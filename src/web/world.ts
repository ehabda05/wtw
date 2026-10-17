// One simulated world for the web demo, wired exactly like the offline sim (src/cli/sim-app.ts): FakeClock,
// in-memory SQLite Repo, Sealer + Ids, the real engine, offline places, MockVoice on the fake clock, the extension
// handlers (travel, pledges, encrypted album) in a temp folder, Runner, Scheduler and one SimHub group.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { galleryFor, type AlbumGallery } from '../album/gallery.js';
import { DEFAULT_PERSONAS, SimHub, personaName, type TranscriptEntry } from '../channels/sim.js';
import type { Config } from '../config.js';
import { Sealer } from '../privacy/crypto.js';
import { Ids } from '../privacy/ids.js';
import type { Logger } from '../privacy/logger.js';
import { Retention } from '../privacy/retention.js';
import { FakeClock } from '../runner/clock.js';
import { createExtHandlers, type ExtHandlerDeps, type PhotoStore } from '../runner/handlers/index.js';
import { Runner } from '../runner/runner.js';
import { Scheduler } from '../runner/scheduler.js';
import type { EngineApi, PlacesService } from '../runner/services.js';
import { openDatabase } from '../store/db.js';
import { Repo } from '../store/repo.js';
import { DemoVoice, type CallView } from './voice.js';
import type { RealCallBridge } from './realcall.js';
import type { RepairFn } from '../llm/router.js';

export const GROUP_NAME = 'the crew';
export const PERSONAS: readonly string[] = DEFAULT_PERSONAS;

export interface WorldDeps {
  config: Config;
  engine: EngineApi;
  places: PlacesService;
  logger: Logger;
  start: number;
  onEntry(e: TranscriptEntry): void;
  onCall(c: CallView): void;
  /** Optional real phone calls (WEB_REAL_CALLS + voice keys), src/web/realcall.ts. */
  realCalls?: RealCallBridge | null;
  /** Optional LLM repair router (HOMI_LLM=on + ANTHROPIC_API_KEY), src/llm/router.ts. Off when null. */
  repair?: RepairFn | null;
}

export interface World {
  start: number;
  clock: FakeClock;
  db: DatabaseSync;
  repo: Repo;
  ids: Ids;
  hub: SimHub;
  runner: Runner;
  scheduler: Scheduler;
  voice: DemoVoice;
  photoStore?: PhotoStore;
  gallery?: AlbumGallery;
  spaceId: string;
  /** Waits for the runner, runs due jobs, waits again (sim-app's settle). */
  settle(): Promise<void>;
  close(): void;
}

export async function buildWorld(d: WorldDeps): Promise<World> {
  const { config, logger } = d;
  const clock = new FakeClock(d.start);
  const db = openDatabase(':memory:');
  const repo = new Repo(db, new Sealer(config.dataKey), { now: () => clock.now(), logger });
  const ids = new Ids(config.idSalt);
  const voice = new DemoVoice(clock, 2000, d.realCalls ?? undefined);
  const hub = new SimHub({ now: () => clock.now() });
  hub.onTranscript((e) => d.onEntry(e));

  // Album photos are sealed with DATA_KEY into a temp folder that is deleted on reset and exit. No PUBLIC_BASE_URL,
  // so album links stay labeled "demo link"; the web page maps them to this server's /a/<albumId>.
  const albumDir = mkdtempSync(join(tmpdir(), 'homi-web-'));
  const extDeps: ExtHandlerDeps & { dataKey: Buffer; sweepIntervalMs: false } = {
    dataDir: albumDir,
    dataKey: config.dataKey,
    paymentsProvider: config.paymentsProvider,
    travelProvider: config.travelProvider,
    now: () => clock.now(),
    sweepIntervalMs: false,
  };
  const ext = createExtHandlers(extDeps);

  const runner = new Runner({
    engine: d.engine,
    repo,
    ids,
    clock,
    config,
    logger,
    places: d.places,
    voice,
    onSent: (info) => hub.annotate(info.msgRef, info.tag),
    handlers: ext.handlers,
    photoStore: ext.photoStore,
    repairWithLlm: d.repair ?? undefined,
    extraNames: PERSONAS.map(personaName),
  });
  runner.addAdapter(hub);
  await hub.start((m) => runner.handleInbound(m));
  const spaceId = hub.createSpace(PERSONAS).id;

  // Call lines in the chat, labeled like the sim; the result goes to the runner inside the fake-clock timer.
  voice.onCall = (c) => {
    const label = c.real ? '📞 (REAL call · Photon 2.0 + Retell)' : '📞 (simulated call)';
    if (c.state === 'ringing') hub.system(spaceId, `${label} Homi is calling ${personaName(c.persona)}: "${c.question}"`, 'call', { to: c.persona });
    else hub.system(spaceId, `${label} ${c.state === 'answered' ? `answered: "${c.answer ?? ''}"` : 'did not pick up'}`, 'call', { to: c.persona });
    d.onCall(c);
  };
  // Returning the promise lets the fake-clock timer await the runner (MockVoice awaits its listeners).
  voice.onResult((r) => runner.handleCallResult(r));

  const scheduler = new Scheduler({ repo, runner, clock, retention: new Retention(repo, logger), logger });
  scheduler.start();

  const settle = async () => {
    await runner.whenIdle();
    await scheduler.tick();
    await runner.whenIdle();
  };

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    scheduler.stop();
    void hub.stop();
    try {
      db.close();
    } catch {
      /* already closed */
    }
    rmSync(albumDir, { recursive: true, force: true });
  };

  return {
    start: d.start,
    clock,
    db,
    repo,
    ids,
    hub,
    runner,
    scheduler,
    voice,
    photoStore: ext.photoStore,
    gallery: galleryFor(ext.photoStore),
    spaceId,
    settle,
    close,
  };
}
