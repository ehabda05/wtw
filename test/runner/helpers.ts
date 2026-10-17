// Shared test fixtures: a tiny fake engine, a recording adapter, and an in-memory environment.

import { randomBytes } from 'node:crypto';
import type { ChannelAdapter, ChannelInbound } from '../../src/channels/types.js';
import { CAPS } from '../../src/channels/types.js';
import type { Action, Capabilities, Ctx, EngineEvent, GroupState, MsgRef, Plan, PlanState } from '../../src/engine/types.js';
import { Sealer } from '../../src/privacy/crypto.js';
import { Ids } from '../../src/privacy/ids.js';
import { createLogger, type Logger, type LogSink } from '../../src/privacy/logger.js';
import { FakeClock } from '../../src/runner/clock.js';
import { Runner, type RunnerDeps } from '../../src/runner/runner.js';
import type { EngineApi, PlacesService, VoiceService } from '../../src/runner/services.js';
import { openDatabase } from '../../src/store/db.js';
import { Repo } from '../../src/store/repo.js';

export const INTRO = "Hi, I'm Homi 👋 Mention me or say /plan and I'll find a date and a place for this group.";

export type Handler = (state: GroupState, event: EngineEvent, ctx: Ctx) => Action[] | void;

export interface FakeEngine extends EngineApi {
  events: EngineEvent[];
  ctxs: Ctx[];
}

/** Minimal engine: sends the intro once per space (first sight), then delegates to `on`. */
export function fakeEngine(on?: Handler): FakeEngine {
  const events: EngineEvent[] = [];
  const ctxs: Ctx[] = [];
  return {
    events,
    ctxs,
    newGroupState(spaceKey: string, tz: string): GroupState {
      return { space: { spaceKey, introSent: false, tone: 'normal', tz, notice: false, muted: false }, plan: null };
    },
    detectAddressed(text: string): boolean {
      return /\bhomi\b/i.test(text) || /^\s*\//.test(text);
    },
    applyEvent(state: GroupState, event: EngineEvent, ctx: Ctx) {
      events.push(event);
      ctxs.push(ctx);
      const s: GroupState = structuredClone(state);
      const actions: Action[] = [];
      if (!s.space.introSent && event.kind !== 'sent' && event.kind !== 'timer') {
        s.space.introSent = true;
        actions.push({ type: 'send', text: INTRO, prompting: 'unprompted', tag: 'intro' });
      }
      const more = on?.(s, event, ctx);
      if (more) actions.push(...more);
      return { state: s, actions };
    },
  };
}

export function makePlan(id: string, over: Partial<Plan> = {}): Plan {
  return {
    id,
    state: 'collecting_availability' as PlanState,
    stack: [],
    activity: 'dinner',
    outdoor: false,
    initiator: 'a'.repeat(64),
    options: [],
    members: {},
    notes: {},
    nudges: [],
    refs: { options: {}, placeOptions: {} },
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

export interface Call {
  method: string;
  args: unknown[];
}

export class RecordingAdapter implements ChannelAdapter {
  readonly surface: ChannelAdapter['surface'];
  readonly caps: Capabilities;
  readonly calls: Call[] = [];
  onInbound?: (m: ChannelInbound) => Promise<void>;
  #seq = 0;
  failWith?: Error;

  constructor(caps: Capabilities = CAPS.sim) {
    this.caps = caps;
    this.surface = caps.surface;
  }
  #rec(method: string, ...args: unknown[]): void {
    this.calls.push({ method, args });
    if (this.failWith) throw this.failWith;
  }
  #ref(): MsgRef {
    return `r-${++this.#seq}`;
  }
  async start(onInbound: (m: ChannelInbound) => Promise<void>): Promise<void> {
    this.onInbound = onInbound;
  }
  async stop(): Promise<void> {}
  async send(spaceId: string, text: string) {
    this.#rec('send', spaceId, text);
    return this.#ref();
  }
  async reply(spaceId: string, to: MsgRef, text: string) {
    this.#rec('reply', spaceId, to, text);
    return this.#ref();
  }
  async poll(spaceId: string, question: string, options: string[]) {
    this.#rec('poll', spaceId, question, options);
    return this.#ref();
  }
  async edit(spaceId: string, target: MsgRef, text: string) {
    this.#rec('edit', spaceId, target, text);
  }
  async react(spaceId: string, to: MsgRef, emoji: string) {
    this.#rec('react', spaceId, to, emoji);
  }
  async dm(handle: string, text: string) {
    this.#rec('dm', handle, text);
    return this.#ref();
  }
  async file(spaceId: string, name: string, mime: string, content: string, caption?: string) {
    this.#rec('file', spaceId, name, mime, content, caption);
    return this.#ref();
  }
  async leave(spaceId: string) {
    this.#rec('leave', spaceId);
  }
  async typing(spaceId: string, on: boolean) {
    this.#rec('typing', spaceId, on);
  }
  methods(): string[] {
    return this.calls.map((c) => c.method);
  }
  sends(): string[] {
    return this.calls.filter((c) => c.method === 'send' || c.method === 'reply').map((c) => String(c.args[c.args.length - 1]));
  }
}

