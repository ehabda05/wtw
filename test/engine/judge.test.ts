// Free-form phrasings from judge-style tests of the live demo: availability with filler and preference words,
// "any day but X", the status family, help, reminders and "<cuisine> instead". Precision guards ride along:
// chatter that merely mentions a day or food must stay silent.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES as T, parseAvailability, parseCommand } from '../../src/engine/index.js';
import { countSentences } from '../../src/engine/templates.js';
import type { Option, Vote } from '../../src/engine/types.js';
import { atLocal, optionLabel } from '../../src/engine/util.js';
import { Harness, TZ, fakePlaces, joined, ofType } from './helpers.js';

// Options as posted for "dinner next week?" on Sat Oct 17 2026: Thu 22, Fri 23, Sat 24 at 7pm.
const DAYS = ['2026-10-22', '2026-10-23', '2026-10-24'];
const OPTS: Option[] = DAYS.map((d, i) => ({ id: i + 1, day: d, time: '19:00', startsAt: atLocal(d, '19:00', TZ), label: optionLabel(d, '19:00') }));
const NOW = Date.parse('2026-10-17T10:00:00-04:00');
const START = '2026-10-17T10:00:00-04:00';

/** "thu fri sat" votes as the tally would see them ('-' = unknown) plus whether an unaddressed message counts. */
function read(text: string): string {
  const p = parseAvailability(text, OPTS, TZ, { now: NOW });
  const v = (o: Option): Vote | '-' => p.optionVotes[o.id] ?? p.dayPrefs[o.day]?.vote ?? '-';
  return `${OPTS.map(v).join(' ')}${p.voteLike ? '' : ' (ignored)'}`;
}

function planned(): Harness {
  const h = new Harness({ start: START });
  h.state.space.introSent = true;
  h.say('ana', '@homi dinner next week?');
  return h;
}

test('"any day but X" family: an exclusion that was never proposed means every proposed option', () => {
  const cases: Array<[string, string]> = [
    ['honestly any day but monday works for me', 'yes yes yes'],
    ['every day but monday', 'yes yes yes'],
    ['any night but thu', 'no yes yes'],
    ['all but sat', 'yes yes no'],
    ['anything works except fri', 'yes no yes'],
    ['not monday but anything else works', 'yes yes yes'],
    ['not thu but anything else works', 'no yes yes'],
    ["i'm free pretty much whenever except wednesday", 'yes yes yes'],
    ['basically free whenever except thu', 'no yes yes'],
    ['any day except the weekend', 'yes yes no'],
    ["i can't do any day but sat", 'no no yes'],
    ['whenever works', 'yes yes yes'],
    ['anytime honestly', 'yes yes yes'],
  ];
  for (const [t, want] of cases) assert.equal(read(t), want, t);
});

test('preference words and filler: "weekend is better for me tbh" is a Sat yes, weekdays stay unknown', () => {
  const cases: Array<[string, string]> = [
    ['weekend is better for me tbh', '- - yes'],
    ['fri is better for me ngl', '- yes -'],
    ['i prefer sat', '- - yes'],
    ['preferably fri', '- yes -'],
    ['sat would be ideal', '- - yes'],
    ['fri works best', '- yes -'],
    ['i could do thu', 'yes - -'],
    ['i can make sat lol', '- - yes'],
    ['im free fri honestly', '- yes -'],
    ['sat is better than fri', '- - yes'],
    ['lowkey thu works', 'yes - -'],
  ];
  for (const [t, want] of cases) assert.equal(read(t), want, t);
});

test('precision: past-tense chatter, food talk and filler-only messages are not votes', () => {
  for (const t of ['lol fri was wild', 'fri was better than i expected', 'the best part of fri was the pizza', 'ok see u all fri 🍻'])
    assert.match(read(t), /\(ignored\)$/, t);
  for (const t of ['anything but that lol', "i'd eat anything but sushi", 'lol same', 'lol']) assert.equal(read(t), '- - - (ignored)', t);
});

