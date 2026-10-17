// Conflict bridges (DATE_FINDING §5): asked immediately in reply to the message that created the conflict, so
// they are prompted. Each kind is asked at most once per plan, and never for an event less than 24h away.

import type { Member, MessageEvent } from '../types.js';
import type { ParsedAvailability } from '../model.js';
import { TEMPLATES as T } from '../templates.js';
import { isBareNo, isBareYes, stripAddress } from '../parse.js';
import { activeOptions, detectDayConflict, detectTimeShift } from '../schedule.js';
import { DAY, HOUR, atLocal, fmtTime, normText, optionLabel, shortDay, weekdayOf } from '../util.js';
import { type Step, P, cancel, howOf, say, schedule, tzOf } from './core.js';

const BRIDGE_TTL = 6 * HOUR;

/** Detects a hard day conflict or a time conflict after a vote and asks one bridge question. */
export function askBridge(st: Step, m: Member | null, parsed: ParsedAvailability | null): boolean {
  const p = P(st);
  const now = st.ctx.now;
  const asked = (p.bridgesAsked ??= []);
  const active = activeOptions(p);
  if (!asked.includes('day_conflict')) {
    const c = detectDayConflict(p);
    const first = c ? Math.min(...active.filter((o) => o.day === c.dayA || o.day === c.dayB).map((o) => o.startsAt)) : 0;
    if (c && first - now >= DAY) {
      const a = p.members[c.a];
      const b = p.members[c.b];
      say(st, T.dayConflict({
        a: a.name ?? 'One of you', dayA: shortDay(c.dayA), b: b.name ?? 'another', dayB: shortDay(c.dayB),
        altA: 'late', altB: weekdayOf(c.dayB) >= 6 ? 'brunch' : 'lunch',
      }));
      p.bridge = {
        kind: 'day_conflict', createdAt: now,
        optionId: active.find((o) => o.day === c.dayA)?.id, altOptionId: active.find((o) => o.day === c.dayB)?.id,
      };
      asked.push('day_conflict');
      schedule(st, 'bridge_timeout', now + BRIDGE_TTL);
      return true;
    }
  }
  if (parsed && m) {
    const ts = detectTimeShift(p, m.key);
    const o = ts ? active.find((x) => x.id === ts.optionId) : undefined;
    if (ts && o && !asked.includes(`time_shift:${o.id}`) && o.startsAt - now >= DAY) {
      say(st, T.timeShift({ day: shortDay(o.day), time: fmtTime(ts.time), count: ts.count, everyone: ts.everyone }));
      p.bridge = { kind: 'time_shift', createdAt: now, optionId: o.id, proposedTime: ts.time };
      asked.push(`time_shift:${o.id}`);
      schedule(st, 'bridge_timeout', now + BRIDGE_TTL);
      return true;
    }
  }
  return false;
}

/**
 * Answer to an open day-conflict bridge ("sat brunch works"): adds a new option at the qualifier's time on one
 * of the two days. Day-level prefs carry over to it automatically ("Sat works" counts as yes).
 */
export function bridgeAnswer(st: Step, m: Member, parsed: ParsedAvailability): boolean {
  const p = P(st);
  const b = p.bridge;
  if (b?.kind !== 'day_conflict') return false;
  const days = [b.optionId, b.altOptionId].map((id) => p.options.find((o) => o.id === id)?.day).filter((d): d is string => !!d);
  const slot = parsed.slots.find((s) => days.includes(s.day) && s.vote !== 'no');
  if (!slot) return false;
  p.bridge = undefined;
  cancel(st, 'bridge_timeout');
  const existing = activeOptions(p).find((o) => o.day === slot.day && o.time === slot.time);
  if (existing) {
    m.optionVotes[existing.id] = slot.vote;
    return false;
  }
  const id = p.options.reduce((x, o) => Math.max(x, o.id), 0) + 1;
  const tz = tzOf(st);
  const o = { id, day: slot.day, time: slot.time, startsAt: atLocal(slot.day, slot.time, tz), label: optionLabel(slot.day, slot.time) };
  if (o.startsAt < st.ctx.now + 3 * HOUR) return false;
  p.options.push(o);
  m.optionVotes[id] = slot.vote;
  say(st, T.addedOption({ how: howOf(st) }));
  say(st, T.optionBubble({ id, label: o.label }), 'prompted', `option:${id}`);
  return true;
}

/** "Want Fri 8:30?" — any yes moves the option's time; a no keeps it. Returns true when the message answered it. */
export function timeShiftAnswer(st: Step, ev: MessageEvent, body: string): boolean {
  const p = P(st);
  const b = p.bridge;
  if (b?.kind !== 'time_shift' || !b.proposedTime) return false;
  const o = p.options.find((x) => x.id === b.optionId);
  if (!o) return false;
  const t = normText(stripAddress(body));
  const hhmm = fmtTime(b.proposedTime).replace(/(am|pm)$/, '');
  const yes =
    isBareYes(body) ||
    /^(?:yes|yeah|yep|yup|sure|ok|okay|do it|sounds good|let'?s do it)\b/.test(t) ||
    (t.includes(hhmm) && /\b(works?|good|fine|yes|down)\b/.test(t));
  const no = isBareNo(body);
  if (!yes && !no) return false;
  p.bridge = undefined;
  cancel(st, 'bridge_timeout');
  if (no) {
    say(st, T.timeShiftKeep({ time: fmtTime(o.time) }));
    return true;
  }
  o.time = b.proposedTime;
  o.startsAt = atLocal(o.day, o.time, tzOf(st));
  o.label = optionLabel(o.day, o.time);
  const bubble = T.optionBubble({ id: o.id, label: o.label });
  say(st, T.timeShiftDone({ bubble }));
  const ref = p.refs.options[o.id];
  if (ref && st.ctx.caps.edit) st.acts.push({ type: 'edit', target: ref, text: bubble });
  void ev;
  return true;
}
