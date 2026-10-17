// Trip-detail grammar: what counts as an answer, and what stays chatter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detailCount, parseChoice, parseDetails, parseTrigger, parseTripCommand } from '../../src/engine/ext/travel/parse.js';

const NOW = Date.parse('2026-10-24T14:00:00Z');
const D = (text: string, dest = 'Japan') => parseDetails(text, NOW, dest);

test('DEMO step 20 answers', () => {
  assert.deepEqual(D('boston, late march for cherry blossoms, 10 nights'), { origin: 'Boston', month: 3, part: 'late', nights: 10, interests: [] });
  assert.deepEqual(D('5 of us, ~$3,000 each all in'), { travelers: 5, budgetPerPersonUsd: 3000, interests: [] });
  const m = D('food, temples, one onsen night');
  assert.deepEqual(m, { interests: ['food', 'temples', 'onsen'] }, '"one onsen night" is an interest, not the trip length');
  assert.equal(detailCount(m), 3);
});

test('lengths, group sizes, budgets, timing', () => {
  assert.equal(D('two weeks in october').nights, 14);
  assert.equal(D('two weeks in october').month, 10);
  assert.equal(D('10 days').nights, 9);
  assert.equal(D('a week and a half').nights, 10);
  assert.equal(D('ten nights').nights, 10);
  assert.equal(D('in two weeks we fly').nights, undefined, '"in two weeks" is when, not how long');
  assert.equal(D("we're 6").travelers, 6);
  assert.equal(D('me and 3 friends').travelers, 4);
  assert.equal(D('party of five').travelers, 5);
  assert.equal(D('3k pp').budgetPerPersonUsd, 3000);
  assert.equal(D('budget is around $2,500').budgetPerPersonUsd, 2500);
  assert.equal(D('$12k total for the group').budgetTotalUsd, 12000);
  assert.deepEqual([D('mid-may').month, D('mid-may').part], [5, 'mid']);
  assert.deepEqual([D('early april 2031').month, D('early april 2031').part, D('early april 2031').year], [4, 'early', 2031]);
  assert.deepEqual([D('spring').season, D('spring').month], ['spring', 4]);
  assert.equal(D('next year').year, 2027);
  assert.equal(D('flying out of SFO').origin, 'San Francisco');
  assert.equal(D('BOS').origin, 'Boston');
});

test('chatter never reads as a trip answer', () => {
  for (const s of [
    'the food was great',
    'we may go to the beach',
    'jan is coming too',
    "charlotte can't make it",
    "I'm MAD lol",
    'see you at 7',
    'fri works, i\'m busy thu and sat',
    'lol same',
    'owe you $20',
    'that was a long night',
  ]) {
    assert.equal(detailCount(D(s)), 0, s);
  }
});

test('the destination city never reads as the origin', () => {
  assert.equal(parseDetails('london in june, 5 nights', NOW, 'the UK').origin, undefined);
  assert.equal(parseDetails('from boston to london', NOW, 'the UK').origin, 'Boston');
});

test('triggers', () => {
  assert.equal(parseTrigger("let's plan Japan for 2030")?.destination?.name, 'Japan');
  assert.equal(parseTrigger('plan a trip to Lisbon next year')?.destination?.name, 'Portugal');
  assert.deepEqual(parseTrigger('trip to Fooland in 2030')?.destination, { name: 'Fooland', key: 'world' });
  assert.deepEqual(parseTrigger('can you plan a trip'), { destination: undefined });
  assert.equal(parseTrigger('trip to somewhere warm')?.destination, undefined);
  assert.equal(parseTrigger("trip to sam's place")?.destination, undefined);
  assert.equal(parseTrigger("let's go to Japan in 2030")?.destination?.name, 'Japan');
  for (const s of ['dinner next week?', 'plan dinner next week', "let's go to Japan", 'go', 'plan something fun']) assert.equal(parseTrigger(s), null, s);
});

test('tier choice and trip commands', () => {
  assert.equal(parseChoice('comfortable please'), 'comfort');
  assert.equal(parseChoice("let's do comfort"), 'comfort');
  assert.equal(parseChoice('budget is fine'), 'budget');
  assert.equal(parseChoice("budget's fine"), 'budget');
  assert.equal(parseChoice('the cheaper one'), 'budget');
  for (const s of ['my budget is $3000', 'the budget was tight last time', 'comfortable shoes are key', 'is it comfortable']) assert.equal(parseChoice(s), null, s);
  assert.equal(parseTripCommand('forget the trip'), 'forget');
  assert.equal(parseTripCommand('delete the japan trip'), 'forget');
  assert.equal(parseTripCommand('trip'), 'show');
  assert.equal(parseTripCommand("what's the trip?"), 'show');
  assert.equal(parseTripCommand('forget'), null, 'plain "forget" is the plan command');
  assert.equal(parseTripCommand('go'), 'go');
});
