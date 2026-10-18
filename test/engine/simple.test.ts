// DEMO_SIMPLE=on (Ctx.simple): one flow. A hangout with a date; the lock asks one cuisine question; the answers pick
// one of the 15 curated cuisines (Mexican when nobody says); three Boston spots; the group votes; everything else
// is off with a one-line pointer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CURATED, CURATED_KEYS, CURATED_LABEL, curatedKeyOf, pickCuratedKey } from '../../src/engine/curated.js';
import { Harness, joined, ofType } from './helpers.js';

const START = '2026-10-17T10:00:00-04:00';
const Q = { dmAfterMs: 30_000, replyMs: 15_000, minYes: 2 };

function group(quorum?: typeof Q) {
  const h = new Harness({ start: START, surface: 'telegram', simple: true, quorum });
  h.apply({ kind: 'headcount', n: 2 });
  return h;
}

/** Start "dinner friday 7pm", both vote yes: locked, and the cuisine question is out. */
function locked(h: Harness) {
  h.say('riad', 'homi dinner friday 7pm');
  h.react('riad', '❤️', 'option:1');
  return h.react('charlie', '❤️', 'option:1');
}

const picks = (actions: ReturnType<Harness['say']>) => ofType(actions, 'send').filter((s) => s.tag?.startsWith('place:'));

test('curated table: 15 cuisines, 3 spots each, ids 1..3, a maps link and a neighborhood on every spot', () => {
  assert.equal(CURATED_KEYS.length, 15);
  for (const key of CURATED_KEYS) {
    const list = CURATED[key];
    assert.equal(list.length, 3, key);
    assert.deepEqual(list.map((p) => p.id), [1, 2, 3], key);
    for (const p of list) {
      assert.ok(p.name && p.hood && p.address && p.mapsUrl?.startsWith('https://maps.apple.com/'), `${key}: ${p.name}`);
      assert.equal(p.cuisine, key);
    }
    assert.ok(CURATED_LABEL[key]);
  }
  // Engine tags -> curated keys; dishes land on their cuisine; unknown tags on nothing; no votes -> Mexican.
  assert.equal(curatedKeyOf('ramen'), 'japanese');
  assert.equal(curatedKeyOf('burger'), 'american');
  assert.equal(curatedKeyOf('falafel'), 'middle_eastern');
  assert.equal(curatedKeyOf('dessert'), undefined);
  assert.equal(pickCuratedKey([['dessert', 2], ['thai', 1]]), 'thai');
  assert.equal(pickCuratedKey([]), 'mexican');
});

test('simple: the lock asks one question, no "Where to"; when everyone has answered the top cuisine wins', () => {
  const h = group();
  const lock = locked(h);
  const texts = ofType(lock, 'send').map((s) => s.text);
  assert.ok(texts.some((t) => /Fri Oct 23 · 7pm it is: 2 in\.$/.test(t)), texts.join(' | '));
  assert.ok(!texts.some((t) => /Where to/.test(t)));
  assert.ok(texts.includes('What are we feeling? Tacos, sushi, pizza, Thai, anything; or say "surprise us".'));
  assert.equal(h.plan!.state, 'collecting_place');
  assert.equal(h.plan!.hungry?.phase, 'asking');
  // One answer: acknowledged, but Homi waits for the second person (no neighborhood question either).
  const first = h.say('riad', 'thai');
  assert.ok(first.some((a) => a.type === 'react'));
  assert.equal(picks(first).length, 0);
  assert.ok(!joined(first).includes('Which neighborhood'));
  const second = h.say('charlie', 'pad thai sounds great');
  assert.equal(ofType(second, 'send').find((s) => s.tag === 'place:header')!.text, 'Thai in Boston, here are 3. Tap ❤️ on your pick (or reply 1, 2 or 3).');
  assert.deepEqual(picks(second).map((s) => s.tag), ['place:header', 'place:1', 'place:2', 'place:3']);
  assert.equal(ofType(second, 'send').find((s) => s.tag === 'place:1')!.text, '1 · 9 Tastes · Harvard Square · $');
  // Majority picks #2: locked with the address and the maps link.
  h.say('riad', '2');
  const done = h.say('charlie', '2');
  assert.match(joined(done), /Dakzen it is: 195 Elm Street, Somerville https:\/\/maps\.apple\.com/);
  assert.equal(h.plan!.state, 'confirmed');
  assert.equal(h.plan!.place?.name, 'Dakzen');
});

test('simple: "surprise us" / "homi go" skips the wait and Mexican is the default; a split vote goes to the first named', () => {
  const h = group();
  locked(h);
  const out = h.say('riad', 'homi go');
  assert.equal(ofType(out, 'send').find((s) => s.tag === 'place:header')!.text.split(' in Boston')[0], 'Mexican');

  const g = group();
  locked(g);
  g.say('riad', 'sushi');
  const out2 = g.say('charlie', 'id rather do pizza but whatever you pick');
  assert.equal(ofType(out2, 'send').find((s) => s.tag === 'place:header')!.text.split(' in Boston')[0], 'Japanese');
});

