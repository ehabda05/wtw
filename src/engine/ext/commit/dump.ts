// "homi what do you know": every pledge field stored for this group (names, amounts, statuses, ID counts; never
// member keys, payment refs or message IDs themselves) plus the group fund and the donation tally.

import type { GroupState, Plan } from '../../types.js';
import { cardWhen, dayLabel, fmtTimeMs, isoDay, listJoin, shortDay } from '../../util.js';
import { type Pledge, DESTS, amt, namesOf, readFund } from './model.js';

const DEST_LABEL = { fund: 'the group fund', split: 'split among attendees', donate: 'a charity' } as const;

function stage(p: Plan, c: Pledge, tz: string): string {
  const names = (keys: string[]) => listJoin(namesOf(p, keys));
  const what = c.kind === 'showup' ? 'no-show' : 'missed-goal';
  if (c.phase === 'vote') {
    const n = DESTS.map((_, i) => Object.values(c.votes).filter((x) => x === i + 1).length);
    const votes = n.map((x, i) => (x ? `${x} for ${DEST_LABEL[DESTS[i]]}` : '')).filter(Boolean);
    return `deciding where ${what} money goes (${votes.length ? votes.join(', ') : 'no votes yet'})`;
  }
  const dest = `${what} money to ${DEST_LABEL[c.dest ?? 'fund']}`;
  const by = (s: string) => Object.values(c.parts).filter((x) => x.status === s).map((x) => x.key);
  if (c.phase === 'open') {
    const held = by('held');
    const inn = held.filter((k) => c.parts[k].inAt !== undefined);
    const bits = [dest, held.length ? `pledged: ${names(held)} (${amt(held.length * c.amountCents)} held)` : 'nobody pledged yet'];
    if (inn.length) bits.push(`${c.kind === 'showup' ? 'checked in' : 'done'}: ${names(inn)}`);
    if (by('cancelled').length) bits.push(`cancelled: ${names(by('cancelled'))}`);
    return bits.join('; ');
  }
  const kept = c.forfeits.filter((f) => !f.refunded).map((f) => f.key);
  const bits = [`settled: ${amt(c.amountCents)} back to ${c.attendees.length ? names(c.attendees) : 'nobody'}`];
  if (kept.length) bits.push(`${names(kept)} forfeited ${amt(kept.length * c.amountCents)} to ${DEST_LABEL[c.dest ?? 'fund']}`);
  for (const d of c.disputes) {
    const who = names([d.key]);
    bits.push(d.outcome ? `${who}'s dispute: ${d.outcome === 'refund' ? 'refunded' : 'kept'}` : `${who}'s dispute: vote open (${Object.keys(d.votes).length} votes)`);
  }
  if (c.phase === 'settled' && c.disputeUntil) bits.push(`disputes until ${shortDay(isoDay(c.disputeUntil, tz))} ${fmtTimeMs(c.disputeUntil, tz)}`);
  if (c.failures) bits.push(`${c.failures} payment${c.failures === 1 ? '' : 's'} failed`);
  return bits.join('; ');
}

export function dumpLines(state: GroupState): string[] {
  const out: string[] = [];
  const tz = state.space.tz;
  const p = state.plan;
  const c = p?.ext?.commit as Pledge | undefined;
  if (p && c) {
    const sim = c.sim ? ' (payments SIMULATED)' : '';
    const head = c.kind === 'showup'
      ? `show-up pledge ${amt(c.amountCents)} each for ${cardWhen(c.at, tz)}${sim}`
      : `goal pledge ${amt(c.amountCents)} each that ${c.goal} by ${dayLabel(isoDay(c.at, tz))}${sim}`;
    const refs = Object.values(c.parts).filter((x) => x.msgRef || x.inRef).length;
    const tail = refs ? `; message IDs for ${refs} ${refs === 1 ? 'person' : 'people'} (IDs only, never text)` : '';
    out.push(`${head}: ${c.phase === 'closed' && !c.forfeits.length && !c.attendees.length ? 'closed' : stage(p, c, tz)}${tail}`);
  }
  const f = readFund(state.space);
  const tag = f?.live ? '' : ' (SIMULATED)';
  if (f?.fundCents) out.push(`group fund ${amt(f.fundCents)}${tag}`);
  if (f?.donateCents) out.push(`${amt(f.donateCents)} set aside to donate${tag}`);
  return out;
}
