// collecting_dates -> collecting_availability: start a plan, post three options, read votes (DATE_FINDING §1-§3).

import type { Member, MemberRef, MessageEvent, Option, Plan, Prompting } from '../types.js';
import type { EnginePlan, ParsedAvailability, WindowSpec } from '../model.js';
import { TEMPLATES as T } from '../templates.js';
import { cuisinesIn } from '../hungry.js';
import { detectActivity, excludedWeekdays, parseAvailability, parseWindow, preferredTime, thresholdIn } from '../parse.js';
import { computeDeadline, generateOptions, tallyLine } from '../schedule.js';
import { nudgeTime } from '../nudge.js';
import { HOUR, relLabel, weekdayOf } from '../util.js';
import { type Step, P, availabilityOpen, cancel, howOf, member, react, refKey, say, schedule, touch, tzOf } from './core.js';
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
  const win = parseWindow(body, now, tz);
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
  st.s.plan = p;
  touch(st, from, msgRef);
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
  cancel(st, 'dates_nudge', 'dates_abandon');
  emitOptions(st, opts, prompting);
  schedule(st, 'availability_deadline', p.deadlineAt);
  const nt = nudgeTime(now, p.deadlineAt, tz, st.ctx.quietHours);
  if (nt !== null) schedule(st, 'availability_nudge', nt);
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
export function windowReply(st: Step, body: string, addressed: boolean): WindowSpec | null {
  const win = parseWindow(body, st.ctx.now, tzOf(st));
  if (!win) return null;
  if (addressed) return win;
  const words = body.trim().split(/\s+/).length;
  return words <= 6 && !/\b(was|were|last|yesterday|did|had)\b/i.test(body) ? win : null;
}
