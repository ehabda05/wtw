// Commands (STATE_MACHINE.md table). Any state, case-insensitive. Returns false when the message should fall
// through to the state handler (e.g. "homi find food" while the food flow is already running).

import type { Member, MessageEvent } from '../types.js';
import type { Command } from '../model.js';
import { TEMPLATES as T } from '../templates.js';
import { dump } from '../dump.js';
import { hasTaste, mergeTaste, neighborhoodsIn, parseTaste } from '../hungry.js';
import { cityZone, optionRefs, parseWindow } from '../parse.js';
import { activeOptions, chooseOption } from '../schedule.js';
import { DAY, MIN, isValidZone } from '../util.js';
import { type Step, P, newGroupState, planOf, purgePlan, say, schedule, member, tzOf } from './core.js';
import { confirmPlan, lockOption, maybeEarlyLock } from './lock.js';
import { openAvailability, setTime, startPlan } from './availability.js';
import { askCuisine, closePlaces, pushHungry, setPlaceText, startInstant, startSearch } from './place.js';
import { calendar, noteGet, notesList, splitText, statusText, whyText } from './status.js';
import { EXTENSIONS } from '../ext/index.js';

/** `homi stop`: delete everything for this chat, then leave (or tombstone where leaving is impossible). */
export function stop(st: Step): void {
  const canLeave = st.ctx.caps.leave;
  for (const x of EXTENSIONS) x.onStop?.(st);
  purgePlan(st);
  say(st, canLeave ? T.stopLeave() : T.stopTombstone());
  st.acts.push(canLeave ? { type: 'leave' } : { type: 'tombstone' });
  const fresh = newGroupState(st.s.space.spaceKey);
  if (!canLeave) {
    fresh.space.muted = true;
    fresh.space.introSent = true;
  }
  st.s = fresh;
}

function markOut(st: Step, m: Member): void {
  m.status = 'out';
  m.optionVotes = {};
  m.dayPrefs = {};
  delete m.lowConfidence;
  say(st, T.out());
  maybeEarlyLock(st, 'prompted');
}

function optIn(st: Step, m: Member, mode: 'dm' | 'call'): void {
  if (mode === 'dm' && !st.ctx.caps.dm) return say(st, T.optInDmUnavailable());
  if (mode === 'dm') m.optInDm = true;
  else m.optInCall = true;
  m.hasDelivery = true;
  st.acts.push({ type: 'remember_handle', member: m.key, planId: P(st).id });
  say(st, mode === 'dm' ? T.optInDm() : T.optInCall());
}

function forceLock(st: Step, ev: MessageEvent, ref: string): void {
  const p = P(st);
  if (p.state !== 'collecting_availability') return say(st, T.lockNothing());
  const ch = chooseOption(p);
  const ids = ref ? optionRefs(ref, p.options, tzOf(st), st.ctx.now) : ch ? [ch.optionId] : [];
  if (!ids.length || !ch) {
    const all = activeOptions(p).map((o) => String(o.id));
    return say(st, T.lockWhich({ ids: all.length > 1 ? `${all.slice(0, -1).join(', ')} or ${all[all.length - 1]}` : all.join('') }));
  }
  const pick = ch.ranked.find((r) => ids.includes(r.id))?.id ?? ids[0];
  lockOption(st, pick, 'forced', 'prompted', ev.from.key);
}

function remind(st: Step): void {
  const p = P(st);
  const E = p.eventAt;
  if (E === undefined) return say(st, T.remindNoTime());
  if (E - st.ctx.now <= 45 * MIN) return say(st, T.remindTooSoon());
  p.remindReq30 = true;
  schedule(st, 'remind_30', E - 30 * MIN);
  say(st, T.remindSet());
}

function onYes(st: Step, ev: MessageEvent): boolean {
  const p = planOf(st);
  const sp = st.s.space;
  if (!p) {
    if (sp.lastNoticeOfferAt !== undefined && st.ctx.now - sp.lastNoticeOfferAt < DAY) {
      startPlan(st, ev.from, ev.msgRef, '');
      return true;
    }
    return false;
  }
  if (p.state === 'collecting_details' && !p.bridge) {
    pushHungry(st, ev.from, '', 'prompted');
    return true;
  }
  return false;
}

/** DEMO_SIMPLE: commands that belong to the flows the demo switches off. */
const SIMPLE_OFF = new Set<Command['kind']>(['note_set', 'note_get', 'notes', 'tone', 'notice', 'threshold', 'headcount', 'tz']);

