// Travel planning end to end through applyEvent (docs/DEMO.md Act 5), with travel_result fed from the
// estimates provider exactly as the runner handler would.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAY, Harness, ofType, texts } from '../engine/helpers.js';
import { countSentences } from '../../src/engine/templates.js';
import type { Action, TravelQuery } from '../../src/engine/types.js';
import { estimateTrip } from '../../src/travel/estimates.js';
import { tripOf } from '../../src/engine/ext/travel/state.js';

const START = '2026-10-24T10:00:00-04:00';

export function fresh(): Harness {
  const h = new Harness({ start: START });
  h.apply({ kind: 'added_to_group' }); // the one-time intro goes out first
  return h;
}

/** What the runner does: each lookup_travel becomes a travel_result from the estimates provider. */
export function feed(h: Harness, actions: Action[]): Action[] {
  const out: Action[] = [];
  for (const a of ofType(actions, 'lookup_travel')) out.push(...h.apply({ kind: 'travel_result', requestId: a.requestId, result: estimateTrip(a.query, h.now) }));
  return out;
}

const Q19 = 'Japan 2030, love it ✈️ Where are you flying from, roughly when and for how long, how many of you, and a budget per person?';
const CARD21 = [
  "Japan · late Mar 2030 · 10 nights · 5 from Boston. Too far ahead to book, so these are estimates in today's prices:",
  'Days 1–4 · Tokyo (Asakusa base)',
  'Day 5 · Hakone onsen night',
  'Days 6–8 · Kyoto (+ Nara day trip)',
  'Days 9–10 · Osaka, fly home from Kansai',
  '✈️ Flights BOS→Tokyo, Osaka→BOS (open-jaw, 1 stop): ~$1,300',
  '🏠 Stays, budget tier: ~$450 · Example listing · estimated price: 3-bedroom Airbnb-style apartment in Asakusa, ~$230/night for 5',
  '🚄 Trains + transit: ~$220 (individual Shinkansen tickets beat a nationwide JR Pass on this route)',
  '🍜 Food + activities: ~$700',
  'Total ≈ $2,670 per person ($13,350 for 5), under your $3,000.',
].join('\n');
const OFFER22 =
  'Want it more comfortable? 4★ hotels plus one ryokan night with dinner runs ≈ $3,620 per person (+$950: stays ~$1,300 instead of ~$450, food ~$800 instead of ~$700).';
const SAVINGS23 = [
  'Less obvious savings:',
  '· Fly into Tokyo and home from Osaka: no backtracking',
  '· Book the ryokan on a weeknight',
  '· Late March is peak bloom; early April or mid-May is usually cheaper',
  '· Convenience-store breakfasts',
  "Last-minute deals: none yet; I'll watch fares once 2030 schedules open (about 11 months out).",
].join('\n');
const SAVED24 = 'Comfort plan saved: ≈ $3,620 per person, all estimates. Say "homi trip" anytime to see it.';

/** Runs DEMO steps 19-23 and returns the harness plus the cards. */
export function demo(): { h: Harness; cards: string[]; lookups: Array<Extract<Action, { type: 'lookup_travel' }>> } {
  const h = fresh();
  assert.deepEqual(texts(h.say('ana', "homi let's plan Japan for 2030")), [Q19]);
  assert.deepEqual(h.say('ana', 'boston, late march for cherry blossoms, 10 nights'), [], 'unaddressed answer: taken silently');
  assert.deepEqual(h.say('ben', '5 of us, ~$3,000 each all in'), [], 'essentials in, waits a message for must-dos');
  const acts = h.say('maya', 'food, temples, one onsen night');
  const lookups = ofType(acts, 'lookup_travel');
  assert.equal(texts(acts).length, 0);
  return { h, cards: texts(feed(h, acts)), lookups };
}

test('DEMO Act 5: question, overview card, comfort offer, savings card (exact copy and numbers)', () => {
  const { cards } = demo();
  assert.deepEqual(cards, [CARD21, OFFER22, SAVINGS23]);
});

