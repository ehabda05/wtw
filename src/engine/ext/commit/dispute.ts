// Disputes: a forfeited participant says "homi dispute" within 24h of the settlement; the other participants
// reply "homi refund <name>" or "homi keep it". The majority decides when everyone voted or after 24h; a tie
// (including no votes at all) means a refund.

import type { MessageEvent } from '../../types.js';
import { type Step, P, say } from '../../plan/core.js';
import { DAY } from '../../util.js';
import { cancelExt, scheduleExt } from '../util.js';
import { viewOf } from './copy.js';
import { S } from './copy-settle.js';
import { type Dispute, type Pledge, ack, ensureRetention, fundOf, nameOf, namesOf, pay } from './model.js';
import { finalize } from './settle.js';

/** Everyone who was in the pledge at settlement, minus the one disputing. */
function voters(c: Pledge, key: string): string[] {
  return Object.values(c.parts)
    .filter((x) => (x.status === 'refunded' || x.status === 'forfeited') && x.key !== key)
    .map((x) => x.key);
}

export function raise(st: Step, c: Pledge | undefined, ev: MessageEvent): void {
  const key = ev.from.key;
  const f = c?.forfeits.find((x) => x.key === key);
  if (!c || !f) return say(st, S.nothing());
  const v = viewOf(st, c);
  const d0 = c.disputes.find((d) => d.key === key);
  if (d0) return say(st, d0.outcome ? S.alreadyDecided() : S.alreadyOpen(v, d0.closesAt));
  if (c.phase !== 'settled' || st.ctx.now > (c.disputeUntil ?? 0)) return say(st, S.windowClosed(v));
  const d: Dispute = { id: st.ctx.newId(), key, raisedAt: st.ctx.now, closesAt: st.ctx.now + DAY, votes: {} };
  c.disputes.push(d);
  const vs = voters(c, key);
  if (!vs.length) return resolve(st, c, d, false);
  scheduleExt(st, 'commit', `dispute:${d.id}`, d.closesAt);
  ensureRetention(st, c);
  say(st, S.disputeOpen(v, nameOf(P(st), key), namesOf(P(st), vs), d.closesAt));
}

/** "homi refund sam" / "homi keep it". Returns false when no dispute is open (the words mean something else). */
export function verdict(st: Step, c: Pledge, ev: MessageEvent, choice: 'refund' | 'keep', name?: string): boolean {
  const open = c.disputes.filter((d) => !d.outcome);
  if (!open.length) return false;
  const p = P(st);
  let d: Dispute | undefined = open[open.length - 1];
  if (name) {
    const t = name.toLowerCase().replace(/'s$/, '');
    d = open.find((x) => nameOf(p, x.key).toLowerCase() === t) ?? open.find((x) => nameOf(p, x.key).toLowerCase().startsWith(t));
  }
  if (!d) {
    say(st, S.noDisputeFor());
    return true;
  }
  const vs = voters(c, d.key);
  if (!vs.includes(ev.from.key)) {
    say(st, S.cantVote());
    return true;
  }
  d.votes[ev.from.key] = choice;
  if (vs.every((k) => d!.votes[k])) resolve(st, c, d, true);
  else ack(st, ev.msgRef, 'Vote counted ✓');
  return true;
}

/** Majority wins; a tie is a refund. A refund from the group fund comes back out of the fund. */
export function resolve(st: Step, c: Pledge, d: Dispute, early: boolean): void {
  if (d.outcome) return;
  const all = Object.values(d.votes);
  const r = all.filter((x) => x === 'refund').length;
  const k = all.length - r;
  d.outcome = r >= k ? 'refund' : 'keep';
  if (early) cancelExt(st, 'commit', `dispute:${d.id}`);
  const v = viewOf(st, c);
  const name = nameOf(P(st), d.key);
  const f = c.forfeits.find((x) => x.key === d.key && !x.refunded);
  if (d.outcome === 'refund' && f) {
    f.refunded = true;
    pay(st, c, d.key, 'refund', f.cents, 'refund (dispute upheld)');
    const part = c.parts[d.key];
    if (part) part.status = 'refunded';
    let fundNow: number | undefined;
    if (c.dest === 'fund') {
      const fund = fundOf(st);
      fund.fundCents = Math.max(0, fund.fundCents - f.cents);
      fundNow = fund.fundCents;
    }
    say(st, S.refunded(v, name, r, k, fundNow));
  } else say(st, S.kept(v, name, r, k));
  finalize(st, c);
}

export function onDisputeTimer(st: Step, c: Pledge, id: string): void {
  const d = c.disputes.find((x) => x.id === id);
  if (d) resolve(st, c, d, false);
}