export function onCommand(st: Step, ev: MessageEvent, cmd: Command, body: string, addressed: boolean): boolean {
  const p = planOf(st);
  const now = st.ctx.now;
  if (st.ctx.simple) {
    if (SIMPLE_OFF.has(cmd.kind)) {
      say(st, T.simpleOnly());
      return true;
    }
    if (cmd.kind === 'help') {
      say(st, T.helpSimple());
      return true;
    }
    if (cmd.kind === 'food' || cmd.kind === 'change_place') {
      if (!p) startPlan(st, ev.from, ev.msgRef, body);
      else if (p.state === 'collecting_place') return false;
      else if (p.state === 'collecting_details' || p.state === 'confirmed' || p.state === 'reminded') askCuisine(st, 'prompted');
      else say(st, T.simpleDayFirst());
      return true;
    }
  }
  switch (cmd.kind) {
    case 'stop': stop(st); return true;
    case 'forget':
      if (p) {
        for (const x of EXTENSIONS) x.onForget?.(st);
        purgePlan(st);
        say(st, T.forgetDone());
      } else say(st, T.forgetNothing());
      return true;
    case 'privacy': say(st, T.privacy({ hours: st.ctx.retentionHours })); return true;
    case 'dump': say(st, dump(st.s, now)); return true;
    case 'help': say(st, T.help()); return true;
    case 'status': say(st, statusText(st)); return true;
    case 'why': say(st, p ? whyText(st, cmd.ref) : T.needPlan()); return true;
    case 'tone': st.s.space.tone = cmd.tone; say(st, T.toneSet({ tone: cmd.tone })); return true;
    case 'notice': st.s.space.notice = cmd.on; say(st, cmd.on ? T.noticeOn() : T.noticeOff()); return true;
    case 'split': say(st, splitText(st, cmd.amount, cmd.ways)); return true;
    case 'ics': calendar(st); return true;
    case 'tz': {
      const hood = neighborhoodsIn(cmd.place).length > 0;
      if (hood && p?.state === 'collecting_place') return false;
      const z = cityZone(cmd.place) ?? (isValidZone(cmd.place) ? ([cmd.place, cmd.place] as [string, string]) : null);
      if (!z) {
        if (hood) return false;
        say(st, T.tzUnknown());
        return true;
      }
      st.s.space.tz = z[0];
      say(st, T.tzSet({ city: z[1] }));
      return true;
    }
    case 'plan': {
      if (!p) {
        startPlan(st, ev.from, ev.msgRef, cmd.rest || body);
        return true;
      }
      const w = p.state === 'collecting_dates' ? parseWindow(cmd.rest, now, tzOf(st)) : null;
      if (w && openAvailability(st, w, 'prompted')) return true;
      say(st, T.alreadyPlan());
      return true;
    }
    case 'food':
      if (!p) {
        startInstant(st, ev.from, ev.msgRef, body, 'prompted');
        return true;
      }
      if (p.state === 'collecting_place') return false;
      pushHungry(st, ev.from, body, 'prompted');
      return true;
    case 'go':
      if (p?.state === 'collecting_place' && p.hungry) {
        if (p.hungry.phase === 'asking') {
          // "homi go, harvard square": take the answer in the same message before searching.
          const t = parseTaste(body);
          if (hasTaste(t)) mergeTaste(p.hungry, ev.from.key, t);
          startSearch(st);
        }
        else if (p.hungry.phase === 'voting') closePlaces(st, 'prompted');
        return true;
      }
      return false;
    case 'yes': return onYes(st, ev);
    case 'no': return false;
    default:
      break;
  }
  if (!p) {
    if (cmd.kind === 'out' && !addressed) return true;
    if (cmd.kind === 'change_place') return false; // "homi sushi instead" with no plan: the idle handler decides
    say(st, cmd.kind === 'name' ? T.nameNoPlan({ name: cmd.name }) : cmd.kind === 'optin' ? T.optInNoPlan() : T.needPlan());
    return true;
  }
  const m = member(st, ev.from);
  switch (cmd.kind) {
    case 'name': m.name = cmd.name; say(st, T.nameSet({ name: cmd.name })); return true;
    case 'out': markOut(st, m); return true;
    case 'optin': optIn(st, m, cmd.mode); return true;
    case 'threshold':
      p.threshold = cmd.n;
      say(st, T.thresholdSet({ n: cmd.n }));
      maybeEarlyLock(st, 'prompted');
      return true;
    case 'headcount': p.expectedHeadcount = cmd.n; say(st, T.headcountSet({ n: cmd.n })); return true;
    case 'lock': forceLock(st, ev, cmd.ref); return true;
    case 'note_set': p.notes[cmd.key] = cmd.value; say(st, T.noteSaved({ key: cmd.key })); return true;
    case 'note_get': say(st, noteGet(st, cmd.key)); return true;
    case 'notes': say(st, notesList(st)); return true;
    case 'place_set': setPlaceText(st, cmd.place); return true;
    case 'set_time': return p ? setTime(st, ev, cmd.time) : false;
    case 'no_place':
      if (p.state !== 'collecting_details') return false;
      confirmPlan(st, 'prompted');
      return true;
    case 'change_place':
      if (!['confirmed', 'reminded', 'collecting_details'].includes(p.state)) return false;
      // "homi lets do sushi instead": the new cuisine replaces the trigger's hint; search right away when the area is known.
      if (cmd.cuisines) p.cuisineHint = undefined;
      pushHungry(st, ev.from, cmd.cuisines ? body : '', 'prompted', false, Boolean(cmd.cuisines));
      return true;
    case 'remind': remind(st); return true;
    default:
      return false;
  }
}
