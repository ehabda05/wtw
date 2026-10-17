// Encrypted photo store: sealed at rest, keep moves incoming -> album, delete, sweep of unkept photos, limits.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AlbumStore, INCOMING_TTL_MS, MAX_PHOTO_BYTES, PhotoRejected, samplePhoto } from '../../src/album/index.js';
import { Sealer } from '../../src/privacy/crypto.js';

function setup(): { dir: string; key: Buffer; clock: { t: number }; store: AlbumStore; done: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'homi-album-test-'));
  const key = randomBytes(32);
  const clock = { t: Date.UTC(2026, 9, 24, 0, 30) };
  const store = new AlbumStore({ dataDir: dir, sealer: new Sealer(key), now: () => clock.t });
  return { dir, key, clock, store, done: () => rmSync(dir, { recursive: true, force: true }) };
}

const ALBUM = 'a1b2c3d4-e5f6-4711-8899-aabbccddeeff';
const PNG = samplePhoto('test');

test('put seals bytes into _incoming; keep moves them into the album; photo() decrypts them back', async () => {
  const { dir, key, store, done } = setup();
  try {
    const id = await store.put(PNG, 'image/png');
    assert.match(id, /^[0-9a-f]{32}$/);
    const incoming = join(dir, 'albums', '_incoming', id);
    const raw = readFileSync(incoming);
    assert.ok(!raw.includes(Buffer.from(PNG).subarray(0, 8)), 'no PNG signature on disk: ciphertext only');
    assert.notEqual(raw.length, PNG.length);
    assert.equal(await store.keep(ALBUM, id, { spaceKey: 'sk1', title: 'Ramen night · Fri Oct 23', photo: { name: 'Ana', caption: 'the crew', addedAt: 1 } }), true);
    assert.equal(existsSync(incoming), false);
    assert.ok(existsSync(join(dir, 'albums', ALBUM, id)));
    assert.equal(await store.keep(ALBUM, id, { title: 'Ramen night · Fri Oct 23' }), true, 'idempotent, keeps the metadata');
    const got = await store.photo(ALBUM, id);
    assert.equal(got?.mime, 'image/png');
    assert.ok(got && Buffer.from(PNG).equals(got.bytes));
    const a = await store.album(ALBUM);
    assert.equal(a?.title, 'Ramen night · Fri Oct 23');
    assert.deepEqual(a?.photos.map((p) => [p.name, p.caption]), [['Ana', 'the crew']]);
    // The index is sealed too, and readable by a fresh store with the same key only.
    assert.ok(!readFileSync(join(dir, 'albums', 'index.sealed')).toString('latin1').includes('Ramen'));
    const again = new AlbumStore({ dataDir: dir, sealer: new Sealer(key) });
    assert.equal((await again.album(ALBUM))?.photos.length, 1);
    const wrong = new AlbumStore({ dataDir: dir, sealer: new Sealer(randomBytes(32)) });
    await assert.rejects(wrong.album(ALBUM));
  } finally {
    done();
  }
});

test('remove deletes kept and incoming photos; prune drops the space\'s other albums', async () => {
  const { dir, store, done } = setup();
  try {
    const [p1, p2, p3, p4] = await Promise.all([1, 2, 3, 4].map(() => store.put(PNG, 'image/png')));
    await store.keep(ALBUM, p1, { spaceKey: 'sk1', title: 'A' });
    await store.keep(ALBUM, p2, { spaceKey: 'sk1', title: 'A' });
    await store.keep('old-album', p3, { spaceKey: 'sk1', title: 'Old' });
    assert.equal(await store.remove([p1, p4]), 2, 'one kept file and one incoming file');
    assert.equal(existsSync(join(dir, 'albums', ALBUM, p1)), false);
    assert.equal(existsSync(join(dir, 'albums', '_incoming', p4)), false);
    assert.deepEqual((await store.album(ALBUM))?.photos.map((p) => p.photoId), [p2]);
    assert.equal(await store.photo(ALBUM, p1), null);
    assert.equal(await store.prune('sk1', ALBUM), 1);
    assert.equal(await store.album('old-album'), null);
    assert.equal(existsSync(join(dir, 'albums', 'old-album')), false);
    assert.ok(await store.album(ALBUM));
    assert.equal(await store.prune('sk1'), 1, 'stop / delete album: nothing kept for the space');
    assert.equal(existsSync(join(dir, 'albums', ALBUM)), false);
  } finally {
    done();
  }
});

test('photos nobody keeps are swept after 10 minutes, and leftovers from an earlier run right away', async () => {
  const { dir, clock, store, done } = setup();
  try {
    const kept = await store.put(PNG, 'image/png');
    const unkept = await store.put(PNG, 'image/png');
    writeFileSync(join(dir, 'albums', '_incoming', 'leftover'), 'sealed bytes from a crashed run');
    await store.keep(ALBUM, kept, { title: 'A' });
    assert.equal(await store.sweep(), 1, 'the leftover goes first');
    assert.deepEqual(readdirSync(join(dir, 'albums', '_incoming')), [unkept]);
    clock.t += INCOMING_TTL_MS - 1;
    assert.equal(await store.sweep(), 0);
    clock.t += 1;
    assert.equal(await store.sweep(), 1);
    assert.deepEqual(readdirSync(join(dir, 'albums', '_incoming')), []);
    assert.equal(await store.keep(ALBUM, unkept, { title: 'A' }), false, 'too late to keep');
    assert.ok(await store.photo(ALBUM, kept), 'kept photos are never swept');
  } finally {
    done();
  }
});

test('only jpeg / png / webp / heic up to 10 MB; ids are path-safe', async () => {
  const { store, done } = setup();
  try {
    for (const mime of ['image/gif', 'text/html', 'application/octet-stream']) await assert.rejects(store.put(PNG, mime), PhotoRejected);
    await assert.rejects(store.put(new Uint8Array(MAX_PHOTO_BYTES + 1), 'image/jpeg'), PhotoRejected);
    await assert.rejects(store.put(new Uint8Array(0), 'image/jpeg'), PhotoRejected);
    const jpg = await store.put(new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]), 'Image/JPG');
    await store.keep(ALBUM, jpg, { title: 'A' });
    assert.equal((await store.photo(ALBUM, jpg))?.mime, 'image/jpeg');
    for (const m of ['image/webp', 'image/heic']) assert.match(await store.put(PNG, m), /^[0-9a-f]{32}$/);
    assert.equal(await store.keep('../escape', jpg, { title: 'x' }), false);
    assert.equal(await store.keep('_incoming', jpg, { title: 'x' }), false);
    assert.equal(await store.album('../../etc'), null);
    assert.equal(await store.photo(ALBUM, '../index.sealed'), null);
  } finally {
    done();
  }
});
