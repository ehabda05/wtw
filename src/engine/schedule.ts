// DATE_FINDING.md §1 (propose three options), §4 (choose by quorum), §5 (conflict bridges). Pure.

import type { Member, MemberKey, Option, Plan, Vote } from './types.js';
import type { WindowSpec } from './model.js';
import {
  HOUR, MIN, atLocal, eveningBefore, fmtTime, hm, isQuiet, isoDay, listJoin, longDay, minutesOf, optionLabel, quietEnd, roundUp,
  shortDay, timeOfMs, weekdayOf,
} from './util.js';

// ───────────────────────── §1 option generation ─────────────────────────

/** Day scores by ISO weekday (index 1 = Mon). Social plans: Fri/Sat 3, Thu/Sun 2, Tue/Wed 1, Mon 0. */
const SOCIAL = [0, 0, 1, 1, 2, 3, 3, 2];
/** Brunch, hikes, picnics prefer the weekend. */
const WEEKEND = [0, 0, 0, 0, 1, 2, 3, 3];

/** Activity -> natural time (DATE_FINDING §1 step 1). */
export function defaultTime(activity: string, weekday: number): string {
  switch (activity) {
    case 'dinner': return '19:00';
    case 'drinks': return '20:00';
    case 'lunch': return '12:30';
    case 'brunch': return '11:00';
    case 'breakfast': return '09:30';
    case 'coffee': return '15:00';
    case 'movie': return '19:30';
    case 'game night': return '19:00';
    case 'hike': case 'picnic': case 'park': return '11:00';
    default: return weekday >= 6 ? '14:00' : '18:30';
  }
}

/** Three times for single-day windows ("tomorrow"). */
export function dayTimes(activity: string): string[] {
  switch (activity) {
    case 'dinner': return ['18:00', '19:00', '20:30'];
    case 'drinks': return ['19:00', '20:00', '21:30'];
    case 'lunch': return ['12:00', '12:30', '13:30'];
    case 'brunch': return ['10:30', '11:30', '12:30'];
    case 'breakfast': return ['08:30', '09:30', '10:30'];
    case 'coffee': return ['10:00', '15:00', '17:00'];
    case 'movie': return ['17:00', '19:30', '21:30'];
    case 'game night': return ['18:00', '19:00', '20:00'];
    case 'hike': return ['09:00', '11:00', '14:00'];
    case 'picnic': case 'park': return ['11:00', '12:30', '14:00'];
    default: return ['12:30', '18:30', '20:00'];
  }
}

export interface GenerateInput {
  activity: string;
  window: WindowSpec;
  now: number;
  tz: string;
  /** ISO days that may not be proposed (requester ruled out, vetoed). */
  excludeDays?: string[];
  /** Weekdays ruled out in the trigger ("not monday"). */
  excludeWeekdays?: number[];
  /** Explicit time from the trigger ("at 8"). */
  time?: string;
  weekendPref?: boolean;
  /** First option id (veto-and-swap continues numbering). */
  startId?: number;
}

const MIN_LEAD = 3 * HOUR;

function shiftTime(time: string, deltaMin: number): string {
  const m = Math.max(0, Math.min(23 * 60 + 30, minutesOf(time) + deltaMin));
  return hm(Math.floor(m / 60), m % 60);
}

/**
 * Picks three concrete options from a window: drop days ruled out and slots less than 3h away, score each
 * day, take the top three (ties to the earlier day), present them chronologically. One-day windows get three
 * times on that day.
 */