test('unaddressed in a live plan: "any day but monday" and "weekend is better" are counted, chatter is not', () => {
  const h = planned();
  assert.ok(ofType(h.say('ben', 'honestly any day but monday works for me'), 'react').length === 1);
  const ben = h.plan!.members['k-ben'];
  assert.deepEqual(Object.values(ben.dayPrefs).map((d) => d.vote), ['yes', 'yes', 'yes']);
  h.say('jo', 'weekend is better for me tbh');
  assert.deepEqual(h.plan!.members['k-jo'].dayPrefs, { '2026-10-24': { vote: 'yes' } });
  h.say('sam', 'lol fri was wild');
  assert.equal(h.plan!.members['k-sam']?.status ?? 'pending', 'pending');
});

test('whenever-except with Sun-only options: every Sunday slot is a yes', () => {
  const h = new Harness({ start: START });
  h.state.space.introSent = true;
  h.say('ana', '@homi brunch sunday?');
  assert.ok(h.plan!.options.every((o) => o.day === '2026-10-18'));
  h.say('ben', "i'm free pretty much whenever except wednesday");
  assert.deepEqual(h.plan!.members['k-ben'].dayPrefs, { '2026-10-18': { vote: 'yes' } });
});

test('status family: tally, winner, pending and "where are we at with this" all show the status card', () => {
  const asks = [
    'which day is winning', "who's winning", "what's the tally", 'which day are we leaning', "how's the vote looking", 'whats the status',
    'status update', 'any updates?', 'progress?', 'summary', "what's the latest", 'where are we at with this', 'where are we on this',
    'where do we stand', 'who hasnt answered', "who hasn't voted", "who's missing", 'who are we waiting on', 'who still needs to vote',
    'how many votes so far', 'remind me what the plan is',
  ];
  for (const t of asks) assert.equal(parseCommand(t)?.kind, 'status', t);
  const h = planned();
  h.say('ben', 'fri works');
  const card = joined(h.say('sam', 'homi which day is winning'));
  assert.match(card, /^Dinner, next week: Fri leads with 1 yes/);
  for (const t of ['homi whats the status', 'homi who hasnt answered', 'homi where are we at with this', "homi what's the tally"])
    assert.equal(joined(h.say('sam', t)), card, t);
  assert.doesNotMatch(card, /which ones could work/);
});

test('notes still answer only notes; "status of X" falls back to the card', () => {
  const h = planned();
  h.say('ben', 'homi note parking: behind the building');
  assert.equal(joined(h.say('jo', "homi what's the note on parking")), 'Parking: behind the building.');
  assert.equal(joined(h.say('jo', 'homi what did we decide about parking')), 'Parking: behind the building.');
  assert.match(joined(h.say('jo', "homi what's the status of the reservation")), /^Dinner, next week:/);
});

test('help lists every feature in at most two sentences', () => {
  for (const t of ['help', 'what can you do', 'what else can you do', 'how does this work', 'who are you', 'commands']) assert.equal(parseCommand(t)?.kind, 'help', t);
  const h = new Harness({ start: START });
  h.state.space.introSent = true;
  const help = joined(h.say('maya', 'homi what can you do'));
  assert.equal(help, T.help());
  for (const w of ['find a date', 'pick food', 'split bills', 'show-up pledge', 'simulated', 'album', 'trips', 'what do you know']) assert.ok(help.includes(w), w);
  assert.ok(countSentences(help) <= 2);
});

test('reminders: "remind me before dinner" and friends map to the remind command', () => {
  for (const t of ['remind me before dinner', 'remind us', 'reminder please', 'set a reminder', 'can you remind everyone', 'remind me 30 min before'])
    assert.equal(parseCommand(t)?.kind, 'remind', t);
  assert.equal(parseCommand('remind me to bring cash'), null);
  const h = planned();
  assert.equal(joined(h.say('ana', 'homi remind me before dinner')), T.remindNoTime());
  h.say('ben', 'fri works');
  h.say('ana', 'fri works');
  h.say('ana', "homi we're going to Tasty Thai");
  assert.equal(h.plan!.state, 'confirmed');
  assert.equal(joined(h.say('maya', 'homi set a reminder')), T.remindSet());
  assert.equal(h.plan!.remindReq30, true);
});

