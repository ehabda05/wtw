// DemoSession: the live web demo's single group chat "the crew" (Ana, Ben, Sam, Jo, Maya, You) on the REAL engine.
// Every operation runs through one queue, so browsers, the script player and tests never interleave engine work.
// Subscribers get transcript entries, clock moves, call state and resets (the SSE stream fans them out).

import { DateTime } from 'luxon';
import type { AlbumGallery } from '../album/gallery.js';
import { samplePhoto } from '../album/sample.js';
import type { TranscriptEntry } from '../channels/sim.js';
import { personaName } from '../channels/sim.js';
import { loadConfig, type Config } from '../config.js';
import type { GroupState } from '../engine/types.js';
import { createLogger, type Logger } from '../privacy/logger.js';
import { loadPlacesService } from '../runner/load.js';
import { cannedPlaceOptions, createStubPlaces } from '../runner/mocks.js';
import { loadEngine, type EngineApi, type PlacesService } from '../runner/services.js';
import type { CallView } from './voice.js';
import { realCallsFromEnv, type RealCallBridge, type RealCallSetup } from './realcall.js';
import { routerFromEnv, type RepairFn, type RouterSetup } from '../llm/router.js';
import { buildWorld, GROUP_NAME, PERSONAS, type World } from './world.js';

/** A transcript entry as the browser sees it: file bodies stay on the server (GET /api/file/<ref>). */
export interface WebEntry extends Omit<TranscriptEntry, 'file' | 'spaceId'> {
  seq: number;
  file?: { name: string; mime: string };
}

export type SessionEvent =
  | { type: 'entry'; entry: WebEntry }
  | { type: 'clock'; now: number }
  | { type: 'call'; call: CallView | null }
  | { type: 'reset' };

export interface DemoSessionOptions {
  /** Fake-clock start (ms or ISO). Default: now, to the minute. */
  start?: number | string;
  tz?: string;
  logger?: Logger;
  engine?: EngineApi;
  /** Real phone calls for chosen personas (default: from WEB_REAL_CALLS + .env voice keys; null = never). */
  realCalls?: RealCallSetup | null;
  /** LLM repair router (default: HOMI_LLM=on or DISABLE_HOSTED_LLM=false, plus ANTHROPIC_API_KEY; null = never). */
  llm?: RouterSetup | null;
}

const MAX_TEXT = 2000;

export class DemoSession {
  readonly personas = [...PERSONAS];
  readonly group = GROUP_NAME;
  readonly tz: string;
  readonly #config: Config;
  readonly #engine: EngineApi;
  readonly #places: PlacesService;
  readonly #logger: Logger;
  readonly #listeners = new Set<(e: SessionEvent) => void>();
  #seqOf = new WeakMap<TranscriptEntry, number>();
  #seq = 0;
  #world!: World;
  #queue: Promise<unknown> = Promise.resolve();

  #realCalls: RealCallBridge | null = null;
  /** Startup notes about real calls (no numbers or keys). */
  realCallNotes: string[] = [];
  #repair: RepairFn | null = null;
  /** Startup note about the LLM repair router ("LLM fallback ON (Claude, redacted snippets)" / "OFF ..."). */
  llmNote = 'LLM fallback OFF';

  private constructor(config: Config, engine: EngineApi, places: PlacesService, logger: Logger) {
    this.#config = config;
    this.#engine = engine;
    this.#places = places;
    this.#logger = logger;
    this.tz = config.defaultTz;
  }

  static async create(opts: DemoSessionOptions = {}): Promise<DemoSession> {
    // Offline and self-contained: no .env, ephemeral keys, offline places, simulated voice. The availability
    // classifier stays off; only the opt-in repair router below may use a hosted LLM (redacted snippets).
    const config = loadConfig({ sim: true, loadDotEnv: false, warn: () => undefined });
    config.places = { provider: 'offline' };
    config.voice = { ...config.voice, mode: 'mock' };
    config.disableHostedLlm = true;
    config.publicBaseUrl = undefined;
    if (opts.tz) {
      if (!DateTime.local().setZone(opts.tz).isValid) throw new Error(`unknown time zone ${opts.tz}`);
      config.defaultTz = opts.tz;
    }
    const logger = opts.logger ?? createLogger({ level: 'warn', sink: (l) => process.stderr.write(l + '\n') });
    const engine = opts.engine ?? (await loadEngine());
    const places = await loadPlacesService(config, logger, () => createStubPlaces(cannedPlaceOptions()));
    const s = new DemoSession(config, engine, places.service, logger);
    const real = opts.realCalls === undefined ? realCallsFromEnv() : opts.realCalls;
    s.#realCalls = real?.bridge ?? null;
    s.realCallNotes = real?.notes ?? [];
    const llm = opts.llm === undefined ? routerFromEnv() : opts.llm;
    s.#repair = llm?.repair ?? null;
    s.llmNote = llm?.note ?? 'LLM fallback OFF';
    s.#world = await s.#build(s.#startMs(opts.start));
    return s;
  }

