// Scheduler-fired jobs. Everything here is unprompted (noise budget + quiet hours) except the hungry-flow
// conclusion and the 30-minute reminder a member asked for. Stale jobs (other plan id, wrong state) are no-ops.

import type { EngineEvent, Member, MemberKey } from '../types.js';
import { TEMPLATES as T } from '../templates.js';
import { BUDGET_MS, escalationTargets, gateUnprompted, nudgeable, whoLabel } from '../nudge.js';
import {
  activeMembers, activeOptions, answeredCount, callOptions, callQuestionList, chooseOption, counts, effectiveVote, everyoneAnswered,
  groupSize, optionShortNames, tallyLine,
} from '../schedule.js';
import { optionDays, parseAvailability } from '../parse.js';
import { DAY, HOUR, MIN, fmtTimeMs, isoDay, listJoin, relDayWord, relLabel, shortDay } from '../util.js';
import { type Step, P, availabilityOpen, cancel, defer, howOf, planOf, purgePlan, replyTo, say, schedule, tzOf } from './core.js';
import { lockOption } from './lock.js';
import { afterVote, applyParsed } from './availability.js';
import { closePlaces, startSearch } from './place.js';
import { EXTENSIONS } from '../ext/index.js';

type Timer = Extract<EngineEvent, { kind: 'timer' }>;

function gate(st: Step, expiresAt?: number, must = false) {
  return gateUnprompted({ now: st.ctx.now, tz: tzOf(st), quietHours: st.ctx.quietHours, lastUnpromptedAt: st.s.lastUnpromptedAt, expiresAt, must });
}

/**
 * The opt-in private check-ins (call or DM). Always emitted right after the group message announcing them.
 * PRIVACY §10: the call carries only the open question and the option times. No names, no place.
 */
function checkIn(st: Step, esc: Member[]): void {
  const p = P(st);
  const question = T.callQuestion({ options: callQuestionList(p) });
  const dmOptions = listJoin(activeOptions(p).map((o) => T.optionBubble({ id: o.id, label: o.label })), 'or');
  for (const m of esc) {
    if (m.optInCall) st.acts.push({ type: 'call', member: m.key, question, options: callOptions(p), callRef: st.ctx.newId(), planId: p.id });
    else st.acts.push({ type: 'dm', member: m.key, text: T.dmCheckIn({ options: dmOptions }), planId: p.id });
    p.nudges.push({ at: st.ctx.now, kind: m.optInCall ? 'call' : 'dm', target: m.key });
  }
}

/**
 * Ends a deadline-time check-in: lock now (prompted, it concludes the flow the group was told about).
 * `unreached` members get one "Couldn't reach Sam; going with Fri." line first.
 */
function concludeEscalation(st: Step, unreached: MemberKey[]): void {
  const p = P(st);
  p.escalationPending = undefined;
  cancel(st, 'escalate-timeout');
  if (p.state !== 'collecting_availability') return;
  const ch = chooseOption(p);
  if (!ch) return;
  const missing = unreached.map((k) => p.members[k]).filter((m): m is Member => !!m);
  if (missing.length) say(st, T.escalateTimeout({ name: whoLabel(missing), day: optionShortNames(p)[ch.optionId] }));
  lockOption(st, ch.optionId, everyoneAnswered(p) ? 'everyone' : 'deadline', 'prompted');
}

/** Nudge A at 50% of the window, with the opt-in DM/call escalation folded into the same announced message. */
function availabilityNudge(st: Step): void {
  const p = P(st);
  const now = st.ctx.now;
  const tz = tzOf(st);
  if (p.state !== 'collecting_availability' || p.deadlineAt === undefined) return;
  const g = gate(st, p.deadlineAt - BUDGET_MS);
  if (g.kind === 'defer') return defer(st, 'availability_nudge', g.at);
  if (g.kind === 'drop') return;
  const pend = nudgeable(p);
  const n = groupSize(p);
  const k = answeredCount(p);
  const unknown = Math.max(0, n - activeMembers(p).length);
  if (!pend.length && !unknown) return;
  const deadline = relLabel(p.deadlineAt, now, tz);
  const tone = st.s.space.tone;
  const how = howOf(st);
  const esc = escalationTargets(pend, st.ctx.caps);
  if (esc.length) {
    const mode = esc.every((m) => m.optInCall) ? 'call' : esc.every((m) => !m.optInCall) ? 'dm' : 'mixed';
    say(st, T.nudgeEscalate({ k, n, who: whoLabel(pend, unknown), callees: whoLabel(esc), same: esc.length === pend.length && !unknown, mode, deadline }), 'unprompted');
    checkIn(st, esc);
  } else if (st.ctx.caps.inlineReply && pend.length === 1 && !unknown && pend[0].lastMsgRef) {
    replyTo(st, pend[0].lastMsgRef, T.nudgeIndividual(tone, { days: optionDays(p.options), how }), 'unprompted');
    p.nudges.push({ at: now, kind: 'individual', target: pend[0].key });
  } else {
    const day = Math.round((Date.parse(isoDay(now, tz)) - Date.parse(isoDay(p.createdAt, tz))) / DAY) + 1;
    const total = pend.length + unknown;
    say(st, T.nudgeCollective(tone, { k, n, who: whoLabel(pend, unknown), deadline, day, hasHave: total === 1 ? 'has' : 'have', how }), 'unprompted');
    p.nudges.push({ at: now, kind: 'collective' });
  }
  for (const m of pend) m.nudgeCount++;
}