/** Dinner locked Fri with Tasty Thai picked through the food flow near Harvard Square. */
function withPlace(): Harness {
  const h = planned();
  h.say('ben', 'fri works');
  h.say('ana', 'fri works');
  h.say('maya', 'homi find food');
  h.say('ana', 'thai sounds amazing');
  h.say('jo', 'homi go, harvard square');
  h.places(fakePlaces());
  h.say('jo', '1');
  h.say('ana', '1');
  assert.equal(h.plan!.state, 'confirmed');
  return h;
}

test('"homi lets do sushi instead" after a place is set: a new search for that cuisine, right away', () => {
  assert.deepEqual(parseCommand('lets do sushi instead'), { kind: 'change_place', cuisines: ['sushi'] });
  assert.equal(parseCommand('how about pizza instead?')?.kind, 'change_place');
  assert.equal(parseCommand('can we do something else instead'), null);
  const h = withPlace();
  assert.deepEqual(h.say('ben', 'sushi instead lol', { addressed: false }), []);
  const out = h.say('maya', 'homi lets do sushi instead');
  assert.equal(h.plan!.state, 'collecting_place');
  assert.deepEqual(ofType(out, 'lookup_places')[0].query.cuisines, ['sushi', 'japanese']);
  assert.deepEqual(h.plan!.hungry!.cuisineVotes, { sushi: 1 });
  // A typed place has no known area: ask the food question instead.
  const g = planned();
  g.say('ben', 'fri works');
  g.say('ana', 'fri works');
  g.say('ana', "homi we're going to Tasty Thai");
  assert.equal(joined(g.say('maya', 'homi lets do pizza instead')), T.foodAsk({ where: true }));
  // During an open food question it is just an answer.
  assert.deepEqual(g.say('jo', 'homi lets do sushi instead').filter((a) => a.type === 'send'), []);
});

test('money words veto food: a bill question never starts the food flow', () => {
  for (const pre of [null, 'avail']) {
    const h = pre ? planned() : new Harness({ start: START });
    h.state.space.introSent = true;
    const out = joined(h.say('sam', 'homi how much does everyone owe for dinner, it was 120 with tip'));
    assert.notEqual(h.plan?.state, 'collecting_place');
    assert.doesNotMatch(out, /What are we feeling/);
  }
  const h = planned();
  for (const t of ['we spent 84 on pizza lol', 'who paid for the pizza last time', 'pizza was $40, venmo me'])
    assert.deepEqual(h.say('jo', t), [], t);
  assert.equal(h.plan!.state, 'collecting_availability');
});

test('food answers get a 👍, and one answer with food + budget + area searches right away', () => {
  const h = planned();
  h.say('ben', 'fri works');
  h.say('ana', 'fri works');
  h.say('maya', 'homi find food');
  const one = h.say('ana', 'ramen sounds amazing');
  assert.equal(ofType(one, 'react').length, 1);
  assert.equal(ofType(one, 'lookup_places').length, 0);
  const all = h.say('jo', 'something spicy and not too expensive near central square');
  assert.equal(ofType(all, 'lookup_places').length, 1);
  const q = ofType(all, 'lookup_places')[0].query;
  assert.ok(q.cuisines.includes('thai'));
});

test('taste: "not too expensive" is mid-range, "spicy" maps to spicy cuisines, "not too spicy" does not', async () => {
  const { parseTaste } = await import('../../src/engine/hungry.js');
  assert.equal(parseTaste('not too expensive pls').price, 2);
  assert.equal(parseTaste("something that won't break the bank").price, 2);
  assert.deepEqual(parseTaste('something spicy').cuisines, ['thai', 'indian', 'korean']);
  assert.deepEqual(parseTaste('nothing too spicy').cuisines, []);
  assert.deepEqual(parseTaste('spicy but no indian').cuisines, ['thai', 'korean']);
  assert.deepEqual(parseTaste('spicy ramen').cuisines.includes('thai'), false);
});

test('status card says "tied" when the top options have the same yes count', () => {
  const h = planned();
  h.say('ben', 'thu or fri');
  h.say('jo', 'fri or sat');
  h.say('maya', 'thu or sat');
  assert.match(joined(h.say('ana', 'homi which day is winning')), /^Dinner, next week: Thu, Fri and Sat are tied at 2 yes/);
});
