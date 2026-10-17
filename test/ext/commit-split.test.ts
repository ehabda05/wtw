// Destinations other than the group fund (split with exact cents, donation tally) and the goal variant.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { joined, ofType } from '../engine/helpers.js';
import { largestRemainder } from '../../src/engine/ext/commit/settle.js';
import { at, demoPlan } from './commit-harness.js';

test('largestRemainder: exact cents, largest fractions first, ties to the earlier index', () => {
  assert.deepEqual(largestRemainder(1000, [1, 1, 1]), [334, 333, 333]);
  assert.deepEqual(largestRemainder(1, [1, 1]), [1, 0]);
  assert.deepEqual(largestRemainder(0, [1, 1]), [0, 0]);
  // DEMO step 11: $30.11 of tax + tip in proportion to each subtotal.
  assert.deepEqual(largestRemainder(3011, [1970, 2870, 2420, 1920, 1970]), [532, 775, 654, 518, 532]);
  for (const n of [1, 2, 3, 6, 7, 9]) {
    const s = largestRemainder(1001, Array(n).fill(1));
    assert.equal(s.reduce((a, b) => a + b, 0), 1001);
    assert.ok(Math.max(...s) - Math.min(...s) <= 1);
  }
});

function night(crew: string[], option: number, here: string[]) {
  const h = demoPlan({}, crew);
  h.say(crew[0], 'homi pledge $10');
  for (const n of crew) h.say(n, String(option));
  for (const n of crew) h.say(n, "homi I'm in");
  h.advanceTo(at('2026-10-23T18:55:00-04:00'));
  for (const n of here) h.say(n, "homi I'm here");
  return h;
}

test('split among the people who showed up: $10 over 3 is $3.34 + $3.33 + $3.33, paid after the dispute window', () => {
  const h = night(['ana', 'ben', 'jo', 'maya'], 2, ['ana', 'ben', 'jo']);
  const s = h.advanceTo(at('2026-10-23T20:30:00-04:00'));
  assert.equal(
    joined(s),
    "Pledge settled (SIMULATED): $10 back to Ana, Ben and Jo. Maya didn't check in, so Maya's $10 gets split among the 3 who showed up ($3.34 or $3.33 each) once disputes close; Maya can dispute until Sat 8:30pm.",
  );
  assert.equal(h.fund?.fundCents ?? 0, 0, 'nothing goes to the fund');
  const fin = h.advanceTo(at('2026-10-24T20:30:00-04:00'));
  assert.equal(joined(fin), 'Pledge closed (SIMULATED): $10 from Maya split among Ana, Ben and Jo, $3.34 or $3.33 each.');
  const shares = ofType(fin, 'payment').map((p) => [p.op, p.member, p.amountCents]);
  assert.deepEqual(shares, [['refund', 'k-ana', 334], ['refund', 'k-ben', 333], ['refund', 'k-jo', 333]]);
  assert.equal(shares.reduce((a, x) => a + (x[2] as number), 0), 1000);
});

test('split: a refund won in a dispute leaves nothing to split; nobody showing up refunds everyone', () => {
  const h = night(['ana', 'ben', 'jo', 'maya'], 2, ['ana', 'ben', 'jo']);
  h.advanceTo(at('2026-10-23T21:00:00-04:00'));
  h.say('maya', 'homi dispute');
  for (const n of ['ana', 'ben']) h.say(n, 'homi refund maya');
  assert.match(joined(h.say('jo', 'homi keep it')), /^Dispute settled \(SIMULATED\): 2 to 1 for a refund, so Maya gets \$10 back\.$/);
  assert.deepEqual(h.advanceTo(at('2026-10-24T20:31:00-04:00')).filter((a) => a.type === 'payment' || a.type === 'send'), []);
  assert.equal(h.pledge?.phase, 'closed');

  const none = night(['ana', 'ben'], 2, []);
  assert.equal(joined(none.advanceTo(at('2026-10-23T20:30:00-04:00'))), 'Pledge settled (SIMULATED): nobody checked in, so everyone gets their $10 back.');
  assert.deepEqual(none.ops('forfeit'), []);
  assert.equal(none.ops('refund').length, 2);
});

test('donate: no-show money is set aside "to donate" once disputes close', () => {
  const h = night(['ana', 'ben', 'jo'], 3, ['ana', 'ben']);
  assert.equal(
    joined(h.advanceTo(at('2026-10-23T20:30:00-04:00'))),
    "Pledge settled (SIMULATED): $10 back to Ana and Ben. Jo didn't check in, so Jo's $10 goes to the charity you pick once disputes close; Jo can dispute until Sat 8:30pm.",
  );
  assert.deepEqual(h.ops('forfeit'), [['forfeit', 'jo', 1000]]);
  assert.equal(joined(h.advanceTo(at('2026-10-24T20:30:00-04:00'))), 'Pledge closed (SIMULATED): $10 from Jo is set aside for the charity you pick ($10 to donate in total).');
  assert.equal(h.fund?.donateCents, 1000);
  assert.match(joined(h.say('ana', 'homi what do you know')), /\$10 set aside to donate \(SIMULATED\)/);
});

test('goal variant: "homi done" + a 👍 or "homi confirm <name>" from another participant, settled at the deadline', () => {
  const h = demoPlan({}, ['ana', 'ben', 'jo']);
  const start = h.say('ana', 'homi pledge $20 that everyone books flights by Dec 1');
  const sends = ofType(start, 'send').map((s) => s.text);
  assert.equal(sends[0], "Goal pledge: $20 each that everyone books flights by Tue Dec 1, back once it's done. First, where should missed-goal money go (everyone who pledges has to agree)?");
  assert.equal(sends[2], '2 · Split among the people who made it');
  assert.match(sends[4], /· Done: "homi done" by Tue Dec 1; it counts once someone else in the pledge 👍s it or says "homi confirm <name>"/);
  assert.match(sends[4], /· Cancel by Mon Nov 30, 11:59pm for a full refund/);
  for (const n of ['ana', 'ben', 'jo']) h.say(n, '1');
  for (const n of ['ana', 'ben']) h.say(n, "homi I'm in");
  assert.equal(joined(h.say('jo', "homi I'm in")), '3 of 3 pledged: $60 held (SIMULATED). Say "homi done" once it\'s done, by Tue Dec 1.');
  h.advanceTo(at('2026-11-10T12:00:00-05:00'));
  const done = h.say('ana', 'homi done');
  assert.equal(ofType(done, 'react').length, 1);
  h.apply({ kind: 'reaction', from: { key: 'k-ben' }, emoji: '👍', target: h.pledge!.parts['k-ana'].inRef! });
  assert.equal(h.pledge!.parts['k-ana'].confirmed, true);
  assert.equal(joined(h.say('ben', 'homi done')), '2 of 3 done ✓ Still waiting on Jo; the deadline is Tue Dec 1.');
  assert.equal(joined(h.say('ben', 'homi confirm ben')), 'Someone else in the pledge has to confirm it.');
  h.say('jo', 'homi confirm ben');
  assert.equal(h.pledge!.parts['k-ben'].confirmed, true);
  assert.ok(h.plan, 'the plan is kept for the pledge');
  const s = h.advanceTo(at('2026-12-01T23:59:00-05:00'));
  assert.equal(joined(s), "Pledge settled (SIMULATED): $20 back to Ana and Ben. Jo didn't finish, so Jo's $20 went to the group fund (now $20); Jo can dispute until Wed 11:59pm.");
  assert.deepEqual(h.ops('forfeit'), [['forfeit', 'jo', 2000]]);
});
