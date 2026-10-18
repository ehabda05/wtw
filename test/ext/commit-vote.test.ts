// Step 1: the destination vote and the agreement rule. Nothing is held until every voter picked the same option.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { joined } from '../engine/helpers.js';
import { parseCommit, deadlineDay, destChoice } from '../../src/engine/ext/commit/parse.js';
import { CREW, PledgeHarness, demoPlan } from './commit-harness.js';

test('a pledge needs a locked date', () => {
  const h = new PledgeHarness({ start: '2026-10-17T10:00:00-04:00' });
  h.say('maya', 'guys we never hang out anymore');
  assert.equal(joined(h.say('maya', "homi let's do a $10 show-up pledge")), 'Lock a date first; then I can set up a pledge.');
  h.say('you', '@homi dinner next week?');
  assert.equal(joined(h.say('maya', 'homi pledge $10')), 'Lock a date first; then I can set up a pledge.');
  assert.equal(h.plan?.ext?.commit, undefined);
  assert.equal(joined(h.say('maya', 'homi pledge $1000')), 'Lock a date first; then I can set up a pledge.');
  const d = demoPlan();
  assert.equal(joined(d.say('maya', 'homi commit $1000 each')), 'Pledges can be $1 to $500 each.');
  assert.match(joined(d.say('maya', 'homi commit $20 each')), /^Show-up pledge for Fri Oct 23, 7pm: \$20 each/);
  assert.equal(joined(d.say('ana', 'homi pledge $10')), 'There\'s already a pledge for this plan; say "homi pledges" to see it.');
});

test('split vote: counts once everyone voted, nothing held, then agreement after a change of vote', () => {
  const h = demoPlan();
  h.say('maya', "homi let's do a $10 show-up pledge");
  for (const n of ['ana', 'ben', 'jo', 'maya']) h.say(n, '1');
  h.react('sam', '👍', 'commit:dest:2');
  assert.equal(
    joined(h.say('you', 'split it')),
    'Not everyone agrees yet: 4 for the group fund and 2 for splitting it. Pledges open once everyone picks the same option; you can change your vote.',
  );
  assert.equal(joined(h.say('you', '3')), '', 'the split is announced once');
  // "homi I'm in" during a split holds nothing and restates the counts.
  assert.equal(
    joined(h.say('ana', "homi I'm in")),
    'Not everyone agrees yet: 4 for the group fund, 1 for splitting it and 1 for a charity. Pledges open once everyone picks the same option; you can change your vote.',
  );
  assert.equal(h.payments.length, 0);
  assert.equal(h.pledge?.phase, 'vote');
  // Votes can change: Sam takes back the 👍 and picks 1; You switch to 1.
  h.apply({ kind: 'reaction', from: { key: 'k-sam' }, emoji: '👍', target: h.refs.get('commit:dest:2')!, removed: true });
  h.react('sam', '❤️', 'commit:dest:1');
  assert.deepEqual(h.payments, []);
  assert.match(joined(h.say('you', 'group fund')), /^Everyone agreed: no-show money goes to the group fund\./);
  assert.equal(h.pledge?.phase, 'open');
  // Votes after the opening do not move the destination.
  h.react('jo', '❤️', 'commit:dest:3');
  assert.equal(h.pledge?.dest, 'fund');
});

test('nothing is held before agreement: a non-voter and a lone voter cannot pledge', () => {
  const h = demoPlan();
  h.say('maya', 'homi pledge $10');
  assert.equal(joined(h.say('ana', "homi I'm in")), 'Pick where no-show money goes first: react to 1, 2 or 3 above or reply with the number.');
  h.say('ana', '2');
  assert.equal(
    joined(h.say('ana', "homi I'm in")),
    'Pledges open once at least 2 of you pick where no-show money goes and nobody disagrees; react to 1, 2 or 3 above or reply with the number.',
  );
  assert.deepEqual(h.payments, []);
  // Two agreeing voters are enough when one of them asks; the others can still join after the announcement.
  h.say('ben', 'homi 2');
  const r = h.say('ben', "homi I'm in");
  assert.match(joined(r), /^Everyone agreed: no-show money gets split among the people who showed up\./);
  assert.deepEqual(h.ops('hold'), [['hold', 'ben', 1000]]);
  h.say('jo', "homi I'm in");
  assert.deepEqual(h.ops('hold').map((x) => x[1]), ['ben', 'jo']);
  assert.equal(joined(h.say('ana', 'homi pledges')), '2 of 3 pledged: $20 held (SIMULATED). See you Friday at 7.');
});

test('unaddressed chat stays silent; "homi pledges" reports; a failed hold is not counted', () => {
  const h = demoPlan();
  h.say('maya', 'homi pledge $10');
  assert.deepEqual(h.say('ben', 'lol i will definitely be late'), []);
  assert.deepEqual(h.say('ben', 'we should commit to this more often'), []);
  for (const n of CREW) h.say(n, '1');
  h.fail.add('k-sam');
  assert.equal(joined(h.say('sam', "homi I'm in")), 'Couldn\'t put down your $10 (SIMULATED); try "homi I\'m in" again in a bit.');
  assert.ok(!('k-sam' in (h.pledge?.parts ?? {})), 'a failed hold is not counted');
  h.fail.clear();
  h.say('sam', "homi I'm in");
  assert.equal(h.pledge?.parts['k-sam'].status, 'held');
});

test('parse: start, goal, commands and destination words', () => {
  assert.deepEqual(parseCommit("let's do a $10 show-up pledge"), { kind: 'start', cents: 1000 });
  assert.deepEqual(parseCommit('pledge 12.5'), { kind: 'start', cents: 1250 });
  assert.deepEqual(parseCommit('commit $20 each'), { kind: 'start', cents: 2000 });
  assert.deepEqual(parseCommit('pledge $20 that everyone books flights by Dec 1'), { kind: 'start', cents: 2000, goal: 'everyone books flights', by: 'Dec 1' });
  assert.equal(parseCommit("I can't commit $50 to that"), null);
  assert.deepEqual(parseCommit('cancel my pledge'), { kind: 'cancel' });
  assert.deepEqual(parseCommit('refund Sam'), { kind: 'verdict', choice: 'refund', name: 'sam' });
  assert.deepEqual(parseCommit('keep it'), { kind: 'verdict', choice: 'keep' });
  assert.deepEqual(parseCommit("I'm here!"), { kind: 'here' });
  assert.deepEqual(parseCommit('pledges?'), { kind: 'status' });
  assert.deepEqual(destChoice('1 ❤️'), { n: 1, numeric: true });
  assert.deepEqual(destChoice('charity'), { n: 3, numeric: false });
  assert.equal(destChoice('1 more thing'), null);
  const now = Date.parse('2026-10-17T10:00:00-04:00');
  assert.equal(deadlineDay('Dec 1', now, 'America/New_York'), '2026-12-01');
  assert.equal(deadlineDay('october 3rd', now, 'America/New_York'), '2027-10-03');
  assert.equal(deadlineDay('someday', now, 'America/New_York'), null);
});
