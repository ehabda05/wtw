// Scheduled messages are at-most-once (docs/ARCHITECTURE.md "Exactly-once-ish").

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Sealer } from '../../src/privacy/crypto.js';
import { openDatabase } from '../../src/store/db.js';
import { Repo, STALE_FIRING_MS } from '../../src/store/repo.js';

const mk = () => new Repo(openDatabase(':memory:'), new Sealer(randomBytes(32)));

test('upsert by job_key replaces (reschedule never duplicates)', () => {
  const repo = mk();
  repo.jobs.upsert({ key: 'p1:remind:day', planId: 'p1', kind: 'remind_day', dueAt: 100, payload: { optionId: 2 } });
  repo.jobs.upsert({ key: 'p1:remind:day', planId: 'p1', kind: 'remind_day', dueAt: 200, payload: { optionId: 3 } });
  const all = repo.jobs.list();
  assert.equal(all.length, 1);
  assert.equal(all[0].dueAt, 200);
  assert.deepEqual(all[0].payload, { optionId: 3 });
  assert.equal(repo.jobs.nextDueAt(), 200);
});

test('claimDue is atomic and returns each job once', () => {
  const repo = mk();
  repo.jobs.upsert({ key: 'p1:a', planId: 'p1', kind: 'availability_nudge', dueAt: 10 });
  repo.jobs.upsert({ key: 'p1:b', planId: 'p1', kind: 'availability_deadline', dueAt: 20 });
  repo.jobs.upsert({ key: 'p1:c', planId: 'p1', kind: 'remind_day', dueAt: 999 });
  const first = repo.jobs.claimDue(50);
  assert.deepEqual(first.map((j) => j.jobKey), ['p1:a', 'p1:b']);
  assert.ok(first.every((j) => j.status === 'firing' && j.claimedAt === 50));
  assert.deepEqual(repo.jobs.claimDue(60), []);
  assert.ok(repo.jobs.markDone(first[0]));
  assert.equal(repo.jobs.get('p1:a')?.status, 'done');
  assert.deepEqual(repo.jobs.claimDue(70), [], 'done jobs never fire again');
});

test('recoverStale: firing jobs older than 2 minutes become failed and are never re-fired', () => {
  const repo = mk();
  repo.jobs.upsert({ key: 'p1:remind:hour', planId: 'p1', kind: 'remind_hour', dueAt: 1000 });
  const [job] = repo.jobs.claimDue(1000);
  assert.ok(job);
  // crash here: never marked done. A restart shortly after does not touch it...
  assert.equal(repo.jobs.recoverStale(1000 + 30_000), 0);
  // ...but once it is older than 2 minutes it is failed, not re-sent.
  assert.equal(repo.jobs.recoverStale(1000 + STALE_FIRING_MS), 1);
  assert.equal(repo.jobs.get('p1:remind:hour')?.status, 'failed');
  assert.deepEqual(repo.jobs.claimDue(10_000_000), []);
  assert.equal(repo.jobs.markDone(job), false, 'a late markDone cannot resurrect it');
});

test('a reschedule during firing is not clobbered by the stale markDone', () => {
  const repo = mk();
  repo.jobs.upsert({ key: 'p1:nudge', planId: 'p1', kind: 'availability_nudge', dueAt: 10 });
  const [job] = repo.jobs.claimDue(10);
  repo.jobs.upsert({ key: 'p1:nudge', planId: 'p1', kind: 'availability_nudge', dueAt: 500 }); // engine reschedules
  assert.equal(repo.jobs.markDone(job), false);
  assert.equal(repo.jobs.get('p1:nudge')?.status, 'pending');
  assert.equal(repo.jobs.claimDue(500).length, 1);
});

test('cancel by key prefix removes only pending jobs with that prefix', () => {
  const repo = mk();
  repo.jobs.upsert({ key: 'p1:remind:day', planId: 'p1', kind: 'remind_day', dueAt: 10 });
  repo.jobs.upsert({ key: 'p1:remind:hour', planId: 'p1', kind: 'remind_hour', dueAt: 20 });
  repo.jobs.upsert({ key: 'p1:nudge', planId: 'p1', kind: 'availability_nudge', dueAt: 30 });
  repo.jobs.upsert({ key: 'p10:remind:day', planId: 'p10', kind: 'remind_day', dueAt: 10 });
  assert.equal(repo.jobs.cancelByPrefix('p1:remind'), 2);
  assert.deepEqual(new Set(repo.jobs.list().map((j) => j.jobKey)), new Set(['p1:nudge', 'p10:remind:day']));
  assert.equal(repo.jobs.cancelByPrefix('%'), 0, 'prefix is literal, not a LIKE pattern');
});

test('job keys with spaces (i.e. text) are rejected by the schema', () => {
  const repo = mk();
  assert.throws(() => repo.jobs.upsert({ key: 'see you at 7', planId: 'p1', kind: 'remind_day', dueAt: 1 }));
});