export interface Env {
  repo: Repo;
  ids: Ids;
  clock: FakeClock;
  runner: Runner;
  adapter: RecordingAdapter;
  engine: FakeEngine;
  sealer: Sealer;
  logger: Logger;
  lines: string[];
  dataKey: Buffer;
}

export interface EnvOptions {
  engine?: FakeEngine;
  caps?: Capabilities;
  places?: PlacesService;
  voice?: VoiceService;
  start?: number;
  dbPath?: string;
  logLevel?: 'debug' | 'info' | 'warn' | 'error' | 'silent';
  placesTimeoutMs?: number;
  /** Extra Runner deps (e.g. repairWithLlm, repairTimeoutMs, extraNames). */
  runnerDeps?: Partial<RunnerDeps>;
  /** Demo quorum timers (Ctx.quorum). */
  quorum?: { dmAfterMs: number; replyMs: number; minYes: number };
}

export const SALT = 'test-salt-0123456789abcdef';

export function makeEnv(opts: EnvOptions = {}): Env {
  const lines: string[] = [];
  const sink: LogSink = (l) => lines.push(l);
  const logger = createLogger({ level: opts.logLevel ?? 'debug', sink });
  const clock = new FakeClock(opts.start ?? Date.UTC(2026, 9, 17, 14, 0));
  const dataKey = randomBytes(32);
  const sealer = new Sealer(dataKey);
  const db = openDatabase(opts.dbPath ?? ':memory:');
  const repo = new Repo(db, sealer, { now: () => clock.now(), logger });
  const ids = new Ids(SALT);
  const engine = opts.engine ?? fakeEngine();
  const adapter = new RecordingAdapter(opts.caps ?? CAPS.sim);
  let n = 0;
  const runner = new Runner({
    engine,
    repo,
    ids,
    clock,
    logger,
    config: { retentionHours: 24, quietHours: [23, 9], defaultTz: 'America/New_York', ...(opts.quorum ? { quorum: opts.quorum } : {}) },
    adapters: [adapter],
    places: opts.places,
    voice: opts.voice,
    newId: () => `id-${++n}`,
    placesTimeoutMs: opts.placesTimeoutMs,
    ...opts.runnerDeps,
  });
  return { repo, ids, clock, runner, adapter, engine, sealer, logger, lines, dataKey };
}

let msgSeq = 0;
export function textIn(spaceId: string, handle: string, text: string, over: Partial<ChannelInbound> = {}): ChannelInbound {
  return {
    surface: 'sim',
    spaceId,
    isGroup: true,
    kind: 'text',
    from: { handle, platformName: handle.replace(/^persona:/, '') },
    text,
    msgId: `m-${++msgSeq}`,
    mentionsAgent: false,
    at: 0,
    ...over,
  };
}
