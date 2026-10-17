// Every pledge message. Headers are at most two sentences (the DEMO step-7 header is canonical copy, see
// docs/COMMITMENTS.md); card lines are fragments. Money copy carries "SIMULATED" whenever the provider is simulated.

import type { Step } from '../../plan/core.js';
import { P } from '../../plan/core.js';
import { cardWhen, dayLabel, fmtTimeMs, isoDay, listJoin, local, longDay, shortDay, addDays } from '../../util.js';
import { type Dest, type Pledge, DESTS, amt, cancelBy, checkinClosesAt, checkinOpensAt, settleAt } from './model.js';

export interface View {
  c: Pledge;
  tz: string;
  now: number;
  place?: string;
  sim: boolean;
}

export function viewOf(st: Step, c: Pledge): View {
  return { c, tz: st.s.space.tz, now: st.ctx.now, place: P(st).place?.name, sim: c.sim };
}

const tag = (v: View) => (v.sim ? ' (SIMULATED)' : '');
const show = (v: View) => v.c.kind === 'showup';
const what = (v: View) => (show(v) ? 'no-show' : 'missed-goal');
const t = (v: View, ms: number) => fmtTimeMs(ms, v.tz);
const day = (v: View) => dayLabel(isoDay(v.c.at, v.tz));
const each = (v: View) => amt(v.c.amountCents);
/** "Sat 8:30pm" */
export const dayTime = (v: View, ms: number) => `${shortDay(isoDay(ms, v.tz))} ${t(v, ms)}`;
const who = (v: View) => (show(v) ? 'showed up' : 'made it');

/** "6:45–7:30pm" (one suffix when both ends share it). */
function range(v: View, a: number, b: number): string {
  const ta = t(v, a);
  const tb = t(v, b);
  return ta.slice(-2) === tb.slice(-2) ? `${ta.slice(0, -2)}–${tb}` : `${ta}–${tb}`;
}

const OPTION: Record<Dest, (v: View) => string> = {
  fund: () => 'Group fund for the next outing',
  split: (v) => `Split among the people who ${who(v)}`,
  donate: () => 'Donate to a charity we pick',
};
const SHORT: Record<Dest, string> = { fund: 'the group fund', split: 'splitting it', donate: 'a charity' };

function destPhrase(v: View, d: Dest): string {
  if (d === 'fund') return 'goes to the group fund';
  if (d === 'split') return `gets split among the people who ${who(v)}`;
  return 'goes to a charity we pick';
}

