// Noise policy (STATE_MACHINE.md hard rules 2, 3, 6) and the escalation ladder (DATE_FINDING.md §6). Pure.
//
// Budget: at most one UNPROMPTED group message per rolling 12h. A message is allowed when
// now - lastUnpromptedAt >= 12h (exactly 12h is fine). Quiet hours (default 23:00-09:00 group-local) hold
// every unprompted message until they end. When a message is blocked it is deferred if it is still useful
// later (its `expiresAt`), otherwise dropped. A deadline lock is never dropped (`must`): it waits.
//
// Collisions are avoided by construction where possible, in priority order hour reminder > day reminder >
// deadline lock > nudge:
//   - the 50% availability nudge is scheduled only when it lands >= 12h before the deadline lock;
//   - the opt-in DM/call escalation is folded into that same nudge (one announced message + the private action);
//   - the day-before reminder expires 13h before the event, so it can never block the hour-before reminder;
//   - the details nudge is only sent when the day-before reminder is >= 12h away.

import type { Capabilities, Member, Plan } from './types.js';
import { HOUR, MIN, eveningBefore, isQuiet, listJoin, quietEnd } from './util.js';

export const BUDGET_MS = 12 * HOUR;

export type GateDecision =
  | { kind: 'send' }
  | { kind: 'defer'; at: number; reason: 'quiet' | 'budget' }
  | { kind: 'drop'; reason: 'quiet' | 'budget' };

export interface GateInput {
  now: number;
  tz: string;
  quietHours: [number, number];
  lastUnpromptedAt?: number;
  /** Latest useful send time; past it the message is dropped instead of deferred. */
  expiresAt?: number;
  /** Never dropped (deadline lock): deferred until allowed. */
  must?: boolean;
}

export function budgetOk(now: number, last?: number): boolean {
  return last === undefined || now - last >= BUDGET_MS;
}

/** Earliest instant >= t that is outside quiet hours and inside the budget. */
export function nextAllowed(t: number, tz: string, qh: [number, number], last?: number): number {
  let at = t;
  for (let i = 0; i < 4; i++) {
    if (last !== undefined && at - last < BUDGET_MS) at = last + BUDGET_MS;
    if (isQuiet(at, tz, qh)) at = quietEnd(at, tz, qh);
    if (budgetOk(at, last) && !isQuiet(at, tz, qh)) break;
  }
  return at;
}

/** Decides what happens to one unprompted group message right now. */
export function gateUnprompted(g: GateInput): GateDecision {
  const quiet = isQuiet(g.now, g.tz, g.quietHours);
  const budget = budgetOk(g.now, g.lastUnpromptedAt);
  if (!quiet && budget) return { kind: 'send' };
  const reason = quiet ? 'quiet' : 'budget';
  const at = nextAllowed(g.now, g.tz, g.quietHours, g.lastUnpromptedAt);
  if (!g.must && g.expiresAt !== undefined && at > g.expiresAt) return { kind: 'drop', reason };
  return { kind: 'defer', at, reason };
}

/**
 * When the 50% nudge goes out, or null when there is no room for it: it must land >= 12h before the deadline
 * lock (coordinator rule), and never in quiet hours. A nudge that would fall in quiet hours moves to 10:30pm
 * the evening before, if that is still sensible.
 */
export function nudgeTime(postedAt: number, deadlineAt: number, tz: string, qh: [number, number]): number | null {
  let at = postedAt + Math.floor((deadlineAt - postedAt) / 2 / MIN) * MIN;
  if (deadlineAt - at < BUDGET_MS) return null;
  if (isQuiet(at, tz, qh)) {
    const ev = eveningBefore(at, tz, qh, `${String((qh[0] + 23) % 24).padStart(2, '0')}:30`);
    if (ev >= postedAt + HOUR && deadlineAt - ev >= BUDGET_MS && !isQuiet(ev, tz, qh)) at = ev;
    else return null;
  }
  return at;
}

/** Shifts a reminder out of quiet hours (to when they end), or returns null if that would be past `latest`. */
export function outOfQuiet(at: number, tz: string, qh: [number, number], latest: number): number | null {
  const t = isQuiet(at, tz, qh) ? quietEnd(at, tz, qh) : at;
  return t <= latest ? t : null;
}

// ───────────────────────── escalation ladder ─────────────────────────

export const MAX_NUDGES_PER_MEMBER = 2;

/** Pending members who can still be nudged (cap: 2 per member per plan). */
export function nudgeable(plan: Plan): Member[] {
  return Object.values(plan.members).filter((m) => m.status === 'pending' && m.nudgeCount < MAX_NUDGES_PER_MEMBER);
}

/** Opted-in members Otto may check on privately: call opt-in, or DM opt-in where the channel can DM. */
export function escalationTargets(pending: Member[], caps: Capabilities): Member[] {
  return pending.filter((m) => m.hasDelivery && (m.optInCall || (m.optInDm && caps.dm)));
}

/** "Sam", "Sam and Jo", "Sam and 1 more", "2 people": names only when members gave them. */
export function whoLabel(members: Member[], unknown = 0): string {
  const names = members.filter((m) => m.name).map((m) => m.name as string);
  const unnamed = members.length - names.length + unknown;
  if (unnamed === 0) return listJoin(names);
  if (names.length === 0) return unnamed === 1 ? '1 person' : `${unnamed} people`;
  return `${names.join(', ')} and ${unnamed} more`;
}
