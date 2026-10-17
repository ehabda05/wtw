import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { JobKind } from '../../src/engine/types.js';
import { Scheduler } from '../../src/runner/scheduler.js';
import { fakeEngine, makeEnv, makePlan, textIn } from './helpers.js';

const M = 60_000;

function schedulingEngine(jobs: { key: string; job: JobKind; inMs: number; payload?: Record<string, unknown> }[]) {
  const fired: { job: string; at: number; payload?: unknown }[] = [];
  const engine = fakeEngine((s, ev, ctx) => {
    if (ev.kind === 'message' && !s.plan) {
      s.plan = makePlan('plan-1');
      return jobs.map((j) => ({ type: 'schedule' as const, key: `plan-1:${j.key}`, job: j.job, at: ctx.now + j.inMs, planId: 'plan-1', ...(j.payload ? { payload: j.payload } : {}) }));
    }
    if (ev.kind === 'timer') {
      fired.push({ job: ev.job, at: ctx.now, payload: ev.payload });
      return [{ type: 'send', text: `timer ${ev.job}`, prompting: 'unprompted' }];
    }
  });
  return { engine, fired };
}

test('FakeClock fast-forward fires due jobs in order, each at its own due time, exactly once', async () => {
  const { engine, fired } = schedulingEngine([
    { key: 'deadline', job: 'availability_deadline', inMs: 120 * M },
    { key: 'nudge', job: 'availability_nudge', inMs: 30 * M, payload: { round: 1 } },
    { key: 'remind', job: 'remind_day', inMs: 600 * M },
  ]);
  const env = makeEnv({ engine });
  const t0 = env.clock.now();
  const s = new Scheduler({ repo: env.repo, runner: env.runner, clock: env.clock });
  s.start();
  await env.runner.handleInbound(textIn('g1', 'persona:ana', 'homi plan'));
  await env.clock.advance(150 * M);
  assert.deepEqual(fired.map((f) => [f.job, f.at - t0]), [['availability_nudge', 30 * M], ['availability_deadline', 120 * M]]);
  assert.deepEqual(fired[0].payload, { round: 1 });
  assert.equal(env.clock.now(), t0 + 150 * M);
  await env.clock.advance(12 * 60 * M);
  assert.deepEqual(fired.map((f) => f.job), ['availability_nudge', 'availability_deadline', 'remind_day']);
  await env.clock.advance(48 * 60 * M);
  assert.equal(fired.length, 3, 'never re-fired');
  assert.ok(env.repo.jobs.list().every((j) => j.status === 'done'));
  assert.equal(env.adapter.sends().filter((t) => t.startsWith('timer')).length, 3);
  s.stop();
});

test('crash between claim and done: the job is failed at restart and never re-sent', async () => {
  const { engine, fired } = schedulingEngine([{ key: 'remind', job: 'remind_hour', inMs: 10 * M }]);
  const env = makeEnv({ engine });
  await env.runner.handleInbound(textIn('g1', 'persona:ana', 'homi plan'));
  env.clock.set(env.clock.now() + 10 * M);
  const claimed = env.repo.jobs.claimDue(env.clock.now()); // process 1 claims... and dies
  assert.equal(claimed.length, 1);
  env.clock.set(env.clock.now() + 3 * M);
  const s = new Scheduler({ repo: env.repo, runner: env.runner, clock: env.clock }); // process 2 boots
  s.start();
  await env.clock.advance(60 * M);
  assert.equal(fired.length, 0);
  assert.equal(env.repo.jobs.get('plan-1:remind')?.status, 'failed');
  s.stop();
});

test('a job whose dispatch throws is marked failed, not retried; a job for a missing plan fails quietly', async () => {
  let throws = true;
  const engine = fakeEngine((s, ev, ctx) => {
    if (ev.kind === 'message' && !s.plan) {
      s.plan = makePlan('plan-1');
      return [{ type: 'schedule', key: 'plan-1:n', job: 'availability_nudge', at: ctx.now + M, planId: 'plan-1' }];
    }
    if (ev.kind === 'timer' && throws) throw new Error('engine bug');
  });
  const env = makeEnv({ engine });
  const s = new Scheduler({ repo: env.repo, runner: env.runner, clock: env.clock, logger: env.logger });
  s.start();
  await env.runner.handleInbound(textIn('g1', 'persona:ana', 'homi plan'));
  await env.clock.advance(2 * M);
  assert.equal(env.repo.jobs.get('plan-1:n')?.status, 'failed');
  throws = false;
  await env.clock.advance(60 * M);
  assert.equal(engine.events.filter((e) => e.kind === 'timer').length, 1);

  env.repo.jobs.upsert({ key: 'ghost:x', planId: 'ghost', kind: 'purge', dueAt: env.clock.now() });
  await s.tick();
  assert.equal(env.repo.jobs.get('ghost:x')?.status, 'failed');
  s.stop();
});

test('timers for muted spaces are not delivered', async () => {
  const { engine, fired } = schedulingEngine([{ key: 'n', job: 'availability_nudge', inMs: M }]);
  const env = makeEnv({ engine });
  const s = new Scheduler({ repo: env.repo, runner: env.runner, clock: env.clock });
  s.start();
  await env.runner.handleInbound(textIn('g1', 'persona:ana', 'homi plan'));
  // mute without deleting the plan row (simulate a race): dispatch must refuse
  env.repo.db.prepare('UPDATE spaces SET muted = 1').run();
  await env.clock.advance(5 * M);
  assert.equal(fired.length, 0);
  s.stop();
});
