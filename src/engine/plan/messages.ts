// Message routing. Order: intro (once) -> head-count -> commands -> the current state's handler.
// Before a plan exists Homi answers only when addressed (silence until invited); notice mode is the one
// opt-in exception and is gated by the noise budget and quiet hours.

import type { Action, MessageEvent } from '../types.js';
import { TEMPLATES as T } from '../templates.js';
import { UNADDRESSED_COMMANDS, detectAddressed, isBareNo, isBareYes, isHangoutPhrase, parseCommand, preferredTime, stripAddress } from '../parse.js';
import { foodTrigger, planOrFood } from '../intent.js';
import { gateUnprompted } from '../nudge.js';
import { activeOptions } from '../schedule.js';
import { DAY } from '../util.js';
import { type Step, P, intro, isHomiRef, member, planOf, reachable, say, touch, tzOf } from './core.js';
import { onCommand } from './commands.js';
import { activityReply, openAvailability, proposeDay, rollPastDay, startPlan, tryTextVote, windowReply } from './availability.js';
import { timeShiftAnswer } from './bridges.js';
import { maybeEarlyLock } from './lock.js';
import { onPlaceMessage, pushHungry, startInstant } from './place.js';
import { isDateVeto, lateVote, reopenDate, strandedAnswer } from './confirmed.js';
import { EXTENSIONS } from '../ext/index.js';

function idList(st: Step): string {
  const ids = activeOptions(P(st)).map((o) => String(o.id));
  return ids.length > 1 ? `${ids.slice(0, -1).join(', ')} or ${ids[ids.length - 1]}` : ids.join('');
}

function onIdle(st: Step, ev: MessageEvent, body: string, addressed: boolean): void {
  const now = st.ctx.now;
  const tz = tzOf(st);
  const sp = st.s.space;
  if (addressed) {
    const kind = planOrFood(body, now, tz);
    if (kind === 'plan') return startPlan(st, ev.from, ev.msgRef, body);
    // DEMO_SIMPLE: "where should we eat" starts the one flow (a date first), never an instant search.
    if (kind === 'food') return st.ctx.simple ? startPlan(st, ev.from, ev.msgRef, body) : startInstant(st, ev.from, ev.msgRef, body, 'prompted');
    return say(st, st.ctx.simple ? T.helpSimple() : T.help());
  }
  // Notice mode (opt-in, off by default): at most one offer per 24h, unprompted, so budget + quiet hours apply.
  if (!sp.notice) return;
  if (sp.lastNoticeOfferAt !== undefined && now - sp.lastNoticeOfferAt < DAY) return;
  const hang = isHangoutPhrase(body);
  const food = !hang && foodTrigger(body, false, now, tz);
  if (!hang && !food) return;
  if (gateUnprompted({ now, tz, quietHours: st.ctx.quietHours, lastUnpromptedAt: st.s.lastUnpromptedAt }).kind !== 'send') return;
  sp.lastNoticeOfferAt = now;
  if (hang) return say(st, T.noticeOffer(), 'unprompted');
  startInstant(st, ev.from, ev.msgRef, body, 'unprompted');
}

/** Bookkeeping only: a remembered handle or a (re)scheduled job is not an answer. Anything else (a message, a reaction,
 *  a lookup or payment whose result will reply) means the message was understood. */
const SILENT = new Set<Action['type']>(['schedule', 'cancel', 'remember_handle']);

/**
 * Someone who addressed Homi always gets an answer. The handlers below stay silent on purpose for unaddressed
 * chatter, but an addressed message that none of them read ("homi are you there?" during the cuisine question,
 * "homi can you find us a place" with a plan open) must not disappear: Homi re-asks the open question or says it
 * did not follow.
 */
export function onMessage(st: Step, ev: MessageEvent): void {
  const mark = st.acts.length;
  const addressed = dispatchMessage(st, ev);
  if (!addressed || st.acts.slice(mark).some((a) => !SILENT.has(a.type) && !(a.type === 'send' && a.tag === 'intro'))) return;
  const p = planOf(st);
  if (p?.state === 'collecting_place' && p.hungry?.phase === 'asking' && st.ctx.simple) return say(st, T.cuisineAsk());
  say(st, T.unknown());
}

/** A sentence that asks to move the time without naming one ("I want to do earlier", "can we do it later?"). */
const TIME_SHIFT = /\b(?:earlier|later|sooner|too late|too early|push it back|move it up|bit before|bit after)\b/i;