export function generateOptions(input: GenerateInput): Option[] {
  const { activity, window, now, tz } = input;
  const exD = new Set(input.excludeDays ?? []);
  const exW = new Set(input.excludeWeekdays ?? []);
  const minStart = now + MIN_LEAD;
  const days = window.days.filter((d) => !exD.has(d) && !exW.has(weekdayOf(d)));
  const startId = input.startId ?? 1;
  const timeFor = (d: string) => input.time ?? defaultTime(activity, weekdayOf(d));
  const mk = (slots: Array<{ day: string; time: string }>): Option[] =>
    slots
      .sort((a, b) => atLocal(a.day, a.time, tz) - atLocal(b.day, b.time, tz))
      .map((s, i) => ({ id: startId + i, day: s.day, time: s.time, startsAt: atLocal(s.day, s.time, tz), label: optionLabel(s.day, s.time) }));

  if (days.length === 0) return [];

  if (window.single || days.length === 1) {
    const day = days[0];
    // "dinner tonight at 8pm": the member named the time, so that is the option (30 min notice is their call,
    // not ours). Only when it has already passed do we fall back to generated times.
    if (input.time && atLocal(day, input.time, tz) >= now + 30 * MIN) return mk([{ day, time: input.time }]);
    const base = input.time ? [shiftTime(input.time, -60), input.time, shiftTime(input.time, 60)] : dayTimes(activity);
    const slots = base.map((time) => ({ day, time })).filter((s) => atLocal(s.day, s.time, tz) >= minStart);
    // Late in the day: offer what is left, in one-hour steps until 22:30.
    let cursor = slots.length ? atLocal(day, slots[slots.length - 1].time, tz) + HOUR : roundUp(minStart, 30 * MIN);
    const lastOk = atLocal(day, '22:30', tz);
    while (slots.length < 3 && cursor <= lastOk && isoDay(cursor, tz) === day) {
      const time = timeOfMs(cursor, tz);
      if (!slots.some((s) => s.time === time)) slots.push({ day, time });
      cursor += HOUR;
    }
    return mk(slots.slice(0, 3));
  }

  // An explicit time keeps a same-day option that is less than 3h away ("fri or sat at 8" said Friday at 6).
  const cands = days.filter((d) => atLocal(d, timeFor(d), tz) >= (input.time ? now + 30 * MIN : minStart));
  if (cands.length === 0) return [];

  if (window.explicit) return mk(cands.slice(0, 5).map((d) => ({ day: d, time: timeFor(d) })));

  const scoreOf = (d: string) => (input.weekendPref ? WEEKEND : SOCIAL)[weekdayOf(d)];
  if (cands.length <= 3) {
    const slots = cands.map((d) => ({ day: d, time: timeFor(d) }));
    // Fewer than three days: add a second time on the best day so there are still three choices.
    const best = [...cands].sort((a, b) => scoreOf(b) - scoreOf(a) || (a < b ? -1 : 1))[0];
    for (const alt of dayTimes(activity)) {
      if (slots.length >= 3) break;
      if (!slots.some((s) => s.day === best && s.time === alt) && atLocal(best, alt, tz) >= minStart) slots.push({ day: best, time: alt });
    }
    return mk(slots.slice(0, 3));
  }

  // Top three days by score, ties to the earlier day, then shown in chronological order (coordinator rule:
  // no spread constraint, which matches the docs' own "Thu, Fri, Sat" example).
  const top = [...cands].sort((a, b) => scoreOf(b) - scoreOf(a) || (a < b ? -1 : 1)).slice(0, 3);
  return mk(top.map((d) => ({ day: d, time: timeFor(d) })));
}

/**
 * Decide-by deadline (§1 step 4): min(now + 24h, first option − 6h), at least now + 2h, rounded up to the
 * half hour. In quiet hours it moves to 9:30am, or to 10:30pm the evening before if 9:30am would be too late.
 */
export function computeDeadline(firstStartsAt: number, now: number, tz: string, qh: [number, number]): number {
  // Short notice ("dinner tonight at 8pm" said at 5:45): decide halfway there, never at or after the start.
  if (firstStartsAt - now < 4 * HOUR) {
    const half = roundUp(now + Math.max(30 * MIN, (firstStartsAt - now) / 2), 15 * MIN);
    return Math.max(now + 15 * MIN, Math.min(half, firstStartsAt - 30 * MIN));
  }
  let d = Math.min(now + 24 * HOUR, firstStartsAt - 6 * HOUR);
  d = Math.max(d, now + 2 * HOUR);
  d = roundUp(d, 30 * MIN);
  if (isQuiet(d, tz, qh)) {
    const morning = quietEnd(d, tz, qh) + 30 * MIN;
    if (morning <= firstStartsAt - 3 * HOUR) return morning;
    const evening = eveningBefore(d, tz, qh, hm((qh[0] + 23) % 24, 30));
    return evening >= now + HOUR ? evening : morning;
  }
  return d;
}

// ───────────────────────── votes & tallies ─────────────────────────

export function activeOptions(plan: Plan): Option[] {
  return plan.options.filter((o) => !o.removed);
}

/** Effective vote: explicit per-option answer, else the day-level pref (yes outside its time window = maybe). */
export function effectiveVote(m: Member, o: Option): Vote | undefined {
  if (m.status === 'out') return undefined;
  const ov = m.optionVotes[o.id];
  if (ov) return ov;
  const dp = m.dayPrefs[o.day];
  if (!dp) return undefined;
  if (dp.vote !== 'no' && outsideWindow(dp, o.time)) return 'maybe';
  return dp.vote;
}

function outsideWindow(dp: { notBefore?: string; notAfter?: string }, time: string): boolean {
  return (dp.notBefore !== undefined && time < dp.notBefore) || (dp.notAfter !== undefined && time > dp.notAfter);
}

/** True when the member's "maybe" for this option comes from a time constraint ("fri but after 8:30"). */
export function isTimeMaybe(m: Member, o: Option): boolean {
  if (m.optionVotes[o.id]) return false;
  const dp = m.dayPrefs[o.day];
  return !!dp && dp.vote !== 'no' && outsideWindow(dp, o.time);
}