test('two lookups, one per tier, carrying only the trip details', () => {
  const { lookups } = demo();
  assert.deepEqual(lookups.map((l) => l.query.tier), ['budget', 'comfort']);
  const q: TravelQuery = { destination: 'Japan', origin: 'Boston', year: 2030, month: 3, nights: 10, travelers: 5, budgetPerPersonUsd: 3000, tier: 'budget', interests: ['food', 'temples', 'onsen'] };
  assert.deepEqual(lookups[0].query, q);
  assert.notEqual(lookups[0].requestId, lookups[1].requestId);
});

test('step 24: "comfortable please" (unaddressed, offer open) saves the comfort plan', () => {
  const { h } = demo();
  assert.deepEqual(texts(h.say('ben', 'comfortable please')), [SAVED24]);
  const trip = tripOf(h.state);
  assert.equal(trip?.chosen, 'comfort');
  assert.equal(trip?.phase, 'saved');
});

test('"budget is fine" saves the budget tier; addressed "homi comfortable please" switches later', () => {
  const { h } = demo();
  assert.deepEqual(texts(h.say('jo', 'budget is fine')), ['Budget plan saved: ≈ $2,670 per person, all estimates. Say "homi trip" anytime to see it.']);
  assert.deepEqual(h.say('ana', 'comfortable please'), [], 'offer closed: unaddressed choice is chatter now');
  assert.deepEqual(texts(h.say('ana', 'homi comfortable please')), [SAVED24]);
});

test('dump line, "homi trip" view, and the trip survives "homi forget"', () => {
  const { h } = demo();
  h.say('ben', 'comfortable please');
  const d = texts(h.say('jo', 'homi what do you know')).join('\n');
  assert.ok(d.includes('trip: Japan, late Mar 2030, 10 nights, 5 from Boston, comfort ≈ $3,620 pp (estimates)'), d);
  h.say('ana', 'homi forget');
  assert.ok(tripOf(h.state), 'plan forget leaves the trip');
  const view = texts(h.say('sam', 'homi trip'))[0];
  assert.ok(view.startsWith('Japan · late Mar 2030 · 10 nights · 5 from Boston, comfort plan (all estimates):'), view);
  assert.ok(view.includes('🏠 Stays, comfort tier: ~$1,300 · 4★ hotels plus one ryokan night with dinner · Example listing · estimated price:'), view);
  assert.ok(view.endsWith('Total ≈ $3,620 per person ($18,100 for 5), about $620 over your $3,000.'), view);
});

test('"homi forget the trip" deletes it; "homi stop" deletes it too', () => {
  const a = demo().h;
  assert.deepEqual(texts(a.say('ana', 'homi forget the trip')), ["Done: I've deleted the trip."]);
  assert.equal(tripOf(a.state), undefined);
  assert.deepEqual(texts(a.say('ana', 'homi trip')), ['No trip saved yet. Say "homi plan a trip to Japan" (or anywhere) to start one.']);
  const b = demo().h;
  b.say('ana', 'homi stop');
  assert.equal(tripOf(b.state), undefined);
});

test('every header is at most two sentences', () => {
  const { cards } = demo();
  for (const c of [Q19, ...cards, SAVED24]) assert.ok(countSentences(c.split('\n')[0]) <= 2, c);
});

test('answers arrive in any order, from anyone; Homi asks again only for what is missing when addressed', () => {
  const h = fresh();
  h.say('jo', 'homi plan a trip to Japan');
  assert.deepEqual(h.say('ben', 'we are 4'), []);
  assert.deepEqual(h.say('maya', 'lol same, see you tonight'), [], 'chatter is ignored');
  assert.deepEqual(texts(h.say('ana', 'homi 7 nights')), ['Got it. Where are you flying from, roughly when, and a budget per person?']);
  assert.deepEqual(h.say('sam', 'flying from SF'), []);
  const acts = h.say('ana', 'homi mid may');
  const lookups = ofType(acts, 'lookup_travel');
  assert.equal(lookups.length, 2, 'addressed + essentials: price it now (budget is optional)');
  assert.deepEqual({ ...lookups[0].query, tier: undefined }, { destination: 'Japan', origin: 'San Francisco', year: 2027, month: 5, nights: 7, travelers: 4, tier: undefined, interests: [] });
  const cards = texts(feed(h, acts));
  assert.ok(cards[0].startsWith("Japan · mid May 2027 · 7 nights · 4 from San Francisco. No live prices for these dates yet, so these are estimates in today's prices:"), cards[0]);
  assert.ok(cards[0].includes('✈️ Flights SFO→Tokyo, Osaka→SFO (open-jaw, nonstop): ~$900'), cards[0]);
});

