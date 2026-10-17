// collecting_dates -> collecting_availability: start a plan, post three options, read votes (DATE_FINDING §1-§3).

import type { Member, MemberRef, MessageEvent, Option, Plan, Prompting } from '../types.js';
import type { EnginePlan, ParsedAvailability, WindowSpec } from '../model.js';
import { TEMPLATES as T } from '../templates.js';
import { cuisinesIn } from '../hungry.js';
import { dayTokens, detectActivity, excludedWeekdays, nextOccurrence, parseAvailability, parseWindow, placeIn, preferredTime, thresholdIn } from '../parse.js';
import { activeOptions, computeDeadline, defaultTime, generateOptions, tallyLine } from '../schedule.js';
import { nudgeTime } from '../nudge.js';
import { HOUR, MIN, addDays, atLocal, fmtTime, isoDay, listJoin, normText, optionLabel, relLabel, shortDay, weekdayOf } from '../util.js';
import { type Step, P, availabilityOpen, cancel, howOf, member, reachable, react, refKey, say, schedule, seedRoster, touch, tzOf } from './core.js';
import { maybeEarlyLock } from './lock.js';
import { askBridge, bridgeAnswer } from './bridges.js';

export function weekendPref(activity: string): boolean {
  return ['brunch', 'hike', 'picnic', 'park'].includes(activity);
}

export function headerText(st: Step, tally?: string): string {
  const p = P(st);
  return T.header({
    activity: p.activity, window: p.windowLabel ?? 'soon', deadline: relLabel(p.deadlineAt as number, st.ctx.now, tzOf(st)), how: howOf(st), tally,
  });
}

/** "@homi dinner next week?" -> a plan, with options right away when the trigger names a window. */
export function startPlan(st: Step, from: MemberRef, msgRef: string | undefined, body: string): void {
  const now = st.ctx.now;
  const tz = tzOf(st);
  const act = detectActivity(body);
  let win = parseWindow(body, now, tz);
  const today = isoDay(now, tz);
  const clock = preferredTime(body);
  // "plan something for 8 pm to eat out": a time with no day means today, as long as it is still ahead.
  if (!win && clock && atLocal(today, clock, tz) >= now + 30 * MIN) {
    win = { label: Number(clock.slice(0, 2)) >= 17 ? 'tonight' : 'today', days: [today], single: true, range: [today] };
  }
  if (win && clock) win = rollPastDay(win, clock, now, tz);
  const p: EnginePlan = {
    id: st.ctx.newId(), state: 'collecting_dates', stack: [], activity: act.activity, outdoor: act.outdoor, initiator: from.key,
    options: [], members: {}, notes: {}, nudges: [], refs: { options: {}, placeOptions: {} }, createdAt: now, updatedAt: now,
  };
  const hint = cuisinesIn(body);
  if (hint.length) p.cuisineHint = hint;
  const thr = thresholdIn(body);
  if (thr) p.threshold = thr;
  const pt = preferredTime(body);
  if (pt) p.preferredTime = pt;
  // "plan something for 8pm": no activity named, but the hour says what kind of meal it is.
  if (!act.named && clock) p.activity = mealByHour(Number(clock.slice(0, 2)));
  // "dinner tonight at 8pm at halal guys": the place is settled from the start.
  const place = placeIn(body);
  if (place) p.place = { name: place, source: 'user' };
  st.s.plan = p;
  reachable(st, touch(st, from, msgRef), msgRef);
  seedRoster(st);
  if (place) say(st, T.placeSetOpen({ place }));
  // "homi plan something next week": ask what first; the window (if any) waits for the answer.
  if (!act.named && !clock && !hint.length) {
    p.activityUnknown = true;
    if (win) p.pendingWindow = win;
    say(st, T.askActivity());
    schedule(st, 'dates_nudge', now + 12 * HOUR);
    schedule(st, 'dates_abandon', now + 36 * HOUR);
    return;
  }
  if (win) {
    const exW = excludedWeekdays(body);
    p.excludedDays = (win.range ?? win.days).filter((d) => exW.includes(weekdayOf(d)));
    openAvailability(st, win, 'prompted');
    return;
  }
  say(st, T.askWhen());
  schedule(st, 'dates_nudge', now + 12 * HOUR);
  schedule(st, 'dates_abandon', now + 36 * HOUR);
}

