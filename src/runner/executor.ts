// Action -> adapter / service calls. Branches on Capabilities and never trusts an unsupported call to throw
// (spectrum-ts silently no-ops many of them). Async results come back as follow-up engine events:
// tagged sends -> 'sent', lookups -> 'places_result' / 'weather_result', failed calls -> 'call_result'.

import type { Action, EngineEvent, GroupState, MemberKey, MsgRef, SpaceKey, Surface } from '../engine/types.js';
import type { ChannelAdapter } from '../channels/types.js';
import { shortKey } from '../privacy/ids.js';
import { silentLogger, type Logger } from '../privacy/logger.js';
import type { Repo } from '../store/repo.js';
import type { PlacesService, VoiceService } from './services.js';
import type { ActionHandler } from './handlers/types.js';

export interface ExecContext {
  spaceKey: SpaceKey;
  surface: Surface;
  /** Raw chat id (in memory only). */
  spaceId: string;
  adapter: ChannelAdapter;
  /** Post-apply state (used for the current plan id). */
  state: GroupState;
  now: number;
  /** Raw handle of the sender of the inbound event being processed. Used only by remember_handle; never stored otherwise. */
  inboundHandle?: string;
  /** Member key of that sender (remember_handle must match it). */
  inboundMemberKey?: MemberKey;
}

export interface ExecOutcome {
  followUps: EngineEvent[];
  /** Homi left or tombstoned this space: the caller must not persist it again. */
  left: boolean;
}

export interface SentInfo {
  spaceKey: SpaceKey;
  surface: Surface;
  spaceId: string;
  msgRef: MsgRef;
  tag?: string;
  kind: 'send' | 'reply' | 'poll' | 'file';
}

