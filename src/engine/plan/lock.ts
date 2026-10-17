// Locking a date (DATE_FINDING §4/§5), the confirmed card, and the reminder ladder schedule.

import type { MemberKey, Prompting } from '../types.js';
import type { LockReason } from '../model.js';
import { TEMPLATES as T } from '../templates.js';
import {
  activeOptions, answeredCount, chooseOption, counts, detectStranded, effectiveVote, everyoneAnswered, groupSize, optionShortNames,
} from '../schedule.js';
import { outOfQuiet, whoLabel } from '../nudge.js';
import { DAY, HOUR, MIN, cardWhen } from '../util.js';
import { type Step, P, cancel, purgePlan, say, schedule, tzOf } from './core.js';

export function cancelAvailabilityJobs(st: Step): void {
  cancel(st, 'availability_nudge', 'availability_escalate', 'availability_deadline', 'escalate-timeout', 'dates_abandon', 'dates_nudge', 'bridge_timeout', 'quorum_dm', 'quorum_close');
}

const EVENT_JOBS = ['remind_day', 'weather', 'remind_hour', 'remind_30', 'complete', 'purge', 'details_nudge'];

export function cancelEventJobs(st: Step): void {
  cancel(st, ...EVENT_JOBS);
}

function remindWhen(eventAt: number, now: number): 'the day before' | 'an hour before' | 'none' {
  if (eventAt - now > DAY + HOUR) return 'the day before';
  if (eventAt - now > HOUR + 15 * MIN) return 'an hour before';
  return 'none';
}

/** "(Jo, you said maybe; still good?)" folded into the first sentence of a lock/card message. */
function maybeClause(st: Step, optionId?: number): string {
  const p = P(st);
  const o = p.options.find((x) => x.id === optionId);
  if (!o) return '';
  const ms = Object.values(p.members).filter((m) => effectiveVote(m, o) === 'maybe');
  if (!ms.length) return '';
  const named = ms.every((m) => m.name);
  return named ? `${whoLabel(ms)}, you said maybe; still good?` : 'if you said maybe, still good?';
}

function fold(sentence: string, clause: string): string {
  if (!clause) return sentence;
  return sentence.endsWith('.') ? `${sentence.slice(0, -1)} (${clause}).` : `${sentence} (${clause})`;
}

/** "Locked: Fri Oct 23, 7pm · Tasty Thai, 1234 Mass Ave · 4 in, 1 maybe. I'll remind you the day before; ..." */
export function cardText(st: Step, opts: { withAddress: boolean; ping?: boolean }): string {
  const p = P(st);
  const o = p.options.find((x) => x.id === p.chosenOptionId);
  const c = o ? counts(p, o) : { yes: Object.values(p.members).filter((m) => m.status !== 'out').length, maybe: 0 };
  const place = p.place ? (opts.withAddress && p.place.address ? `${p.place.name}, ${p.place.address}` : p.place.name) : undefined;
  const text = T.card({ when: cardWhen(p.eventAt as number, tzOf(st)), place, yes: c.yes, maybe: c.maybe, remind: remindWhen(p.eventAt as number, st.ctx.now) });
  const clause = opts.ping ? maybeClause(st, p.chosenOptionId) : '';
  if (!clause) return text;
  const i = text.indexOf('. ');
  return i < 0 ? text : `${fold(text.slice(0, i + 1), clause)}${text.slice(i + 1)}`;
}

export function confirmPlan(st: Step, prompting: Prompting, withAddress = true): void {
  P(st).state = 'confirmed';
  say(st, cardText(st, { withAddress }), prompting);
}

/** Reminders, completion and purge for the chosen time. Only jobs that no longer apply are cancelled. */
export function scheduleEventJobs(st: Step): void {
  const p = P(st);
  const E = p.eventAt as number;
  const now = st.ctx.now;
  const tz = tzOf(st);
  const qh = st.ctx.quietHours;
  p.purgeAt = E + st.ctx.retentionHours * HOUR;
  p.remindDaySent = undefined;
  p.remindHourSent = undefined;
  p.remind30Sent = undefined;
  const done = new Set<string>();
  // Day-before: expires 13h before the event so it can never block the hour-before reminder.
  const rd = outOfQuiet(E - DAY, tz, qh, E - 13 * HOUR);
  if (rd !== null && rd > now) {
    schedule(st, 'remind_day', rd);
    done.add('remind_day');
    if (p.outdoor) {
      schedule(st, 'remind_day', Math.max(now, rd - 30 * MIN), { name: 'weather', payload: { step: 'weather' } });
      done.add('weather');
    }
  }
  const rh = outOfQuiet(E - HOUR, tz, qh, E - 15 * MIN);
  if (rh !== null && rh > now) {
    schedule(st, 'remind_hour', rh);
    done.add('remind_hour');
  }
  if (p.remindReq30 && E - 30 * MIN > now) {
    schedule(st, 'remind_30', E - 30 * MIN);
    done.add('remind_30');
  }
  schedule(st, 'complete', E + 3 * HOUR);
  schedule(st, 'purge', p.purgeAt);
  done.add('complete').add('purge');
  if (p.state === 'collecting_details' && E - now >= 48 * HOUR) {
    schedule(st, 'details_nudge', now + 12 * HOUR);
    done.add('details_nudge');
  }
  const stale = EVENT_JOBS.filter((j) => !done.has(j));
  if (stale.length) cancel(st, ...stale);
}

function absentLabel(st: Step): string | undefined {
  const pend = Object.values(P(st).members).filter((m) => m.status === 'pending');
  return pend.length ? whoLabel(pend) : undefined;
}