/**
 * "saturday 7pm" said on a Saturday evening means next Saturday, not a time that has already passed today:
 * a single named day whose time is less than 30 minutes away rolls forward a week.
 */
export function rollPastDay(win: WindowSpec, clock: string, now: number, tz: string): WindowSpec {
  if (!win.single || win.days.length !== 1 || win.days[0] !== isoDay(now, tz)) return win;
  if (atLocal(win.days[0], clock, tz) >= now + 30 * MIN) return win;
  if (win.label === 'tonight' || win.label === 'today') return win; // "tonight at 6" when it is 7: let the generator fall back
  const day = addDays(win.days[0], 7);
  return { ...win, days: [day], range: [day] };
}

function mealByHour(h: number): string {
  if (h < 11) return 'breakfast';
  if (h < 15) return 'lunch';
  if (h < 17) return 'coffee';
  if (h < 22) return 'dinner';
  return 'drinks';
}

/** The answer to "What are we doing?": sets the activity, then opens the saved window or asks when. */
export function activityReply(st: Step, body: string, addressed: boolean): boolean {
  const p = P(st);
  if (!p.activityUnknown) return false;
  const a = detectActivity(body);
  const win = windowReply(st, body, true);
  if (!a.named) {
    if (win) p.pendingWindow = win; // "next week" before saying what: keep it, ask again
    if (addressed || win) say(st, T.askActivity());
    return addressed || !!win;
  }
  p.activity = a.activity;
  p.outdoor = a.outdoor;
  p.activityUnknown = undefined;
  let w = win ?? p.pendingWindow;
  p.pendingWindow = undefined;
  const pt = preferredTime(body);
  if (pt) p.preferredTime = pt;
  if (w && p.preferredTime) w = rollPastDay(w, p.preferredTime, st.ctx.now, tzOf(st));
  if (w && openAvailability(st, w, 'prompted')) return true;
  say(st, T.askWhen());
  return true;
}

/** Generates options for a window and opens collecting_availability: header + bubbles (or a poll), deadline, nudge. */
export function openAvailability(st: Step, win: WindowSpec, prompting: Prompting): boolean {
  const p = P(st);
  const now = st.ctx.now;
  const tz = tzOf(st);
  const startId = p.options.reduce((m, o) => Math.max(m, o.id), 0) + 1;
  const gen = (w: WindowSpec) =>
    generateOptions({ activity: p.activity, window: w, now, tz, excludeDays: p.excludedDays, time: p.preferredTime, weekendPref: weekendPref(p.activity), startId });
  let w = win;
  let opts = gen(w);
  if (!opts.length) {
    w = parseWindow('soon', now, tz) as WindowSpec;
    opts = gen(w);
  }
  if (!opts.length) return false;
  p.options.push(...opts);
  p.windowLabel = w.label;
  p.windowDays = w.range ?? w.days;
  p.deadlineAt = computeDeadline(Math.min(...opts.map((o) => o.startsAt)), now, tz, st.ctx.quietHours);
  p.state = 'collecting_availability';
  p.bridge = undefined;
  p.refs.header = undefined;
  p.refs.headerSentAt = undefined;
  p.refs.poll = undefined;
  cancel(st, 'dates_nudge', 'dates_abandon', 'quorum_dm', 'quorum_close');
  emitOptions(st, opts, prompting);
  schedule(st, 'availability_deadline', p.deadlineAt);
  const nt = nudgeTime(now, p.deadlineAt, tz, st.ctx.quietHours);
  if (nt !== null) schedule(st, 'availability_nudge', nt);
  // Demo quorum: ask the silent privately soon after the options go out (timers.ts quorumDm).
  if (st.ctx.quorum) schedule(st, 'quorum_dm', now + st.ctx.quorum.dmAfterMs);
  return true;
}

