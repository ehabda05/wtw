import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foodScore, nearOf, parseTaste, placesQuery, rankPlaces } from '../../src/engine/index.js';
import { mergeTaste, newHungry, placesHeader, placeEmoji } from '../../src/engine/hungry.js';
import { pFood, predict } from '../../src/engine/classifier.js';
import type { PlaceOption } from '../../src/engine/types.js';
import { fakePlaces } from './helpers.js';

test('§1 lexicon: strong signals score 2, weak 1, idioms cancel, negatives cancel unless strong', () => {
  assert.ok(foodScore("ok I'm starving where are we eating").score >= 4);
  assert.equal(foodScore('where should we eat').strong, true);
  assert.equal(foodScore('dinner?').score, 2);
  assert.equal(foodScore('food?').score, 2);
  assert.equal(foodScore('dinner next week?').score, 1);
  assert.equal(foodScore('that talk was food for thought').score, 0);
  assert.equal(foodScore('this pset is eating me alive').score, 0);
  assert.equal(foodScore('the wifi is eating my soul').score, 0);
  assert.equal(foodScore("what's eating him lately").score, 0);
  assert.equal(foodScore('food coma incoming, dumplings were great').score, 0);
  assert.equal(foodScore('i ate so much at lunch lol').score, 0);
  assert.ok(foodScore("i already ate but where are we eating").score >= 2);
});

test('stage 2 (naive Bayes): food talk vs chatter that has food words', () => {
  assert.ok(pFood("ok I'm starving where are we eating") >= 0.6);
  assert.ok(pFood('so hungry rn, lets get food') >= 0.6);
  assert.ok(pFood('brb grabbing food from the dhall') < 0.6);
  assert.ok(pFood('my mom made dumplings last night') < 0.6);
  const p = predict('dinner next week?');
  assert.ok(Math.abs(p.food + p.plan + p.chatter - 1) < 1e-9);
  assert.deepEqual(predict('where should we eat'), predict('where should we eat'));
});

test('§3 taste: synonyms -> OSM tags, vetoes, tightest budget, diet, neighborhoods, wildcard, vague', () => {
  assert.deepEqual(parseTaste('tacos or pho?').cuisines, ['mexican', 'vietnamese']);
  assert.deepEqual(parseTaste('anything but sushi lol. harvard sq is easiest').vetoes, ['sushi']);
  assert.deepEqual(parseTaste('anything but sushi lol. harvard sq is easiest').neighborhoods, ['Harvard Square']);
  assert.deepEqual(parseTaste('no pizza we had it for lunch').vetoes, ['pizza']);
  assert.equal(parseTaste('cheap pls im broke').price, 1);
  assert.equal(parseTaste('thai or indian, under 30 pls').price, 2);
  assert.equal(parseTaste('lets treat ourselves').price, 3);
  assert.equal(parseTaste('$$ is fine').price, 2);
  assert.deepEqual(parseTaste("no sushi, i'm vegetarian and gluten-free").diet, ['vegetarian', 'gluten_free']);
  assert.equal(parseTaste('idc honestly').wildcard, true);
  assert.equal(parseTaste('somewhere near here').vague, true);
  assert.deepEqual(parseTaste('dumplings 🥟').cuisines, ['dumpling']);
  assert.deepEqual(parseTaste('Affordable Italian in Malden, Massachusetts').neighborhoods, ['Malden, Massachusetts']);
  assert.equal(parseTaste('Affordable Italian in Malden, Massachusetts').price, 1);
  assert.deepEqual(parseTaste('bowling alley in Malden, Massachusetts').neighborhoods, ['Malden, Massachusetts']);
  assert.equal(parseTaste('bowling alley in Malden, Massachusetts').category, 'bowling');
});

test('§3 merge: +1 per member per cuisine, vetoes win, tightest budget wins, midpoint near', () => {
  const h = newHungry(0, false);
  mergeTaste(h, 'a', parseTaste('thai thai THAI'));
  mergeTaste(h, 'b', parseTaste('thai or tacos, cheap'));
  mergeTaste(h, 'c', parseTaste('treat ourselves, no tacos'));
  mergeTaste(h, 'd', parseTaste('harvard sq'));
  mergeTaste(h, 'e', parseTaste('allston'));
  assert.deepEqual(h.cuisineVotes, { thai: 2, mexican: 1 });
  assert.deepEqual(h.vetoes, ['mexican']);
  assert.equal(h.priceMax, 1);
  assert.deepEqual(h.answeredBy, ['a', 'b', 'c', 'd', 'e']);
  assert.equal(nearOf(h), 'Harvard Square + Allston');
  const q = placesQuery(h, nearOf(h), 123);
  assert.deepEqual(q, { cuisines: ['thai'], diet: [], near: 'Harvard Square + Allston', at: 123, priceMax: 1 });
  const malden = newHungry(0, false);
  mergeTaste(malden, 'member', parseTaste('Affordable Italian in Malden, Massachusetts'));
  assert.deepEqual(placesQuery(malden, nearOf(malden), 123), {
    cuisines: ['italian'],
    diet: [],
    near: 'Malden, Massachusetts',
    at: 123,
    priceMax: 1,
  });
});

