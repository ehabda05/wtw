// collecting_place (HUNGRY_FLOW.md): a sub-state with a return stack. Ask once, merge answers, look up, rank
// to three, vote, lock the winner into plan.place, pop. Every message here concludes a flow a member started
// minutes ago, so it is prompted (including the 10-minute hungry_deadline result).

import type { EngineEvent, MemberKey, MemberRef, MessageEvent, PlanState, Prompting } from '../types.js';
import type { EngineHungry, EnginePlan } from '../model.js';
import { TEMPLATES as T } from '../templates.js';
import {
  hasTaste, mergeTaste, placeEmoji, placesHeader, nearOf, newHungry, parseTaste, placeBubbleParts, placesQuery, rankPlaces, rankedCuisines,
} from '../hungry.js';
import { TRAIL, detectActivity, stripAddress } from '../parse.js';
import { CURATED, CURATED_LABEL, type CuratedKey, curatedKeyOf, curatedPrice, pickCuratedKey } from '../curated.js';
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
  if (p.activity === 'bowling' || p.activity === 'museum' || p.activity === 'park' || p.activity === 'cafe') h.category = p.activity;
  for (const c of p.cuisineHint ?? []) {
    h.cuisineVotes[c] = (h.cuisineVotes[c] ?? 0) + 1;
    (h.memberCuisines![p.initiator] ??= []).push(c);
  }
  p.hungry = h;
  const taste = parseTaste(body);
  if (
    (searchNow && (taste.cuisines.length || taste.category) && p.neighborhood) ||
    (instant && (taste.cuisines.length || taste.category) && taste.neighborhoods.length > 0)
  ) {
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
  // DEMO_SIMPLE: no lookup; the window closed, so decide (majority, or extend the deliberation, or the top cuisine).
  if (st.ctx.simple) {
    resolveCuisine(st, true);
    return;
  }
  const near = nearOf(h, p.neighborhood) || st.ctx.defaultSearchLocation || 'Boston';
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
      // DEMO_SIMPLE deliberation: a person's latest cuisine answer replaces their earlier one ("ok fine, thai then").
      if (st.ctx.simple && taste.cuisines.length) retractCuisines(h, m.key);
      mergeTaste(h, m.key, taste);
      // Acknowledge each answer so nobody wonders whether Homi heard it while the others reply.
      if (!taste.go) react(st, ev.msgRef);
      if (st.ctx.simple) {
        if (taste.go) presentCurated(st, 'prompted');
        else resolveCuisine(st, false);
        return;
      }
      if (taste.vague && !taste.neighborhoods.length && !p.neighborhood) {
        h.askedWhere = true;
        say(st, T.foodWhere());
        return;
      }
      // Any provided preference is actionable; omitted preferences use general recommendations.
      // DEMO_SIMPLE: one cuisine word is never "complete"; the question waits for the group (or "surprise us" / the window).
      if (taste.go || hasTaste(taste)) return startSearch(st);
      if (!st.ctx.simple && taste.vague && !h.askedWhere && !Object.keys(h.neighborhoods).length && !p.neighborhood) {
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
 * Text votes replace; tapbacks add. Closes once a majority of the known active group, platform roster, or stated
 * headcount has voted. Preference answers do not reduce the number of votes needed.
 */
export function placeVote(st: Step, key: MemberKey, id: number, mode: 'set' | 'add'): void {
  const p = P(st);
  const h = p.hungry as EngineHungry;
  if (h.phase !== 'voting' || !h.options.some((o) => o.id === id)) return;
  const cur = h.votes[key] ?? [];
  h.votes[key] = mode === 'set' ? [id] : cur.includes(id) ? cur : [...cur, id];
  const roster = p.rosterSize ? Math.min(p.rosterSize, activeMembers(p).length) : 0;
  const counted = p.expectedHeadcount ? groupSize(p) : 0;
  const n = Math.max(h.answeredBy.length, activeMembers(p).length, roster, counted, 1);
  if (Object.keys(h.votes).length >= Math.floor(n / 2) + 1) closePlaces(st, 'prompted');
}

export function onPlacesResult(st: Step, ev: Extract<EngineEvent, { kind: 'places_result' }>): void {
  const p = planOf(st);
  const h = p?.hungry as EngineHungry | undefined;
  if (!p || !h || h.phase !== 'searching' || h.requestId !== ev.requestId) return;
  const now = st.ctx.now;
  h.source = ev.source;
  if (ev.source === 'unknown-neighborhood' || ev.source === 'unknown-location' || ev.source === 'ambiguous-location' || ev.source === 'provider-error' || ev.source === 'provider-limit') {
    h.phase = 'asking';
    const message =
      ev.source === 'unknown-neighborhood'
        ? T.foodWhere()
        : ev.source === 'ambiguous-location'
          ? T.foodLocationAmbiguous()
          : ev.source === 'unknown-location'
            ? T.foodLocationUnknown()
            : T.foodSearchUnavailable();
    say(st, message);
    return;
  }
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

/**
 * DEMO_SIMPLE, step 1: one question after the date locks ("What are we feeling?"). Answers are merged by the usual
 * taste rules (Claude maps free text onto a cuisine word first); when everyone known has answered, someone says
 * "surprise us" / "homi go", or the window closes, the curated picks for the top cuisine go out (presentCurated).
 */
export function askCuisine(st: Step, prompting: Prompting): boolean {
  const p = P(st);
  if (p.state === 'collecting_place') return false;
  const now = st.ctx.now;
  p.stack.push(p.state);
  p.state = 'collecting_place';
  const h = newHungry(now, false);
  // Demo timers: the question closes as fast as the date poll did; otherwise the usual 10 minutes.
  h.deadlineAt = now + (st.ctx.quorum ? st.ctx.quorum.dmAfterMs : WINDOW);
  p.hungry = h;
  say(st, T.cuisineAsk(), prompting);
  schedule(st, 'hungry_deadline', h.deadlineAt, { suffix: 'where' });
  return true;
}

/** Forget a member's earlier cuisine answers (their latest message replaces them). */
function retractCuisines(h: EngineHungry, member: MemberKey): void {
  const mine = h.memberCuisines?.[member] ?? [];
  for (const c of mine) h.cuisineVotes[c] = Math.max(0, (h.cuisineVotes[c] ?? 1) - 1);
  if (h.memberCuisines) h.memberCuisines[member] = [];
}

/** Votes per curated cuisine: one per member, their first mappable tag, vetoed keys excluded. */
function curatedTally(h: EngineHungry): Array<[CuratedKey, number]> {
  const counts = new Map<CuratedKey, number>();
  const order: CuratedKey[] = [];
  const vetoed = new Set(h.vetoes.map(curatedKeyOf).filter((k): k is CuratedKey => !!k));
  for (const tags of Object.values(h.memberCuisines ?? {})) {
    const key = tags.map(curatedKeyOf).find((k): k is CuratedKey => !!k && !vetoed.has(k));
    if (!key) continue;
    if (!counts.has(key)) order.push(key);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return order.map((k) => [k, counts.get(k) ?? 0] as [CuratedKey, number]).sort((a, b) => b[1] - a[1] || order.indexOf(a[0]) - order.indexOf(b[0]));
}

/** DEMO_SIMPLE deliberation: extensions of the cuisine window before the top cuisine goes ahead anyway. */
const MAX_EXTENSIONS = 3;

/**
 * DEMO_SIMPLE, between the question and the picks: the group deliberates until one cuisine has a majority of the
 * group. Each answer re-checks; when everyone known has answered and it is still split, Homi posts the tally once
 * per change ("Thai 1 · Japanese 1, need 2 of 2 on one"). The window closing (`timer`) extends the deliberation up to
 * three times with the same nudge, then the top cuisine goes ahead. "surprise us" skips all of this.
 */
export function resolveCuisine(st: Step, timer: boolean): void {
  const p = P(st);
  const h = p.hungry as EngineHungry;
  if (h.phase !== 'asking') return;
  const tally = curatedTally(h);
  const n = Math.max(groupSize(p), 1);
  const need = Math.floor(n / 2) + 1;
  const top = tally[0];
  if (top && top[1] >= need) {
    presentCurated(st, 'prompted', top[0]);
    return;
  }
  const line = tally.map(([k, c]) => `${CURATED_LABEL[k]} ${c}`).join(' · ');
  const nudge = () => {
    if (!line || h.lastSplit === line) return;
    h.lastSplit = line;
    say(st, T.cuisineSplit({ tally: line, need, n }), 'prompted');
  };
  if (!timer) {
    if (allAnswered(p, h)) nudge();
    return;
  }
  if ((h.extensions ?? 0) < MAX_EXTENSIONS && tally.length > 1) {
    h.extensions = (h.extensions ?? 0) + 1;
    h.deadlineAt = st.ctx.now + (st.ctx.quorum ? st.ctx.quorum.dmAfterMs : WINDOW);
    schedule(st, 'hungry_deadline', h.deadlineAt, { suffix: 'where' });
    h.lastSplit = undefined;
    nudge();
    return;
  }
  presentCurated(st, 'prompted', top?.[0]);
}

/**
 * DEMO_SIMPLE, step 2: the three curated spots for the top cuisine (Mexican when nobody named one), straight to the
 * vote (no lookup). Also what "homi find food" does after the lock. The usual place vote and close apply.
 */
export function presentCurated(st: Step, prompting: Prompting, key?: CuratedKey): boolean {
  const p = P(st);
  const now = st.ctx.now;
  const prev = p.hungry as EngineHungry | undefined;
  if (p.state !== 'collecting_place') {
    p.stack.push(p.state);
    p.state = 'collecting_place';
  } else if (prev?.phase === 'voting') {
    return false;
  }
  const cuisine = key ?? pickCuratedKey(prev ? rankedCuisines(prev) : []);
  const picks = CURATED[cuisine];
  const h = prev && prev.phase === 'asking' ? prev : newHungry(now, false);
  h.cuisineVotes = { [cuisine]: Math.max(1, h.cuisineVotes[cuisine] ?? 0) };
  h.phase = 'voting';
  h.options = picks.map((o) => ({ ...o }));
  h.votes = {};
  h.deadlineAt = now + WINDOW;
  p.hungry = h;
  p.refs.placeOptions = {};
  p.refs.placePoll = undefined;
  cancel(st, 'hungry_deadline');
  schedule(st, 'hungry_deadline', h.deadlineAt, { suffix: 'vote' });
  const header = T.curatedHeader({ cuisine: CURATED_LABEL[cuisine], how: howOf(st) });
  const bubbles = picks.map((o) => T.placeBubble({ id: o.id, name: o.name, cuisine: o.hood, price: curatedPrice(o.priceBand), open: '' }));
  if (st.ctx.caps.polls) {
    st.acts.push({ type: 'poll', question: header, options: bubbles, prompting, tag: 'poll:place' });
    return true;
  }
  say(st, header, prompting, 'place:header');
  bubbles.forEach((b, i) => say(st, b, prompting, `place:${picks[i].id}`));
  return true;
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
