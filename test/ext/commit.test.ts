// DEMO Acts 2-3 (steps 6-10 and 14): the show-up pledge end to end, copy and numbers exactly as docs/DEMO.md.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countSentences } from '../../src/engine/index.js';
import { joined, ofType, texts } from '../engine/helpers.js';
import { CREW, at, demoPlan } from './commit-harness.js';

const HEADER =
  'Show-up pledge for Fri Oct 23 · 7pm: $10 each, back when you check in. First, where should no-show money go (everyone who pledges has to agree)?';
const RULES = [
  'How the pledge works (payments are SIMULATED in this demo):',
  '· Check in: "homi I\'m here" at Hokkaido Ramen Santouka, 6:45–7:30pm; it counts once a second person is there (or someone 👍s it)',
  '· Refund: automatic, by 8:30pm',
  '· No-show: your $10 goes where we agree',
  '· Cancel by Thu Oct 22, 7pm for a full refund ("homi cancel my pledge")',
  '· Disputes: "homi dispute" within 24h; the others vote, a tie means a refund',
].join('\n');
const AGREED = 'Everyone agreed: no-show money goes to the group fund. Pledges are open: say "homi I\'m in" to put down $10 (SIMULATED, no real money moves).';
const PLEDGED = '6 of 6 pledged: $60 held (SIMULATED). See you Friday at 7.';
const ONE_LEFT = '5 of 6 checked in ✓ Still waiting on Sam; check-in closes at 7:30pm.';
const SETTLED =
  "Pledge settled (SIMULATED): $10 back to Ana, Ben, Jo, Maya and You. Sam didn't check in, so Sam's $10 went to the group fund (now $10); Sam can dispute until Sat 8:30pm.";