export const C = {
  needDate: () => 'Lock a date first; then I can set up a pledge.',
  needPlan: () => 'Start a plan first; then I can set up a pledge.',
  tooSoon: () => "It's too close to the start for a pledge; try it next time.",
  already: () => 'There\'s already a pledge for this plan; say "homi pledges" to see it.',
  range: () => 'Pledges can be $1 to $500 each.',
  goalWhen: () => 'By when? Try "homi pledge $20 that everyone books flights by Dec 1".',
  goalPast: () => 'That deadline is too soon; pick a later date.',
  howto: () =>
    'Say "homi pledge $10" for a show-up pledge once a date is locked, or "homi pledge $20 that everyone books flights by Dec 1" for a goal.',

  header: (v: View) =>
    show(v)
      ? `Show-up pledge for ${day(v)} · ${t(v, v.c.at)}: ${each(v)} each, back when you check in. First, where should no-show money go (everyone who pledges has to agree)?`
      : `Goal pledge: ${each(v)} each that ${v.c.goal} by ${day(v)}, back once it's done. First, where should missed-goal money go (everyone who pledges has to agree)?`,
  option: (v: View, i: number) => `${i} · ${OPTION[DESTS[i - 1]](v)}`,
  rules: (v: View) => {
    const c = v.c;
    const lines = [v.sim ? 'How the pledge works (payments are SIMULATED in this demo):' : 'How the pledge works:'];
    if (show(v)) {
      const at = v.place ? ` at ${v.place}` : '';
      lines.push(`· Check in: "homi I'm here"${at}, ${range(v, checkinOpensAt(c), checkinClosesAt(c))}; it counts once a second person is there (or someone 👍s it)`);
      lines.push(`· Refund: automatic, by ${t(v, settleAt(c))}`, `· No-show: your ${each(v)} goes where we agree`);
    } else {
      lines.push(`· Done: "homi done" by ${day(v)}; it counts once someone else in the pledge 👍s it or says "homi confirm <name>"`);
      lines.push('· Refund: automatic, at the deadline', `· Missed it: your ${each(v)} goes where we agree`);
    }
    lines.push(
      cancelBy(c) > v.now
        ? `· Cancel by ${cardWhen(cancelBy(c), v.tz)} for a full refund ("homi cancel my pledge")`
        : '· Cancel: not this close to the start; disputes cover surprises',
    );
    lines.push('· Disputes: "homi dispute" within 24h; the others vote, a tie means a refund');
    return lines.join('\n');
  },

  opened: (v: View) =>
    `Everyone agreed: ${what(v)} money ${destPhrase(v, v.c.dest as Dest)}. Pledges are open: say "homi I'm in" to put down ${each(v)}${
      v.sim ? ' (SIMULATED, no real money moves)' : " (you'll authorize it in the payment provider's secure checkout)"
    }.`,
  split: (v: View, counts: number[]) => {
    const parts = counts.map((n, i) => (n ? `${n} for ${SHORT[DESTS[i]]}` : '')).filter(Boolean);
    return `Not everyone agrees yet: ${listJoin(parts)}. Pledges open once everyone picks the same option; you can change your vote.`;
  },
  waiting: (v: View) =>
    `Pledges open once at least 2 of you pick where ${what(v)} money goes and nobody disagrees; react to 1, 2 or 3 above or reply with the number.`,
  pickFirst: (v: View) => `Pick where ${what(v)} money goes first: react to 1, 2 or 3 above or reply with the number.`,

  summary: (v: View, n: number, m: number) => {
    const held = `${n} of ${m} pledged: ${amt(n * v.c.amountCents)} held${tag(v)}.`;
    if (!show(v)) return `${held} Say "homi done" once it's done, by ${day(v)}.`;
    return `${held} See you ${seeYou(v)} at ${t(v, v.c.at).replace(/(am|pm)$/, '')}.`;
  },
  heldAck: (v: View) => `You're in: ${each(v)} held${tag(v)}.`,
  holdFailed: (v: View) => `Couldn't put down your ${each(v)}${tag(v)}; try "homi I'm in" again in a bit.`,
  alreadyIn: () => "You're already in.",
  joinClosed: (v: View) => (show(v) ? 'Pledges closed when check-in opened.' : 'Pledges for this goal are closed.'),
  settledAlready: () => 'This pledge is already settled.',

  cancelled: (v: View) => `Cancelled: your ${each(v)} is on its way back${tag(v)}.`,
  tooLate: () => 'Too late to cancel; you can dispute after if something came up.',
  noPledge: () => "You don't have a pledge to cancel.",
  stillHolding: () => 'Your pledge is still going through; try again in a minute.',
  cancelFailed: (v: View) => `Couldn't refund your ${each(v)} yet${tag(v)}, so your pledge stays on; try again in a bit.`,

  notIn: () => "You're not in this pledge, so there's no need to check in.",
  tooEarly: (v: View) => `Check-in opens at ${t(v, checkinOpensAt(v.c))}.`,
  windowShut: (v: View) =>
    show(v)
      ? `Check-in closed at ${t(v, checkinClosesAt(v.c))}; if something went wrong, say "homi dispute" after the settlement.`
      : 'The deadline has passed; if something went wrong, say "homi dispute" after the settlement.',
  oneLeft: (v: View, k: number, n: number, name: string) =>
    show(v)
      ? `${k} of ${n} checked in ✓ Still waiting on ${name}; check-in closes at ${t(v, checkinClosesAt(v.c))}.`
      : `${k} of ${n} done ✓ Still waiting on ${name}; the deadline is ${day(v)}.`,
  allIn: (v: View, n: number) =>
    show(v)
      ? `${n} of ${n} checked in ✓ Everyone's here; refunds go out by ${t(v, settleAt(v.c))}.`
      : `${n} of ${n} done ✓ Refunds go out at the deadline for everyone confirmed.`,
  progress: (v: View, k: number, n: number) =>
    show(v) ? `${k} of ${n} checked in ✓ Check-in closes at ${t(v, checkinClosesAt(v.c))}.` : `${k} of ${n} done ✓ The deadline is ${day(v)}.`,
  selfConfirm: () => 'Someone else in the pledge has to confirm it.',
  confirmWho: () => 'I don\'t see a "homi done" from anyone by that name yet.',
  confirmNotIn: () => 'Only people in the pledge can confirm.',
  dateChanged: (v: View, refunded: boolean) =>
    refunded ? `The date changed, so I refunded every pledge${tag(v)}; start a new one anytime.` : 'The date changed, so the pledge is off; start a new one anytime.',
  forgetRefunds: (v: View, cents: number, names: string[]) => `Refunded every open pledge${tag(v)}: ${amt(cents)} back to ${listJoin(names)}.`,
  settledStatus: (v: View, refunded: number, forfeited: number) =>
    `Pledge settled${tag(v)}: ${refunded} refunded, ${forfeited} forfeited; disputes until ${dayTime(v, v.c.disputeUntil ?? v.now)}.`,
};

/** "Friday" within the week, "tonight"/"today"/"tomorrow" when close, else "Fri Oct 23". */
function seeYou(v: View): string {
  const d = isoDay(v.c.at, v.tz);
  const today = isoDay(v.now, v.tz);
  if (d === today) return local(v.c.at, v.tz).hour >= 17 ? 'tonight' : 'today';
  if (d === addDays(today, 1)) return 'tomorrow';
  for (let i = 2; i < 7; i++) if (d === addDays(today, i)) return longDay(d);
  return dayLabel(d);
}

export const tagOf = tag;
export const showOf = show;
export const whoOf = who;