test('§4 ranking: exactly three, ids 1..3, closed and vetoed excluded, unknown hours allowed', () => {
  const h = newHungry(0, false);
  mergeTaste(h, 'a', parseTaste('thai, cheap'));
  const r = rankPlaces(fakePlaces(), h, 1);
  assert.equal(r.length, 3);
  assert.deepEqual(r.map((o) => o.id), [1, 2, 3]);
  assert.ok(!r.some((o) => o.name === 'Late Thai'), 'closed at plan time is excluded');
  assert.equal(r[0].name, 'Tasty Thai');
  h.vetoes.push('thai');
  assert.ok(!rankPlaces(fakePlaces(), h, 1).some((o) => /thai/.test(o.cuisine ?? '')));
});

test('§4 budget: over-budget excluded; estimated prices get one band of slack (penalized)', () => {
  const h = newHungry(0, false);
  mergeTaste(h, 'a', parseTaste('thai, cheap'));
  const places: PlaceOption[] = [
    { id: 1, name: 'Fancy Thai', cuisine: 'thai', priceBand: 3, priceEstimated: true, source: 'osm', walkMinutes: 1, openAtPlanTime: true },
    { id: 2, name: 'Mid Thai', cuisine: 'thai', priceBand: 2, priceEstimated: true, source: 'osm', walkMinutes: 1, openAtPlanTime: true },
    { id: 3, name: 'Known Mid Thai', cuisine: 'thai', priceBand: 2, priceEstimated: false, source: 'google', walkMinutes: 1, openAtPlanTime: true },
  ];
  assert.deepEqual(rankPlaces(places, h).map((o) => o.name), ['Mid Thai']);
});

test('§3 compromise: runner-up with >= half the votes gets 2+1 and the header says so', () => {
  const h = newHungry(0, false);
  mergeTaste(h, 'a', parseTaste('thai'));
  mergeTaste(h, 'b', parseTaste('thai'));
  mergeTaste(h, 'c', parseTaste('tacos'));
  const r = rankPlaces(fakePlaces(), h, 1);
  assert.equal(r.filter((o) => /thai/.test(o.cuisine ?? '')).length, 2);
  assert.equal(r.filter((o) => o.cuisine === 'mexican').length, 1);
  assert.match(placesHeader(h, 'Harvard Square', r, 'tap'), /^Two said Thai, one said Mexican: two Thai spots and a Mexican place, Harvard Sq: here are 3\./);
});

test('§4 variety: no two options share a brand; snacks lose to meals', () => {
  const h = newHungry(0, false);
  const places: PlaceOption[] = [
    { id: 1, name: 'Hokkaido Ramen Santouka', cuisine: 'ramen', source: 'osm', walkMinutes: 2, openAtPlanTime: true },
    { id: 2, name: 'Hokkaido Ramen Santouka - Back Bay', cuisine: 'ramen', source: 'osm', walkMinutes: 3, openAtPlanTime: true },
    { id: 3, name: 'Blank Street Coffee', cuisine: 'coffee_shop', source: 'osm', walkMinutes: 1, openAtPlanTime: true },
    { id: 4, name: 'Pho Basil', cuisine: 'vietnamese', source: 'osm', walkMinutes: 4, openAtPlanTime: true },
    { id: 5, name: 'Taco Spot', cuisine: 'mexican', source: 'osm', walkMinutes: 5, openAtPlanTime: true },
  ];
  const names = rankPlaces(places, h).map((o) => o.name);
  assert.equal(names.filter((n) => n.startsWith('Hokkaido')).length, 1);
  assert.ok(!names.includes('Blank Street Coffee'));
});

test('headers: plain summary, honest no-match, emoji by cuisine', () => {
  const h = newHungry(0, false);
  mergeTaste(h, 'a', parseTaste('thai, cheap, harvard sq'));
  const r = rankPlaces(fakePlaces(), h, 1);
  assert.equal(placesHeader(h, 'Harvard Square', r, 'tap'), 'Thai, keeping it cheap, Harvard Sq: here are 3. Tap ❤️ on your pick (or reply 1, 2 or 3).');
  const other = newHungry(0, false);
  mergeTaste(other, 'a', parseTaste('ethiopian'));
  assert.match(placesHeader(other, 'Harvard Square', r, 'reply'), /^No Ethiopian near Harvard Sq in my map; 3 close picks instead\./);
  assert.equal(placeEmoji('pizza'), '🍕');
  assert.equal(placeEmoji('thai'), '🍜');
  assert.equal(placeEmoji(undefined), '🍽️');
});
