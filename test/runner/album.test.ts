// Album end to end through the runner and the sim: /photo delivers a photo inbound, bytes go to the encrypted
// store, album_keep / album_delete move and delete files, and no photo id, album id or caption is ever logged.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SimHub } from '../../src/channels/sim.js';
import type { ChannelInbound } from '../../src/channels/types.js';
import { applyEvent, detectAddressed, newGroupState } from '../../src/engine/index.js';
import type { AlbumState } from '../../src/engine/ext/album/model.js';
import type { GroupState } from '../../src/engine/types.js';
import { AlbumStore, createGallery } from '../../src/album/index.js';
import { Sealer } from '../../src/privacy/crypto.js';
import { Ids } from '../../src/privacy/ids.js';
import { createLogger } from '../../src/privacy/logger.js';
import { FakeClock } from '../../src/runner/clock.js';
import { createAlbumHandler } from '../../src/runner/handlers/album.js';
import { createExtHandlers } from '../../src/runner/handlers/index.js';
import { Runner } from '../../src/runner/runner.js';
import { openDatabase } from '../../src/store/db.js';
import { Repo } from '../../src/store/repo.js';

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47];

test('sim photoAs delivers a kind "photo" inbound with generated PNG bytes and the caption as text', async () => {
  const hub = new SimHub({ now: () => 42 });
  const got: ChannelInbound[] = [];
  await hub.start(async (m) => void got.push(m));
  const s = hub.createSpace(['ana', 'jo']);
  const ref = await hub.photoAs(s.id, 'jo', 'homi add', { replyTo: 'sim-1' });
  await hub.photoAs(s.id, 'ana');
  assert.equal(got[0].kind, 'photo');
  assert.equal(got[0].msgId, ref);
  assert.equal(got[0].text, 'homi add');
  assert.equal(got[0].replyTo, 'sim-1');
  assert.deepEqual(got[0].from, { handle: 'persona:jo', platformName: 'Jo' });
  assert.equal(got[0].photo?.mime, 'image/png');
  assert.deepEqual([...(got[0].photo?.bytes ?? []).slice(0, 4)], PNG_SIG);
  assert.equal(got[1].text, undefined);
  assert.equal(hub.transcript[0].text, '📷 homi add');
  assert.deepEqual(hub.transcript[0].photo, { mime: 'image/png', size: got[0].photo?.bytes.byteLength });
  assert.ok(!('bytes' in (hub.transcript[0].photo ?? {})), 'the transcript never holds image bytes');
});

test('createAlbumHandler is off without DATA_KEY; createExtHandlers wires the store when a key is passed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'homi-album-off-'));
  try {
    assert.deepEqual(createAlbumHandler({ dataDir: dir, now: Date.now }), { handler: null });
    const deps = { dataDir: dir, now: Date.now, dataKey: randomBytes(32), sweepIntervalMs: false as const };
    const ext = createExtHandlers(deps);
    assert.ok(ext.photoStore instanceof AlbumStore);
    assert.ok(ext.handlers.some((h) => h.types.includes('album_keep') && h.types.includes('album_delete')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runner + sim + engine: shared photos are kept encrypted, others deleted at once; delete album and stop clean up', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'homi-album-e2e-'));
  const lines: string[] = [];
  const logger = createLogger({ level: 'debug', sink: (l) => lines.push(l) });
  const clock = new FakeClock(Date.parse('2026-10-23T20:30:00-04:00'));
  const dataKey = randomBytes(32);
  const repo = new Repo(openDatabase(':memory:'), new Sealer(dataKey), { now: () => clock.now(), logger });
  const ids = new Ids('test-salt-0123456789abcdef');
  const album = createAlbumHandler({ dataDir: dir, dataKey, now: () => clock.now(), sweepIntervalMs: false });
  const hub = new SimHub({ now: () => clock.now() });
  const runner = new Runner({
    engine: { applyEvent, newGroupState, detectAddressed },
    repo, ids, clock, logger,
    config: { retentionHours: 24, quietHours: [23, 9], defaultTz: 'America/New_York' },
    adapters: [hub],
    handlers: [album.handler!],
    photoStore: album.photoStore,
    onSent: (info) => hub.annotate(info.msgRef, info.tag),
  });
  await hub.start((m) => runner.handleInbound(m));
  const s = hub.createSpace();
  const state = (): GroupState => repo.loadGroup(ids.space('sim', s.id))!;
  const albumDir = () => join(dir, 'albums', (state().space.ext?.album as AlbumState).id);
  const incoming = () => (existsSync(join(dir, 'albums', '_incoming')) ? readdirSync(join(dir, 'albums', '_incoming')) : []);
  try {
    await hub.say(s.id, 'you', 'homi start an album for tonight');
    await runner.whenIdle();
    const albumMsg = hub.lastHomiMessage(s.id)!;
    assert.match(albumMsg.text, /^Album "Our album · Fri Oct 23" is open to this group only: https:\/\/homi\.example\/a\/[0-9a-f-]{36} \(demo link\)\./);
    assert.equal(albumMsg.tag, 'album:open');
    const albumId = (state().space.ext?.album as AlbumState).id;

    await hub.photoAs(s.id, 'ana', 'homi add the crew');
    await hub.photoAs(s.id, 'ben'); // no caption: not shared on purpose
    await hub.photoAs(s.id, 'jo', 'homi add');
    await hub.photoAs(s.id, 'maya', 'homi add');
    await runner.whenIdle();
    assert.deepEqual(incoming(), [], 'the unshared photo was deleted right away, the shared ones moved');
    assert.equal(readdirSync(albumDir()).length, 3);
    assert.equal(hub.homiMessages(s.id).at(-1)?.text, '3 photos in the album from Ana, Jo and Maya.');
    assert.equal(hub.transcript.filter((e) => e.from === 'homi' && e.kind === 'react').length, 3);

    const page = await createGallery(album.photoStore as AlbumStore).handle(`/a/${albumId}`);
    assert.equal(page?.status, 200);
    assert.ok(String(page?.body).includes('<b>#1 Ana</b> <span>· the crew</span>'));
    const photoIds = (state().space.ext?.album as AlbumState).photos.map((p) => p.photoId);

    await hub.say(s.id, 'jo', 'homi remove my photos');
    await runner.whenIdle();
    assert.equal(hub.lastHomiMessage(s.id)?.text, "Removed Jo's photo; 2 left in the album.");
    assert.equal(readdirSync(albumDir()).length, 2);

    await hub.say(s.id, 'ben', 'homi delete album');
    await runner.whenIdle();
    assert.equal(existsSync(join(dir, 'albums', albumId)), false);
    assert.equal((await createGallery(album.photoStore as AlbumStore).handle(`/a/${albumId}`))?.status, 404);

    await hub.say(s.id, 'you', 'homi start an album');
    await hub.photoAs(s.id, 'ana', 'homi add');
    await runner.whenIdle();
    const second = (state().space.ext?.album as AlbumState).id;
    assert.equal(readdirSync(join(dir, 'albums', second)).length, 1);
    await hub.say(s.id, 'ana', 'homi stop');
    await runner.whenIdle();
    assert.equal(existsSync(join(dir, 'albums', second)), false, '"homi stop" deleted every photo');

    const all = lines.join('\n');
    for (const secret of [albumId, second, 'the crew', ...photoIds]) assert.ok(!all.includes(secret), `logs leak ${secret}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
