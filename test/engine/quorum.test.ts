// Demo quorum (Ctx.quorum / QUORUM_DM_AFTER_MS): 30 s after the options go out the silent are asked privately,
// 15 s later they count as not coming, and the plan locks with >= 2 yes or is cancelled. Plus the intake question
// when a request names no activity.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness, joined, ofType } from './helpers.js';

const START = '2026-10-17T10:00:00-04:00';
const Q = { dmAfterMs: 30_000, replyMs: 15_000, minYes: 2 };

function telegramGroupOfThree() {
  const h = new Harness({ start: START, surface: 'telegram', quorum: Q });
  h.apply({ kind: 'headcount', n: 3 });
  const out = h.say('riad', 'homi dinner friday 7pm');
  assert.deepEqual(ofType(out, 'send').filter((s) => s.tag?.startsWith('option:')).map((s) => s.text), ['1. Fri Oct 23, 7pm']);
  assert.ok(ofType(out, 'remember_handle').some((a) => a.member === 'k-riad'), 'the speaker becomes reachable privately');
  assert.ok(ofType(out, 'schedule').some((s) => s.job === 'quorum_dm' && s.at === h.now + 30_000));
  return h;
}

test('quorum: silent members are DMed at 30 s, counted out at 45 s; one yes cancels the plan', () => {
  const h = telegramGroupOfThree();
  h.react('riad', '❤️', 'option:1');
  const hey = h.say('charlie', 'hey all');
  assert.ok(ofType(hey, 'remember_handle').some((a) => a.member === 'k-charlie'));
  const ping = h.advance(30_000);
  const dms = ofType(ping, 'dm');
  assert.equal(dms.length, 1);
  assert.equal(dms[0].member, 'k-charlie');
  assert.match(dms[0].text, /does 1\. Fri Oct 23, 7pm work for you for dinner\? Reply yes, no, or a number\./);
  assert.match(joined(ping), /Still need .*; I've asked them privately\. No word by .* counts as not coming\./);
  assert.ok(ofType(ping, 'schedule').some((s) => s.job === 'quorum_close' && s.at === h.now + 15_000));
  const close = h.advance(15_000);
  assert.match(joined(close), /No word from .*, so I'm counting them as not coming\./);
  assert.match(joined(close), /Only 1 can make it, so no dinner this time\./);
  assert.ok(ofType(close, 'purge').length === 1);
  assert.equal(h.plan, null);
});

test('quorum: a routed DM reply ("yes") counts, and two yes votes lock once the silent are counted out', () => {
  const h = telegramGroupOfThree();
  h.react('riad', '❤️', 'option:1');
  h.say('charlie', 'hey all');
  h.advance(30_000);
  // The runner feeds Charlie's private "yes" back as his own addressed message with a dm: ref.
  const reply = h.apply({ kind: 'message', from: { key: 'k-charlie' }, text: 'yes', msgRef: 'dm:77', addressed: true });
  assert.equal(ofType(reply, 'remember_handle').length, 0, 'a dm reply has no group handle to remember');
  assert.equal(h.plan!.members['k-charlie'].status, 'answered');
  assert.equal(h.plan!.state, 'collecting_availability', 'the third (silent) person is still expected');
  const close = h.advance(15_000);
  assert.match(joined(close), /No word from 1 person, so I'm counting them as not coming\./);
  assert.match(joined(close), /Fri Oct 23, 7pm it is: 2 in\./);
  assert.equal(h.plan!.state, 'collecting_details');
});

test('quorum: everyone answered but only one yes -> cancelled, not locked', () => {
  const h = new Harness({ start: START, surface: 'telegram', quorum: Q });
  h.apply({ kind: 'headcount', n: 2 });
  h.say('riad', 'homi dinner friday 7pm');
  h.react('riad', '❤️', 'option:1');
  const out = h.say('charlie', "homi I'm out");
  assert.match(joined(out), /Only 1 can make it/);
  assert.equal(h.plan, null);
});

test('quorum off: nothing scheduled, locks as before', () => {
  const h = new Harness({ start: START, surface: 'telegram' });
  const out = h.say('riad', 'homi dinner friday 7pm');
  assert.equal(ofType(out, 'schedule').some((s) => s.job === 'quorum_dm'), false);
  assert.equal(ofType(out, 'remember_handle').length, 0);
});

test('intake: "plan something" asks what first, then when; a window named early is kept', () => {
  const h = new Harness({ start: START });
  assert.match(joined(h.say('riad', 'homi plan something next week')), /What are we doing: dinner, drinks, brunch, or something else\?/);
  assert.equal(h.plan!.state, 'collecting_dates');
  const out = h.say('ana', 'dinner');
  assert.deepEqual(ofType(out, 'send').filter((s) => s.tag?.startsWith('option:')).map((s) => s.text), ['1. Thu Oct 22, 7pm', '2. Fri Oct 23, 7pm', '3. Sat Oct 24, 7pm']);
  assert.equal(h.plan!.activity, 'dinner');

  const g = new Harness({ start: START });
  g.say('riad', 'homi plan something');
  assert.match(joined(g.say('riad', 'homi drinks')), /Roughly when/);
  assert.match(joined(g.say('ana', 'friday')), /2. Fri Oct 23, 8pm/);
});

test('quorum: a lone voter in a one-person chat is cancelled cleanly (no crash after the purge)', () => {
  const h = new Harness({ start: START, surface: 'telegram', quorum: Q });
  h.say('riad', 'homi dinner friday 7pm');
  const out = h.apply({ kind: 'message', from: { key: 'k-riad' }, text: 'yes', msgRef: 'dm:9', addressed: true });
  assert.match(joined(out), /Only 1 can make it, so no dinner this time\./);
  assert.equal(h.plan, null);
  assert.equal(ofType(out, 'edit').length, 0);
});

test('quorum: after the ping, a pending member\'s bare "yes" in the group counts even unaddressed', () => {
  const h = telegramGroupOfThree();
  h.say('charlie', 'hey all');
  // Before the ping a bare "yes" is chatter.
  assert.equal(h.say('charlie', 'yes').some((a) => a.type === 'react' || a.type === 'edit'), false);
  h.advance(30_000);
  const out = h.say('charlie', 'yes');
  assert.ok(out.some((a) => a.type === 'react' || a.type === 'edit'), 'the vote was taken');
  assert.equal(h.plan!.members['k-charlie'].status, 'answered');
});

test('quorum: a tapback makes the voter reachable privately, like a message does', () => {
  const h = new Harness({ start: START, surface: 'telegram', quorum: Q });
  h.apply({ kind: 'headcount', n: 2 });
  h.say('riad', 'homi dinner friday 7pm');
  const out = h.react('charlie', '🤔', 'option:1'); // maybe: answered, but still worth a nudge? no: answered. Use a non-vote emoji instead.
  assert.ok(ofType(out, 'remember_handle').some((a) => a.member === 'k-charlie'));
});