/**
 * Deadline: choose (§4). Waits while a food detour runs; never dropped, only deferred by quiet hours/budget.
 * Short windows (no 50% nudge): opted-in pending members are called/DM'd here first, announced in the one
 * unprompted message, and the lock follows their result (or 10 minutes) as a prompted message.
 */
function availabilityDeadline(st: Step, payload?: Record<string, unknown>): void {
  const p = P(st);
  const now = st.ctx.now;
  if (payload?.afterEscalation) return p.escalationPending?.length ? concludeEscalation(st, p.escalationPending) : undefined;
  if (p.state === 'collecting_place' && p.stack.includes('collecting_availability')) return defer(st, 'availability_deadline', now + 15 * MIN);
  if (p.state !== 'collecting_availability') return;
  if (p.pendingProposal) {
    p.deadlineAt = now + DAY;
    return defer(st, 'availability_deadline', p.deadlineAt);
  }
  if (answeredCount(p) === 0) return schedule(st, 'dates_abandon', now + DAY);
  const ch = chooseOption(p);
  const best = ch?.ranked.find((r) => r.id === ch.optionId);
  if (!ch || !best || best.score <= 0) {
    if (gate(st, now + HOUR).kind === 'send') say(st, T.noneWork(), 'unprompted');
    return schedule(st, 'dates_abandon', now + DAY);
  }
  const g = gate(st, undefined, true);
  if (g.kind !== 'send') {
    const at = g.kind === 'defer' ? g.at : now + HOUR;
    p.deadlineAt = at;
    return defer(st, 'availability_deadline', at);
  }
  const contacted = new Set(p.nudges.filter((x) => x.kind === 'call' || x.kind === 'dm').map((x) => x.target));
  const esc = escalationTargets(nudgeable(p), st.ctx.caps).filter((m) => !contacted.has(m.key));
  if (esc.length) {
    const pend = Object.values(p.members).filter((m) => m.status === 'pending');
    const unknown = Math.max(0, groupSize(p) - activeMembers(p).length);
    const mode = esc.every((m) => m.optInCall) ? 'call' : esc.every((m) => !m.optInCall) ? 'dm' : 'mixed';
    say(st, T.escalateDeadline({ who: whoLabel(pend, unknown), callees: whoLabel(esc), same: esc.length === pend.length && !unknown, mode }), 'unprompted');
    checkIn(st, esc);
    for (const m of esc) m.nudgeCount++;
    p.escalationPending = esc.map((m) => m.key);
    schedule(st, 'availability_deadline', now + 10 * MIN, { name: 'escalate-timeout', payload: { afterEscalation: true } });
    return;
  }
  lockOption(st, ch.optionId, 'deadline', 'unprompted');
}

/**
 * Demo quorum, step 1 (QUORUM_DM_AFTER_MS after the options): everyone still silent is asked privately where Homi
 * has their handle, and named in the group either way; the close is scheduled QUORUM_REPLY_MS later.
 */
function quorumDm(st: Step): void {
  const p = P(st);
  const q = st.ctx.quorum;
  if (!q) return;
  const now = st.ctx.now;
  if (p.state === 'collecting_place' && p.stack.includes('collecting_availability')) return defer(st, 'quorum_dm', now + 15 * MIN);
  if (p.state !== 'collecting_availability') return;
  const pend = Object.values(p.members).filter((m) => m.status === 'pending');
  const unknown = Math.max(0, groupSize(p) - activeMembers(p).length);
  if (!pend.length && !unknown) return;
  const dmOptions = listJoin(activeOptions(p).map((o) => T.optionBubble({ id: o.id, label: o.label })), 'or');
  let dmd = 0;
  for (const m of pend) {
    // A sealed handle (they spoke or tapped), or a platform roster the runner can resolve (dedicated iMessage line).
    if (!st.ctx.caps.dm || !(m.hasDelivery || st.ctx.caps.roster)) continue;
    st.acts.push({ type: 'dm', member: m.key, text: T.dmQuorum({ activity: p.activity, options: dmOptions }), planId: p.id });
    p.nudges.push({ at: now, kind: 'dm', target: m.key });
    m.nudgeCount++;
    dmd++;
  }
  const closeAt = now + q.replyMs;
  p.quorumAskedAt = now;
  say(st, T.quorumPing({ who: whoLabel(pend, unknown), dmd: dmd > 0, by: relLabel(closeAt, now, tzOf(st)) }), 'prompted');
  schedule(st, 'quorum_close', closeAt);
}