export interface OptionScore {
  id: number;
  score: number;
  yes: number;
  maybe: number;
  no: number;
  startsAt: number;
}

export function counts(plan: Plan, o: Option, override?: { member: MemberKey; vote: Vote }): OptionScore {
  let yes = 0;
  let maybe = 0;
  let no = 0;
  for (const m of Object.values(plan.members)) {
    const v = override && override.member === m.key ? override.vote : effectiveVote(m, o);
    if (v === 'yes') yes++;
    else if (v === 'maybe') maybe++;
    else if (v === 'no') no++;
  }
  return { id: o.id, score: yes + 0.5 * maybe, yes, maybe, no, startsAt: o.startsAt };
}

const byRank = (a: OptionScore, b: OptionScore) => b.score - a.score || b.yes - a.yes || a.no - b.no || a.startsAt - b.startsAt;

/**
 * §4: score = yes + 0.5 × maybe (unknown = 0). Options the organizer said no to are skipped unless every
 * option has that no. Ties: more yes, then fewer no, then earlier.
 */
export function chooseOption(plan: Plan, override?: { member: MemberKey; vote: Vote; optionId: number }): { optionId: number; ranked: OptionScore[] } | null {
  const active = activeOptions(plan);
  if (active.length === 0) return null;
  const ranked = active
    .map((o) => counts(plan, o, override && override.optionId === o.id ? override : undefined))
    .sort(byRank);
  const org = plan.members[plan.initiator];
  const vetoed = new Set(org ? active.filter((o) => effectiveVote(org, o) === 'no').map((o) => o.id) : []);
  const pool = vetoed.size === active.length ? ranked : ranked.filter((r) => !vetoed.has(r.id));
  return { optionId: pool[0].id, ranked };
}

/** Members who are not out. */
export function activeMembers(plan: Plan): Member[] {
  return Object.values(plan.members).filter((m) => m.status !== 'out');
}

/** Group size for "k of n": known active members, or the stated headcount minus people who are out. */
export function groupSize(plan: Plan): number {
  const all = Object.values(plan.members);
  const active = all.filter((m) => m.status !== 'out').length;
  const out = all.length - active;
  return Math.max(active, (plan.expectedHeadcount ?? 0) - out);
}

export function answeredCount(plan: Plan): number {
  return Object.values(plan.members).filter((m) => m.status === 'answered').length;
}

/** §4 early lock rule 2: every known member answered, and at least 2 did. */
export function everyoneAnswered(plan: Plan): boolean {
  const k = answeredCount(plan);
  return k >= 2 && k >= groupSize(plan);
}

/** Short option names: "Thu", or "Sat 11am" when a weekday repeats. */
export function optionShortNames(plan: Plan): Record<number, string> {
  const active = activeOptions(plan);
  const seen = new Map<string, number>();
  for (const o of active) seen.set(shortDay(o.day), (seen.get(shortDay(o.day)) ?? 0) + 1);
  const out: Record<number, string> = {};
  for (const o of active) out[o.id] = (seen.get(shortDay(o.day)) ?? 0) > 1 ? `${shortDay(o.day)} ${fmtTime(o.time)}` : shortDay(o.day);
  return out;
}

/** Living tally: "Thu 1 · Fri 3 · Sat 2" (yes counts). */
export function tallyLine(plan: Plan): string {
  const names = optionShortNames(plan);
  return activeOptions(plan)
    .map((o) => `${names[o.id]} ${counts(plan, o).yes}`)
    .join(' · ');
}

/** `homi why`: "Thu had 1 yes; Fri had 4 yes + 1 maybe; Sat had 3 yes, 2 no". */
export function whyTally(plan: Plan): string {
  const names = optionShortNames(plan);
  return activeOptions(plan)
    .map((o) => {
      const c = counts(plan, o);
      return `${names[o.id]} had ${c.yes} yes${c.maybe ? ` + ${c.maybe} maybe` : ''}${c.no ? `, ${c.no} no` : ''}`;
    })
    .join('; ');
}

// ───────────────────────── §5 bridges ─────────────────────────

export interface DayConflict {
  a: MemberKey;
  b: MemberKey;
  dayA: string;
  dayB: string;
}

function yesDays(plan: Plan, m: Member): Set<string> {
  const out = new Set<string>();
  for (const o of activeOptions(plan)) if (effectiveVote(m, o) === 'yes') out.add(o.day);
  return out;
}

