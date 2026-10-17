// After the date is locked: votes that still arrive, the stranded-bridge switch, and veto-and-swap
// ("can't do friday anymore" from a yes voter reopens ONLY the date; place and notes are kept).

import type { Member, MessageEvent } from '../types.js';
import { TEMPLATES as T } from '../templates.js';
import { isVeto, optionRefs, parseAvailability } from '../parse.js';
import { defaultTime, effectiveVote } from '../schedule.js';
import { HOUR, addDays, atLocal, isoDay, weekdayOf } from '../util.js';
import { type Step, P, member, react, say, tzOf } from './core.js';
import { cancelEventJobs, switchTo } from './lock.js';
import { applyParsed, openAvailability } from './availability.js';

/** Stranded bridge open: "sat" (a reference to the runner-up, without a no) switches the plan to it. */
export function strandedAnswer(st: Step, body: string, addressed: boolean): boolean {
  const p = P(st);
  const b = p.bridge;
  if (b?.kind !== 'stranded' || b.altOptionId === undefined) return false;
  const refs = optionRefs(body, p.options, tzOf(st), st.ctx.now);
  if (!refs.includes(b.altOptionId) || refs.includes(b.optionId as number)) return false;
  const parsed = parseAvailability(body, p.options, tzOf(st), { now: st.ctx.now, addressed });
  const vote = parsed.optionVotes[b.altOptionId] ?? Object.values(parsed.dayPrefs)[0]?.vote ?? 'yes';
  if (vote === 'no' || (!addressed && !parsed.voteLike)) return false;
  switchTo(st, b.altOptionId);
  return true;
}

/** Late answers after the lock: addressed ones are recorded (the date does not move). */
export function lateVote(st: Step, ev: MessageEvent, body: string): boolean {
  const p = P(st);
  const parsed = parseAvailability(body, p.options, tzOf(st), { now: st.ctx.now, addressed: true });
  if (!parsed.matched) return false;
  applyParsed(p, member(st, ev.from), parsed);
  react(st, ev.msgRef);
  return true;
}

/** True when this message vetoes the chosen date and comes from someone who said yes to it. */
export function isDateVeto(st: Step, m: Member, body: string, addressed: boolean): boolean {
  const p = P(st);
  const chosen = p.options.find((o) => o.id === p.chosenOptionId);
  if (!chosen) return false;
  return effectiveVote(m, chosen) === 'yes' && isVeto(body, chosen, p.activity, tzOf(st), st.ctx.now, addressed);
}

/**
 * Veto and swap: three fresh options from the same window minus the vetoed day (extended by a week when
 * fewer than three usable days remain). Day-level prefs carry over; explicit votes on removed options are
 * dropped; everyone answers again before "everyone answered" can fire.
 */
export function reopenDate(st: Step, m: Member): void {
  const p = P(st);
  const now = st.ctx.now;
  const tz = tzOf(st);
  const chosen = p.options.find((o) => o.id === p.chosenOptionId);
  if (!chosen) return;
  p.excludedDays = [...new Set([...(p.excludedDays ?? []), chosen.day])];
  for (const o of p.options) o.removed = true;
  for (const x of Object.values(p.members)) {
    x.optionVotes = {};
    if (x.status !== 'out') x.status = 'pending';
    delete x.lowConfidence;
  }
  m.dayPrefs[chosen.day] = { vote: 'no' };
  p.chosenOptionId = undefined;
  p.eventAt = undefined;
  p.lockedBy = undefined;
  p.forcedBy = undefined;
  p.bridge = undefined;
  p.purgeAt = undefined;
  if (p.state !== 'collecting_place') p.state = 'collecting_availability';
  cancelEventJobs(st);
  say(st, T.vetoReopen({ place: p.place?.name }));

  const usable = (d: string) => !p.excludedDays!.includes(d) && atLocal(d, defaultTime(p.activity, weekdayOf(d)), tz) >= now + 3 * HOUR;
  let days = (p.windowDays ?? []).filter(usable);
  let label = p.windowLabel ?? 'soon';
  if (days.length < 3) {
    const today = isoDay(now, tz);
    const lastDay = [...(p.windowDays ?? []), today].sort().pop() as string;
    for (let i = 1; i <= 7; i++) {
      const d = addDays(lastDay, i);
      if (usable(d)) days.push(d);
    }
    days = [...new Set(days)].sort();
    label = 'soon';
  }
  openAvailability(st, { label, days, single: false, range: days }, 'prompted');
}