function emitOptions(st: Step, opts: Option[], prompting: Prompting): void {
  const p = P(st);
  const bubbles = opts.map((o) => T.optionBubble({ id: o.id, label: o.label }));
  if (st.ctx.caps.polls) {
    const question = T.pollQuestion({ activity: p.activity, window: p.windowLabel ?? 'soon', deadline: relLabel(p.deadlineAt as number, st.ctx.now, tzOf(st)) });
    st.acts.push({ type: 'poll', question, options: bubbles, prompting, tag: 'poll:dates' });
    return;
  }
  say(st, headerText(st), prompting, 'header');
  opts.forEach((o, i) => say(st, bubbles[i], prompting, `option:${o.id}`));
}

/** DATE_FINDING §3 rules 4-5: day-level prefs; explicit answers win; later messages override only what they mention. */
export function applyParsed(p: Plan, m: Member, parsed: ParsedAvailability): void {
  if (parsed.all) m.optionVotes = {};
  for (const [day, pref] of Object.entries(parsed.dayPrefs)) {
    m.dayPrefs[day] = pref;
    for (const o of p.options) if (o.day === day) delete m.optionVotes[o.id];
  }
  for (const [id, v] of Object.entries(parsed.optionVotes)) m.optionVotes[Number(id)] = v;
  if (m.status !== 'out') m.status = 'answered';
  if (parsed.lowConfidence) m.lowConfidence = true;
  else delete m.lowConfidence;
}

/** Living tally: edit the header where the channel allows it, instead of posting anything new. */
export function tallyEdit(st: Step, before: string): void {
  const p = P(st);
  const caps = st.ctx.caps;
  if (!caps.edit || !p.refs.header || !availabilityOpen(p)) return;
  if (caps.editWindowMs && st.ctx.now - (p.refs.headerSentAt ?? 0) > caps.editWindowMs) return;
  const after = tallyLine(p);
  if (after !== before) st.acts.push({ type: 'edit', target: p.refs.header, text: headerText(st, after) });
}

/** After any vote: bridges first (prompted, immediate), then early lock, then the living tally. */
export function afterVote(st: Step, m: Member, parsed: ParsedAvailability | null, before: string, prompting: Prompting = 'prompted'): void {
  const p = P(st);
  let asked = false;
  if (parsed) asked = bridgeAnswer(st, m, parsed);
  if (!asked && !p.bridge && p.state === 'collecting_availability') asked = askBridge(st, m, parsed);
  if (!asked) maybeEarlyLock(st, prompting);
  if (!st.s.plan) return; // the demo quorum cancelled the plan: nothing left to tally
  tallyEdit(st, before);
}

/** A text message as a date vote (rule 6 for unaddressed messages). Returns false when it isn't one. */
export function tryTextVote(st: Step, ev: MessageEvent, body: string, addressed: boolean): boolean {
  const p = P(st);
  const m = member(st, ev.from);
  const replyOpt = refKey(p.refs.options, ev.replyTo);
  const replyHeader = !!ev.replyTo && ev.replyTo === p.refs.header;
  const parsed = parseAvailability(body, p.options, tzOf(st), { now: st.ctx.now, replyOptionId: replyOpt, addressed: addressed || replyHeader });
  const ok = parsed.matched && (addressed || replyHeader || replyOpt !== undefined || parsed.voteLike);
  const before = tallyLine(p);
  if (!ok) {
    const llm = ev.llmVote;
    if (!addressed || !llm || !llm.optionIds.length) return false;
    for (const id of llm.optionIds) if (p.options.some((o) => o.id === id && !o.removed)) m.optionVotes[id] = llm.vote;
    if (m.status !== 'out') m.status = 'answered';
    m.lowConfidence = true;
    react(st, ev.msgRef);
    afterVote(st, m, null, before);
    return true;
  }
  applyParsed(p, m, parsed);
  react(st, ev.msgRef);
  afterVote(st, m, parsed, before);
  return true;
}

/** Window replies while collecting_dates: addressed, or a short unaddressed reply that names a window. */
const PROPOSE = /\b(?:i was thinking|i'?m thinking|what about|how about|maybe|can we do|could we do|let'?s do|lets do|prefer|rather|would be better|is better|instead)\b/;

/**
 * A day nobody proposed ("homi wednesday works", or an unaddressed "I was thinking Wednesday") becomes a new option
 * at the plan's time, with the proposer's yes. Unaddressed messages need a proposal phrase, so passing mentions of
 * a weekday stay ignored. Days already on the ballot are left to the vote grammar.
 */
