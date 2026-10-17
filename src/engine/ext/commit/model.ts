// Show-up pledge state (docs/COMMITMENTS.md). Plan-level data lives in Plan.ext.commit and is deleted with the
// plan; the group fund and the donation tally live in SpaceSettings.ext.commit and persist until "homi stop".
// IDs, amounts and times only: no message text (a goal pledge keeps the short goal a member handed to Homi).

import type { Action, MemberKey, MsgRef, Plan, PaymentOp, SpaceSettings } from '../../types.js';
import { type Step, P, planOf, react, replyTo } from '../../plan/core.js';
import { DAY, MIN, dayLabel, isoDay, listJoin } from '../../util.js';
import { usd } from '../util.js';

export type Kind = 'showup' | 'goal';
export type Dest = 'fund' | 'split' | 'donate';
/** Destination options 1..3, in bubble order. */
export const DESTS: Dest[] = ['fund', 'split', 'donate'];
export type Phase = 'vote' | 'open' | 'settled' | 'closed';
export type PartStatus = 'holding' | 'held' | 'cancelling' | 'cancelled' | 'refunded' | 'forfeited';

export interface Part {
  key: MemberKey;
  status: PartStatus;
  holdRef?: string;
  cancelRef?: string;
  /** ID of their latest pledge command (for the 👍 or a reply). Never text. */
  msgRef?: MsgRef;
  /** Check-in (show-up) or "homi done" (goal): when, and the message ID others can 👍. */
  inAt?: number;
  inRef?: MsgRef;
  confirmed?: boolean;
}

export interface Forfeit {
  key: MemberKey;
  cents: number;
  refunded?: boolean;
}

export interface Dispute {
  id: string;
  key: MemberKey;
  raisedAt: number;
  closesAt: number;
  votes: Record<MemberKey, 'refund' | 'keep'>;
  outcome?: 'refund' | 'keep';
}

export interface Pledge {
  kind: Kind;
  amountCents: number;
  /** Show-up: the locked event time the check-in window hangs off. Goal: the deadline. */
  at: number;
  goal?: string;
  startedBy: MemberKey;
  startedAt: number;
  phase: Phase;
  refs: { header?: MsgRef; rules?: MsgRef; dest: Record<number, MsgRef> };
  /** member -> destination option 1..3 (latest vote wins). */
  votes: Record<MemberKey, number>;
  splitShown?: boolean;
  dest?: Dest;
  /** Voters when pledges opened (everyone picked `dest`). */
  agreed: MemberKey[];
  parts: Record<MemberKey, Part>;
  summaryPosted?: boolean;
  oneLeftPosted?: boolean;
  allInPosted?: boolean;
  /** Show-up: the check-in window closed (silent job). */
  windowClosed?: boolean;
  settledAt?: number;
  disputeUntil?: number;
  attendees: MemberKey[];
  forfeits: Forfeit[];
  disputes: Dispute[];
  /** Payments that came back failed after settlement (shown in the dump). */
  failures?: number;
  /** Latest payment result was SIMULATED (true until a real provider answers). */
  sim: boolean;
}

/** Group-level money that outlives the plan. */
export interface Fund {
  fundCents: number;
  donateCents: number;
  /** A real (non-simulated) provider has answered in this group. */
  live?: boolean;
}

export const CHECKIN_BEFORE = 15 * MIN;
export const CHECKIN_AFTER = 30 * MIN;
export const SETTLE_AFTER_CLOSE = 60 * MIN;
export const CANCEL_CUTOFF = DAY;
export const DISPUTE_WINDOW = DAY;
export const MIN_CENTS = 100;
export const MAX_CENTS = 50_000;

export const checkinOpensAt = (c: Pledge) => c.at - CHECKIN_BEFORE;
export const checkinClosesAt = (c: Pledge) => c.at + CHECKIN_AFTER;
export const settleAt = (c: Pledge) => (c.kind === 'showup' ? checkinClosesAt(c) + SETTLE_AFTER_CLOSE : c.at);
export const cancelBy = (c: Pledge) => c.at - CANCEL_CUTOFF;
/** Pledges are taken until check-in opens (show-up) or the deadline (goal). */
export const joinUntil = (c: Pledge) => (c.kind === 'showup' ? checkinOpensAt(c) : c.at);