/** Demo quorum, step 2: the silent count as not coming; then lock with >= minYes yes votes, or cancel the plan. */
function quorumClose(st: Step): void {
  const p = P(st);
  const q = st.ctx.quorum;
  if (!q) return;
  const now = st.ctx.now;
  if (p.state === 'collecting_place' && p.stack.includes('collecting_availability')) return defer(st, 'quorum_close', now + 15 * MIN);
  if (p.state !== 'collecting_availability') return;
  const pend = Object.values(p.members).filter((m) => m.status === 'pending');
  const unknown = Math.max(0, groupSize(p) - activeMembers(p).length);
  for (const m of pend) m.status = 'out';
  if (unknown > 0) p.expectedHeadcount = undefined; // whoever never spoke is not coming either
  if (pend.length || unknown) say(st, T.quorumOut({ who: whoLabel(pend, unknown) }), 'prompted');
  const ch = chooseOption(p);
  const yes = ch ? counts(p, activeOptions(p).find((o) => o.id === ch.optionId)!).yes : 0;
  if (!ch || yes < q.minYes) {
    say(st, T.noQuorum({ yes, activity: p.activity }), 'prompted');
    return purgePlan(st);
  }
  lockOption(st, ch.optionId, 'everyone', 'prompted');
}

function whatOf(st: Step): string {
  const p = P(st);
  if (p.place) return p.place.address ? `${p.place.name}, ${p.place.address}` : p.place.name;
  return `${p.activity}, place still open`;
}

function remindDay(st: Step, payload?: Record<string, unknown>): void {
  const p = P(st);
  const now = st.ctx.now;
  const tz = tzOf(st);
  if (payload?.step === 'weather') {
    if (!p.outdoor || p.eventAt === undefined) return;
    p.weatherReq = st.ctx.newId();
    st.acts.push({ type: 'lookup_weather', requestId: p.weatherReq, near: p.neighborhood ?? p.place?.address ?? p.place?.name ?? '', at: p.eventAt });
    return;
  }
  if (p.state === 'collecting_place') return defer(st, 'remind_day', now + 30 * MIN);
  if ((p.state !== 'confirmed' && p.state !== 'collecting_details') || p.remindDaySent || p.eventAt === undefined) return;
  const E = p.eventAt;
  const g = gate(st, E - 13 * HOUR);
  if (g.kind === 'defer') return defer(st, 'remind_day', g.at);
  if (g.kind === 'drop') return;
  p.state = 'reminded';
  p.remindDaySent = true;
  say(st, T.remindDay({ day: relDayWord(E, now, tz), time: fmtTimeMs(E, tz), what: whatOf(st), url: p.place?.mapsUrl, rain: !!(p.outdoor && p.rainLikely) }), 'unprompted');
}

function remindHour(st: Step): void {
  const p = P(st);
  if (!['confirmed', 'reminded', 'collecting_details'].includes(p.state) || p.remindHourSent || p.eventAt === undefined) return;
  const g = gate(st, p.eventAt - 15 * MIN);
  if (g.kind === 'defer') return defer(st, 'remind_hour', g.at);
  if (g.kind === 'drop') return;
  if (p.state === 'collecting_details') p.state = 'confirmed';
  p.remindHourSent = true;
  say(st, T.remindHour({ what: p.place ? whatOf(st) : `${p.activity} at ${fmtTimeMs(p.eventAt, tzOf(st))}` }), 'unprompted');
}

