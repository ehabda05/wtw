import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectAddressed, emojiVote, parseAvailability, parseCommand, parseWindow, stripAddress } from '../../src/engine/index.js';
import type { Option, Vote } from '../../src/engine/types.js';
import { atLocal, optionLabel } from '../../src/engine/util.js';
import { TZ } from './helpers.js';

// Options as posted for "dinner next week?" on Sat Oct 17 2026: Thu 22, Fri 23, Sat 24 at 7pm.
const DAYS = ['2026-10-22', '2026-10-23', '2026-10-24'];
const OPTS: Option[] = DAYS.map((d, i) => ({ id: i + 1, day: d, time: '19:00', startsAt: atLocal(d, '19:00', TZ), label: optionLabel(d, '19:00') }));
const NOW = Date.parse('2026-10-17T10:00:00-04:00');
const WD: Record<string, string> = { '2026-10-22': 'thu', '2026-10-23': 'fri', '2026-10-24': 'sat' };

/** Reads a reply into {thu, fri, sat} the way the tally would see it (explicit option vote, else day pref). */
function read(text: string, addressed = false): Record<string, Vote | 'unknown'> & { _low?: boolean; _like?: boolean } {
  const p = parseAvailability(text, OPTS, TZ, { now: NOW, addressed });
  const out: Record<string, Vote | 'unknown'> & { _low?: boolean; _like?: boolean } = {};
  for (const o of OPTS) out[WD[o.day]] = p.optionVotes[o.id] ?? p.dayPrefs[o.day]?.vote ?? 'unknown';
  out._low = p.lowConfidence;
  out._like = p.voteLike;
  return out;
}

const v = (x: ReturnType<typeof read>) => ({ thu: x.thu, fri: x.fri, sat: x.sat });

test('detectAddressed: leading otto, @otto, hey otto, /commands, "otto," and "otto?"', () => {
  for (const t of ['otto dinner next week?', '@otto where should we eat', 'hey otto, lock fri', 'Otto: status', '/plan', 'ok otto, go', 'what do you think otto?', 'OTTO STOP'])
    assert.equal(detectAddressed(t), true, t);
  for (const t of ['dinner next week?', "otto's plan was fine", 'lotto tickets', 'i love ottoman empire history'])
    assert.equal(detectAddressed(t), false, t);
});

test('stripAddress keeps case and removes the address', () => {
  assert.equal(stripAddress("hey otto, I'm Sam"), "I'm Sam");
  assert.equal(stripAddress('@otto dinner next week?'), 'dinner next week?');
  assert.equal(stripAddress('/plan@OttoBot dinner'), '/plan dinner');
  assert.equal(stripAddress('what do you know otto?'), 'what do you know?');
});

test('DATE_FINDING §3 grammar: the documented cases', () => {
  assert.deepEqual(v(read('fri or sat works')), { thu: 'unknown', fri: 'yes', sat: 'yes' });
  assert.deepEqual(v(read('not thu, fri works')), { thu: 'no', fri: 'yes', sat: 'unknown' });
  assert.deepEqual(v(read('anything but sat')), { thu: 'yes', fri: 'yes', sat: 'no' });
  assert.deepEqual(v(read('either')), { thu: 'yes', fri: 'yes', sat: 'yes' });
  assert.deepEqual(v(read('none')), { thu: 'no', fri: 'no', sat: 'no' });
  assert.deepEqual(v(read('1 3')), { thu: 'yes', fri: 'unknown', sat: 'yes' });
  assert.deepEqual(v(read('1, 3')), { thu: 'yes', fri: 'unknown', sat: 'yes' });
  assert.deepEqual(v(read('sat works, sun maybe')), { thu: 'unknown', fri: 'unknown', sat: 'yes' });
  assert.deepEqual(v(read('thu? maybe fri')), { thu: 'maybe', fri: 'maybe', sat: 'unknown' });
  assert.deepEqual(v(read('thurs?')), { thu: 'maybe', fri: 'unknown', sat: 'unknown' });
  assert.deepEqual(v(read("thu's bad for me then, fri prob")), { thu: 'no', fri: 'maybe', sat: 'unknown' });
  assert.deepEqual(v(read('the 23rd or 24th works for me')), { thu: 'unknown', fri: 'yes', sat: 'yes' });
  assert.deepEqual(v(read('the second one works, sat i might have a thing')), { thu: 'unknown', fri: 'yes', sat: 'maybe' });
  assert.deepEqual(v(read("can't do thu but fri works")), { thu: 'no', fri: 'yes', sat: 'unknown' });
  assert.deepEqual(v(read('weekend works for me')), { thu: 'unknown', fri: 'unknown', sat: 'yes' });
  assert.deepEqual(v(read("i'm out this time 😭")), { thu: 'no', fri: 'no', sat: 'no' });
});