export interface ExecutorDeps {
  repo: Repo;
  logger?: Logger;
  places?: PlacesService;
  voice?: VoiceService;
  placesTimeoutMs?: number;
  /** Called for every message Homi sends (the runner keeps an LRU of Homi refs; the sim tags its transcript). */
  onSent?: (info: SentInfo) => void;
  /** Extension action handlers (travel, payments, album): src/runner/handlers. */
  handlers?: ActionHandler[];
}

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`timed out after ${ms} ms`);
    this.name = 'TimeoutError';
  }
}

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new TimeoutError(ms)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export class Executor {
  readonly #repo: Repo;
  readonly #log: Logger;
  readonly #places?: PlacesService;
  readonly #voice?: VoiceService;
  readonly #placesTimeoutMs: number;
  readonly #onSent?: (info: SentInfo) => void;
  readonly #handlers: ActionHandler[];

  constructor(deps: ExecutorDeps) {
    this.#repo = deps.repo;
    this.#log = deps.logger ?? silentLogger;
    this.#places = deps.places;
    this.#voice = deps.voice;
    this.#placesTimeoutMs = deps.placesTimeoutMs ?? 3000;
    this.#onSent = deps.onSent;
    this.#handlers = deps.handlers ?? [];
  }

  async execute(actions: Action[], ctx: ExecContext): Promise<ExecOutcome> {
    const out: ExecOutcome = { followUps: [], left: false };
    for (const action of actions) {
      if (out.left) {
        this.#log.debug('executor: action after leave skipped', { action: action.type });
        continue;
      }
      try {
        await this.#one(action, ctx, out);
      } catch (err) {
        this.#log.warn('executor: action failed', { action: action.type, surface: ctx.surface, space: shortKey(ctx.spaceKey), err });
      }
    }
    return out;
  }

  #sent(ctx: ExecContext, out: ExecOutcome, kind: SentInfo['kind'], msgRef: MsgRef | undefined, tag?: string): void {
    if (!msgRef) {
      if (tag) this.#log.debug('executor: tagged send returned no id', { tag, surface: ctx.surface });
      return;
    }
    try {
      this.#onSent?.({ spaceKey: ctx.spaceKey, surface: ctx.surface, spaceId: ctx.spaceId, msgRef, tag, kind });
    } catch {
      /* observer errors never break delivery */
    }
    if (tag) out.followUps.push({ kind: 'sent', tag, msgRef, at: ctx.now });
  }

  async #one(action: Action, ctx: ExecContext, out: ExecOutcome): Promise<void> {
    const { adapter, spaceId } = ctx;
    const caps = adapter.caps;
    switch (action.type) {
      case 'send': {
        const ref = await adapter.send(spaceId, action.text);
        this.#sent(ctx, out, 'send', ref, action.tag);
        return;
      }
      case 'reply': {
        const ref =
          caps.inlineReply && adapter.reply ? await adapter.reply(spaceId, action.to, action.text) : await adapter.send(spaceId, action.text);
        this.#sent(ctx, out, caps.inlineReply ? 'reply' : 'send', ref, action.tag);
        return;
      }
      case 'poll': {
        let ref: MsgRef | undefined;
        if (caps.polls && adapter.poll) {
          ref = await adapter.poll(spaceId, action.question, action.options);
        } else {
          const body = [action.question, ...action.options.map((o, i) => `${i + 1}. ${o}`)].join('\n');
          ref = await adapter.send(spaceId, body);
        }
        this.#sent(ctx, out, 'poll', ref, action.tag);
        return;
      }
      case 'edit': {
        if (caps.edit && adapter.edit) await adapter.edit(spaceId, action.target, action.text);
        else this.#log.debug('executor: edit unsupported, skipped', { surface: ctx.surface });
        return;
      }
      case 'react': {
        if (caps.reactionsOut && adapter.react) await adapter.react(spaceId, action.to, action.emoji);
        else this.#log.debug('executor: react unsupported, skipped', { surface: ctx.surface });
        return;
      }
      case 'file': {
        let ref: MsgRef | undefined;
        if (caps.files && adapter.file) {
          ref = await adapter.file(spaceId, action.name, action.mime, action.content, action.caption);
        } else {
          ref = await adapter.send(spaceId, action.caption ?? action.name);
        }
        this.#sent(ctx, out, 'file', ref);
        return;
      }
      case 'dm': {
        const planId = ctx.state.plan?.id;
        const handle = planId ? this.#repo.delivery.get(action.member, planId) : undefined;
        if (!handle) {
          this.#log.warn('executor: dm skipped, no delivery handle', { member: shortKey(action.member), surface: ctx.surface });
          return;
        }
        if (!caps.dm || !adapter.dm) {
          this.#log.warn('executor: dm unsupported on surface', { surface: ctx.surface });
          return;
        }
        await adapter.dm(handle, action.text);
        return;
      }
      case 'call': {
        const planId = ctx.state.plan?.id;
        const fail = () => {
          if (planId) out.followUps.push({ kind: 'call_result', planId, member: action.member, ok: false });
        };
        const handle = planId ? this.#repo.delivery.get(action.member, planId) : undefined;
        if (!planId || !handle) {
          this.#log.warn('executor: call skipped, no delivery handle', { member: shortKey(action.member) });
          fail();
          return;
        }
        if (!this.#voice) {
          this.#log.warn('executor: call skipped, no voice service');
          fail();
          return;
        }
        try {
          await this.#voice.placeCall({
            to: handle,
            question: action.question,
            options: action.options,
            callRef: action.callRef,
            planId,
            member: action.member,
          });
          this.#log.info('executor: call placed', { member: shortKey(action.member) });
        } catch (err) {
          this.#log.warn('executor: call failed', { err });
          fail();
        }
        return;
      }
      case 'schedule': {
        this.#repo.jobs.upsert({ key: action.key, planId: action.planId, kind: action.job, dueAt: action.at, payload: action.payload });
        return;
      }
      case 'cancel': {
        this.#repo.jobs.cancelByPrefix(action.keyPrefix);
        return;
      }
      case 'lookup_places': {
        let options: import('../engine/types.js').PlaceOption[] = [];
        let source = 'unavailable';
        if (this.#places) {
          try {
            const r = await withTimeout(this.#places.search(action.query), this.#placesTimeoutMs);
            options = r.options ?? [];
            source = r.source ?? 'unknown';
          } catch (err) {
            source = err instanceof TimeoutError ? 'timeout' : 'error';
            this.#log.warn('executor: places lookup failed', { err });
          }
        }
        out.followUps.push({ kind: 'places_result', requestId: action.requestId, options, source });
        return;
      }
      case 'lookup_weather': {
        let rainLikely = false;
        let summary: string | undefined;
        if (this.#places) {
          try {
            const r = await withTimeout(this.#places.weather(action.near, action.at), this.#placesTimeoutMs);
            if (r) {
              rainLikely = !!r.rainLikely;
              summary = r.summary;
            }
          } catch (err) {
            this.#log.warn('executor: weather lookup failed', { err });
          }
        }
        const ev: EngineEvent = { kind: 'weather_result', requestId: action.requestId, rainLikely };
        if (summary !== undefined) ev.summary = summary;
        out.followUps.push(ev);
        return;
      }
      case 'remember_handle': {
        if (!ctx.inboundHandle || !ctx.inboundMemberKey || ctx.inboundMemberKey !== action.member) {
          this.#log.warn('executor: remember_handle skipped, not from the current sender', { member: shortKey(action.member) });
          return;
        }
        this.#repo.delivery.put(action.member, action.planId, ctx.inboundHandle);
        return;
      }
      case 'purge': {
        this.#repo.deletePlan(action.planId);
        return;
      }
      case 'leave': {
        let left = false;
        if (caps.leave && adapter.leave) {
          try {
            await adapter.leave(spaceId);
            left = true;
          } catch (err) {
            this.#log.warn('executor: leave failed, tombstoning instead', { surface: ctx.surface, err });
          }
        }
        if (left) {
          this.#repo.deleteSpace(ctx.spaceKey);
          this.#log.info('executor: left space', { surface: ctx.surface, space: shortKey(ctx.spaceKey) });
        } else {
          this.#repo.tombstone(ctx.spaceKey, ctx.surface);
          this.#log.info('executor: cannot leave, tombstoned', { surface: ctx.surface, space: shortKey(ctx.spaceKey) });
        }
        out.left = true;
        return;
      }
      case 'tombstone': {
        this.#repo.tombstone(ctx.spaceKey, ctx.surface);
        out.left = true;
        return;
      }
      default: {
        const h = this.#handlers.find((x) => x.types.includes(action.type));
        if (h) return h.run(action, ctx, out);
        this.#log.warn('executor: no handler for action', { action: action.type });
      }
    }
  }
}
