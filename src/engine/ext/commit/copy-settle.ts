// Settlement, payout and dispute copy (opted-in transactional updates: always prompted, docs/COMMITMENTS.md).

import { listJoin } from '../../util.js';
import { type Dest, amt } from './model.js';
import { type View, dayTime, showOf, tagOf, whoOf } from './copy.js';

/** "$2 each", or "$3.34 or $3.33 each" when the largest remainder makes shares differ by a cent. */
export function shareLabel(shares: number[]): string {
  const vals = [...new Set(shares)].sort((a, b) => b - a);
  return vals.length === 1 ? `${amt(vals[0])} each` : `${amt(vals[0])} or ${amt(vals[vals.length - 1])} each`;
}

export interface SettledInfo {
  att: string[];
  miss: string[];
  /** None of the missing ones checked in (vs a check-in nobody confirmed). */
  noneIn: boolean;
  total: number;
  fund: number;
  share?: string;
  refundAll: boolean;
}

function missVerb(v: View, one: boolean, noneIn: boolean): string {
  if (showOf(v)) return noneIn ? "didn't check in" : one ? "didn't get a confirmed check-in" : "didn't get confirmed check-ins";
  return noneIn ? "didn't finish" : one ? "wasn't confirmed as done" : "weren't confirmed as done";
}

function destPast(v: View, d: Dest, o: SettledInfo): string {
  if (d === 'fund') return `went to the group fund (now ${amt(o.fund)})`;
  if (d === 'split') return `gets split among the ${o.att.length} who ${whoOf(v)} (${o.share}) once disputes close`;
  return 'goes to the charity you pick once disputes close';
}

export const S = {
  /** DEMO step 14: "Pledge settled (SIMULATED): $10 back to Ana, … Sam can dispute until Sat 8:30pm." */
  settled: (v: View, o: SettledInfo) => {
    const each = amt(v.c.amountCents);
    const did = showOf(v) ? 'checked in' : 'made it';
    if (o.refundAll) return `Pledge settled${tagOf(v)}: nobody ${did}, so everyone gets their ${each} back.`;
    if (!o.miss.length) return `Pledge settled${tagOf(v)}: everyone ${did}, so ${each} back to ${listJoin(o.att)}.`;
    const first = o.att.length ? `Pledge settled${tagOf(v)}: ${each} back to ${listJoin(o.att)}.` : `Pledge settled${tagOf(v)}: nobody ${did}.`;
    const one = o.miss.length === 1;
    const poss = one ? `${o.miss[0]}'s` : 'their';
    const subj = one ? o.miss[0] : 'they';
    const until = dayTime(v, v.c.disputeUntil ?? v.now);
    return `${first} ${listJoin(o.miss)} ${missVerb(v, one, o.noneIn)}, so ${poss} ${amt(o.total)} ${destPast(v, v.c.dest as Dest, o)}; ${subj} can dispute until ${until}.`;
  },
  finalSplit: (v: View, cents: number, from: string[], att: string[], share: string) =>
    `Pledge closed${tagOf(v)}: ${amt(cents)} from ${listJoin(from)} split among ${listJoin(att)}, ${share}.`,
  finalDonate: (v: View, cents: number, from: string[], total: number) =>
    `Pledge closed${tagOf(v)}: ${amt(cents)} from ${listJoin(from)} is set aside for the charity you pick (${amt(total)} to donate in total).`,

  disputeOpen: (v: View, name: string, voters: string[], closesAt: number) =>
    `${name} disputed the ${showOf(v) ? 'no-show' : 'missed goal'}. ${listJoin(voters)}: reply "homi refund ${name}" or "homi keep it" by ${dayTime(v, closesAt)}; a tie means a refund.`,
  nothing: () => "Nothing to dispute: your pledge wasn't forfeited.",
  windowClosed: (v: View) => `The dispute window closed ${dayTime(v, v.c.disputeUntil ?? v.now)}.`,
  alreadyOpen: (v: View, closesAt: number) => `Your dispute is already open; the vote closes ${dayTime(v, closesAt)}.`,
  alreadyDecided: () => 'Your dispute was already decided.',
  cantVote: () => 'Only the other people in the pledge can vote on this.',
  noDisputeFor: () => "There's no open dispute for that name.",
  refunded: (v: View, name: string, r: number, k: number, fund?: number) => {
    const tail = fund === undefined ? '' : ` and the group fund is now ${amt(fund)}`;
    const how = r === k ? `a ${r} to ${k} tie means a refund` : `${r} to ${k} for a refund`;
    return `Dispute settled${tagOf(v)}: ${how}, so ${name} gets ${amt(v.c.amountCents)} back${tail}.`;
  },
  kept: (v: View, name: string, r: number, k: number) => {
    const d = v.c.dest as Dest;
    const where = d === 'fund' ? 'stays in the group fund' : d === 'split' ? 'still gets split' : 'still goes to charity';
    return `Dispute settled${tagOf(v)}: ${k} to ${r} to keep it, so ${name}'s ${amt(v.c.amountCents)} ${where}.`;
  },
};
