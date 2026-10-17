// Estimates provider: DEMO numbers, scaling, labeling, determinism.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TravelQuery } from '../../src/engine/types.js';
import { estimateTrip } from '../../src/travel/estimates.js';
import { route } from '../../src/travel/data/japan.js';

const NOW = Date.parse('2026-10-24T14:00:00Z');
const LABEL = 'Example listing · estimated price';
const Q = (over: Partial<TravelQuery> = {}): TravelQuery => ({
  destination: 'Japan', origin: 'Boston', year: 2030, month: 3, nights: 10, travelers: 5, budgetPerPersonUsd: 3000, tier: 'budget', interests: ['food', 'temples', 'onsen'], ...over,
});
const price = (q: TravelQuery, kind: string) => estimateTrip(q, NOW).listings.find((l) => l.kind === kind)?.pricePerPersonUsd;

test('DEMO numbers: $2,670 budget, $3,620 comfort, line by line', () => {
  const b = estimateTrip(Q(), NOW);
  const c = estimateTrip(Q({ tier: 'comfort' }), NOW);
  assert.deepEqual(b.listings.map((l) => [l.kind, l.pricePerPersonUsd]), [['flight', 1300], ['stay', 450], ['transport', 220], ['food', 700]]);
  assert.deepEqual(c.listings.map((l) => [l.kind, l.pricePerPersonUsd]), [['flight', 1300], ['stay', 1300], ['transport', 220], ['food', 800]]);
  assert.equal(b.totalPerPersonUsd, 2670);
  assert.equal(c.totalPerPersonUsd, 3620);
  assert.deepEqual(b.itinerary, ['Days 1–4 · Tokyo (Asakusa base)', 'Day 5 · Hakone onsen night', 'Days 6–8 · Kyoto (+ Nara day trip)', 'Days 9–10 · Osaka, fly home from Kansai']);
  assert.equal(b.listings[1].title, `${LABEL}: 3-bedroom Airbnb-style apartment in Asakusa, ~$230/night for 5`);
  assert.equal(c.listings[1].title, '4★ hotels plus one ryokan night with dinner');
  assert.deepEqual(b.lastMinute, []);
  assert.equal(b.source, 'estimates');
  assert.equal(b.basis, "estimates in today's prices");
});

test('everything from the estimates provider is a labeled example', () => {
  for (const q of [Q(), Q({ tier: 'comfort' }), Q({ destination: 'Italy', origin: 'New York' }), Q({ destination: 'Fooland', tier: 'comfort' }), Q({ year: 2027, month: 1 })]) {
    const r = estimateTrip(q, NOW);
    assert.equal(r.estimates, true);
    for (const l of r.listings) {
      assert.equal(l.example, true, l.title);
      assert.equal(l.estimate, true, l.title);
    }
    const stay = r.listings.find((l) => l.kind === 'stay');
    assert.ok(stay && (stay.title.includes(LABEL) || stay.detail?.includes(LABEL)), JSON.stringify(stay));
  }
});

test('scales with nights, travelers, origin and season', () => {
  assert.equal(estimateTrip(Q({ nights: 14 }), NOW).totalPerPersonUsd > 2670, true);
  assert.ok((price(Q({ travelers: 2 }), 'stay') ?? 0) > 450, 'pairs pay more per person than a group of 5');
  assert.ok((price(Q({ travelers: 1 }), 'stay') ?? 0) > (price(Q({ travelers: 2 }), 'stay') ?? 0));
  assert.equal(price(Q({ origin: 'San Francisco' }), 'flight'), 1000);
  assert.equal(price(Q({ origin: 'London' }), 'flight'), 1150);
  assert.equal(price(Q({ origin: 'Chicago' }), 'flight'), 1200);
  assert.ok((price(Q({ month: 1 }), 'flight') ?? 0) < 1300, 'January is cheaper than peak bloom');
  assert.deepEqual(route(4), { tokyo: 4, hakone: 0, kyoto: 0, osaka: 0 });
  assert.deepEqual(route(7), { tokyo: 3, hakone: 1, kyoto: 2, osaka: 1 });
  const short = estimateTrip(Q({ nights: 4 }), NOW);
  assert.equal(short.listings[0].title, 'Flights BOS→Tokyo round trip');
  assert.deepEqual(short.itinerary, ['Days 1–4 · Tokyo (Asakusa base), fly home from Tokyo']);
});

test('other destinations: clearly labeled rough regional averages, never real listings', () => {
  const r = estimateTrip(Q({ destination: 'Italy', origin: 'New York', month: 6, year: 2030, nights: 7, travelers: 4 }), NOW);
  assert.match(r.basis, /rough regional averages/);
  assert.equal(r.listings[0].title, 'Flights JFK→Italy round trip');
  for (const l of r.listings) assert.ok(`${l.title} ${l.detail ?? ''}`.includes('rough regional average'), l.title);
  assert.deepEqual(r.itinerary, ['Days 1–4 · Italy, first base (rough plan)', 'Days 5–7 · Italy, second base']);
  const unknown = estimateTrip(Q({ destination: 'Fooland' }), NOW);
  assert.ok(unknown.listings.every((l) => `${l.title} ${l.detail ?? ''}`.includes('rough regional average')));
});

test('bookable dates get a verifiable Airbnb search link; far-future trips get none', () => {
  const near = estimateTrip(Q({ year: 2027, month: 3 }), NOW).listings.find((l) => l.kind === 'stay');
  assert.equal(near?.url, 'https://www.airbnb.com/s/Tokyo--Japan/homes?checkin=2027-03-15&checkout=2027-03-25&adults=5');
  assert.equal(estimateTrip(Q(), NOW).listings.find((l) => l.kind === 'stay')?.url, undefined);
});

test('deterministic', () => {
  assert.deepEqual(estimateTrip(Q(), NOW), estimateTrip(Q(), NOW));
});
