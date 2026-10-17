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

test('every engine job kind is accepted by the jobs.kind CHECK (schema v3 adds the demo quorum jobs)', () => {
  const repo = mk();
  const kinds = [
    'availability_nudge', 'availability_escalate', 'availability_deadline', 'bridge_timeout', 'dates_nudge', 'dates_abandon',
    'details_nudge', 'hungry_deadline', 'remind_day', 'remind_hour', 'remind_30', 'complete', 'purge', 'ext', 'quorum_dm', 'quorum_close',
  ] as const;
  for (const kind of kinds) repo.jobs.upsert({ key: `p1:${kind}`, planId: 'p1', kind, dueAt: 100 });
  assert.equal(repo.jobs.list().length, kinds.length);
});

test('migration v2 -> v3 rebuilds the jobs table and keeps its rows', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { migrate, SCHEMA_VERSION } = await import('../../src/store/db.js');
  const db = new DatabaseSync(':memory:');
  // A v2 database: the jobs table without the quorum kinds, one pending job in it.
  db.exec(`CREATE TABLE jobs (
    job_key TEXT PRIMARY KEY, plan_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('availability_nudge', 'availability_deadline', 'remind_day', 'ext')),
    due_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', payload BLOB, claimed_at INTEGER) STRICT;
    CREATE INDEX jobs_by_due ON jobs (status, due_at); CREATE INDEX jobs_by_plan ON jobs (plan_id);
    INSERT INTO jobs (job_key, plan_id, kind, due_at) VALUES ('p1:availability_deadline', 'p1', 'availability_deadline', 5);
    PRAGMA user_version = 2;`);
  migrate(db);
  assert.equal((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, SCHEMA_VERSION);
  assert.equal((db.prepare("SELECT count(*) AS n FROM jobs WHERE job_key = 'p1:availability_deadline'").get() as { n: number }).n, 1);
  db.prepare("INSERT INTO jobs (job_key, plan_id, kind, due_at) VALUES ('p1:quorum_dm', 'p1', 'quorum_dm', 6)").run();
  assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'jobs_old'").get(), undefined, 'the old table is gone');
});
