// Conversational bills: "we spent 84 on pizza, split it between ana ben and me", owe questions, word numbers,
// "between us" = the plan members, and the "who's me" question. Precision: money talk without a split stays null.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBills } from '../../src/engine/ext/bills/parse.js';
import { foodScore } from '../../src/engine/hungry.js';
import { countSentences } from '../../src/engine/templates.js';
import { Harness, joined } from '../engine/helpers.js';

/** Compact view of a parse: kind, cents, ways, names, payer, label, everyone. */
function view(s: string): string {
  const c = parseBills(s);
  if (!c) return 'null';
  if (c.kind === 'help') return `help:${c.why}`;
  if (c.kind !== 'equal') return c.kind;
  const bits = [`${c.base}`, c.ways !== undefined ? `${c.ways}w` : '', c.names.join('+'), c.payer ? `by:${c.payer}` : '', c.label ? `for:${c.label}` : '', c.everyone ? 'everyone' : ''];
  return bits.filter(Boolean).join(' ');
}

test('conversational bills read into the split grammar', () => {
  const cases: Array<[string, string]> = [
    ['how much does everyone owe for dinner, it was 120 with tip', '12000 for:dinner everyone'],
    ['we spent 84 on pizza, split it between ana ben and me', '8400 3w ana+ben+me for:pizza'],
    ['ben spent 60 on dinner, split it between ana ben and jo', '6000 3w ana+ben+jo by:ben for:dinner'],
    ['i spent 40 on gas, split it with ana', '4000 2w ana+me by:i for:gas'],
    ['it was 96.50, split it four ways', '9650 4w'],
    ['split it 4 ways, it was 96.50', '9650 4w'],
    ['split it between ana and ben, it was 84 for pizza', '8400 2w ana+ben for:pizza'],
    ['dinner came to 96.50, split it 3 ways', '9650 3w for:dinner'],
    ['ben paid for dinner, it was 84, split it 3 ways', '8400 3w by:ben for:dinner'],
    ['dinner was 84, ben paid, split it 3 ways', '8400 3w by:ben for:dinner'],
    ['paid 84 for pizza, split 3 ways', '8400 3w by:i for:pizza'],
    ['how much do i owe ben for dinner, it was 120', '12000 by:ben for:dinner everyone'],
    ['the bill was $96.50, how much each', '9650 everyone'],
    ['can you split 84 between us', '8400 everyone'],
    ['split 90 between the group', '9000 everyone'],
    ['split 84 evenly', '8400'],
  ];
  for (const [s, want] of cases) assert.equal(view(s), want, s);
});

test('word numbers and halves: "four ways", "in half", "the five of us", "divide 80 by 4"', () => {
  const cases: Array<[string, string]> = [
    ['split 96.50 four ways', '9650 4w'],
    ['split the 84 three ways', '8400 3w'],
    ['split 120 between the five of us', '12000 5w'],
    ['divide 80 by 4', '8000 4w'],
    ['split 84 in half', '8400 2w'],
    ['split it in half, it was 50', '5000 2w'],
    ['split 100 three ways plus 20% tip', '10000 3w'],
  ];
  for (const [s, want] of cases) assert.equal(view(s), want, s);
  assert.equal(view('split it four ways'), view('split it 4 ways')); // no amount: the same help as before
});

test('precision: money talk without a split, and non-bills, stay out of bills', () => {
  for (const s of ['we paid 40 for gas', 'ben got 2 tickets', 'splitting headache lol', 'we spent so long there', 'i owe you one']) assert.equal(view(s), 'null', s);
  for (const s of ['we each owe ben 20', 'venmo ben 20']) assert.equal(view(s), 'help:split', s);
  assert.equal(view('how much does everyone owe'), 'settle');
  assert.equal(view('jo paid 23.40 for the uber, split ana jo you'), '2340 3w ana+jo+you by:jo for:uber'); // DEMO step 12
  // Money words veto food intent; budgets and food plans do not.
  for (const s of ['how much does everyone owe for dinner, it was 120 with tip', 'we spent 84 on pizza', 'anyone hungry? i can pay'])
    assert.equal(foodScore(s).money, true, s);
  for (const s of ['wanna split a pizza', 'where should we eat, under $20', 'where should we eat, $15 max', 'grab food? i have $20'])
    assert.equal(foodScore(s).money, false, s);
});

function harness(): Harness {
  const h = new Harness({ start: '2026-10-23T19:30:00-04:00' });
  h.state.space.introSent = true;
  return h;
}

test('through the engine: everyone = plan members still in; no plan asks how many ways', () => {
  const none = harness();
  assert.match(joined(none.say('sam', 'homi how much does everyone owe for dinner, it was 120 with tip')), /^How many ways\?/);
  const h = harness();
  h.say('ana', '@homi dinner tonight?');
  for (const who of ['ben', 'jo', 'maya']) h.say(who, "I'm in");
  h.say('maya', "I'm out");
  // ana, ben, jo and sam are on the plan; maya is out.
  assert.equal(joined(h.say('sam', 'homi how much does everyone owe for dinner, it was 120 with tip')), 'Dinner $120.00 split 4 ways: $30.00 each.');
  assert.equal(joined(h.say('ben', 'homi can you split 84 between us')), '$84.00 split 4 ways: $21.00 each.');
  assert.equal(joined(h.say('ben', 'homi split 96.50 four ways')), '$96.50 split 4 ways: 2 pay $24.13, 2 pay $24.12.');
});

test('"me" is the sender\'s known name; with a plan open Homi asks "Who\'s me?" once', () => {
  const h = harness();
  h.say('ana', '@homi dinner tonight?');
  const ask = joined(h.say('maya', 'homi we spent 84 on pizza, split it between ana ben and me'));
  assert.equal(ask, `Who's "me"? Say "homi I'm <name>".`);
  assert.ok(countSentences(ask) <= 2);
  h.say('maya', "homi I'm Maya");
  assert.equal(
    joined(h.say('maya', 'homi we spent 84 on pizza, split it between ana ben and me')),
    'Pizza $84.00 split between Ana, Ben and Maya: $28.00 each. Say who paid ("paid by ana") to put it on the tab.',
  );
  assert.equal(joined(h.say('maya', 'homi i spent 40 on gas, split it with ana')), 'Gas $40.00 paid by Maya: $20.00 each for Ana and Maya.');
  assert.equal(joined(h.say('jo', 'homi ben paid 60 for dinner, split it between ana ben and jo')), 'Dinner $60.00 paid by Ben: $20.00 each for Ana, Ben and Jo.');
  assert.equal(h.state.space.ext?.bills ? (h.state.space.ext.bills as { expenses: unknown[] }).expenses.length : 0, 2);
});
