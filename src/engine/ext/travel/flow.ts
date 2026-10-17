// Trip flow (pure). collecting -> ready -> searching -> offered -> saved. One trip per group, group-level.
// Pricing starts once destination, origin, timing, nights and group size are known and either Homi was
// addressed, or budget and interests are both in; otherwise Homi waits for the group's next message (anyone
// still typing gets to add a budget or must-dos) and then prices it.

import type { EngineEvent, MessageEvent } from '../../types.js';
import { type Step, planOf, say } from '../../plan/core.js';
import { type Tier, detailCount, parseChoice, parseDetails, parseTrigger, parseTripCommand, tripOnly } from './parse.js';
import { type Destination, destinationIn } from './geo.js';
import { ANSWER_WINDOW_MS, type TripState, budgetPP, essentialsKnown, farAhead, getTrip, merge, queryOf, setTrip } from './state.js';
import { comfortOffer, overviewCard, progressText, reask, savedText, savingsCard, startQuestion, tripCard } from './render.js';

const TIERS: Tier[] = ['budget', 'comfort'];

/** Emits one lookup_travel per tier; results come back as travel_result events. */
export function search(st: Step, trip: TripState): void {
  const requests = { budget: st.ctx.newId(), comfort: st.ctx.newId() };
  trip.requests = requests;
  trip.results = {};
  trip.phase = 'searching';
  trip.updatedAt = st.ctx.now;
  for (const tier of TIERS) st.acts.push({ type: 'lookup_travel', requestId: requests[tier], query: queryOf(trip, tier) });
}

/** After new details: price it, wait one message for the optional bits, or ask for what's missing. */
function afterAnswer(st: Step, trip: TripState, addressed: boolean): void {
  if (essentialsKnown(trip)) {
    if (addressed || (budgetPP(trip) !== undefined && trip.interests.length > 0)) return search(st, trip);
    trip.phase = 'ready';
    return;
  }
  trip.phase = 'collecting';
  if (addressed) say(st, reask(trip));
}

/** Member names the group gave Homi, so a "trip to <name>" never becomes a destination sent to a provider. */
function memberNames(st: Step): string[] {
  const p = planOf(st);
  return p ? Object.values(p.members).flatMap((m) => (m.name ? [m.name.toLowerCase()] : [])) : [];
}

function adopt(trip: TripState, d: Destination, now: number): void {
  trip.destination = d.name;
  trip.destKey = d.key;
  trip.updatedAt = now;
}

function start(st: Step, body: string, dest: ReturnType<typeof parseTrigger>, existing: TripState | undefined): void {
  const now = st.ctx.now;
  let d = dest?.destination;
  if (d && d.key === 'world' && memberNames(st).some((n) => d && d.name.toLowerCase().includes(n))) d = undefined;
  if (existing && (!d || !existing.destination || d.name === existing.destination)) {
    // Same trip again (or its destination at last): take any new details, then price it or ask for the rest.
    if (d && !existing.destination) adopt(existing, d, now);
    merge(existing, parseDetails(body, now, existing.destination), now);
    if (existing.phase === 'collecting' || existing.phase === 'ready') return afterAnswer(st, existing, true);
    const card = tripCard(existing);
    return say(st, card ?? progressText(existing));
  }
  const trip: TripState = { id: st.ctx.newId(), phase: 'collecting', interests: [], createdAt: now, updatedAt: now };
  if (d) adopt(trip, d, now);
  merge(trip, parseDetails(body, now, trip.destination), now);
  setTrip(st, trip);
  if (essentialsKnown(trip)) return search(st, trip);
  say(st, startQuestion(trip, existing?.destination && existing.destination !== trip.destination ? existing.destination : undefined));
}