export function onTimer(st: Step, ev: Timer): void {
  const p = planOf(st);
  if (!p || ev.planId !== p.id) return;
  if (ev.job === 'ext') {
    const x = EXTENSIONS.find((e) => e.name === ev.payload?.ext);
    return x?.onTimer?.(st, ev);
  }
  const now = st.ctx.now;
  switch (ev.job) {
    case 'quorum_dm': return quorumDm(st);
    case 'quorum_close': return quorumClose(st);
    case 'availability_nudge': return availabilityNudge(st);
    case 'availability_escalate': return; // folded into the 50% nudge (coordinator rule); kept for old jobs
    case 'availability_deadline': return availabilityDeadline(st, ev.payload);
    case 'bridge_timeout':
      // Stranded bridge with the place already picked: confirm silently (the place line already went out).
      if (p.bridge?.kind === 'stranded' && p.state === 'collecting_details' && p.place) p.state = 'confirmed';
      p.bridge = undefined;
      return;
    case 'dates_nudge': {
      if (p.state !== 'collecting_dates') return;
      const g = gate(st, p.createdAt + 30 * HOUR);
      if (g.kind === 'defer') return defer(st, 'dates_nudge', g.at);
      if (g.kind === 'drop') return;
      p.nudges.push({ at: now, kind: 'dates' });
      return say(st, T.datesNudge({ activity: p.activity }), 'unprompted');
    }
    case 'dates_abandon':
      if (p.state === 'collecting_dates' || (p.state === 'collecting_availability' && answeredCount(p) === 0)) purgePlan(st);
      return;
    case 'details_nudge': {
      if (p.state !== 'collecting_details' || p.eventAt === undefined || p.eventAt - now <= 36 * HOUR) return;
      const g = gate(st, p.eventAt - 36 * HOUR);
      if (g.kind === 'defer') return defer(st, 'details_nudge', g.at);
      if (g.kind === 'drop') return;
      p.nudges.push({ at: now, kind: 'details' });
      return say(st, T.detailsNudge({ day: shortDay(isoDay(p.eventAt, tzOf(st))) }), 'unprompted');
    }
    case 'hungry_deadline':
      if (p.state !== 'collecting_place' || !p.hungry) return;
      if (p.hungry.phase === 'asking') return startSearch(st);
      if (p.hungry.phase === 'voting') return closePlaces(st, 'prompted');
      return;
    case 'remind_day': return remindDay(st, ev.payload);
    case 'remind_hour': return remindHour(st);
    case 'remind_30':
      if (!p.remindReq30 || p.remind30Sent || p.eventAt === undefined || !['confirmed', 'reminded'].includes(p.state)) return;
      p.remind30Sent = true;
      return say(st, T.remind30({ what: whatOf(st) }), 'prompted');
    case 'complete':
      if (p.state !== 'completed') p.state = 'completed';
      return;
    case 'purge': return purgePlan(st);
  }
}

/** call_result: votes via the same grammar; a prompted group post ("Sam's in for Fri (by phone). 6 for 6 🎉"). */
export function onCallResult(st: Step, ev: Extract<EngineEvent, { kind: 'call_result' }>): void {
  const p = planOf(st);
  if (!p || ev.planId !== p.id) return;
  const m = p.members[ev.member];
  if (!m) return;
  const name = m.name ?? 'Someone';
  const simulated = !!ev.simulated;
  // A deadline-time check-in: once every contacted member has a result, the lock follows in this same step.
  const escalating = !!p.escalationPending?.includes(ev.member);
  if (escalating) p.escalationPending = p.escalationPending!.filter((k) => k !== ev.member);
  const done = escalating && p.escalationPending!.length === 0;
  if (!ev.ok) {
    if (done) return concludeEscalation(st, [ev.member]);
    const deadline = p.state === 'collecting_availability' && p.deadlineAt ? relLabel(p.deadlineAt, st.ctx.now, tzOf(st)) : undefined;
    return say(st, T.callFailed({ name, simulated, deadline }));
  }
  const before = tallyLine(p);
  let applied = false;
  const active = activeOptions(p);
  if (ev.optionIds?.length) {
    for (const id of ev.optionIds) if (active.some((o) => o.id === id)) m.optionVotes[id] = 'yes';
    applied = true;
  } else if (ev.answerText) {
    const parsed = parseAvailability(ev.answerText, p.options, tzOf(st), { now: st.ctx.now, addressed: true });
    if (parsed.matched) {
      applyParsed(p, m, parsed);
      applied = true;
    }
  }
  if (!applied) {
    say(st, T.callUnclear({ name, simulated }));
    if (done) concludeEscalation(st, []);
    return;
  }
  if (m.status !== 'out') m.status = 'answered';
  const yes = active.filter((o) => effectiveVote(m, o) === 'yes');
  if (!yes.length) say(st, T.callNone({ name, simulated }));
  else {
    const sn = optionShortNames(p);
    const k = Math.max(...yes.map((o) => counts(p, o).yes));
    say(st, T.callYes({ name, days: listJoin(yes.map((o) => sn[o.id])), k, n: groupSize(p), simulated }));
  }
  if (availabilityOpen(p)) afterVote(st, m, null, before);
  if (done && P(st).state === 'collecting_availability') concludeEscalation(st, []);
}

export function onWeather(st: Step, ev: Extract<EngineEvent, { kind: 'weather_result' }>): void {
  const p = planOf(st);
  if (p && p.weatherReq === ev.requestId) p.rainLikely = ev.rainLikely;
}
