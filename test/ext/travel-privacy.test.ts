// Travel privacy (docs/PRIVACY.md "Beyond a single plan"): the trip keeps only details members handed Homi, and
// the provider query carries no names, numbers or member keys.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness, ofType, texts } from '../engine/helpers.js';
import type { Action } from '../../src/engine/types.js';
import { tripOf } from '../../src/engine/ext/travel/state.js';

test('egress: lookup queries carry trip details only, even after names and a phone number were typed', () => {
  const h = new Harness({ start: '2026-10-24T10:00:00-04:00' });
  const acts: Action[] = [];
  const say = (who: string, text: string) => acts.push(...h.say(who, text, { platformName: who[0].toUpperCase() + who.slice(1) }));
  say('you', '@homi dinner next week?');
  say('ana', 'fri works');
  say('sam', "homi I'm Sam");
  say('ben', 'my number is 617-555-0134 if anyone needs a ride');
  say('ana', "homi let's plan Japan for 2030");
  say('ana', 'boston, late march for cherry blossoms, 10 nights');
  say('ben', '5 of us, ~$3,000 each all in, call me at 617-555-0134');
  say('maya', 'food, temples, one onsen night');
  const queries = ofType(acts, 'lookup_travel').map((a) => a.query);
  assert.equal(queries.length, 2);
  const blob = JSON.stringify(queries);
  assert.doesNotMatch(blob, /\b(?:ana|ben|maya|sam|you)\b/i);
  assert.doesNotMatch(blob, /617|555|0134|k-/);
  assert.deepEqual(queries[0], { destination: 'Japan', origin: 'Boston', year: 2030, month: 3, nights: 10, travelers: 5, budgetPerPersonUsd: 3000, tier: 'budget', interests: ['food', 'temples', 'onsen'] });
});

test('the stored trip holds structured details, never message text', () => {
  const h = new Harness({ start: '2026-10-24T10:00:00-04:00' });
  h.say('ana', "homi let's plan Japan for 2030");
  h.say('ana', 'boston, late march for cherry blossoms, 10 nights');
  h.say('ben', '5 of us, ~$3,000 each all in');
  const trip = JSON.stringify(tripOf(h.state));
  for (const s of ['cherry', 'all in', 'boston,', 'let\'s plan', 'k-ana', 'k-ben']) assert.ok(!trip.includes(s), `${s} in ${trip}`);
});

test('a "trip to <member name>" never becomes a destination', () => {
  const h = new Harness({ start: '2026-10-24T10:00:00-04:00' });
  h.say('you', '@homi dinner next week?', { platformName: 'You' });
  h.say('ana', 'fri works', { platformName: 'Ana' });
  const out = texts(h.say('ben', 'homi plan a trip to Ana'));
  assert.equal(out[0], 'A trip, love it ✈️ Where to, where are you flying from, roughly when and for how long, how many of you, and a budget per person?');
  assert.equal(tripOf(h.state)?.destination, undefined);
  // The destination can still come later, addressed or as an answer.
  h.say('ben', 'japan, from boston, 2030 in april, 7 nights, 4 of us');
  assert.equal(tripOf(h.state)?.destination, 'Japan');
});
