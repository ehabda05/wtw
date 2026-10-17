// Inbound pipeline and event loop (docs/ARCHITECTURE.md):
//   dedupe sha256(surface+spaceId+msgId) -> spaceKey -> muted? drop silently -> load or newGroupState
//   -> member key -> EngineEvent(s) -> applyEvent -> save -> execute actions -> follow-up events (sent, lookups)
// A per-space async mutex keeps each group's events strictly sequential.
// Raw text and handles live only in this call's memory; nothing here logs or persists them.

import { parseDuration } from './clock.js';
import { randomUUID } from 'node:crypto';
import type { ChannelAdapter, ChannelInbound } from '../channels/types.js';
import type { ApplyResult, Ctx, EngineEvent, GroupState, MemberRef, MessageEvent, MsgRef, Plan, SpaceKey, Surface } from '../engine/types.js';
import { shortKey, type Ids } from '../privacy/ids.js';
import { silentLogger, type Logger } from '../privacy/logger.js';
import { containsPii } from '../privacy/redact.js';
import type { Repo } from '../store/repo.js';
import type { Clock } from './clock.js';
import { Executor, type SentInfo } from './executor.js';
import type { CallResult, EngineApi, PlacesService, VoiceService } from './services.js';
import type { ActionHandler, PhotoStore } from './handlers/types.js';
import { restorePlaceholders, type RepairFn } from '../llm/router.js';
import { NameMemory, REPAIR_TIMEOUT_MS, RepairTimeout, knownNamesFor, onlyGenericFallback, repairContext, skipRepair, withTimeout } from './repair.js';

export { type EngineApi } from './services.js';

/** Per-key async mutex. */
export class KeyedMutex {
  readonly #tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.#tails.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const tail = next.catch(() => undefined);
    this.#tails.set(key, tail);
    void tail.then(() => {
      if (this.#tails.get(key) === tail) this.#tails.delete(key);
    });
    return next;
  }
}

/** Small insertion-ordered LRU set of Homi-sent message refs per space. */
class RefLru {
  readonly #spaces = new Map<string, Set<string>>();
  constructor(
    private readonly perSpace = 256,
    private readonly maxSpaces = 1000,
  ) {}
  add(space: string, ref: string): void {
    let set = this.#spaces.get(space);
    if (!set) {
      set = new Set();
      if (this.#spaces.size >= this.maxSpaces) {
        const oldest = this.#spaces.keys().next().value;
        if (oldest !== undefined) this.#spaces.delete(oldest);
      }
    } else {
      this.#spaces.delete(space); // refresh recency
    }
    this.#spaces.set(space, set);
    set.delete(ref);
    set.add(ref);
    if (set.size > this.perSpace) {
      const first = set.values().next().value;
      if (first !== undefined) set.delete(first);
    }
  }
  has(space: string, ref: string): boolean {
    return this.#spaces.get(space)?.has(ref) ?? false;
  }
  drop(space: string): void {
    this.#spaces.delete(space);
  }
}

export function planRefs(plan: Plan | null | undefined): MsgRef[] {
  if (!plan?.refs) return [];
  const r = plan.refs;
  const out: MsgRef[] = [];
  if (r.header) out.push(r.header);
  if (r.poll) out.push(r.poll);
  if (r.placePoll) out.push(r.placePoll);
  for (const v of Object.values(r.options ?? {})) if (v) out.push(v);
  for (const v of Object.values(r.placeOptions ?? {})) if (v) out.push(v);
  return out;
}

export interface RunnerConfig {
  retentionHours: number;
  quietHours: [number, number];
  defaultTz: string;
}