test('unaddressed answers stop counting after two quiet days; the ready trip prices on the next message', () => {
  const h = fresh();
  h.say('ana', 'homi trip to Japan in 2030');
  h.advance(3 * DAY);
  assert.deepEqual(h.say('ben', 'from boston, 10 nights'), [], 'stale: ignored');
  assert.equal(tripOf(h.state)?.origin, undefined);
  assert.deepEqual(texts(h.say('ben', 'homi from boston, late march, 10 nights')), ['Got it. How many of you and a budget per person?']);
  assert.deepEqual(h.say('jo', '5 people'), [], 'essentials done but budget + interests missing: wait');
  assert.equal(tripOf(h.state)?.phase, 'ready');
  const acts = h.say('maya', 'so excited');
  assert.equal(ofType(acts, 'lookup_travel').length, 2, 'the next message triggers the search');
});

test('a far-off estimate is re-priced by "homi trip" once the dates come within booking range', () => {
  const { h } = demo();
  h.say('ben', 'comfortable please');
  h.advanceTo(Date.parse('2029-05-01T14:00:00Z'));
  const acts = h.say('ana', 'homi trip');
  assert.deepEqual(texts(acts), ["2030 fares should be on sale by now, so I'm pricing the trip again."]);
  const cards = texts(feed(h, acts));
  assert.ok(cards[0].startsWith('Japan · late Mar 2030 · 10 nights · 5 from Boston, comfort plan (all estimates):'), cards[0]);
  assert.ok(cards[1].endsWith("Last-minute deals: none; live fare alerts aren't set up yet."), cards[1]);
  assert.equal(tripOf(h.state)?.chosen, 'comfort');
});

test('an addressed change after the offer re-prices; unaddressed chatter with numbers does not', () => {
  const { h } = demo();
  assert.deepEqual(h.say('jo', 'lol 5 of us in one apartment'), [], 'not addressed: chatter');
  const acts = h.say('ana', 'homi make it 7 nights');
  assert.equal(ofType(acts, 'lookup_travel').length, 2);
  assert.equal(ofType(acts, 'lookup_travel')[0].query.nights, 7);
  const cards = texts(feed(h, acts));
  assert.ok(cards[0].startsWith('Japan · late Mar 2030 · 7 nights · 5 from Boston.'), cards[0]);
  assert.deepEqual(texts(h.say('ana', 'homi dinner friday? 5 of us')).some((t) => t.includes('Japan')), false, 'dinner talk is not a trip update');
});

test('other destinations: one-message request prices right away, cards say rough regional average', () => {
  const h = fresh();
  const acts = h.say('ana', 'homi plan a trip to Italy from Boston in June 2030 for 7 nights, 4 of us');
  assert.equal(texts(acts).length, 0, 'everything given: no question');
  const cards = texts(feed(h, acts));
  assert.ok(cards[0].startsWith("Italy · Jun 2030 · 7 nights · 4 from Boston. Too far ahead to book, so these are rough regional averages in today's prices, not real listings:"), cards[0]);
  assert.ok(cards[0].includes('🏠 Stays, budget tier: ~$385 · Example listing · estimated price: 2-bedroom apartment for 4, ~$220/night (rough regional average)'), cards[0]);
  assert.ok(cards[0].includes('✈️ Flights BOS→Italy round trip (rough regional average): ~$850'), cards[0]);
  assert.ok(/Total ≈ \$[\d,]+ per person \(\$[\d,]+ for 4\)\.$/.test(cards[0].split('\n').at(-1) ?? ''), cards[0]);
});
