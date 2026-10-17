// Test harness: a tiny in-memory runner around the pure engine. It feeds `sent` events back for tagged sends
// (so tapbacks can target option bubbles), keeps the job table from schedule/cancel actions, and fast-forwards
// the clock firing due jobs in order. Nothing here is used by production code.

import { applyEvent, detectAddressed, newGroupState } from '../../src/engine/index.js';
import { CAPS } from '../../src/channels/types.js';
import type { Action, Capabilities, EngineEvent, GroupState, PlaceOption, Surface } from '../../src/engine/types.js';
import type { EnginePlan } from '../../src/engine/model.js';

export const TZ = 'America/New_York';
export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export interface Logged {
  at: number;
  a: Action;
}

type Job = Extract<Action, { type: 'schedule' }>;

export class Harness {
  state: GroupState;
  now: number;
  caps: Capabilities;
  log: Logged[] = [];
  jobs = new Map<string, Job>();
  refs = new Map<string, string>();
  private ids = 0;
  private seq = 0;

  constructor(opts: { start: string; surface?: Surface; caps?: Partial<Capabilities>; tz?: string; spaceKey?: string } ) {
    this.now = Date.parse(opts.start);
    this.caps = { ...CAPS[opts.surface ?? 'sim'], ...(opts.caps ?? {}) };
    this.state = newGroupState(opts.spaceKey ?? 'space-1', opts.tz ?? TZ);
  }

  get plan(): EnginePlan | null {
    return this.state.plan as EnginePlan | null;
  }

  apply(ev: EngineEvent): Action[] {
    const r = applyEvent(this.state, ev, {
      now: this.now, caps: this.caps, retentionHours: 24, quietHours: [23, 9], newId: () => `id${++this.ids}`,
    });
    this.state = r.state;
    for (const a of r.actions) {
      this.log.push({ at: this.now, a });
      if (a.type === 'schedule') this.jobs.set(a.key, a);
      if (a.type === 'cancel') for (const k of [...this.jobs.keys()]) if (k.startsWith(a.keyPrefix)) this.jobs.delete(k);
    }
    for (const a of r.actions) {
      if ((a.type === 'send' || a.type === 'poll' || a.type === 'reply') && a.tag) {
        const ref = `homi-${++this.seq}`;
        this.refs.set(a.tag, ref);
        const res = applyEvent(this.state, { kind: 'sent', tag: a.tag, msgRef: ref, at: this.now }, {
          now: this.now, caps: this.caps, retentionHours: 24, quietHours: [23, 9], newId: () => `id${++this.ids}`,
        });
        this.state = res.state;
      }
    }
    return r.actions;
  }

  /** A member posts. `addressed` defaults to the engine's own detector. Returns the actions. */
  say(who: string, text: string, opts: { addressed?: boolean; replyTo?: string; platformName?: string; llmVote?: { optionIds: number[]; vote: 'yes' | 'no' | 'maybe' } } = {}): Action[] {
    const msgRef = `msg-${who}-${++this.seq}`;
    return this.apply({
      kind: 'message', from: { key: `k-${who}`, platformName: opts.platformName }, text, msgRef,
      addressed: opts.addressed ?? detectAddressed(text), replyTo: opts.replyTo, llmVote: opts.llmVote,
    });
  }

  react(who: string, emoji: string, tag: string): Action[] {
    const target = this.refs.get(tag);
    if (!target) throw new Error(`no message tagged ${tag}`);
    return this.apply({ kind: 'reaction', from: { key: `k-${who}` }, emoji, target });
  }

  /** Fast-forward to `t`, firing due jobs in order (ties by key). */
  advanceTo(t: number): Action[] {
    const out: Action[] = [];
    for (;;) {
      const due = [...this.jobs.values()].filter((j) => j.at <= t).sort((a, b) => a.at - b.at || (a.key < b.key ? -1 : 1));
      if (!due.length) break;
      const j = due[0];
      this.jobs.delete(j.key);
      this.now = Math.max(this.now, j.at);
      out.push(...this.apply({ kind: 'timer', job: j.job, planId: j.planId, payload: j.payload }));
    }
    this.now = Math.max(this.now, t);
    return out;
  }

  advance(ms: number): Action[] {
    return this.advanceTo(this.now + ms);
  }

  /** Answers the latest places lookup with these candidates. */
  places(candidates: PlaceOption[], source = 'osm'): Action[] {
    const req = [...this.log].reverse().find((l) => l.a.type === 'lookup_places')?.a as Extract<Action, { type: 'lookup_places' }> | undefined;
    if (!req) throw new Error('no lookup_places');
    return this.apply({ kind: 'places_result', requestId: req.requestId, options: candidates, source });
  }

  /** Group messages (send/reply/poll) in the log, optionally since time t. */
  groupMessages(since = -Infinity): Array<{ at: number; text: string; prompting: string; tag?: string; type: string }> {
    const out: Array<{ at: number; text: string; prompting: string; tag?: string; type: string }> = [];
    for (const { at, a } of this.log) {
      if (at < since) continue;
      if (a.type === 'send' || a.type === 'reply') out.push({ at, text: a.text, prompting: a.prompting, tag: a.tag, type: a.type });
      if (a.type === 'poll') out.push({ at, text: a.question, prompting: a.prompting, tag: a.tag, type: a.type });
    }
    return out;
  }
}

export function texts(actions: Action[]): string[] {
  return actions.flatMap((a) => (a.type === 'send' || a.type === 'reply' || a.type === 'dm' ? [a.text] : a.type === 'poll' ? [a.question] : []));
}

export function joined(actions: Action[]): string {
  return texts(actions).join('\n');
}

export function ofType<T extends Action['type']>(actions: Action[], type: T): Array<Extract<Action, { type: T }>> {
  return actions.filter((a) => a.type === type) as Array<Extract<Action, { type: T }>>;
}

/** Five fake places around Harvard Square for hungry-flow tests. */
export function fakePlaces(): PlaceOption[] {
  const base = { source: 'osm', priceEstimated: true } as const;
  return [
    { ...base, id: 11, name: 'Tasty Thai', cuisine: 'thai', priceBand: 1, address: '1234 Mass Ave', mapsUrl: 'https://maps.example/tasty', walkMinutes: 4, openAtPlanTime: true },
    { ...base, id: 12, name: 'Pho Basil', cuisine: 'vietnamese;thai', priceBand: 1, address: '177 Mass Ave', mapsUrl: 'https://maps.example/pho', walkMinutes: 6, openAtPlanTime: true },
    { ...base, id: 13, name: 'Siam Garden', cuisine: 'thai', priceBand: 2, address: '45 Mt Auburn St', walkMinutes: 5, openAtPlanTime: null },
    { ...base, id: 14, name: 'Taco Spot', cuisine: 'mexican', priceBand: 1, address: '9 Brattle St', walkMinutes: 3, openAtPlanTime: null },
    { ...base, id: 15, name: 'Late Thai', cuisine: 'thai', priceBand: 1, address: '1 JFK St', walkMinutes: 2, openAtPlanTime: false },
  ];
}
