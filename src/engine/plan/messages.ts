// Message routing. Order: intro (once) -> head-count -> commands -> the current state's handler.
// Before a plan exists Homi answers only when addressed (silence until invited); notice mode is the one
// opt-in exception and is gated by the noise budget and quiet hours.

import type { MessageEvent } from '../types.js';
import { TEMPLATES as T } from '../templates.js';
import { UNADDRESSED_COMMANDS, detectAddressed, isHangoutPhrase, parseCommand, stripAddress } from '../parse.js';
import { foodTrigger, planOrFood } from '../intent.js';
import { gateUnprompted } from '../nudge.js';
import { activeOptions } from '../schedule.js';
import { DAY } from '../util.js';
import { type Step, P, intro, isHomiRef, member, planOf, say, touch, tzOf } from './core.js';
import { onCommand } from './commands.js';
import { openAvailability, startPlan, tryTextVote, windowReply } from './availability.js';
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
    if (kind === 'food') return startInstant(st, ev.from, ev.msgRef, body, 'prompted');
    return say(st, T.help());
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

export function onMessage(st: Step, ev: MessageEvent): void {
  intro(st);
  const text = ev.text ?? '';
  const addressed = ev.addressed || detectAddressed(text) || isHomiRef(planOf(st), ev.replyTo);
  const body = stripAddress(text);
  if (planOf(st)) touch(st, ev.from, ev.msgRef);
  // Bills, travel, commitments and the album get first look (src/engine/ext).
  for (const x of EXTENSIONS) if (x.onMessage?.(st, ev, body, addressed)) return;
  const cmd = parseCommand(body);
  if (cmd && (addressed || UNADDRESSED_COMMANDS.has(cmd.kind)) && onCommand(st, ev, cmd, body, addressed)) return;
  const p = planOf(st);
  if (!p) return onIdle(st, ev, body, addressed);
  const now = st.ctx.now;
  const tz = tzOf(st);
  const food = () => foodTrigger(body, addressed, now, tz);
  const unknown = () => {
    if (addressed) say(st, planOrFood(body, now, tz) === 'plan' ? T.alreadyPlan() : T.unknown());
  };
  switch (p.state) {
    case 'collecting_dates': {
      const win = windowReply(st, body, addressed);
      if (win && openAvailability(st, win, 'prompted')) return;
      if (food()) return pushHungry(st, ev.from, body, 'prompted');
      if (addressed) say(st, T.askWhen());
      return;
    }
    case 'collecting_availability': {
      if (timeShiftAnswer(st, ev, body)) {
        if (!tryTextVote(st, ev, body, addressed)) maybeEarlyLock(st, 'prompted');
        return;
      }
      if (tryTextVote(st, ev, body, addressed)) return;
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