export function proposeDay(st: Step, ev: MessageEvent, body: string, addressed: boolean): boolean {
  const p = P(st);
  if (p.state !== 'collecting_availability') return false;
  const t = normText(body);
  if (t.split(/\s+/).length > 12) return false;
  if (!addressed && !PROPOSE.test(t)) return false;
  const now = st.ctx.now;
  const tz = tzOf(st);
  const today = isoDay(now, tz);
  const days = [...new Set(dayTokens(t).map((d) => nextOccurrence(today, d.wd)))];
  if (/\btomorrow\b|\btmrw?\b|\btmr\b/.test(t)) days.push(addDays(today, 1));
  else if (/\btonight\b|\btoday\b/.test(t)) days.push(today);
  if (days.length !== 1) return false;
  const day = days[0];
  if (p.options.some((o) => !o.removed && o.day === day)) return false;
  const time = p.preferredTime ?? defaultTime(p.activity, weekdayOf(day));
  const startsAt = atLocal(day, time, tz);
  if (startsAt < now + 3 * HOUR) return false;
  const m = touch(st, ev.from, ev.msgRef);
  if (!m) return false;
  const before = tallyLine(p);
  const id = p.options.reduce((x, o) => Math.max(x, o.id), 0) + 1;
  p.options.push({ id, day, time, startsAt, label: optionLabel(day, time) });
  m.optionVotes[id] = 'yes';
  if (m.status !== 'out') m.status = 'answered';
  say(st, T.addedOption({ how: howOf(st) }));
  say(st, T.optionBubble({ id, label: optionLabel(day, time) }), 'prompted', `option:${id}`);
  afterVote(st, m, null, before);
  return true;
}

/**
 * "homi make it 8pm", "homi I said 8pm": the open poll is re-proposed at that time, one option per day. While
 * dates are still being asked for, the time is kept for when they arrive. An existing option at that time is a
 * vote, not a change, so it falls through to the vote grammar.
 */
export function setTime(st: Step, ev: MessageEvent, time: string): boolean {
  const p = P(st);
  if (p.state === 'collecting_dates') {
    p.preferredTime = time;
    say(st, T.timeNoted({ time: fmtTime(time) }));
    return true;
  }
  if (p.state !== 'collecting_availability') return false;
  const active = activeOptions(p);
  if (!active.length) return false;
  const same = active.filter((o) => o.time === time);
  if (same.length) {
    // "homi 8pm works" when 8pm is already on the ballot: a yes for that option (one day), or point at the options.
    if (same.length !== 1) {
      say(st, T.timeAlready({ time: fmtTime(time), ids: listJoin(same.map((o) => String(o.id)), 'and'), how: howOf(st) }));
      return true;
    }
    const m = touch(st, ev.from, ev.msgRef);
    if (!m) return false;
    const before = tallyLine(p);
    m.optionVotes[same[0].id] = 'yes';
    if (m.status !== 'out') m.status = 'answered';
    afterVote(st, m, null, before);
    return true;
  }
  const days = [...new Set(active.map((o) => o.day))];
  for (const o of active) o.removed = true;
  const prevTime = p.preferredTime;
  p.preferredTime = time;
  const win: WindowSpec = { label: p.windowLabel ?? listJoin(days.map(shortDay), 'or'), days, single: days.length === 1, range: p.windowDays ?? days };
  say(st, T.timeMoved({ time: fmtTime(time) }));
  if (openAvailability(st, win, 'prompted')) return true;
  for (const o of active) o.removed = false;
  p.preferredTime = prevTime;
  st.acts.pop(); // the "Changed the time" line: nothing fit, so it is not true
  say(st, T.timeTooSoon({ time: fmtTime(time) }));
  return true;
}

export function windowReply(st: Step, body: string, addressed: boolean): WindowSpec | null {
  const win = parseWindow(body, st.ctx.now, tzOf(st));
  if (!win) return null;
  if (addressed) return win;
  const words = body.trim().split(/\s+/).length;
  return words <= 6 && !/\b(was|were|last|yesterday|did|had)\b/i.test(body) ? win : null;
}
