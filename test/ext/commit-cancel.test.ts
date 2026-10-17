// Cancellation (full refund until 24h before), and calling the whole thing off: forget, stop, a moved date.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { joined, ofType } from '../engine/helpers.js';
import { CREW, at, demoPlan, openPledge } from './commit-harness.js';

function pledged() {
  const h = demoPlan();
  openPledge(h);
  for (const n of CREW) h.say(n, "homi I'm in");
  return h;
}

test('cancel before Thu Oct 22, 7pm: full refund, and the person is out of the pledge', () => {
  const h = pledged();
  h.advanceTo(at('2026-10-22T18:59:00-04:00'));
  const r = h.say('jo', 'homi cancel my pledge');
  assert.deepEqual(ofType(r, 'reply').map((x) => x.text), ['Cancelled: your $10 is on its way back (SIMULATED).']);
  assert.deepEqual(h.ops('refund'), [['refund', 'jo', 1000]]);
  assert.equal(h.pledge?.parts['k-jo'].status, 'cancelled');
  assert.equal(joined(h.say('jo', 'homi cancel my pledge')), "You don't have a pledge to cancel.");
  assert.equal(joined(h.say('ana', 'homi pledges')), '5 of 5 pledged: $50 held (SIMULATED). See you tomorrow at 7.');
  // Jo is not part of the settlement at all.
  h.advanceTo(at('2026-10-23T18:50:00-04:00'));
  assert.equal(joined(h.say('jo', "homi I'm here")), "You're not in this pledge, so there's no need to check in.");
  for (const n of ['ana', 'ben', 'maya', 'sam', 'you']) h.say(n, "homi I'm here");
  assert.equal(joined(h.advanceTo(at('2026-10-23T20:30:00-04:00'))), 'Pledge settled (SIMULATED): everyone checked in, so $10 back to Ana, Ben, Maya, Sam and You.');
  assert.deepEqual(h.ops('refund').filter((x) => x[1] === 'jo'), [['refund', 'jo', 1000]], 'Jo refunded once');
});

test('cancel after the cutoff: too late, nothing moves', () => {
  const h = pledged();
  h.advanceTo(at('2026-10-22T19:01:00-04:00'));
  assert.equal(joined(h.say('sam', 'homi cancel my pledge')), 'Too late to cancel; you can dispute after if something came up.');
  assert.deepEqual(h.ops('refund'), []);
  assert.equal(h.pledge?.parts['k-sam'].status, 'held');
});

test('homi forget refunds every held pledge before the plan is deleted', () => {
  const h = pledged();
  const r = h.say('ben', 'homi forget');
  assert.deepEqual(ofType(r, 'send').map((s) => s.text), [
    'Refunded every open pledge (SIMULATED): $60 back to Ana, Ben, Jo, Maya, Sam and You.',
    "Done: I've deleted this plan.",
  ]);
  assert.deepEqual(h.ops('refund').map((x) => x[1]).sort(), [...CREW].sort());
  const purge = r.findIndex((a) => a.type === 'purge');
  assert.ok(r.findIndex((a) => a.type === 'payment') < purge, 'refunds go out before the purge');
  assert.equal(h.plan, null);
  assert.deepEqual(h.advanceTo(at('2026-10-24T12:00:00-04:00')).filter((a) => a.type === 'payment'), [], 'no timers survive');
});

test('homi stop refunds too; a hold that lands after the plan is gone is given straight back', () => {
  const h = pledged();
  const r = h.say('ana', 'homi stop');
  assert.equal(ofType(r, 'payment').length, 6);
  assert.ok(ofType(r, 'send').some((s) => s.text.startsWith('Refunded every open pledge (SIMULATED): $60')));
  assert.equal(h.state.space.ext?.commit, undefined, 'stop deletes the group fund record too');

  const g = demoPlan();
  openPledge(g);
  g.autoPay = false;
  const hold = ofType(g.say('sam', "homi I'm in"), 'payment')[0];
  g.say('ben', 'homi forget');
  assert.equal(g.payments.length, 1, 'a pending hold is not refunded twice');
  g.autoPay = true;
  const late = g.apply({ kind: 'payment_result', ref: hold.ref, planId: hold.planId, member: hold.member, op: 'hold', amountCents: 1000, ok: true, simulated: true });
  assert.deepEqual(ofType(late, 'payment').map((p) => [p.op, p.member, p.amountCents]), [['refund', 'k-sam', 1000]]);
});

test('a moved date calls the pledge off with refunds', () => {
  const h = pledged();
  // Veto-and-swap from a yes voter reopens the date; the next event notices and refunds.
  h.say('ana', "can't do friday anymore");
  assert.equal(h.plan?.eventAt, undefined);
  const r = h.say('ben', 'ok');
  assert.ok(ofType(r, 'send').some((s) => s.text === 'The date changed, so I refunded every pledge (SIMULATED); start a new one anytime.'));
  assert.equal(h.ops('refund').length, 6);
  assert.equal(h.pledge, undefined);
});