/**
 * Locks an option: date_chosen -> collecting_details (or straight to confirmed when the place is already set).
 * The lock message is at most two sentences: the lock line (tone dial for deadline locks) with any maybe
 * confirm-ping folded in, then "Where to"; or the stranded bridge question; or "we'll miss you" (< 24h).
 */
export function lockOption(st: Step, id: number, how: LockReason, prompting: Prompting, by?: MemberKey): void {
  const p = P(st);
  const o = activeOptions(p).find((x) => x.id === id);
  if (!o) return;
  const now = st.ctx.now;
  // Demo quorum: an automatic lock needs at least minYes people; one person is not a plan. (A forced "homi lock fri" still is.)
  const q = st.ctx.quorum;
  if (q && (how === 'everyone' || how === 'deadline' || how === 'threshold') && counts(p, o).yes < q.minYes) {
    say(st, T.noQuorum({ yes: counts(p, o).yes, activity: p.activity }), prompting);
    purgePlan(st);
    return;
  }
  p.chosenOptionId = id;
  p.eventAt = o.startsAt;
  p.lockedBy = how;
  if (by) p.forcedBy = by;
  p.bridge = undefined;
  p.escalationPending = undefined;
  p.state = 'date_chosen';
  cancelAvailabilityJobs(st);
  const c = counts(p, o);
  const soon = o.startsAt - now < DAY;
  const stranded = how === 'deadline' || how === 'everyone' ? detectStranded(p, id) : null;
  let text: string;
  if (p.place) {
    p.state = 'confirmed';
    text = cardText(st, { withAddress: true, ping: true });
  } else {
    p.state = 'collecting_details';
    if (stranded && stranded.altId !== undefined && !soon) {
      const sn = optionShortNames(p);
      const alt = stranded.altId;
      text = T.stranded({
        win: sn[id], winYes: stranded.winYes, notNames: whoLabel(stranded.stranded.map((k) => p.members[k])),
        alt: sn[alt], altYes: stranded.altYes, inclNames: whoLabel(stranded.altIncluded.map((k) => p.members[k])), altWord: sn[alt].toLowerCase(),
      });
      p.bridge = { kind: 'stranded', createdAt: now, optionId: id, altOptionId: alt };
      schedule(st, 'bridge_timeout', now + 6 * HOUR);
    } else {
      const s1 =
        how === 'deadline'
          ? T.lockDeadline(st.s.space.tone, { label: o.label, yes: c.yes, maybe: c.maybe, absent: absentLabel(st) })
          : T.lockEarly({ label: o.label, yes: c.yes, maybe: c.maybe });
      const missing = stranded && soon ? stranded.stranded.map((k) => p.members[k]) : [];
      const s2 = missing.length ? T.missYou({ names: missing.every((m) => m.name) ? whoLabel(missing) : undefined }) : T.whereTo();
      text = `${fold(s1, maybeClause(st, id))} ${s2}`;
    }
  }
  say(st, text, prompting);
  scheduleEventJobs(st);
}

/**
 * Early lock (§4): threshold reached, or every known member answered (>= 2). After a missed deadline the
 * next vote also decides. Never while a bridge question is open.
 */
export function maybeEarlyLock(st: Step, prompting: Prompting): boolean {
  const p = P(st);
  if (p.state !== 'collecting_availability' || p.bridge) return false;
  const ch = chooseOption(p);
  // Demo quorum: once everyone is accounted for (answered or out) and fewer than minYes can make it, it is no plan.
  const q = st.ctx.quorum;
  if (q && answeredCount(p) >= groupSize(p) && !Object.values(p.members).some((m) => m.status === 'pending')) {
    const yes = ch ? (ch.ranked.find((r) => r.id === ch.optionId)?.yes ?? 0) : 0;
    if (yes < q.minYes) {
      say(st, T.noQuorum({ yes, activity: p.activity }), prompting);
      purgePlan(st);
      return true;
    }
  }
  if (!ch) return false;
  const score = (id: number) => ch.ranked.find((r) => r.id === id)?.score ?? 0;
  if (p.threshold) {
    const hits = new Set(ch.ranked.filter((r) => r.yes >= (p.threshold as number)).map((r) => r.id));
    if (hits.size) {
      const pick = hits.has(ch.optionId) ? ch.optionId : ch.ranked.find((r) => hits.has(r.id))!.id;
      lockOption(st, pick, 'threshold', prompting);
      return true;
    }
  }
  if (everyoneAnswered(p) && score(ch.optionId) > 0) {
    lockOption(st, ch.optionId, 'everyone', prompting);
    return true;
  }
  const waitingOnCall = !!p.escalationPending?.length;
  if (!waitingOnCall && p.deadlineAt !== undefined && st.ctx.now >= p.deadlineAt && answeredCount(p) > 0 && score(ch.optionId) > 0) {
    lockOption(st, ch.optionId, 'deadline', prompting);
    return true;
  }
  return false;
}

/** Stranded bridge: someone said the runner-up's day, so switch to it. */
export function switchTo(st: Step, altId: number): void {
  const p = P(st);
  const o = activeOptions(p).find((x) => x.id === altId);
  if (!o) return;
  p.chosenOptionId = altId;
  p.eventAt = o.startsAt;
  p.bridge = undefined;
  cancel(st, 'bridge_timeout');
  say(st, T.switched({ label: o.label, yes: counts(p, o).yes }));
  if (p.place && p.state === 'collecting_details') confirmPlan(st, 'prompted', false);
  scheduleEventJobs(st);
}
