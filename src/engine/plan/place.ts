// collecting_place (HUNGRY_FLOW.md): a sub-state with a return stack. Ask once, merge answers, look up, rank
// to three, vote, lock the winner into plan.place, pop. Every message here concludes a flow a member started
// minutes ago, so it is prompted (including the 10-minute hungry_deadline result).

import type { EngineEvent, MemberKey, MemberRef, MessageEvent, PlanState, Prompting } from '../types.js';
import type { EngineHungry, EnginePlan } from '../model.js';
import { TEMPLATES as T } from '../templates.js';
import {
  hasTaste, mergeTaste, placeEmoji, placesHeader, nearOf, newHungry, parseTaste, placeBubbleParts, placesQuery, rankPlaces,
} from '../hungry.js';
import { TRAIL, detectActivity, stripAddress } from '../parse.js';
import { activeMembers, groupSize } from '../schedule.js';
import { MIN, local, normText } from '../util.js';
import { type Step, P, availabilityOpen, cancel, howOf, member, planOf, purgePlan, reachable, react, say, schedule, seedRoster, touch, tzOf } from './core.js';
import { confirmPlan, maybeEarlyLock, scheduleEventJobs } from './lock.js';
import { tryTextVote } from './availability.js';

const WINDOW = 10 * MIN;

function mealFor(body: string, now: number, tz: string): string {
  const a = detectActivity(body).activity;
  if (['dinner', 'lunch', 'brunch', 'breakfast', 'drinks', 'coffee'].includes(a)) return a;
  const h = local(now, tz).hour;
  return h < 11 ? 'breakfast' : h < 16 ? 'lunch' : 'dinner';
}

/**
 * Enters collecting_place on top of the current state (push). Never re-triggers while it is running.
 * `searchNow`: a new cuisine for a known area ("homi sushi instead") goes straight to the lookup.
 */
export function pushHungry(st: Step, from: MemberRef, body: string, prompting: Prompting, instant = false, searchNow = false): void {
  const p = P(st);
  if (p.state === 'collecting_place') return;
  p.stack.push(instant ? 'idle' : p.state);
  p.state = 'collecting_place';
  const h = newHungry(st.ctx.now, instant);
  for (const c of p.cuisineHint ?? []) {
    h.cuisineVotes[c] = (h.cuisineVotes[c] ?? 0) + 1;
    (h.memberCuisines![p.initiator] ??= []).push(c);
  }
  p.hungry = h;
  const taste = parseTaste(body);
  if (searchNow && taste.cuisines.length && p.neighborhood) {
    mergeTaste(h, from.key, taste);
    schedule(st, 'hungry_deadline', h.deadlineAt as number);
    return startSearch(st);
  }
  say(st, T.foodAsk({ where: !p.neighborhood }), prompting);
  schedule(st, 'hungry_deadline', h.deadlineAt as number);
  if (hasTaste(taste)) mergeTaste(h, from.key, taste);
}

/** "@homi where should we eat" with no plan: an instant plan for today, around now. */
export function startInstant(st: Step, from: MemberRef, msgRef: string | undefined, body: string, prompting: Prompting): void {
  const now = st.ctx.now;
  const p: EnginePlan = {
    id: st.ctx.newId(), state: 'idle', stack: [], activity: mealFor(body, now, tzOf(st)), outdoor: false, initiator: from.key, options: [],
    members: {}, notes: {}, nudges: [], refs: { options: {}, placeOptions: {} }, createdAt: now, updatedAt: now,
  };
  st.s.plan = p;
  reachable(st, touch(st, from, msgRef), msgRef);
  seedRoster(st);
  pushHungry(st, from, body, prompting, true);
}

/** Everyone Homi knows is in (roster, people seen, or the stated / platform head count) has answered. */
function allAnswered(p: EnginePlan, h: EngineHungry): boolean {
  const active = Object.values(p.members).filter((m) => m.status !== 'out');
  return active.length > 0 && active.every((m) => h.answeredBy.includes(m.key)) && h.answeredBy.length >= groupSize(p);
}