function show(st: Step, trip: TripState | undefined): void {
  if (!trip) return say(st, 'No trip saved yet. Say "homi plan a trip to Japan" (or anywhere) to start one.');
  if ((trip.phase === 'offered' || trip.phase === 'saved') && trip.results?.budget?.estimates && trip.pricedFar && !farAhead(trip, st.ctx.now)) {
    say(st, `${trip.year} fares should be on sale by now, so I'm pricing the trip again.`);
    return search(st, trip);
  }
  say(st, tripCard(trip) ?? progressText(trip));
}

function choose(st: Step, trip: TripState, tier: Tier): void {
  const r = trip.results?.[tier];
  if (!r) return;
  trip.chosen = tier;
  trip.phase = 'saved';
  trip.updatedAt = st.ctx.now;
  delete trip.offerAt;
  say(st, savedText(tier, r));
}

export function onTravelMessage(st: Step, ev: MessageEvent, body: string, addressed: boolean): boolean {
  const now = st.ctx.now;
  const trip = getTrip(st);
  if (addressed) {
    const cmd = parseTripCommand(body);
    if (cmd === 'forget') {
      setTrip(st, undefined);
      say(st, trip ? "Done: I've deleted the trip." : 'There was no trip saved.');
      return true;
    }
    if (cmd === 'show') {
      show(st, trip);
      return true;
    }
    if (cmd === 'go' && trip && (trip.phase === 'ready' || (trip.phase === 'collecting' && essentialsKnown(trip)))) {
      search(st, trip);
      return true;
    }
    const trig = parseTrigger(body);
    if (trig) {
      start(st, body, trig, trip);
      return true;
    }
  }
  if (!trip) return false;
  const choice = parseChoice(body);
  if (choice && trip.results?.[choice] && (addressed || (trip.phase === 'offered' && now - (trip.offerAt ?? 0) < ANSWER_WINDOW_MS))) {
    choose(st, trip, choice);
    return true;
  }
  const d = parseDetails(body, now, trip.destination);
  const n = detailCount(d);
  switch (trip.phase) {
    case 'collecting': {
      const named = trip.destination ? undefined : destinationIn(body);
      if ((!n && !named) || (!addressed && now - trip.updatedAt > ANSWER_WINDOW_MS)) return false;
      if (named) adopt(trip, named, now);
      merge(trip, d, now);
      afterAnswer(st, trip, addressed);
      return true;
    }
    case 'ready':
      // The group's next message after the essentials: take what it adds, then price the trip.
      if (n) merge(trip, d, now);
      search(st, trip);
      return n > 0;
    case 'searching':
      return false;
    case 'offered':
    case 'saved': {
      const aboutTrip = /\btrip\b/i.test(body) || (!!trip.destination && destinationIn(body)?.name === trip.destination);
      if (!addressed || !n || !(tripOnly(d) || aboutTrip)) return false;
      if (merge(trip, d, now)) {
        delete trip.chosen;
        search(st, trip);
      } else say(st, tripCard(trip) ?? progressText(trip));
      return true;
    }
  }
}

export function onTravelEvent(st: Step, ev: EngineEvent): boolean {
  const trip = getTrip(st);
  if (!trip) return false;
  if (ev.kind === 'reaction') {
    if (trip.phase === 'ready') search(st, trip);
    return false;
  }
  if (ev.kind !== 'travel_result' || !trip.requests) return false;
  const tier = TIERS.find((t) => trip.requests?.[t] === ev.requestId);
  if (!tier) return false;
  trip.results = { ...(trip.results ?? {}), [tier]: ev.result };
  const b = trip.results.budget;
  const c = trip.results.comfort;
  if (!b || !c) return true;
  const now = st.ctx.now;
  delete trip.requests;
  trip.pricedFar = farAhead(trip, now);
  trip.updatedAt = now;
  if (trip.chosen) {
    trip.phase = 'saved';
    say(st, tripCard(trip) ?? overviewCard(trip, b, now));
  } else {
    trip.phase = 'offered';
    trip.offerAt = now;
    say(st, overviewCard(trip, b, now));
    const offer = comfortOffer(b, c);
    if (offer) say(st, offer);
  }
  say(st, savingsCard(trip, b, now));
  return true;
}