test('DEMO: 6 pledge, 5 check in, Sam forfeits $10 to the group fund, the others are refunded', () => {
  const h = demoPlan();
  const budget = h.state.lastUnpromptedAt;

  // Step 7: header, three option bubbles, the rules card. Nothing is held.
  const start = h.say('maya', "homi let's do a $10 show-up pledge");
  assert.deepEqual(ofType(start, 'send').map((s) => [s.text, s.tag]), [
    [HEADER, 'commit:header'],
    ['1 · Group fund for the next outing', 'commit:dest:1'],
    ['2 · Split among the people who showed up', 'commit:dest:2'],
    ['3 · Donate to a charity we pick', 'commit:dest:3'],
    [RULES, 'commit:rules'],
  ]);
  for (const line of RULES.split('\n').slice(1)) assert.equal(countSentences(line), 1, line);

  // Step 8: everyone picks option 1, by ❤️ or by replying "1". Pledges open after the last vote, not before.
  const votes = [h.react('ana', '❤️', 'commit:dest:1'), h.say('ben', '1'), h.say('jo', '1'), h.say('maya', '1'), h.say('sam', '1')];
  assert.deepEqual(votes.flatMap(texts), []);
  assert.equal(h.pledge?.phase, 'vote');
  assert.equal(joined(h.react('you', '❤️', 'commit:dest:1')), AGREED);
  assert.equal(h.pledge?.dest, 'fund');
  assert.equal(h.payments.length, 0, 'nothing is held before agreement');

  // Step 9: six "homi I'm in": a hold each, a 👍 each, then one summary line.
  const ins = CREW.map((n) => h.say(n, "homi I'm in"));
  assert.deepEqual(ins.map((a) => ofType(a, 'react').length), [1, 1, 1, 1, 1, 1]);
  assert.deepEqual(ins.slice(0, 5).flatMap(texts), []);
  assert.equal(joined(ins[5]), PLEDGED);
  assert.deepEqual(h.ops('hold'), CREW.map((n) => ['hold', n, 1000]));
  assert.ok(h.payments.every((p) => p.currency === 'USD' && Number.isInteger(p.amountCents)));
  assert.equal(joined(h.say('ben', "homi I'm in")), "You're already in.");

  // Step 10: check-ins 6:50-7:05pm; each gets a 👍, the fifth also gets the milestone reply.
  h.advanceTo(at('2026-10-23T18:50:00-04:00'));
  const here = ['ana', 'ben', 'jo', 'maya'].map((n, i) => {
    h.advanceTo(at('2026-10-23T18:50:00-04:00') + i * 4 * 60_000);
    return h.say(n, "homi I'm here");
  });
  assert.deepEqual(here.flatMap(texts), []);
  assert.deepEqual(here.map((a) => ofType(a, 'react').length), [1, 1, 1, 1]);
  h.advanceTo(at('2026-10-23T19:05:00-04:00'));
  const fifth = h.say('you', "homi I'm here");
  assert.equal(ofType(fifth, 'react').length, 1);
  assert.deepEqual(ofType(fifth, 'reply').map((r) => [r.text, r.prompting]), [[ONE_LEFT, 'prompted']]);
  assert.equal(ofType(fifth, 'reply')[0].to, ofType(fifth, 'react')[0].to, 'replies to that check-in');
  assert.ok(Object.values(h.pledge!.parts).filter((x) => x.inAt).every((x) => x.confirmed), 'mutual presence');

  // Step 14: settlement at 8:30pm.
  assert.deepEqual(h.advanceTo(at('2026-10-23T20:29:00-04:00')).filter((a) => a.type === 'payment'), []);
  const settle = h.advanceTo(at('2026-10-23T20:30:00-04:00'));
  assert.deepEqual(ofType(settle, 'send').map((s) => [s.text, s.prompting]), [[SETTLED, 'prompted']]);
  assert.deepEqual(h.ops('refund').map((x) => x[1]).sort(), ['ana', 'ben', 'jo', 'maya', 'you']);
  assert.deepEqual(h.ops('forfeit'), [['forfeit', 'sam', 1000]]);
  assert.equal(h.fund?.fundCents, 1000);

  // Noise rule for pledges: every pledge message was prompted, so the 12h budget was never spent by them.
  const pledgeTexts = new Set([HEADER, RULES, AGREED, PLEDGED, ONE_LEFT, SETTLED]);
  const msgs = h.groupMessages().filter((m) => pledgeTexts.has(m.text));
  assert.equal(msgs.length, 6);
  assert.ok(msgs.every((m) => m.prompting === 'prompted'));
  assert.ok(budget === undefined || (h.state.lastUnpromptedAt ?? 0) >= budget);
  for (const t of [AGREED, PLEDGED, ONE_LEFT, SETTLED]) assert.ok(countSentences(t) <= 2, t);
  for (const t of [AGREED, PLEDGED, SETTLED]) assert.match(t, /SIMULATED/);
});

test('the dump shows the pledge outcome and the group fund; the fund outlives the plan', () => {
  const h = demoPlan();
  h.say('maya', "homi let's do a $10 show-up pledge");
  for (const n of CREW) h.say(n, '1');
  for (const n of CREW) h.say(n, "homi I'm in");
  h.advanceTo(at('2026-10-23T18:55:00-04:00'));
  for (const n of ['ana', 'ben', 'jo', 'maya', 'you']) h.say(n, "homi I'm here");
  h.advanceTo(at('2026-10-23T20:30:00-04:00'));
  const dump = joined(h.say('jo', 'homi what do you know'));
  assert.match(dump, /show-up pledge \$10 each for Fri Oct 23, 7pm \(payments SIMULATED\): settled: \$10 back to Ana, Ben, Jo, Maya and You; Sam forfeited \$10 to the group fund; disputes until Sat 8:30pm/);
  assert.match(dump, /group fund \$10 \(SIMULATED\)/);
  assert.doesNotMatch(dump, /k-|msg-|homi-\d/, 'no keys or message ids');
  // The plan is kept until the dispute window closes (Sat 8:30pm), then purged as usual.
  assert.equal(h.plan?.purgeAt, at('2026-10-24T20:35:00-04:00'));
  h.advanceTo(at('2026-10-24T20:40:00-04:00'));
  assert.equal(h.plan, null);
  assert.equal(h.fund?.fundCents, 1000);
  assert.match(joined(h.say('jo', 'homi what do you know')), /group fund \$10 \(SIMULATED\)/);
});

