// Disputes: the forfeited member says "homi dispute" within 24h; the others vote; majority decides, tie = refund.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { joined, ofType } from '../engine/helpers.js';
import { CREW, at, demoPlan, openPledge } from './commit-harness.js';

/** DEMO night: Sam forfeits $10 to the group fund at 8:30pm; then it is Sat 9am. */
function samForfeited() {
  const h = demoPlan();
  openPledge(h);
  for (const n of CREW) h.say(n, "homi I'm in");
  h.advanceTo(at('2026-10-23T18:55:00-04:00'));
  for (const n of ['ana', 'ben', 'jo', 'maya', 'you']) h.say(n, "homi I'm here");
  h.advanceTo(at('2026-10-24T09:00:00-04:00'));
  assert.equal(h.fund?.fundCents, 1000);
  return h;
}

const OPEN = 'Sam disputed the no-show. Ana, Ben, Jo, Maya and You: reply "homi refund Sam" or "homi keep it" by Sun 9am; a tie means a refund.';

test('majority keeps it: Sam\'s $10 stays in the group fund', () => {
  const h = samForfeited();
  assert.equal(joined(h.say('ana', 'homi dispute')), "Nothing to dispute: your pledge wasn't forfeited.");
  const r = h.say('sam', 'homi dispute');
  assert.deepEqual(ofType(r, 'send').map((s) => [s.text, s.prompting]), [[OPEN, 'prompted']]);
  assert.equal(joined(h.say('sam', 'homi dispute')), 'Your dispute is already open; the vote closes Sun 9am.');
  assert.equal(joined(h.say('sam', 'homi refund sam')), 'Only the other people in the pledge can vote on this.');
  h.say('ana', 'homi refund Sam');
  h.say('ben', 'homi keep it');
  h.say('jo', 'homi keep it');
  assert.equal(ofType(h.say('maya', 'homi keep it'), 'react').length, 1, 'each vote gets a 👍');
  const done = h.say('you', 'homi refund sam');
  assert.equal(joined(done), "Dispute settled (SIMULATED): 3 to 2 to keep it, so Sam's $10 stays in the group fund.");
  assert.equal(h.fund?.fundCents, 1000);
  assert.deepEqual(h.ops('refund').filter((x) => x[1] === 'sam'), []);
  assert.equal(joined(h.say('sam', 'homi dispute')), 'Your dispute was already decided.');
  // "homi keep it" with no open dispute is not a pledge command any more.
  assert.doesNotMatch(joined(h.say('ben', 'homi keep it')), /dispute/i);
});

test('majority refunds: Sam gets $10 back out of the group fund', () => {
  const h = samForfeited();
  h.say('sam', 'homi dispute');
  for (const n of ['ana', 'ben', 'jo']) h.say(n, 'homi refund sam');
  h.say('maya', 'homi keep it');
  const done = h.say('you', 'homi keep it');
  assert.equal(joined(done), 'Dispute settled (SIMULATED): 3 to 2 for a refund, so Sam gets $10 back and the group fund is now $0.');
  assert.deepEqual(ofType(done, 'payment').map((p) => [p.op, p.member, p.amountCents]), [['refund', 'k-sam', 1000]]);
  assert.equal(h.fund?.fundCents, 0);
  assert.deepEqual([...h.jobs.keys()].filter((k) => k.includes(':ext:commit:dispute')), [], 'deadline job cancelled');
});

test('a tie at the deadline means a refund; the plan is kept until the vote closes', () => {
  const h = samForfeited();
  h.say('sam', 'homi dispute');
  h.say('ana', 'homi refund');
  h.say('ben', 'homi keep it');
  h.advanceTo(at('2026-10-24T21:00:00-04:00'));
  assert.ok(h.plan, 'still here after the usual purge time (Sat 7pm) and the dispute window (Sat 8:30pm)');
  assert.equal(h.plan?.purgeAt, at('2026-10-25T09:05:00-04:00'));
  const r = h.advanceTo(at('2026-10-25T09:00:00-04:00'));
  assert.equal(joined(r), 'Dispute settled (SIMULATED): a 1 to 1 tie means a refund, so Sam gets $10 back and the group fund is now $0.');
  assert.deepEqual(h.ops('refund').filter((x) => x[1] === 'sam'), [['refund', 'sam', 1000]]);
  assert.equal(h.pledge?.phase, 'closed');
  h.advanceTo(at('2026-10-25T09:10:00-04:00'));
  assert.equal(h.plan, null);
});

test('no votes at all is a tie too; disputing after the window is too late', () => {
  const h = samForfeited();
  h.say('sam', 'homi dispute');
  assert.match(joined(h.advanceTo(at('2026-10-25T09:00:00-04:00'))), /^Dispute settled \(SIMULATED\): a 0 to 0 tie means a refund/);

  const late = samForfeited();
  late.advanceTo(at('2026-10-24T20:32:00-04:00'));
  assert.equal(joined(late.say('sam', 'homi dispute')), 'The dispute window closed Sat 8:30pm.');
});