  // ───────────── reads ─────────────

  now(): number {
    return this.#world.clock.now();
  }
  get startedAt(): number {
    return this.#world.start;
  }
  get call(): CallView | null {
    return this.#world.voice.current;
  }
  get gallery(): AlbumGallery | undefined {
    return this.#world.gallery;
  }
  get photoStore() {
    return this.#world.photoStore;
  }
  get pristine(): boolean {
    return this.#world.hub.transcript.length === 0;
  }

  transcript(): WebEntry[] {
    return this.#world.hub.transcript.map((e) => this.#web(e));
  }

  /** The generated sample image behind a persona's photo message (same seed as SimHub.photoAs). */
  samplePhoto(ref: string, size = 240): Uint8Array | undefined {
    const e = this.#world.hub.entry(ref);
    return e?.photo ? samplePhoto(`${e.spaceId}:${e.from}:${ref}`, size) : undefined;
  }

  file(ref: string): { name: string; mime: string; content: string } | undefined {
    return this.#world.hub.entry(ref)?.file;
  }

  subscribe(cb: (e: SessionEvent) => void): () => void {
    this.#listeners.add(cb);
    return () => this.#listeners.delete(cb);
  }

  // ───────────── operations (queued) ─────────────

  say(persona: string, text: string, replyTo?: string): Promise<string> {
    return this.#run(async (w) => {
      const p = this.#persona(persona);
      const t = cleanText(text);
      const target = replyTo ? this.#target(replyTo) : undefined;
      if (replyTo && !target) throw new DemoError(`no message "${replyTo}" to reply to`);
      return w.hub.say(w.spaceId, p, t, target ? { replyTo: target } : {});
    });
  }

  react(persona: string, emoji: string, target: string): Promise<void> {
    return this.#run(async (w) => {
      const p = this.#persona(persona);
      const e = String(emoji ?? '').trim();
      if (!e || e.length > 16) throw new DemoError('bad emoji');
      const ref = this.#target(target);
      if (!ref) throw new DemoError(`no message "${target}" to react to`);
      await w.hub.reactAs(w.spaceId, p, e, ref);
    });
  }

  photo(persona: string, caption?: string, replyTo?: string): Promise<string> {
    return this.#run(async (w) => {
      const p = this.#persona(persona);
      const c = caption?.trim() ? cleanText(caption) : undefined;
      const target = replyTo ? this.#target(replyTo) : undefined;
      return w.hub.photoAs(w.spaceId, p, c, target ? { replyTo: target } : {});
    });
  }

  /** What a persona says on Homi's (simulated) call: answers a ringing call now, or the next one. null = no pickup. */
  answer(persona: string, text: string | null): Promise<{ answered: boolean }> {
    return this.#run(async (w) => {
      const p = this.#persona(persona);
      const t = text === null ? null : cleanText(text);
      const answered = await w.voice.answer(p, t);
      if (answered) await w.clock.advance(w.voice.delayMs);
      return { answered };
    });
  }

  /** Fast-forward the fake clock; due nudges, calls, reminders and settlements fire in order. Pauses on a ringing call. */
  fastForward(ms: number): Promise<{ now: number; paused: boolean }> {
    return this.#run(async (w) => {
      if (!Number.isFinite(ms) || ms <= 0 || ms > 60 * 86_400_000) throw new DemoError('fast-forward between 1 ms and 60 days');
      const target = w.clock.now() + ms;
      w.hub.system(w.spaceId, `⏩ Fast-forward ${durationLabel(ms)} → ${this.#fmt(target)}`, 'send', { tag: 'ff' });
      let paused = false;
      for (let guard = 0; guard < 10_000 && w.clock.now() < target; guard++) {
        const due = w.scheduler.nextDueAt();
        const step = due !== undefined && due > w.clock.now() && due < target ? due : target;
        await w.clock.advanceTo(step);
        await w.settle();
        if (w.voice.isRinging()) {
          paused = w.clock.now() < target;
          break;
        }
      }
      if (paused) {
        const who = personaName(w.voice.current?.persona ?? 'someone');
        w.hub.system(w.spaceId, `⏸ Clock paused at ${this.#fmt(w.clock.now())}: Homi is calling ${who}`, 'send', { tag: 'ff' });
      }
      return { now: w.clock.now(), paused };
    });
  }

  /** ms from now to tomorrow 10am (local), the "next day" button. */
  msToNextDay(): number {
    const now = DateTime.fromMillis(this.now(), { zone: this.tz });
    return now.plus({ days: 1 }).set({ hour: 10, minute: 0, second: 0, millisecond: 0 }).toMillis() - now.toMillis();
  }

  /** Throw the world away and start a fresh "the crew" chat. */
  reset(start?: number | string): Promise<void> {
    return this.#run(async (w) => {
      const ms = this.#startMs(start);
      w.close();
      this.#world = await this.#build(ms);
      this.#emit({ type: 'reset' });
    }, false);
  }

  /** Resolves when everything queued so far has finished. */
  /** Resolves when no REAL phone call is still ringing (the scripted demo waits on it). */
  waitForCalls(): Promise<void> {
    return this.#world.voice.whenRealSettled();
  }

  idle(): Promise<void> {
    return this.#queue.then(() => undefined, () => undefined);
  }

  close(): void {
    this.#world.close();
    this.#listeners.clear();
  }

  // ───────────── internals ─────────────

  async #build(start: number): Promise<World> {
    this.#seqOf = new WeakMap();
    this.#seq = 0;
    return buildWorld({
      config: this.#config,
      engine: this.#engine,
      places: this.#places,
      logger: this.#logger,
      start,
      onEntry: (e) => {
        this.#seqOf.set(e, ++this.#seq);
        this.#emit({ type: 'entry', entry: this.#web(e) });
      },
      onCall: (c) => this.#emit({ type: 'call', call: { ...c } }),
      realCalls: this.#realCalls,
      repair: this.#repair,
    });
  }

  #run<T>(fn: (w: World) => Promise<T>, settle = true): Promise<T> {
    const job = this.#queue.then(async () => {
      const w = this.#world;
      const out = await fn(w);
      if (settle) await w.settle();
      this.#emit({ type: 'clock', now: this.now() });
      return out;
    });
    this.#queue = job.catch(() => undefined);
    return job;
  }

  #emit(e: SessionEvent): void {
    for (const l of [...this.#listeners]) {
      try {
        l(e);
      } catch {
        /* a broken subscriber never breaks the demo */
      }
    }
  }

  #web(e: TranscriptEntry): WebEntry {
    const { file, spaceId: _space, ...rest } = e;
    const out: WebEntry = { ...rest, seq: this.#seqOf.get(e) ?? 0 };
    if (file) out.file = { name: file.name, mime: file.mime };
    return out;
  }

  #persona(p: string): string {
    const id = String(p ?? '').toLowerCase().trim();
    if (!this.personas.includes(id)) throw new DemoError(`unknown persona "${p}" (${this.personas.join(', ')})`);
    return id;
  }

  /** "last", a ref (sim-12 / u-3), or "N" = Homi's option bubble N (place bubble N while a place vote is open). */
  #target(spec: string): string | undefined {
    const w = this.#world;
    const s = String(spec ?? '').trim();
    if (s === 'last') return w.hub.lastHomiMessage(w.spaceId)?.ref;
    if (/^(sim|u)-\d+$/.test(s)) return w.hub.entry(s) ? s : undefined;
    const n = Number(s.replace(/^#/, ''));
    if (!Number.isInteger(n) || n < 1) return undefined;
    const state: GroupState | null = w.repo.loadGroup(w.ids.space('sim', w.spaceId));
    const plan = state?.plan;
    if (plan) {
      const placeVote = plan.hungry && plan.hungry.phase === 'voting';
      const place = plan.refs?.placeOptions?.[n];
      const option = plan.refs?.options?.[n];
      if (placeVote && place) return place;
      if (option) return option;
      if (place) return place;
    }
    const tagged = w.hub.homiMessages(w.spaceId).reverse().find((e) => e.tag && new RegExp(`(^|\\D)${n}$`).test(e.tag));
    return tagged?.ref;
  }

  #startMs(start?: number | string): number {
    if (start === undefined || start === '') return Math.floor(Date.now() / 60_000) * 60_000;
    const t = typeof start === 'number' ? DateTime.fromMillis(start) : DateTime.fromISO(start, { zone: this.tz });
    if (!t.isValid) throw new DemoError(`bad start "${start}" (use ISO, e.g. 2026-10-17T10:00:00-04:00)`);
    return t.toMillis();
  }

  #fmt(t: number): string {
    return DateTime.fromMillis(t, { zone: this.tz }).toFormat('ccc LLL d, h:mm a');
  }
}

/** A user-facing error (bad persona, bad target): the API answers 400 with its message. */
export class DemoError extends Error {
  readonly status = 400;
}

function cleanText(t: unknown): string {
  const s = String(t ?? '').replace(/\r\n?/g, '\n').trim();
  if (!s) throw new DemoError('empty message');
  if (s.length > MAX_TEXT) throw new DemoError(`message longer than ${MAX_TEXT} characters`);
  return s;
}

export function durationLabel(ms: number): string {
  const parts: string[] = [];
  let m = Math.round(ms / 60_000);
  const d = Math.floor(m / 1440);
  m -= d * 1440;
  const h = Math.floor(m / 60);
  m -= h * 60;
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m || parts.length === 0) parts.push(`${m}m`);
  return '+' + parts.join(' ');
}
