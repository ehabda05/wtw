// Hard rule 1 for pledge copy: every message is at most two sentences and card lines are fragments.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countSentences } from '../../src/engine/index.js';
import { C, type View } from '../../src/engine/ext/commit/copy.js';
import { S, shareLabel } from '../../src/engine/ext/commit/copy-settle.js';
import type { Pledge } from '../../src/engine/ext/commit/model.js';

const E = Date.parse('2026-10-23T19:00:00-04:00');
const base: Pledge = {
  kind: 'showup', amountCents: 1000, at: E, startedBy: 'k', startedAt: 0, phase: 'open', refs: { dest: {} }, votes: {}, agreed: [],
  parts: {}, attendees: [], forfeits: [], disputes: [], sim: true, dest: 'fund', disputeUntil: E + 25.5 * 3600_000,
};

function views(): View[] {
  const out: View[] = [];
  for (const kind of ['showup', 'goal'] as const)
    for (const dest of ['fund', 'split', 'donate'] as const)
      for (const sim of [true, false])
        out.push({ c: { ...base, kind, dest, sim, goal: kind === 'goal' ? 'everyone books flights' : undefined }, tz: 'America/New_York', now: Date.parse('2026-10-17T10:30:00-04:00'), place: 'Hokkaido Ramen Santouka', sim });
  return out;
}

test('every pledge message is at most two sentences', () => {
  const names = ['Ana', 'Ben', 'Jo'];
  for (const v of views()) {
    const msgs = [
      C.needDate(), C.needPlan(), C.tooSoon(), C.already(), C.range(), C.goalWhen(), C.goalPast(), C.howto(),
      C.opened(v), C.split(v, [4, 1, 1]), C.waiting(v), C.pickFirst(v), C.summary(v, 6, 6), C.heldAck(v), C.holdFailed(v),
      C.alreadyIn(), C.joinClosed(v), C.settledAlready(), C.cancelled(v), C.tooLate(), C.noPledge(), C.stillHolding(),
      C.cancelFailed(v), C.notIn(), C.tooEarly(v), C.windowShut(v), C.oneLeft(v, 5, 6, 'Sam'), C.allIn(v, 6), C.progress(v, 2, 6),
      C.selfConfirm(), C.confirmWho(), C.confirmNotIn(), C.dateChanged(v, true), C.dateChanged(v, false),
      C.forgetRefunds(v, 6000, names), C.settledStatus(v, 5, 1),
      S.settled(v, { att: names, miss: ['Sam'], noneIn: true, total: 1000, fund: 1000, share: '$3.34 or $3.33 each', refundAll: false }),
      S.settled(v, { att: [], miss: ['Sam', 'Maya'], noneIn: false, total: 2000, fund: 2000, refundAll: false }),
      S.settled(v, { att: names, miss: [], noneIn: true, total: 0, fund: 0, refundAll: false }),
      S.settled(v, { att: [], miss: names, noneIn: true, total: 0, fund: 0, refundAll: true }),
      S.finalSplit(v, 1000, ['Sam'], names, '$3.34 or $3.33 each'), S.finalDonate(v, 1000, ['Sam'], 3000),
      S.disputeOpen(v, 'Sam', names, E + 40 * 3600_000), S.nothing(), S.windowClosed(v), S.alreadyOpen(v, E), S.alreadyDecided(),
      S.cantVote(), S.noDisputeFor(), S.refunded(v, 'Sam', 3, 2, 0), S.refunded(v, 'Sam', 1, 1), S.kept(v, 'Sam', 2, 3),
    ];
    for (const m of msgs) {
      assert.ok(countSentences(m) <= 2, `${countSentences(m)} sentences: ${m}`);
      assert.ok(m.length <= 320, m);
      if (/\$\d/.test(m) && /held|back|forfeit|fund now|went to|split among|set aside|refunded/i.test(m) && v.sim) assert.match(m, /SIMULATED/, m);
    }
    assert.ok(countSentences(C.header(v)) <= 2, `header: ${C.header(v)}`);
    for (let i = 1; i <= 3; i++) assert.equal(countSentences(C.option(v, i)), 1);
    const rules = C.rules(v).split('\n');
    assert.ok(countSentences(rules[0]) <= 1);
    for (const line of rules.slice(1)) {
      assert.equal(countSentences(line), 1, line);
      assert.ok(!/[.!?]$/.test(line), `fragment: ${line}`);
    }
  }
});

test('share labels', () => {
  assert.equal(shareLabel([200, 200, 200]), '$2 each');
  assert.equal(shareLabel([334, 333, 333]), '$3.34 or $3.33 each');
});