export function startSearch(st: Step): void {
  const p = P(st);
  const h = p.hungry as EngineHungry;
  const near = nearOf(h, p.neighborhood);
  if (!near) {
    // No neighborhood yet: ask once (Homi never uses device location), then give up quietly.
    if (h.askedWhere) return giveUp(st);
    h.askedWhere = true;
    h.deadlineAt = st.ctx.now + WINDOW;
    schedule(st, 'hungry_deadline', h.deadlineAt, { suffix: 'where' });
    return say(st, T.foodWhere());
  }
  p.neighborhood = near;
  h.searches = (h.searches ?? 0) + 1;
  h.phase = 'searching';
  h.requestId = st.ctx.newId();
  st.acts.push({ type: 'lookup_places', requestId: h.requestId, query: placesQuery(h, near, p.eventAt ?? st.ctx.now) });
}

/** "1", "#2", "the second", or a place name. */
export function placeRef(body: string, options: Array<{ id: number; name: string }>): number | undefined {
  const t = normText(stripAddress(body)).replace(TRAIL, '');
  let m = t.match(/^(?:#|option |number |no\.? )?([1-9])\b/);
  if (m && Number(m[1]) <= options.length) return Number(m[1]);
  m = t.match(/^(?:the )?(first|second|third|last)\b/);
  if (m) return m[1] === 'last' ? options.length : { first: 1, second: 2, third: 3 }[m[1] as 'first'];
  for (const o of options) {
    const n = normText(o.name);
    if (n.length >= 4 && t.includes(n)) return o.id;
  }
  return undefined;
}

export function onPlaceMessage(st: Step, ev: MessageEvent, body: string, addressed: boolean): void {
  const p = P(st);
  const h = p.hungry as EngineHungry | undefined;
  if (!h) return;
  const m = member(st, ev.from);
  if (h.phase === 'asking') {
    const taste = parseTaste(body);
    if (hasTaste(taste) || taste.go) {
      mergeTaste(h, m.key, taste);
      // Acknowledge each answer so nobody wonders whether Homi heard it while the others reply.
      if (!taste.go) react(st, ev.msgRef);
      // One message with food, budget and area ("something spicy, not too pricey, near central square") is enough.
      const complete = (taste.cuisines.length > 0 || taste.wildcard) && taste.price !== undefined && taste.neighborhoods.length > 0;
      if (taste.go || complete || (h.searches ?? 0) > 0) return startSearch(st);
      if (taste.vague && !h.askedWhere && !Object.keys(h.neighborhoods).length && !p.neighborhood) {
        h.askedWhere = true;
        say(st, T.foodWhere());
      }
      if (allAnswered(p, h)) startSearch(st);
      return;
    }
  } else if (h.phase === 'voting') {
    const id = placeRef(body, h.options);
    if (id !== undefined) {
      react(st, ev.msgRef);
      placeVote(st, m.key, id, 'set');
      return;
    }
  }
  if (availabilityOpen(p)) tryTextVote(st, ev, body, addressed);
}

/**
 * Text votes replace; tapbacks add. Closes as soon as a majority voted: of the people who answered the food
 * question, or of the platform roster when there is one (a dedicated iMessage line), whichever is larger. So in a
 * group of two the first "1" waits for the second person (or the vote deadline), as in the demo.
 */
export function placeVote(st: Step, key: MemberKey, id: number, mode: 'set' | 'add'): void {
  const p = P(st);
  const h = p.hungry as EngineHungry;
  if (h.phase !== 'voting' || !h.options.some((o) => o.id === id)) return;
  const cur = h.votes[key] ?? [];
  h.votes[key] = mode === 'set' ? [id] : cur.includes(id) ? cur : [...cur, id];
  const roster = p.rosterSize ? Math.min(p.rosterSize, activeMembers(p).length) : 0;
  const counted = p.expectedHeadcount ? groupSize(p) : 0;
  const n = Math.max(h.answeredBy.length, roster, counted, 1);
  if (Object.keys(h.votes).length >= Math.floor(n / 2) + 1) closePlaces(st, 'prompted');
}

export function onPlacesResult(st: Step, ev: Extract<EngineEvent, { kind: 'places_result' }>): void {
  const p = planOf(st);
  const h = p?.hungry as EngineHungry | undefined;
  if (!p || !h || h.phase !== 'searching' || h.requestId !== ev.requestId) return;
  const now = st.ctx.now;
  h.source = ev.source;
  const ranked = rankPlaces(ev.options, h, h.instant ? undefined : p.eventAt);
  h.deadlineAt = now + WINDOW;
  schedule(st, 'hungry_deadline', h.deadlineAt, { suffix: 'vote' });
  if (!ranked.length) {
    if ((h.searches ?? 0) >= 2) return giveUp(st);
    h.phase = 'asking';
    say(st, T.foodNoResults());
    return;
  }
  h.options = ranked;
  h.phase = 'voting';
  h.votes = {};
  p.refs.placeOptions = {};
  p.refs.placePoll = undefined;
  const header = placesHeader(h, p.neighborhood ?? '', ranked, howOf(st));
  const bubbles = ranked.map((o) => T.placeBubble(placeBubbleParts(o, h, h.instant ? undefined : p.eventAt, tzOf(st))));
  if (st.ctx.caps.polls) {
    st.acts.push({ type: 'poll', question: header, options: bubbles, prompting: 'prompted', tag: 'poll:place' });
    return;
  }
  say(st, header, 'prompted', 'place:header');
  bubbles.forEach((b, i) => say(st, b, 'prompted', `place:${ranked[i].id}`));
}

/** Winner (most votes, ties to rank order, none -> #1) becomes plan.place; the address is posted once; pop. */
export function closePlaces(st: Step, prompting: Prompting): void {
  const p = P(st);
  const h = p.hungry as EngineHungry;
  if (!h.options.length) return;
  const tallies = h.options.map((o) => ({ o, n: Object.values(h.votes).filter((v) => v.includes(o.id)).length }));
  const noVotes = tallies.every((t) => t.n === 0);
  const win = tallies.reduce((a, b) => (b.n > a.n ? b : a)).o;
  const { id: _id, walkMinutes: _w, openAtPlanTime: _o, why: _why, ...place } = win;
  p.place = place;
  h.phase = 'done';
  cancel(st, 'hungry_deadline');
  const back = (p.stack.pop() ?? 'collecting_details') as PlanState;
  const remindOffer = back !== 'idle' && p.eventAt !== undefined && p.eventAt > st.ctx.now + 45 * MIN;
  say(st, T.placeClose({ name: place.name, address: place.address, url: place.mapsUrl, noVotes, remindOffer, emoji: placeEmoji(place.cuisine) }), prompting);
  popTo(st, back, prompting);
}

/** No usable result: say so once, pop back without a place (an instant plan with nothing in it is deleted). */
export function giveUp(st: Step): void {
  const p = P(st);
  const h = p.hungry as EngineHungry;
  h.phase = 'done';
  cancel(st, 'hungry_deadline');
  say(st, T.foodGiveUp());
  const back = (p.stack.pop() ?? 'collecting_details') as PlanState;
  if (back === 'idle') return purgePlan(st);
  p.state = back;
  if (back === 'collecting_availability') maybeEarlyLock(st, 'prompted');
}

/** Return-stack pop. From idle: the instant plan is confirmed for now. From details: confirmed (address already posted). */
export function popTo(st: Step, back: PlanState, prompting: Prompting): void {
  const p = P(st);
  if (back === 'idle') {
    p.state = 'confirmed';
    p.eventAt = st.ctx.now;
    scheduleEventJobs(st);
  } else if (back === 'collecting_details') {
    // A pending stranded-bridge question ("Fri unless someone says sat") stays open: confirm after it resolves.
    if (p.bridge?.kind === 'stranded') p.state = 'collecting_details';
    else confirmPlan(st, prompting, false);
  } else if (back === 'collecting_availability') {
    p.state = 'collecting_availability';
    maybeEarlyLock(st, prompting);
  } else {
    p.state = back;
  }
}

/** "homi we're going to X" / "homi place: X". */
export function setPlaceText(st: Step, place: string): void {
  const p = P(st);
  p.place = { name: place, source: 'user' };
  if (p.state === 'collecting_details') return confirmPlan(st, 'prompted');
  if (p.state === 'confirmed' || p.state === 'reminded' || p.state === 'completed') return say(st, T.placeChanged({ place }));
  if (p.state === 'collecting_place') {
    if (p.hungry) p.hungry.phase = 'done';
    cancel(st, 'hungry_deadline');
    const back = (p.stack.pop() ?? 'collecting_details') as PlanState;
    if (back !== 'collecting_details') say(st, back === 'idle' ? T.placeSet({ place }) : T.placeSetOpen({ place }));
    return popTo(st, back, 'prompted');
  }
  say(st, T.placeSetOpen({ place }));
}