/** Routes one message; returns whether it was addressed to Homi (so onMessage can guarantee an answer). */
function dispatchMessage(st: Step, ev: MessageEvent): boolean {
  intro(st);
  const text = ev.text ?? '';
  const addressed = ev.addressed || detectAddressed(text) || isHomiRef(planOf(st), ev.replyTo);
  const body = stripAddress(text);
  handleMessage(st, ev, body, addressed);
  return addressed;
}

function handleMessage(st: Step, ev: MessageEvent, body: string, addressed: boolean): void {
  if (planOf(st)) reachable(st, touch(st, ev.from, ev.msgRef), ev.msgRef);
  // Bills, travel, commitments and the album get first look (src/engine/ext); the simple demo keeps only bills.
  for (const x of EXTENSIONS) if ((!st.ctx.simple || x.name === 'bills') && x.onMessage?.(st, ev, body, addressed)) return;
  const cmd = parseCommand(body);
  if (cmd && (addressed || UNADDRESSED_COMMANDS.has(cmd.kind)) && onCommand(st, ev, cmd, body, addressed)) return;
  const p = planOf(st);
  if (!p) return onIdle(st, ev, body, addressed);
  const now = st.ctx.now;
  const tz = tzOf(st);
  // DEMO_SIMPLE: no food questionnaire; an addressed "where are we eating" before the lock gets "day first".
  const food = () => {
    if (!foodTrigger(body, addressed, now, tz)) return false;
    if (!st.ctx.simple) return true;
    if (addressed) say(st, T.simpleDayFirst());
    return false;
  };
  const unknown = () => {
    if (addressed) say(st, planOrFood(body, now, tz) === 'plan' ? T.alreadyPlan() : T.unknown());
  };
  switch (p.state) {
    case 'collecting_dates': {
      if (activityReply(st, body, addressed)) return;
      let win = windowReply(st, body, addressed);
      // "friday 7pm" as the answer to "when?": the time counts too.
      const pt = win ? preferredTime(body) : undefined;
      if (pt) p.preferredTime = pt;
      if (win && p.preferredTime) win = rollPastDay(win, p.preferredTime, now, tz);
      if (win && openAvailability(st, win, 'prompted', ev.from)) return;
      if (food()) return pushHungry(st, ev.from, body, 'prompted');
      if (addressed) say(st, T.askWhen());
      return;
    }
    case 'collecting_availability': {
      // Someone Homi just asked (demo quorum) answers with a bare "yes" / "no" / "1": that is their vote, addressed or not.
      const askedMe = p.quorumAskedAt !== undefined && member(st, ev.from).status === 'pending' && (isBareYes(body) || isBareNo(body) || /^[1-9]$/.test(body.trim()));
      // DEMO_SIMPLE: while the poll is open every message in the group is an answer to it ("yeah 1 works", "can't do fri").
      const voteAddressed = addressed || askedMe || !!st.ctx.simple;
      if (timeShiftAnswer(st, ev, body)) {
        if (!tryTextVote(st, ev, body, voteAddressed)) maybeEarlyLock(st, 'prompted');
        return;
      }
      if (tryTextVote(st, ev, body, voteAddressed)) return;
      // "I want to do earlier" names no time: ask for one instead of letting the wish vanish (demo: even unaddressed).
      if (voteAddressed && TIME_SHIFT.test(body) && !preferredTime(body)) return say(st, T.timeWhich());
      if (proposeDay(st, ev, body, addressed)) return;
      if (tryTextVote(st, ev, body, voteAddressed)) return;
      if (food()) return pushHungry(st, ev.from, body, 'prompted');
      if (addressed) say(st, planOrFood(body, now, tz) === 'plan' ? T.alreadyPlan() : T.whichOnes({ ids: idList(st) }));
      return;
    }
    case 'collecting_place':
      return onPlaceMessage(st, ev, body, addressed);
    case 'collecting_details': {
      if (strandedAnswer(st, body, addressed)) return;
      if (food()) return pushHungry(st, ev.from, body, 'prompted');
      if (addressed && lateVote(st, ev, body)) return;
      return unknown();
    }
    case 'confirmed':
    case 'reminded': {
      const m = member(st, ev.from);
      if (isDateVeto(st, m, body, addressed)) return reopenDate(st, m);
      if (!p.place && food()) return pushHungry(st, ev.from, body, 'prompted');
      if (addressed && lateVote(st, ev, body)) return;
      return unknown();
    }
    default:
      return unknown();
  }
}
