// Shared helpers for the state machine. A Step is one applyEvent call: a cloned state, the context, and the
// actions emitted so far. Every unprompted group message goes through say(..., 'unprompted'), which also
// spends the noise budget (GroupState.lastUnpromptedAt).

import type { Action, Ctx, GroupState, JobKind, Member, MemberRef, MsgRef, Plan, Prompting } from '../types.js';
import type { EnginePlan } from '../model.js';
import { TEMPLATES as T } from '../templates.js';
import { DEFAULT_TZ, clean } from '../util.js';

export interface Step {
  s: GroupState;
  ctx: Ctx;
  acts: Action[];
}

export function newGroupState(spaceKey: string, tz: string = DEFAULT_TZ): GroupState {
  return { space: { spaceKey, introSent: false, tone: 'normal', tz, notice: false, muted: false }, plan: null };
}

export function planOf(st: Step): EnginePlan | null {
  return st.s.plan as EnginePlan | null;
}

/** The current plan; callers only use it where a plan is known to exist. */
export function P(st: Step): EnginePlan {
  return st.s.plan as EnginePlan;
}

export const tzOf = (st: Step): string => st.s.space.tz;
export const howOf = (st: Step): 'tap' | 'reply' => (st.ctx.caps.reactionsIn ? 'tap' : 'reply');

export function say(st: Step, text: string, prompting: Prompting = 'prompted', tag?: string): void {
  st.acts.push(tag ? { type: 'send', text, prompting, tag } : { type: 'send', text, prompting });
  if (prompting === 'unprompted') st.s.lastUnpromptedAt = st.ctx.now;
}

export function replyTo(st: Step, to: MsgRef, text: string, prompting: Prompting = 'prompted'): void {
  st.acts.push({ type: 'reply', to, text, prompting });
  if (prompting === 'unprompted') st.s.lastUnpromptedAt = st.ctx.now;
}

/** Quiet acknowledgement of a counted vote (where the channel can react). */
export function react(st: Step, to?: MsgRef): void {
  if (to && st.ctx.caps.reactionsOut) st.acts.push({ type: 'react', to, emoji: '👍' });
}

/** Deterministic job keys: `${planId}:${name}` (+ ":<suffix>" for deferred copies). Printable ASCII, no spaces. */
export function jobKey(planId: string, name: string, suffix?: string | number): string {
  return suffix === undefined ? `${planId}:${name}` : `${planId}:${name}:${suffix}`;
}

export function schedule(
  st: Step,
  job: JobKind,
  at: number,
  opts: { name?: string; suffix?: string | number; payload?: Record<string, unknown> } = {},
): void {
  const p = P(st);
  const a: Action = { type: 'schedule', key: jobKey(p.id, opts.name ?? job, opts.suffix), job, at, planId: p.id };
  if (opts.payload) a.payload = opts.payload;
  st.acts.push(a);
}

/** Re-schedules the firing job for later under a distinct key (so the runner never confuses it with the one firing). */
export function defer(st: Step, job: JobKind, at: number, payload?: Record<string, unknown>): void {
  schedule(st, job, at, { suffix: `d${at.toString(36)}`, payload: payload && Object.keys(payload).length ? payload : undefined });
}

export function cancel(st: Step, ...names: string[]): void {
  const p = P(st);
  for (const n of names) st.acts.push({ type: 'cancel', keyPrefix: `${p.id}:${n}` });
}

export function isOpen(p: Plan): boolean {
  return p.state !== 'completed' && p.state !== 'purged';
}

/** Find or create the member record (hashed key only). Only called while a plan exists. */
export function member(st: Step, ref: MemberRef): Member {
  const p = P(st);
  let m = p.members[ref.key];
  if (!m) {
    m = { key: ref.key, status: 'pending', dayPrefs: {}, optionVotes: {}, optInDm: false, optInCall: false, hasDelivery: false, nudgeCount: 0, joinedAt: st.ctx.now };
    p.members[ref.key] = m;
  }
  if (ref.platformName && !m.name) {
    const n = clean(ref.platformName, 30);
    if (n) m.name = n;
  }
  return m;
}

/**
 * A new plan starts with everyone the platform listed (iMessage dedicated lines report the roster), so "everyone
 * answered" means the group, not just whoever spoke first. No roster: members appear as they speak, as before.
 */
export function seedRoster(st: Step): void {
  const p = planOf(st);
  if (!p) return;
  const roster = st.s.space.roster ?? [];
  if (roster.length) {
    for (const ref of roster) member(st, ref);
    p.rosterSize = roster.length;
  } else if (st.s.space.headcount && !p.expectedHeadcount) {
    // Telegram: only a count. "k of n" and the food flow wait for that many people.
    p.expectedHeadcount = st.s.space.headcount;
  }
}

/**
 * Demo quorum: make the current group speaker reachable privately (the runner seals their handle). Replies the
 * runner routed from a DM carry a "dm:" ref and have no group handle to remember.
 */
export function reachable(st: Step, m: Member | null, msgRef?: MsgRef): void {
  const p = planOf(st);
  if (!p || !m || !st.ctx.quorum || !st.ctx.caps.dm || m.hasDelivery || msgRef?.startsWith('dm:')) return;
  m.hasDelivery = true;
  st.acts.push({ type: 'remember_handle', member: m.key, planId: p.id });
}

/** Head-counting while a plan is open: the member exists, plus their last message ID (never text). */
export function touch(st: Step, ref: MemberRef, msgRef?: MsgRef): Member | null {
  const p = planOf(st);
  if (!p || !isOpen(p)) return null;
  const m = member(st, ref);
  if (msgRef) m.lastMsgRef = msgRef;
  return m;
}

/** PRIVACY §1: the one-time intro, on the first event Homi sees in a chat. Prompted (it answers that event). */
export function intro(st: Step): void {
  if (st.s.space.introSent) return;
  st.s.space.introSent = true;
  say(st, st.ctx.simple ? T.introSimple() : T.intro({ hours: st.ctx.retentionHours }), 'prompted', 'intro');
}

/** Deletes the plan: every job, the plan row, the delivery lookup (runner). State goes back to idle. */
export function purgePlan(st: Step): void {
  const p = planOf(st);
  if (!p) return;
  st.acts.push({ type: 'cancel', keyPrefix: `${p.id}:` }, { type: 'purge', planId: p.id });
  st.s.plan = null;
}

export function refKey(map: Record<number, MsgRef> | undefined, ref?: MsgRef): number | undefined {
  if (!ref || !map) return undefined;
  for (const [k, v] of Object.entries(map)) if (v === ref) return Number(k);
  return undefined;
}

export function isHomiRef(p: Plan | null, ref?: MsgRef): boolean {
  if (!p || !ref) return false;
  const r = p.refs;
  return r.header === ref || r.poll === ref || r.placePoll === ref || refKey(r.options, ref) !== undefined || refKey(r.placeOptions, ref) !== undefined;
}

/** Date votes are accepted while availability is open, including during a food detour on top of it. */
export function availabilityOpen(p: Plan): boolean {
  return p.state === 'collecting_availability' || (p.state === 'collecting_place' && p.stack.includes('collecting_availability'));
}

export function names(ms: Member[]): string[] {
  return ms.filter((m) => m.name).map((m) => m.name as string);
}
