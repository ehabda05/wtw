// applyEvent: the pure state machine entry point. Clones the state, dispatches the event, returns the new state
// and the actions. No I/O, no clock reads (ctx.now), no randomness (ctx.newId).

import type { ApplyResult, Ctx, EngineEvent, GroupState } from '../types.js';
import type { EngineHungry } from '../model.js';
import { emojiVote } from '../parse.js';
import { activeOptions, tallyLine } from '../schedule.js';
import { type Step, availabilityOpen, intro, isOpen, member, planOf, reachable, refKey, touch } from './core.js';
import { afterVote } from './availability.js';
import { onMessage } from './messages.js';
import { onPlacesResult, placeVote } from './place.js';
import { onCallResult, onTimer, onWeather } from './timers.js';
import { EXTENSIONS } from '../ext/index.js';

type Ev<K extends EngineEvent['kind']> = Extract<EngineEvent, { kind: K }>;

/** Tapbacks on option bubbles: ❤️ 👍 ‼️ yes, 👎 no, ❓ maybe, 😂 ignored. Removal never arrives: add-only. */
function onReaction(st: Step, ev: Ev<'reaction'>): void {
  intro(st);
  for (const x of EXTENSIONS) if (x.onEvent?.(st, ev)) return;
  const p = planOf(st);
  if (!p || !isOpen(p)) return;
  const m = touch(st, ev.from);
  if (!m || ev.removed) return;
  reachable(st, m); // a tapback is enough to be asked privately later (demo quorum)
  const vote = emojiVote(ev.emoji);
  if (!vote) return;
  const optId = refKey(p.refs.options, ev.target);
  if (optId !== undefined && availabilityOpen(p)) {
    if (!activeOptions(p).some((o) => o.id === optId)) return;
    const before = tallyLine(p);
    m.optionVotes[optId] = vote;
    if (m.status !== 'out') m.status = 'answered';
    afterVote(st, m, null, before);
    return;
  }
  const placeId = refKey(p.refs.placeOptions, ev.target);
  if (placeId !== undefined && p.state === 'collecting_place' && vote === 'yes') placeVote(st, m.key, placeId, 'add');
}

/** Native multi-answer polls: selected = yes, unselected = no. */
function onPollVote(st: Step, ev: Ev<'poll_vote'>): void {
  intro(st);
  const p = planOf(st);
  if (!p || !isOpen(p)) return;
  const m = touch(st, ev.from);
  if (!m) return;
  if (ev.poll === p.refs.poll && availabilityOpen(p)) {
    const act = activeOptions(p).sort((a, b) => a.id - b.id);
    const chosen = new Set(ev.optionIndexes.map((i) => act[i]?.id).filter((x): x is number => x !== undefined));
    const before = tallyLine(p);
    for (const o of act) m.optionVotes[o.id] = chosen.has(o.id) ? 'yes' : 'no';
    if (m.status !== 'out') m.status = 'answered';
    afterVote(st, m, null, before);
    return;
  }
  const h = p.hungry as EngineHungry | undefined;
  if (h && ev.poll === p.refs.placePoll && p.state === 'collecting_place') {
    ev.optionIndexes.forEach((i, n) => placeVote(st, m.key, i + 1, n === 0 ? 'set' : 'add'));
  }
}

/** The runner reports the message ids of tagged sends, so tapbacks and inline replies can be matched. */
function onSent(st: Step, ev: Ev<'sent'>): void {
  for (const x of EXTENSIONS) if (ev.tag.startsWith(`${x.name}:`) && x.onSent?.(st, ev.tag, ev.msgRef)) return;
  const p = planOf(st);
  if (!p) return;
  let m: RegExpMatchArray | null;
  if (ev.tag === 'header') {
    p.refs.header = ev.msgRef;
    p.refs.headerSentAt = ev.at;
  } else if ((m = ev.tag.match(/^option:(\d+)$/))) p.refs.options[Number(m[1])] = ev.msgRef;
  else if (ev.tag === 'poll:dates') p.refs.poll = ev.msgRef;
  else if ((m = ev.tag.match(/^place:(\d+)$/))) p.refs.placeOptions[Number(m[1])] = ev.msgRef;
  else if (ev.tag === 'poll:place') p.refs.placePoll = ev.msgRef;
}

export function applyEvent(state: GroupState, event: EngineEvent, ctx: Ctx): ApplyResult {
  const st: Step = { s: structuredClone(state), ctx, acts: [] };
  if (st.s.space.muted) return { state: st.s, actions: [] };
  switch (event.kind) {
    case 'message': onMessage(st, event); break;
    case 'reaction': onReaction(st, event); break;
    case 'poll_vote': onPollVote(st, event); break;
    case 'member_seen':
      intro(st);
      touch(st, event.from, event.msgRef);
      break;
    case 'members_snapshot': {
      intro(st);
      // Remembered for the next plan (first sight is usually before any plan exists), and applied to an open one.
      st.s.space.roster = event.members.filter((r) => !r.isBot).slice(0, 64).map((r) => ({ key: r.key, ...(r.platformName ? { platformName: r.platformName } : {}) }));
      const p = planOf(st);
      if (p && isOpen(p)) for (const ref of event.members) if (!ref.isBot) member(st, ref);
      break;
    }
    case 'headcount': {
      // Telegram: no member list, but a count. Remembered for the next plan; an open plan gets it as its head count.
      st.s.space.headcount = event.n;
      const p = planOf(st);
      if (p && isOpen(p) && !p.expectedHeadcount) p.expectedHeadcount = event.n;
      break;
    }
    case 'added_to_group': intro(st); break;
    case 'sent': onSent(st, event); break;
    case 'timer': onTimer(st, event); break;
    case 'places_result': onPlacesResult(st, event); break;
    case 'weather_result': onWeather(st, event); break;
    case 'call_result': onCallResult(st, event); break;
    case 'photo':
    case 'travel_result':
    case 'payment_result':
      intro(st);
      for (const x of EXTENSIONS) if (x.onEvent?.(st, event)) break;
      break;
  }
  const p = planOf(st);
  if (p && event.kind !== 'sent') p.updatedAt = ctx.now;
  return { state: st.s, actions: st.acts };
}
