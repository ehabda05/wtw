import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { GroupState } from '../../src/engine/types.js';
import { Sealer } from '../../src/privacy/crypto.js';
import { Ids } from '../../src/privacy/ids.js';
import { openDatabase } from '../../src/store/db.js';
import { Repo } from '../../src/store/repo.js';
import { makePlan } from '../runner/helpers.js';

const ids = new Ids('repo-test-salt-0123456789');
const mk = (path = ':memory:') => new Repo(openDatabase(path), new Sealer(randomBytes(32)), { now: () => 1000 });

function group(spaceKey: string, plan = makePlan('plan-1')): GroupState {
  return {
    space: { spaceKey, introSent: true, tone: 'normal', tz: 'America/New_York', notice: false, muted: false },
    plan,
    lastUnpromptedAt: 42,
  };
}

test('saveGroup / loadGroup roundtrip and routing', () => {
  const repo = mk();
  const sk = ids.space('sim', 'chat-1');
  const member = ids.member('sim', 'chat-1', 'persona:ana');
  const plan = makePlan('plan-1', { members: { [member]: { key: member, name: 'Ana', status: 'pending', dayPrefs: {}, optionVotes: {}, optInDm: false, optInCall: false, hasDelivery: false, nudgeCount: 0, joinedAt: 1 } }, purgeAt: 5000, eventAt: 4000 });
  repo.saveGroup(group(sk, plan), { surface: 'sim', spaceId: 'chat-1' });
  const back = repo.loadGroup(sk);
  assert.ok(back);
  assert.deepEqual(back.plan, plan);
  assert.equal(back.lastUnpromptedAt, 42);
  assert.equal(back.space.introSent, true);
  assert.deepEqual(repo.getRouting(sk), { surface: 'sim', spaceId: 'chat-1' });
  assert.equal(repo.spaceForPlan('plan-1'), sk);
  assert.equal(repo.loadGroup(ids.space('sim', 'other')), null);
});

test('a replaced or purged plan is deleted with its delivery and jobs', () => {
  const repo = mk();
  const sk = ids.space('sim', 'chat-1');
  repo.saveGroup(group(sk, makePlan('old')), { surface: 'sim', spaceId: 'chat-1' });
  repo.delivery.put(ids.member('sim', 'chat-1', 'h'), 'old', '+16175550134');
  repo.jobs.upsert({ key: 'old:remind:day', planId: 'old', kind: 'remind_day', dueAt: 10 });
  repo.saveGroup(group(sk, makePlan('new')), { surface: 'sim', spaceId: 'chat-1' });
  assert.deepEqual(repo.counts(), { spaces: 1, plans: 1, delivery: 0, jobs: 0, seen: 0 });
  repo.saveGroup(group(sk, makePlan('new', { state: 'purged' })), { surface: 'sim', spaceId: 'chat-1' });
  assert.equal(repo.counts().plans, 0);
  assert.equal(repo.loadGroup(sk)?.plan, null);
});

test('tombstone keeps only the hashed key and muted flag', () => {
  const repo = mk();
  const sk = ids.space('imessage-local', 'any;+;chat1');
  repo.saveGroup(group(sk), { surface: 'imessage-local', spaceId: 'any;+;chat1' });
  repo.tombstone(sk, 'imessage-local');
  assert.equal(repo.isMuted(sk), true);
  assert.equal(repo.getRouting(sk), null);
  assert.equal(repo.loadGroup(sk), null);
  const row = repo.db.prepare('SELECT * FROM spaces').get() as Record<string, unknown>;
  assert.equal(row.settings_blob, null);
  assert.equal(row.space_id_sealed, null);
  assert.equal(repo.counts().plans, 0);
});

test('deleteSpace removes everything for that space', () => {
  const repo = mk();
  const sk = ids.space('sim', 'c');
  repo.saveGroup(group(sk), { surface: 'sim', spaceId: 'c' });
  repo.jobs.upsert({ key: 'plan-1:x', planId: 'plan-1', kind: 'purge', dueAt: 1 });
  repo.deleteSpace(sk);
  assert.deepEqual(repo.counts(), { spaces: 0, plans: 0, delivery: 0, jobs: 0, seen: 0 });
});

test('delivery handles are sealed: the raw phone never appears in the database file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'homi-repo-'));
  const path = join(dir, 'homi.db');
  const repo = mk(path);
  const sk = ids.space('sim', 'chat-9');
  const phone = '+16175550134';
  const memberName = 'Zebulon';
  repo.saveGroup(
    group(sk, makePlan('p9', { neighborhood: 'Harvard Square', notes: { parking: 'behind the building' }, members: { m: { key: 'm', name: memberName, status: 'pending', dayPrefs: {}, optionVotes: {}, optInDm: true, optInCall: true, hasDelivery: true, nudgeCount: 0, joinedAt: 0 } } })),
    { surface: 'sim', spaceId: 'chat-9-secret-id' },
  );
  const mkey = ids.member('sim', 'chat-9', 'persona:zeb');
  repo.delivery.put(mkey, 'p9', phone);
  assert.equal(repo.delivery.get(mkey, 'p9'), phone);
  assert.deepEqual(repo.delivery.findByHandle('+1 (617) 555-0134'), [{ memberKey: mkey, planId: 'p9' }]);
  repo.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  repo.db.close();
  for (const f of readdirSync(dir)) {
    const bytes = readFileSync(join(dir, f)).toString('latin1');
    for (const secret of [phone, '6175550134', memberName, 'Harvard Square', 'behind the building', 'chat-9-secret-id']) {
      assert.ok(!bytes.includes(secret), `${f} contains plaintext "${secret}"`);
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

test('seen.checkAndMark dedupes', () => {
  const repo = mk();
  const h = ids.msgHash('sim', 'c', 'm1');
  assert.equal(repo.seen.checkAndMark(h, 1), true);
  assert.equal(repo.seen.checkAndMark(h, 2), false);
  assert.equal(repo.seen.purgeOlderThan(2), 1);
  assert.equal(repo.seen.checkAndMark(h, 3), true);
});

test('a blob sealed for one row cannot be opened as another (AAD binding)', () => {
  const repo = mk();
  const a = ids.space('sim', 'a');
  const b = ids.space('sim', 'b');
  repo.saveGroup(group(a, makePlan('pa')), { surface: 'sim', spaceId: 'a' });
  repo.saveGroup(group(b, makePlan('pb')), { surface: 'sim', spaceId: 'b' });
  // swap settings blobs between rows: both must fail to open (treated as new space), never cross-read
  const ra = repo.db.prepare('SELECT settings_blob FROM spaces WHERE space_key = ?').get(a) as { settings_blob: Uint8Array };
  repo.db.prepare('UPDATE spaces SET settings_blob = ? WHERE space_key = ?').run(ra.settings_blob, b);
  assert.equal(repo.loadGroup(b), null);
  assert.equal(repo.loadGroup(a)?.plan?.id, 'pa');
});
