// Step 4: settlement at check-in close + 60 min (goal: at the deadline). Confirmed participants get a refund;
// the others forfeit to the agreed destination. The group fund is credited at once (it is in-app and can be
// reversed by a dispute); a split or a donation is paid out when the 24h dispute window (and any vote) closes.

import { type Step, P, planOf, say } from '../../plan/core.js';
import { DAY } from '../../util.js';
import { cancelExt, scheduleExt } from '../util.js';
import { C, viewOf } from './copy.js';
import { S, shareLabel } from './copy-settle.js';
import { type Pledge, ensureRetention, fundOf, namesOf, partsIn, pay, pledgeOf, setPledge } from './model.js';

/**
 * Largest-remainder apportionment in integer cents: shares proportional to `weights` that add up to `total`
 * exactly. Leftover cents go to the largest fractional parts, ties to the earlier index.
 */
export function largestRemainder(total: number, weights: number[]): number[] {
  const w = weights.reduce((a, b) => a + b, 0);
  if (!weights.length || w <= 0) return weights.map(() => 0);
  const base = weights.map((x) => Math.floor((total * x) / w));
  const rem = weights.map((x, i) => ({ i, r: (total * x) % w }));
  let left = total - base.reduce((a, b) => a + b, 0);
  rem.sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of rem) {
    if (left <= 0) break;
    base[i]++;
    left--;
  }
  return base;
}

export function settle(st: Step, c: Pledge): void {
  if (c.phase === 'vote') {
    c.phase = 'closed';
    return;
  }
  if (c.phase !== 'open') return;
  const p = P(st);
  const held = partsIn(p, c, 'held');
  const att = held.filter((x) => x.confirmed);
  const miss = held.filter((x) => !x.confirmed);
  const refundAll = c.dest === 'split' && !att.length;
  for (const a of att) {
    pay(st, c, a.key, 'refund', c.amountCents, 'refund');
    a.status = 'refunded';
  }
  for (const m of miss) {
    if (refundAll) {
      pay(st, c, m.key, 'refund', c.amountCents, 'refund');
      m.status = 'refunded';
      continue;
    }
    pay(st, c, m.key, 'forfeit', c.amountCents, `forfeit to ${c.dest === 'fund' ? 'the group fund' : c.dest === 'split' ? 'split among attendees' : 'donate'}`);
    m.status = 'forfeited';
    c.forfeits.push({ key: m.key, cents: c.amountCents });
  }
  const total = c.forfeits.reduce((a, f) => a + f.cents, 0);
  const fund = fundOf(st);
  if (c.dest === 'fund') fund.fundCents += total;
  c.attendees = att.map((x) => x.key);
  c.phase = 'settled';
  c.settledAt = st.ctx.now;
  c.disputeUntil = st.ctx.now + DAY;
  const shares = largestRemainder(total, att.map(() => 1));
  say(st, S.settled(viewOf(st, c), {
    att: namesOf(p, c.attendees),
    miss: namesOf(p, c.forfeits.map((f) => f.key)),
    noneIn: miss.every((x) => x.inAt === undefined),
    total,
    fund: fund.fundCents,
    share: att.length ? shareLabel(shares) : undefined,
    refundAll,
  }));
  if (!c.forfeits.length) {
    c.phase = 'closed';
    return;
  }
  scheduleExt(st, 'commit', 'final', c.disputeUntil);
  ensureRetention(st, c);
}

/** After the dispute window and every dispute vote: pay out a split, or set a donation aside. */
export function finalize(st: Step, c: Pledge): void {
  if (c.phase !== 'settled' || st.ctx.now < (c.disputeUntil ?? 0) || c.disputes.some((d) => !d.outcome)) return;
  c.phase = 'closed';
  const kept = c.forfeits.filter((f) => !f.refunded);
  const total = kept.reduce((a, f) => a + f.cents, 0);
  if (!total) return;
  const p = P(st);
  const v = viewOf(st, c);
  const from = namesOf(p, kept.map((f) => f.key));
  if (c.dest === 'split' && c.attendees.length) {
    const att = [...c.attendees].sort((a, b) => namesOf(p, [a])[0].localeCompare(namesOf(p, [b])[0]));
    const shares = largestRemainder(total, att.map(() => 1));
    att.forEach((k, i) => pay(st, c, k, 'refund', shares[i], 'share of no-show money'));
    say(st, S.finalSplit(v, total, from, namesOf(p, att), shareLabel(shares)));
  } else if (c.dest === 'donate') {
    const f = fundOf(st);
    f.donateCents += total;
    say(st, S.finalDonate(v, total, from, f.donateCents));
  }
}

/**
 * `homi forget` / `homi stop` (and a changed date): every held deposit goes back, and so does no-show money that
 * was not paid out yet (a split or a donation still inside the dispute window). Group-fund money stays in the fund.
 */
export function refundOpen(st: Step): { cents: number; keys: string[] } {
  const c = pledgeOf(st);
  const out = { cents: 0, keys: [] as string[] };
  if (!c || !planOf(st)) return out;
  for (const x of Object.values(c.parts)) {
    if (x.status !== 'held') continue;
    pay(st, c, x.key, 'refund', c.amountCents, 'refund (pledge called off)');
    x.status = 'refunded';
    out.cents += c.amountCents;
    out.keys.push(x.key);
  }
  if (c.phase === 'settled' && c.dest !== 'fund') {
    for (const f of c.forfeits.filter((x) => !x.refunded)) {
      pay(st, c, f.key, 'refund', f.cents, 'refund (pledge called off)');
      f.refunded = true;
      out.cents += f.cents;
      out.keys.push(f.key);
    }
  }
  cancelExt(st, 'commit');
  return out;
}

export function callOff(st: Step): void {
  const c = pledgeOf(st);
  if (!c) return;
  const r = refundOpen(st);
  if (r.keys.length) say(st, C.forgetRefunds(viewOf(st, c), r.cents, namesOf(P(st), [...new Set(r.keys)])));
  c.phase = 'closed';
}

/** The locked date moved (veto-and-swap): the pledge was for the old time, so it is refunded and dropped. */
export function staleCheck(st: Step): void {
  const p = planOf(st);
  const c = pledgeOf(st);
  if (!p || !c || c.kind !== 'showup' || (c.phase !== 'vote' && c.phase !== 'open') || p.eventAt === c.at) return;
  const v = viewOf(st, c);
  const r = refundOpen(st);
  setPledge(st, undefined);
  say(st, C.dateChanged(v, r.keys.length > 0));
}