export function pledgeOf(st: Step): Pledge | undefined {
  return planOf(st)?.ext?.commit as Pledge | undefined;
}

export function setPledge(st: Step, c: Pledge | undefined): void {
  const p = P(st);
  const ext = { ...(p.ext ?? {}) };
  if (c) ext.commit = c;
  else delete ext.commit;
  p.ext = ext;
}

export function readFund(space: SpaceSettings): Fund | undefined {
  return space.ext?.commit as Fund | undefined;
}

export function fundOf(st: Step): Fund {
  const sp = st.s.space;
  const cur = readFund(sp);
  if (cur) return cur;
  const f: Fund = { fundCents: 0, donateCents: 0 };
  sp.ext = { ...(sp.ext ?? {}), commit: f };
  return f;
}

/** "$10" for whole dollars, "$3.34" otherwise. */
export function amt(cents: number): string {
  return cents % 100 === 0 ? `$${(cents / 100).toLocaleString('en-US')}` : usd(cents);
}

export function nameOf(p: Plan, key: MemberKey): string {
  return p.members[key]?.name ?? 'someone';
}

/** Names sorted alphabetically ("Ana, Ben, Jo, Maya and You"). */
export function namesOf(p: Plan, keys: MemberKey[]): string[] {
  return keys.map((k) => nameOf(p, k)).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
}

export function nameList(p: Plan, keys: MemberKey[]): string {
  return listJoin(namesOf(p, keys));
}

/** Participants in a status, sorted by name. */
export function partsIn(p: Plan, c: Pledge, ...statuses: PartStatus[]): Part[] {
  return Object.values(c.parts)
    .filter((x) => statuses.includes(x.status))
    .sort((a, b) => nameOf(p, a.key).localeCompare(nameOf(p, b.key), 'en', { sensitivity: 'base' }));
}

/** Finds a participant by the name a member typed ("sam", "Sam's"). */
export function partByName(p: Plan, parts: Part[], typed: string): Part | undefined {
  const t = typed.toLowerCase().replace(/'s$/, '').trim();
  if (!t) return undefined;
  return parts.find((x) => nameOf(p, x.key).toLowerCase() === t) ?? parts.find((x) => nameOf(p, x.key).toLowerCase().startsWith(t));
}

export function memo(c: Pledge, tz: string, what: string): string {
  return `Whats the Word ${c.kind === 'showup' ? 'show-up' : 'goal'} pledge ${dayLabel(isoDay(c.at, tz))}: ${what}`;
}

/** Quiet 👍 where the channel can react; a short "✓" reply where it can't, so the member still sees it counted. */
export function ack(st: Step, to: MsgRef, text: string): void {
  if (st.ctx.caps.reactionsOut) react(st, to);
  else replyTo(st, to, text);
}

/** Emits one payment action (SIMULATED unless a real provider is configured; docs/COMMITMENTS.md). */
export function pay(st: Step, c: Pledge, member: MemberKey, op: PaymentOp, cents: number, what: string): string {
  const ref = st.ctx.newId();
  const a: Action = { type: 'payment', op, ref, planId: P(st).id, member, amountCents: cents, currency: 'USD', memo: memo(c, st.s.space.tz, what) };
  st.acts.push(a);
  return ref;
}

/**
 * The plan normally purges 24h after the event; a pledge with no-show money keeps it until the dispute window
 * (and any open dispute vote) closes, so the timers and the refund path still exist. Only ever extends.
 */
export function ensureRetention(st: Step, c: Pledge): void {
  const p = P(st);
  const open = c.disputes.filter((d) => !d.outcome).map((d) => d.closesAt);
  const need = (c.phase === 'settled' ? Math.max(c.disputeUntil ?? 0, ...open) : settleAt(c)) + 5 * MIN;
  if (p.purgeAt === undefined || p.purgeAt >= need) return;
  p.purgeAt = need;
  st.acts.push({ type: 'schedule', key: `${p.id}:purge`, job: 'purge', at: need, planId: p.id });
}