export interface RunnerDeps {
  engine: EngineApi;
  repo: Repo;
  ids: Ids;
  clock: Clock;
  config: RunnerConfig;
  logger?: Logger;
  adapters?: ChannelAdapter[];
  places?: PlacesService;
  voice?: VoiceService;
  newId?: () => string;
  onSent?: (info: SentInfo) => void;
  placesTimeoutMs?: number;
  /** Max engine passes per inbound/timer (1 + follow-ups). */
  maxPasses?: number;
  /** DEMO_MODE only: the visible `homi demo ff 22h` command moves the clock and runs due jobs. */
  demo?: { fastForward(ms: number): Promise<void> };
  /**
   * Gated hosted-LLM fallback (off unless DISABLE_HOSTED_LLM=false and a key is set). Called only for an addressed
   * reply the local parser could not read while dates are open; receives option labels and names to redact.
   */
  hostedLlm?: (text: string, optionLabels: string[], knownNames: string[]) => Promise<{ optionIds: number[]; vote: 'yes' | 'maybe' | 'no' } | null>;
  /**
   * Gated LLM repair router (src/llm/router.ts; off unless enabled and a key is set). Called at most once per
   * ADDRESSED message whose engine result is only a generic fallback; the engine then re-runs on the rewrite.
   */
  repairWithLlm?: RepairFn;
  /** Budget for one repair call (default 4000 ms); on timeout the original reply stands. */
  repairTimeoutMs?: number;
  /** Names always redacted before a repair call (e.g. the demo personas), besides the ones Homi has seen. */
  extraNames?: string[];
  /** Extension action handlers and the album photo store (src/runner/handlers). */
  handlers?: ActionHandler[];
  photoStore?: PhotoStore;
  /** Public base URL for member-only links (album page). */
  publicBaseUrl?: string;
}

const DEMO_FF = /^\s*@?homi[,:]?\s+demo\s+ff\s+((?:\d+[smhd])+)\s*$/i;

interface Origin {
  spaceKey: SpaceKey;
  surface: Surface;
  spaceId: string;
  adapter: ChannelAdapter;
  inboundHandle?: string;
  inboundMemberKey?: string;
}

export class Runner {
  readonly #engine: EngineApi;
  readonly #repo: Repo;
  readonly #ids: Ids;
  readonly #clock: Clock;
  readonly #config: RunnerConfig;
  readonly #log: Logger;
  readonly #adapters = new Map<Surface, ChannelAdapter>();
  readonly #executor: Executor;
  readonly #newId: () => string;
  readonly #mutex = new KeyedMutex();
  readonly #refs = new RefLru();
  readonly #maxPasses: number;
  readonly #demo?: RunnerDeps['demo'];
  readonly #hostedLlm?: RunnerDeps['hostedLlm'];
  readonly #photoStore?: PhotoStore;
  readonly #publicBaseUrl?: string;
  readonly #repair?: RepairFn;
  readonly #repairTimeoutMs: number;
  readonly #extraNames: string[];
  readonly #names = new NameMemory();
  #inflight = 0;
  #idleWaiters: (() => void)[] = [];