test('time constraints: "fri but after 8:30" is a Fri day-pref with a window (maybe for the 7pm option)', () => {
  const p = parseAvailability('fri but after 8:30', OPTS, TZ, { now: NOW });
  assert.deepEqual(p.dayPrefs['2026-10-23'], { vote: 'yes', notBefore: '20:30' });
  assert.deepEqual(p.slots, [{ day: '2026-10-23', time: '20:30', vote: 'yes' }]);
  assert.equal(p.voteLike, true);
  const b = parseAvailability('sat brunch works', OPTS, TZ, { now: NOW });
  assert.deepEqual(b.dayPrefs['2026-10-24'], { vote: 'yes', notBefore: '10:00', notAfter: '13:00' });
  assert.equal(b.slots[0].time, '11:00');
});

test('bare "I\'m in" / "down" = all yes, low confidence; bare "yes" only when addressed', () => {
  const a = read("I'm in");
  assert.deepEqual(v(a), { thu: 'yes', fri: 'yes', sat: 'yes' });
  assert.equal(a._low, true);
  assert.equal(read('down 🫡')._low, true);
  assert.deepEqual(v(read('yes')), { thu: 'unknown', fri: 'unknown', sat: 'unknown' });
  assert.deepEqual(v(read('yes', true)), { thu: 'yes', fri: 'yes', sat: 'yes' });
});

test('rule 6: "lol fri was wild" has a reference but no cue, so it is not vote-like', () => {
  assert.equal(read('lol fri was wild')._like, false);
  assert.equal(read('the last fri at the pub was insane 💀')._like, false);
  assert.equal(read('ok see u all fri 🍻')._like, false);
  assert.equal(read('wait is thu the night of the midterm')._like, false);
  assert.equal(read('fri!!')._like, true);
  assert.equal(read('fri works')._like, true);
});

test('numbers that are not votes: phone numbers, prices, times', () => {
  assert.deepEqual(v(read('fri or sat, if anyone wants to carpool my number is 617-555-0101')), { thu: 'unknown', fri: 'yes', sat: 'yes' });
  assert.equal(read('text me +1 617 555 0129 if you lose your id')._like, false);
  assert.equal(read('meet at 7 lol')._like, false);
});

test('inline reply to an option bubble is a yes for it unless the text says otherwise', () => {
  assert.deepEqual(parseAvailability('works for me', OPTS, TZ, { now: NOW, replyOptionId: 2 }).optionVotes, { 2: 'yes' });
  assert.deepEqual(parseAvailability('👍', OPTS, TZ, { now: NOW, replyOptionId: 2 }).optionVotes, { 2: 'yes' });
  assert.deepEqual(parseAvailability("can't", OPTS, TZ, { now: NOW, replyOptionId: 3 }).optionVotes, { 3: 'no' });
});

test('relative references resolve against now', () => {
  const tue = ['2026-10-20', '2026-10-21', '2026-10-22'].map((d, i) => ({ id: i + 1, day: d, time: '19:00', startsAt: atLocal(d, '19:00', TZ), label: optionLabel(d, '19:00') }));
  const mon = Date.parse('2026-10-19T22:40:00-04:00');
  const p = parseAvailability("tomorrow's bad, wed or thu", tue, TZ, { now: mon });
  assert.equal(p.dayPrefs['2026-10-20'].vote, 'no');
  assert.equal(p.dayPrefs['2026-10-21'].vote, 'yes');
});

test('emoji votes: ❤️ 👍 ‼️ yes, 👎 no, ❓ maybe, 😂 ignored', () => {
  assert.equal(emojiVote('❤️'), 'yes');
  assert.equal(emojiVote('👍🏽'), 'yes');
  assert.equal(emojiVote('‼️'), 'yes');
  assert.equal(emojiVote('👎'), 'no');
  assert.equal(emojiVote('❓'), 'maybe');
  assert.equal(emojiVote('😂'), null);
});