test('a lone check-in counts once someone 👍s it; without that it forfeits', () => {
  const h = demoPlan({}, ['ana', 'ben', 'jo']);
  h.say('ana', 'homi pledge $10');
  for (const n of ['ana', 'ben', 'jo']) h.say(n, '1');
  for (const n of ['ana', 'ben', 'jo']) h.say(n, "homi I'm in");
  h.advanceTo(at('2026-10-23T18:40:00-04:00'));
  assert.equal(joined(h.say('ana', "homi I'm here")), 'Check-in opens at 6:45pm.');
  h.advanceTo(at('2026-10-23T18:50:00-04:00'));
  h.say('ana', "homi I'm here");
  assert.equal(h.pledge!.parts['k-ana'].confirmed, undefined, 'alone: not confirmed yet');
  const ref = h.pledge!.parts['k-ana'].inRef!;
  h.apply({ kind: 'reaction', from: { key: 'k-ana' }, emoji: '👍', target: ref });
  assert.equal(h.pledge!.parts['k-ana'].confirmed, undefined, 'your own 👍 does not count');
  h.apply({ kind: 'reaction', from: { key: 'k-ben' }, emoji: '👍', target: ref });
  assert.equal(h.pledge!.parts['k-ana'].confirmed, true);
  h.advanceTo(at('2026-10-23T19:31:00-04:00'));
  assert.match(joined(h.say('ben', "homi I'm here")), /^Check-in closed at 7:30pm/);
  const s = joined(h.advanceTo(at('2026-10-23T20:30:00-04:00')));
  assert.equal(s, "Pledge settled (SIMULATED): $10 back to Ana. Ben and Jo didn't check in, so their $20 went to the group fund (now $20); they can dispute until Sat 8:30pm.");
});

test('everyone checks in: one "everyone is here" reply, all refunded, nothing to dispute', () => {
  const h = demoPlan({}, ['ana', 'ben']);
  h.say('ana', 'homi pledge $10');
  h.say('ana', '1');
  h.say('ben', '1');
  h.say('ana', "homi I'm in");
  assert.equal(joined(h.say('ben', "homi I'm in")), '2 of 2 pledged: $20 held (SIMULATED). See you Friday at 7.');
  h.advanceTo(at('2026-10-23T18:50:00-04:00'));
  assert.equal(joined(h.say('ana', "homi I'm here")), '1 of 2 checked in ✓ Still waiting on Ben; check-in closes at 7:30pm.');
  assert.equal(joined(h.say('ben', "homi I'm here")), "2 of 2 checked in ✓ Everyone's here; refunds go out by 8:30pm.");
  assert.equal(joined(h.advanceTo(at('2026-10-23T20:30:00-04:00'))), 'Pledge settled (SIMULATED): everyone checked in, so $10 back to Ana and Ben.');
  assert.equal(h.pledge?.phase, 'closed');
  assert.equal(joined(h.say('ana', 'homi dispute')), "Nothing to dispute: your pledge wasn't forfeited.");
});

test('channels without reactions get short text acks instead of 👍', () => {
  const h = demoPlan({ reactionsOut: false, reactionsIn: false }, ['ana', 'ben', 'jo']);
  h.say('ana', 'homi pledge $10');
  for (const n of ['ana', 'ben', 'jo']) h.say(n, '1');
  assert.equal(joined(h.say('ana', "homi I'm in")), "You're in: $10 held (SIMULATED).");
  h.say('ben', "homi I'm in");
  h.say('jo', "homi I'm in");
  h.advanceTo(at('2026-10-23T18:50:00-04:00'));
  assert.equal(joined(h.say('ana', "homi I'm here")), 'Checked in ✓');
  assert.equal(joined(h.say('ben', "homi I'm here")), '2 of 3 checked in ✓ Still waiting on Jo; check-in closes at 7:30pm.');
  assert.equal(ofType(h.log.map((l) => l.a), 'react').length, 0);
});