  constructor(deps: RunnerDeps) {
    this.#engine = deps.engine;
    this.#repo = deps.repo;
    this.#ids = deps.ids;
    this.#clock = deps.clock;
    this.#config = deps.config;
    this.#log = deps.logger ?? silentLogger;
    this.#newId = deps.newId ?? (() => randomUUID());
    this.#maxPasses = deps.maxPasses ?? 25;
    this.#demo = deps.demo;
    this.#hostedLlm = deps.hostedLlm;
    this.#photoStore = deps.photoStore;
    this.#publicBaseUrl = deps.publicBaseUrl;
    this.#repair = deps.repairWithLlm;
    this.#repairTimeoutMs = deps.repairTimeoutMs ?? REPAIR_TIMEOUT_MS;
    this.#extraNames = deps.extraNames ?? [];
    for (const a of deps.adapters ?? []) this.addAdapter(a);
    const onSent = deps.onSent;
    this.#executor = new Executor({
      repo: deps.repo,
      logger: this.#log,
      places: deps.places,
      voice: deps.voice,
      placesTimeoutMs: deps.placesTimeoutMs,
      handlers: deps.handlers,
      onSent: (info) => {
        this.#refs.add(info.spaceKey, info.msgRef);
        onSent?.(info);
      },
    });
  }

  addAdapter(a: ChannelAdapter): void {
    this.#adapters.set(a.surface, a);
  }

  adapterFor(surface: Surface): ChannelAdapter | undefined {
    return this.#adapters.get(surface);
  }

  /** True if ref is a message Homi sent in this space (recent LRU or a ref stored on the plan). */
  isHomiRef(spaceKey: SpaceKey, ref: MsgRef | undefined, state?: GroupState | null): boolean {
    if (!ref) return false;
    if (this.#refs.has(spaceKey, ref)) return true;
    return planRefs(state?.plan).includes(ref);
  }

  #track(): () => void {
    this.#inflight++;
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.#inflight--;
      if (this.#inflight === 0) for (const w of this.#idleWaiters.splice(0)) w();
    };
  }

  /** Resolves when no inbound / dispatch is in flight. */
  whenIdle(): Promise<void> {
    if (this.#inflight === 0) return Promise.resolve();
    return new Promise((r) => this.#idleWaiters.push(r));
  }

  #memberRef(surface: Surface, spaceId: string, user: { handle: string; platformName?: string }): MemberRef {
    const ref: MemberRef = { key: this.#ids.member(surface, spaceId, user.handle) };
    // platformName must never be a phone number / email / handle-like string.
    if (user.platformName && !containsPii(user.platformName)) ref.platformName = user.platformName.slice(0, 64);
    return ref;
  }

  #toEvents(m: ChannelInbound, spaceKey: SpaceKey, state: GroupState): EngineEvent[] {
    switch (m.kind) {
      case 'text': {
        if (!m.from || m.text === undefined) return [];
        const from = this.#memberRef(m.surface, m.spaceId, m.from);
        if (this.#repair) this.#names.add(spaceKey, from.platformName);
        let addressed = m.mentionsAgent;
        if (!addressed) {
          try {
            addressed = this.#engine.detectAddressed(m.text);
          } catch {
            addressed = false;
          }
        }
        if (!addressed && m.replyTo) addressed = this.isHomiRef(spaceKey, m.replyTo, state);
        const ev: EngineEvent = { kind: 'message', from, text: m.text, msgRef: m.msgId, addressed };
        if (m.replyTo) ev.replyTo = m.replyTo;
        return [ev];
      }
      case 'reaction': {
        if (!m.from || !m.reaction) return [];
        const ev: EngineEvent = {
          kind: 'reaction',
          from: this.#memberRef(m.surface, m.spaceId, m.from),
          emoji: m.reaction.emoji,
          target: m.reaction.target,
        };
        if (m.reaction.removed) ev.removed = true;
        return [ev];
      }
      case 'poll_vote': {
        if (!m.from || !m.poll) return [];
        return [
          {
            kind: 'poll_vote',
            from: this.#memberRef(m.surface, m.spaceId, m.from),
            poll: m.poll.pollId,
            optionIndexes: [...m.poll.optionIndexes],
          },
        ];
      }
      case 'members': {
        if (!m.members) return [];
        const members = m.members.map((u) => this.#memberRef(m.surface, m.spaceId, u));
        if (this.#repair) for (const r of members) this.#names.add(spaceKey, r.platformName);
        return [{ kind: 'members_snapshot', members }];
      }
      case 'added_to_group':
        return [{ kind: 'added_to_group' }];
      case 'other': {
        if (!m.from) return [];
        return [{ kind: 'member_seen', from: this.#memberRef(m.surface, m.spaceId, m.from), msgRef: m.msgId }];
      }
      default:
        return [];
    }
  }

  #ctx(adapter: ChannelAdapter): Ctx {
    return {
      now: this.#clock.now(),
      caps: adapter.caps,
      retentionHours: this.#config.retentionHours,
      quietHours: this.#config.quietHours,
      newId: this.#newId,
      publicBaseUrl: this.#publicBaseUrl,
    };
  }

  /** applyEvent -> save -> execute, repeated for follow-up events. Returns null if Homi left the space. */
  async #process(state: GroupState, first: EngineEvent, origin: Origin): Promise<GroupState | null> {
    const queue: EngineEvent[] = [first];
    let passes = 0;
    while (queue.length) {
      if (++passes > this.#maxPasses) {
        this.#log.warn('runner: follow-up limit reached, dropping remaining events', { dropped: queue.length });
        break;
      }
      const ev = queue.shift()!;
      const ctx = this.#ctx(origin.adapter);
      let res = this.#engine.applyEvent(state, ev, ctx);
      if (passes === 1 && this.#repair && ev.kind === 'message' && ev.addressed) res = await this.#repaired(state, ev, ctx, res, origin);
      state = res.state;
      this.#repo.saveGroup(state, { surface: origin.surface, spaceId: origin.spaceId });
      this.#log.debug('runner: applied', {
        event: ev.kind,
        actions: res.actions.map((a) => a.type),
        space: shortKey(origin.spaceKey),
      });
      const out = await this.#executor.execute(res.actions, {
        spaceKey: origin.spaceKey,
        surface: origin.surface,
        spaceId: origin.spaceId,
        adapter: origin.adapter,
        state,
        now: ctx.now,
        inboundHandle: origin.inboundHandle,
        inboundMemberKey: origin.inboundMemberKey,
      });
      if (out.left) {
        this.#refs.drop(origin.spaceKey);
        this.#names.drop(origin.spaceKey);
        return null;
      }
      queue.push(...out.followUps);
    }
    return state;
  }

  /**
   * One repair at most: if the engine's answer to an addressed message is only a generic fallback, ask the router
   * for a canonical command (redacted snippet, 4 s budget) and re-run the engine on the ORIGINAL pre-event state.
   * The repaired result is used only if it says something better; otherwise the first result stands.
   */
  async #repaired(pre: GroupState, ev: MessageEvent, ctx: Ctx, first: ApplyResult, origin: Origin): Promise<ApplyResult> {
    if (!this.#repair || !onlyGenericFallback(first.actions, pre) || skipRepair(ev.text)) return first;
    const space = shortKey(origin.spaceKey);
    const seen = this.#names.get(origin.spaceKey);
    const names = knownNamesFor(pre, ev, [...this.#extraNames, ...seen]);
    const repair = this.#repair;
    let reason = 'no_rewrite';
    try {
      const r = await withTimeout((signal) => repair({ text: ev.text, knownNames: names, context: repairContext(pre, seen.length) }, signal), this.#repairTimeoutMs);
      const rewrite = r ? restorePlaceholders(r.rewrite, ev.text, names) : null;
      if (rewrite && rewrite.trim().toLowerCase() !== ev.text.trim().toLowerCase()) {
        const second = this.#engine.applyEvent(pre, { ...ev, text: rewrite, llmVote: undefined }, ctx);
        if (!onlyGenericFallback(second.actions, pre)) {
          this.#log.info('runner: llm repair used: yes', { space });
          return second;
        }
        reason = 'still_generic';
      } else if (r) {
        reason = 'unusable';
      }
    } catch (err) {
      reason = err instanceof RepairTimeout ? 'timeout' : 'error';
    }
    this.#log.info('runner: llm repair used: no', { space, reason });
    return first;
  }

  async handleInbound(m: ChannelInbound): Promise<void> {
    const done = this.#track();
    try {
      const now = this.#clock.now();
      if (!this.#repo.seen.checkAndMark(this.#ids.msgHash(m.surface, m.spaceId, m.msgId), now)) {
        this.#log.debug('runner: duplicate inbound dropped', { surface: m.surface });
        return;
      }
      const spaceKey = this.#ids.space(m.surface, m.spaceId);
      const ff = this.#demo && m.kind === 'text' && m.text ? DEMO_FF.exec(m.text) : null;
      if (ff && this.#demo) {
        const adapter = this.#adapters.get(m.surface);
        const ms = parseDuration(ff[1]);
        this.#log.info('runner: demo fast-forward', { ms });
        await adapter?.send(m.spaceId, `⏩ Demo mode: fast-forwarding the clock ${ff[1]} (simulated time, for the judges).`).catch(() => undefined);
        await this.#demo.fastForward(ms);
        return;
      }
      await this.#mutex.run(spaceKey, async () => {
        if (this.#repo.isMuted(spaceKey)) return; // tombstoned: ignore forever, silently
        const adapter = this.#adapters.get(m.surface);
        if (!adapter) {
          this.#log.warn('runner: no adapter for surface', { surface: m.surface });
          return;
        }
        let state: GroupState = this.#repo.loadGroup(spaceKey) ?? this.#engine.newGroupState(spaceKey, this.#config.defaultTz);
        const events = m.kind === 'photo' ? await this.#photoEvents(m) : this.#toEvents(m, spaceKey, state);
        if (events.length === 0) return;
        await this.#annotateWithHostedLlm(events, state);
        const origin: Origin = { spaceKey, surface: m.surface, spaceId: m.spaceId, adapter };
        if (m.from) {
          origin.inboundHandle = m.from.handle;
          origin.inboundMemberKey = this.#ids.member(m.surface, m.spaceId, m.from.handle);
        }
        const addressed = events.some((e) => e.kind === 'message' && e.addressed);
        const typing = addressed && adapter.caps.typing && typeof adapter.typing === 'function';
        this.#log.info('runner: inbound', { surface: m.surface, kind: m.kind, addressed, space: shortKey(spaceKey) });
        if (typing) await adapter.typing!(m.spaceId, true).catch(() => undefined);
        let left = false;
        try {
          for (const ev of events) {
            const next = await this.#process(state, ev, origin);
            if (!next) {
              left = true;
              break;
            }
            state = next;
          }
        } finally {
          if (typing && !left) await adapter.typing!(m.spaceId, false).catch(() => undefined);
        }
      });
    } catch (err) {
      this.#log.error('runner: inbound failed', { surface: m.surface, kind: m.kind, err });
    } finally {
      done();
    }
  }

  /**
   * Feed a non-inbound event (timer, call result) into a known space. Throws on engine / storage errors so the
   * scheduler can mark the job failed. Returns false if the space is gone, muted or unroutable.
   */
  async dispatch(spaceKey: SpaceKey, event: EngineEvent): Promise<boolean> {
    const done = this.#track();
    try {
      return await this.#mutex.run(spaceKey, async () => {
        if (this.#repo.isMuted(spaceKey)) return false;
        const routing = this.#repo.getRouting(spaceKey);
        if (!routing) return false;
        const adapter = this.#adapters.get(routing.surface);
        if (!adapter) {
          this.#log.warn('runner: no adapter for routed surface', { surface: routing.surface });
          return false;
        }
        const state = this.#repo.loadGroup(spaceKey);
        if (!state) return false;
        await this.#process(state, event, { spaceKey, surface: routing.surface, spaceId: routing.spaceId, adapter });
        return true;
      });
    } finally {
      done();
    }
  }

  /** Photos: bytes go straight to the album store (never the engine, never logs); the engine gets an opaque id. */
  async #photoEvents(m: ChannelInbound): Promise<EngineEvent[]> {
    if (!m.from || !m.photo || !this.#photoStore) return [];
    const photoId = await this.#photoStore.put(m.photo.bytes, m.photo.mime);
    const caption = m.text?.trim();
    let addressed = m.mentionsAgent;
    if (!addressed && caption) addressed = this.#engine.detectAddressed(caption);
    const ev: EngineEvent = { kind: 'photo', from: this.#memberRef(m.surface, m.spaceId, m.from), msgRef: m.msgId, photoId, mime: m.photo.mime, addressed };
    if (caption) ev.caption = caption;
    if (m.replyTo && ev.kind === 'photo') ev.replyTo = m.replyTo;
    return [ev];
  }

  async #annotateWithHostedLlm(events: EngineEvent[], state: GroupState): Promise<void> {
    if (!this.#hostedLlm || !this.#engine.parseAvailability) return;
    const plan = state.plan;
    if (!plan || plan.state !== 'collecting_availability') return;
    const open = plan.options.filter((o) => !o.removed);
    for (const ev of events) {
      if (ev.kind !== 'message' || !ev.addressed) continue;
      try {
        if (this.#engine.parseAvailability(ev.text, open, state.space.tz).matched) continue;
        // A recognised command ("homi go", "homi status", "homi split 84 3 ways") is never an availability reply, even
        // when it does not apply in the current state. Without this the LLM read "homi go" as "every day works"
        // (seen live in a Telegram group, 2026-10-17).
        const body = this.#engine.stripAddress?.(ev.text) ?? ev.text;
        if (this.#engine.parseCommand?.(body)) continue;
        const names = Object.values(plan.members).map((mb) => mb.name).filter((n): n is string => !!n);
        const vote = await this.#hostedLlm(ev.text, open.map((o) => o.label), names);
        if (vote) {
          const ids = vote.optionIds.map((i) => open[i - 1]?.id).filter((id): id is number => id !== undefined);
          ev.llmVote = { optionIds: ids, vote: vote.vote };
        }
      } catch {
        /* the fallback is best-effort; never block a message on it */
      }
    }
  }

  /** Voice results arrive asynchronously; route them by plan id. */
  async handleCallResult(r: CallResult): Promise<void> {
    try {
      const spaceKey = this.#repo.spaceForPlan(r.planId);
      if (!spaceKey) {
        this.#log.warn('runner: call result for unknown plan dropped');
        return;
      }
      const ev: EngineEvent = { kind: 'call_result', planId: r.planId, member: r.member, ok: r.ok };
      if (r.answerText !== undefined) ev.answerText = r.answerText;
      if (r.simulated) ev.simulated = true;
      await this.dispatch(spaceKey, ev);
    } catch (err) {
      this.#log.error('runner: call result failed', { err });
    }
  }
}
