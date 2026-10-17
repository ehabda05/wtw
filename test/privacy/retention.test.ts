// PRIVACY.md §5: fast-forward the clock and assert that zero rows remain.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Action } from '../../src/engine/types.js';
import { Retention } from '../../src/privacy/retention.js';
import { Scheduler } from '../../src/runner/scheduler.js';
import { fakeEngine, makeEnv, makePlan, textIn } from '../runner/helpers.js';

const H = 3_600_000;

function planningEngine(handlePurgeTimer: boolean) {
  return fakeEngine((s, ev, ctx) => {
    const out: Action[] = [];
    if (ev.kind === 'message' && !s.plan) {
      const eventAt = ctx.now + 3 * H;
      s.plan = makePlan(ctx.newId(), { state: 'confirmed', eventAt, purgeAt: eventAt + ctx.retentionHours * H });
      s.plan.members[ev.from.key] = { key: ev.from.key, name: 'Ana', status: 'answered', dayPrefs: {}, optionVotes: {}, optInDm: true, optInCall: true, hasDelivery: true, nudgeCount: 0, joinedAt: ctx.now };
      out.push(
        { type: 'remember_handle', member: ev.from.key, planId: s.plan.id },
        { type: 'schedule', key: `${s.plan.id}:remind:hour`, job: 'remind_hour', at: eventAt - H, planId: s.plan.id },
        { type: 'schedule', key: `${s.plan.id}:complete`, job: 'complete', at: eventAt + 3 * H, planId: s.plan.id },
        { type: 'schedule', key: `${s.plan.id}:purge`, job: 'purge', at: s.plan.purgeAt!, planId: s.plan.id },
      );
    }
    if (handlePurgeTimer && ev.kind === 'timer' && ev.job === 'purge' && s.plan) {
      out.push({ type: 'purge', planId: s.plan.id }, { type: 'cancel', keyPrefix: `${s.plan.id}:` });
      s.plan = null;
    }
    return out;
  });
}

for (const handlePurgeTimer of [true, false]) {
  test(`fast-forward past retention leaves zero plan rows (engine ${handlePurgeTimer ? 'purges on timer' : 'ignores timer; sweep is the backstop'})`, async () => {
    const env = makeEnv({ engine: planningEngine(handlePurgeTimer) });
    const scheduler = new Scheduler({ repo: env.repo, runner: env.runner, clock: env.clock, retention: new Retention(env.repo, env.logger), logger: env.logger });
    scheduler.start();
    await env.runner.handleInbound(textIn('g1', 'persona:ana', 'homi dinner tonight'));
    await env.runner.handleInbound(textIn('g1', 'persona:ben', 'sounds good'));
    const before = env.repo.counts();
    assert.equal(before.plans, 1);
    assert.equal(before.delivery, 1);
    assert.equal(before.jobs, 3);
    assert.equal(before.seen, 2);

    await env.clock.advance(3 * H + 24 * H + 1); // event + RETENTION_HOURS (+ seen TTL)
    const after = env.repo.counts();
    assert.deepEqual({ ...after, spaces: 0 }, { spaces: 0, plans: 0, delivery: 0, jobs: 0, seen: 0 });
    // the only thing left is the per-group settings row, holding no plan
    assert.equal(after.spaces, 1);
    assert.equal(env.repo.loadGroup(env.ids.space('sim', 'g1'))?.plan, null);
    scheduler.stop();
  });
}

test('sweep deletes seen hashes older than 24h and vacuums only after a purge', () => {
  const env = makeEnv();
  const r = new Retention(env.repo);
  env.repo.seen.checkAndMark(env.ids.msgHash('sim', 'c', '1'), 0);
  env.repo.seen.checkAndMark(env.ids.msgHash('sim', 'c', '2'), 20 * H);
  assert.deepEqual(r.sweep(10 * H), { plans: 0, delivery: 0, jobs: 0, seen: 0, vacuumed: false });
  const res = r.sweep(25 * H);
  assert.equal(res.seen, 1);
  assert.equal(res.vacuumed, true);
  assert.equal(env.repo.counts().seen, 1);
});