test('windows: next week, this weekend, tomorrow, explicit days, tonight + named days', () => {
  assert.deepEqual(parseWindow('dinner next week?', NOW, TZ)?.days, ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']);
  assert.deepEqual(parseWindow('this weekend', NOW, TZ)?.days, ['2026-10-17', '2026-10-18']);
  assert.deepEqual(parseWindow('lunch tomorrow?', NOW, TZ), { label: 'tomorrow', days: ['2026-10-18'], single: true, range: ['2026-10-18'] });
  const ex = parseWindow('drinks thu, fri or sat?', NOW, TZ);
  assert.equal(ex?.explicit, true);
  assert.equal(ex?.label, 'Thu, Fri or Sat');
  const thu = Date.parse('2026-10-22T09:27:00-04:00');
  assert.deepEqual(parseWindow('dinner tonight, fri or sat?', thu, TZ)?.days, ['2026-10-22', '2026-10-23', '2026-10-24']);
  assert.equal(parseWindow('lol whatever', NOW, TZ), null);
});

test('commands: the STATE_MACHINE table', () => {
  const k = (t: string) => parseCommand(t)?.kind;
  assert.equal(k('stop'), 'stop');
  assert.equal(k('forget'), 'forget');
  assert.equal(k('privacy'), 'privacy');
  assert.equal(k('what do you know'), 'dump');
  assert.equal(k('where are we at'), 'status');
  assert.equal(k('/status'), 'status');
  assert.equal(k('find food'), 'food');
  assert.equal(k('/food'), 'food');
  assert.deepEqual(parseCommand('lock it when 4 say yes'), { kind: 'threshold', n: 4 });
  assert.deepEqual(parseCommand('/threshold 4'), { kind: 'threshold', n: 4 });
  assert.deepEqual(parseCommand('lock fri'), { kind: 'lock', ref: 'fri' });
  assert.deepEqual(parseCommand('why fri'), { kind: 'why', ref: 'fri' });
  assert.deepEqual(parseCommand("I'm Sam"), { kind: 'name', name: 'Sam' });
  assert.equal(parseCommand("I'm in"), null);
  assert.equal(parseCommand("I'm starving"), null);
  assert.equal(k("I'm out"), 'out');
  assert.equal(k('count me out'), 'out');
  assert.equal(k("i'm out fri"), undefined);
  assert.deepEqual(parseCommand('you can DM me'), { kind: 'optin', mode: 'dm' });
  assert.deepEqual(parseCommand('you can call me, i never check this chat'), { kind: 'optin', mode: 'call' });
  assert.deepEqual(parseCommand('tone ruthless'), { kind: 'tone', tone: 'ruthless' });
  assert.deepEqual(parseCommand('note parking: behind the building'), { kind: 'note_set', key: 'parking', value: 'behind the building' });
  assert.deepEqual(parseCommand('what did we decide about parking'), { kind: 'note_get', key: 'parking' });
  assert.equal(k('add to calendar'), 'ics');
  assert.deepEqual(parseCommand('split 142.50 5 ways'), { kind: 'split', amount: 142.5, ways: 5 });
  assert.deepEqual(parseCommand('split $142.50'), { kind: 'split', amount: 142.5, ways: undefined });
  assert.deepEqual(parseCommand('notice on'), { kind: 'notice', on: true });
  assert.deepEqual(parseCommand("we're in Chicago"), { kind: 'tz', place: 'Chicago' });
  assert.deepEqual(parseCommand("we're 6"), { kind: 'headcount', n: 6 });
  assert.deepEqual(parseCommand("we're going to Tasty Thai"), { kind: 'place_set', place: 'Tasty Thai' });
  assert.deepEqual(parseCommand("place: ben's apt"), { kind: 'place_set', place: "ben's apt" });
  assert.equal(k('no place needed'), 'no_place');
  assert.equal(k("no place needed, we'll figure it out lol"), 'no_place');
  assert.equal(k('remind me'), 'remind');
  assert.equal(k("go we're dying"), 'go');
  assert.equal(k('just pick'), 'go');
});