/** Hard day conflict: two members each say yes only on different days, and no on the other's day. */
export function detectDayConflict(plan: Plan): DayConflict | null {
  const ms = Object.values(plan.members).filter((m) => m.status === 'answered');
  const active = activeOptions(plan);
  const allNo = (m: Member, day: string) => {
    const os = active.filter((o) => o.day === day);
    return os.length > 0 && os.every((o) => effectiveVote(m, o) === 'no');
  };
  for (let i = 0; i < ms.length; i++) {
    const da = yesDays(plan, ms[i]);
    if (da.size !== 1) continue;
    for (let j = i + 1; j < ms.length; j++) {
      const db = yesDays(plan, ms[j]);
      if (db.size !== 1) continue;
      const [x] = [...da];
      const [y] = [...db];
      if (x === y) continue;
      if (allNo(ms[i], y) && allNo(ms[j], x)) {
        return x < y ? { a: ms[i].key, b: ms[j].key, dayA: x, dayB: y } : { a: ms[j].key, b: ms[i].key, dayA: y, dayB: x };
      }
    }
  }
  return null;
}

export interface TimeShift {
  optionId: number;
  time: string;
  count: number;
  everyone: boolean;
}

/**
 * Time conflict: this member's constraint ("fri but after 8:30") makes an option a maybe, the option would
 * otherwise be the best, and moving it to the member's time gains yes votes overall.
 */
export function detectTimeShift(plan: Plan, member: MemberKey): TimeShift | null {
  const m = plan.members[member];
  if (!m || m.status === 'out') return null;
  for (const o of activeOptions(plan)) {
    if (!isTimeMaybe(m, o)) continue;
    const dp = m.dayPrefs[o.day];
    const time = dp.notBefore && o.time < dp.notBefore ? dp.notBefore : dp.notAfter;
    if (!time || time === o.time) continue;
    const best = chooseOption(plan, { member, vote: 'yes', optionId: o.id });
    if (!best || best.optionId !== o.id) continue;
    const shifted: Option = { ...o, time };
    const answered = Object.values(plan.members).filter((x) => x.status === 'answered');
    const yesAfter = answered.filter((x) => effectiveVote(x, shifted) === 'yes').length;
    const yesBefore = counts(plan, o).yes;
    if (yesAfter > yesBefore) return { optionId: o.id, time, count: yesAfter, everyone: yesAfter === answered.length };
  }
  return null;
}

export interface Stranded {
  stranded: MemberKey[];
  altId?: number;
  altIncluded: MemberKey[];
  winYes: number;
  altYes: number;
}

/**
 * Winner strands someone: an answered member has no yes on the winner but said yes elsewhere. `altId` is set
 * when a runner-up includes at least one of them and loses at most one yes.
 */
export function detectStranded(plan: Plan, winnerId: number): Stranded | null {
  const active = activeOptions(plan);
  const w = active.find((o) => o.id === winnerId);
  if (!w) return null;
  const answered = Object.values(plan.members).filter((m) => m.status === 'answered');
  const stranded = answered.filter((m) => effectiveVote(m, w) !== 'yes' && active.some((o) => o.id !== w.id && effectiveVote(m, o) === 'yes'));
  if (stranded.length === 0) return null;
  const winYes = counts(plan, w).yes;
  const org = plan.members[plan.initiator];
  let best: { id: number; incl: MemberKey[]; yes: number; startsAt: number } | null = null;
  for (const o of active) {
    if (o.id === w.id || (org && effectiveVote(org, o) === 'no')) continue;
    const incl = stranded.filter((m) => effectiveVote(m, o) === 'yes').map((m) => m.key);
    const yes = counts(plan, o).yes;
    if (incl.length === 0 || yes < winYes - 1) continue;
    if (!best || incl.length > best.incl.length || (incl.length === best.incl.length && (yes > best.yes || (yes === best.yes && o.startsAt < best.startsAt)))) {
      best = { id: o.id, incl, yes, startsAt: o.startsAt };
    }
  }
  return { stranded: stranded.map((m) => m.key), altId: best?.id, altIncluded: best?.incl ?? [], winYes, altYes: best?.yes ?? 0 };
}

/**
 * Spoken options for the phone call (PRIVACY §10): at most the current top 3 by score, in date order, as
 * "Thursday at 7". No names, no place.
 */
export function callOptions(plan: Plan): string[] {
  const ch = chooseOption(plan);
  const top = new Set((ch?.ranked ?? []).slice(0, 3).map((r) => r.id));
  return activeOptions(plan)
    .filter((o) => top.has(o.id))
    .sort((a, b) => a.startsAt - b.startsAt)
    .map((o) => `${longDay(o.day)} at ${fmtTime(o.time).replace(/(am|pm)$/, '')}`);
}

export function callQuestionList(plan: Plan): string {
  const opts = callOptions(plan);
  return opts.length > 2 ? `${opts.slice(0, -1).join(', ')}, or ${opts[opts.length - 1]}` : listJoin(opts, 'or');
}