test('simple + quorum: the cuisine question closes on the demo timer with whatever was said', () => {
  const h = group(Q);
  locked(h);
  h.say('riad', 'korean');
  const out = h.advance(30_000);
  assert.equal(ofType(out, 'send').find((s) => s.tag === 'place:header')!.text.split(' in Boston')[0], 'Korean');
  assert.equal(ofType(out, 'send').find((s) => s.tag === 'place:1')!.text, '1 · Koreana · Central Square · $$');
});

test('simple: bills, notes and the food questionnaire are off; "find food" before the lock says day first', () => {
  const h = group();
  assert.match(joined(h.say('riad', 'homi split 84 3 ways')), /\$84\.00 split 3 ways: \$28\.00 each\./);
  assert.match(joined(h.say('riad', 'homi note parking: behind the building')), /In this demo I only plan the hangout, the spot and the bill/);
  assert.match(joined(h.say('riad', 'homi where should we eat')), /Roughly when/);
  assert.equal(h.plan!.state, 'collecting_dates');
  h.say('riad', 'friday 7pm');
  assert.match(joined(h.say('riad', 'homi find food')), /Let's lock the day first/);
  assert.equal(h.plan!.state, 'collecting_availability');
  assert.match(joined(h.say('riad', 'homi help')), /everyone votes, I lock it, ask what we're feeling and post 3 spots/);
  assert.match(joined(h.say('riad', 'homi what do you know')), /plan "dinner"/);
  assert.match(joined(h.say('riad', 'homi forget')), /deleted this plan/);
});

test('simple: a place given up front skips the question; "homi find food" after the lock asks again', () => {
  const h = group();
  h.say('riad', 'homi dinner friday 7pm at halal guys');
  h.react('riad', '❤️', 'option:1');
  const lock = h.react('charlie', '❤️', 'option:1');
  assert.ok(!joined(lock).includes('What are we feeling'));
  assert.equal(h.plan!.state, 'confirmed');
  const again = h.say('riad', 'homi find food');
  assert.ok(joined(again).includes('What are we feeling'));
  const out = h.say('riad', 'homi go');
  assert.ok(ofType(out, 'send').some((s) => s.tag === 'place:header'));
});

test('simple + quorum: the header and status say "once everyone answers", never a clock time; unaddressed answers count', () => {
  const h = group(Q);
  const out = h.say('riad', 'homi dinner friday 7pm');
  const header = ofType(out, 'send').find((s) => s.tag === 'header')!.text;
  assert.match(header, /I'll lock it in once everyone answers\.$/);
  assert.match(joined(h.say('riad', 'homi where are we at')), /once everyone answers/);
  const vote = h.say('charlie', 'yeah 1 works for me');
  assert.ok(vote.some((a) => a.type === 'react'), 'the answer was acknowledged');
  assert.equal(h.plan!.members['k-charlie'].optionVotes[1], 'yes');
});

test('deliberation: a 1-1 split gets the tally nudge, no picks; the latest answer replaces the earlier one', () => {
  const h = group();
  locked(h);
  h.say('riad', 'thai');
  const split = h.say('charlie', 'sushi for me');
  assert.equal(picks(split).length, 0, 'no majority, no picks');
  assert.match(joined(split), /No majority yet: Thai 1 · Japanese 1\. Need 2 of 2 on one; say the one you'd switch to, or "surprise us"\./);
  // Repeating the same split does not repeat the nudge.
  const again = h.say('charlie', 'still sushi');
  assert.ok(!joined(again).includes('No majority'));
  // Charlie switches: majority of 2, Thai picks.
  const done = h.say('charlie', 'ok fine, thai then');
  assert.equal(ofType(done, 'send').find((s) => s.tag === 'place:header')!.text.split(' in Boston')[0], 'Thai');
});

test('deliberation: a majority of the group decides without waiting for everyone (2 of 3)', () => {
  const h = new Harness({ start: START, surface: 'telegram', simple: true });
  h.apply({ kind: 'headcount', n: 3 });
  h.say('riad', 'homi dinner friday 7pm');
  h.react('riad', '❤️', 'option:1');
  h.react('charlie', '❤️', 'option:1');
  const lock = h.react('sam', '❤️', 'option:1');
  assert.ok(joined(lock).includes('What are we feeling'));
  h.say('riad', 'korean');
  const out = h.say('charlie', 'korean works');
  assert.equal(ofType(out, 'send').find((s) => s.tag === 'place:header')!.text.split(' in Boston')[0], 'Korean');
});

test('deliberation + timer: a split extends the window up to three times with the nudge, then the top cuisine goes', () => {
  const h = group(Q);
  locked(h);
  h.say('riad', 'thai');
  h.say('charlie', 'pizza');
  for (let i = 1; i <= 3; i++) {
    const ext = h.advance(30_000);
    assert.equal(picks(ext).length, 0, `extension ${i} still deliberating`);
    assert.match(joined(ext), /No majority yet: Thai 1 · Pizza 1/);
  }
  const done = h.advance(30_000);
  assert.equal(ofType(done, 'send').find((s) => s.tag === 'place:header')!.text.split(' in Boston')[0], 'Thai');
});
