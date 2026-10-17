// Gallery page and HTTP route: only existing album ids are served, images decrypt on the fly, HTML is escaped,
// and album paths, photo ids and captions never reach the logs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AlbumStore, createGallery, galleryFor, renderAlbumPage, samplePhoto } from '../../src/album/index.js';
import { startHttpServer } from '../../src/http/server.js';
import { Sealer } from '../../src/privacy/crypto.js';
import { createLogger } from '../../src/privacy/logger.js';

const ALBUM = '7f327e39-8467-4d4c-9063-c15b8df252b8';

async function withStore(fn: (store: AlbumStore, ids: string[]) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'homi-gallery-test-'));
  try {
    const store = new AlbumStore({ dataDir: dir, sealer: new Sealer(randomBytes(32)) });
    const ids: string[] = [];
    for (const [name, caption] of [['Ana', 'the crew'], ['Maya', undefined]] as const) {
      const id = await store.put(samplePhoto(name), 'image/png');
      await store.keep(ALBUM, id, { spaceKey: 'sk', title: 'Ramen night · Fri Oct 23', photo: { name, caption, addedAt: 1 } });
      ids.push(id);
    }
    await fn(store, ids);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('renderAlbumPage escapes member text and labels the page members-only', () => {
  const html = renderAlbumPage({
    albumId: ALBUM,
    title: 'Ramen <script>alert(1)</script>',
    photos: [{ photoId: 'p1', mime: 'image/png', addedAt: 1, name: 'Ana "A"', caption: '<img src=x onerror=1>' }],
  });
  assert.ok(!html.includes('<script>alert'));
  assert.ok(!html.includes('<img src=x'));
  assert.match(html, /Ramen &lt;script&gt;/);
  assert.match(html, /Members only · 1 photo/);
  assert.match(html, /<img src="\/a\/7f327e39-8467-4d4c-9063-c15b8df252b8\/p1"/);
  assert.match(html, /#1 Ana &quot;A&quot;/);
});

test('gallery handler serves only existing albums and their own photos', async () => {
  await withStore(async (store, [p1, p2]) => {
    const g = createGallery(store);
    assert.equal(galleryFor(store) !== undefined, true);
    assert.equal(galleryFor(undefined), undefined);
    const page = await g.handle(`/a/${ALBUM}`);
    assert.equal(page?.status, 200);
    assert.match(String(page?.body), /Ramen night · Fri Oct 23/);
    assert.match(String(page?.body), new RegExp(`/a/${ALBUM}/${p1}`));
    assert.equal(page?.headers['x-robots-tag'], 'noindex, nofollow');
    const img = await g.handle(`/a/${ALBUM}/${p2}`);
    assert.equal(img?.status, 200);
    assert.equal(img?.headers['content-type'], 'image/png');
    assert.ok(Buffer.from(samplePhoto('Maya')).equals(img?.body as Buffer));
    for (const bad of ['/a/nope', `/a/${ALBUM}/nope`, '/a/..%2F..%2Fetc', `/a/${ALBUM}/..%2Findex.sealed`, '/a/_incoming', '/a', '/a/%E0%A4%A']) {
      assert.equal((await g.handle(bad))?.status, 404, bad);
    }
    assert.equal(await g.handle('/health'), null);
  });
});

test('HTTP: GET /a/<albumId> and /a/<albumId>/<photoId>; unknown ids 404; paths never logged', async () => {
  await withStore(async (store, [p1]) => {
    const lines: string[] = [];
    const server = await startHttpServer(0, { album: createGallery(store), logger: createLogger({ level: 'debug', sink: (l) => lines.push(l) }) });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const page = await fetch(`${base}/a/${ALBUM}`);
      assert.equal(page.status, 200);
      assert.match(page.headers.get('content-type') ?? '', /text\/html/);
      assert.match(page.headers.get('content-security-policy') ?? '', /default-src 'none'/);
      assert.match(await page.text(), /#2 Maya/);
      const img = await fetch(`${base}/a/${ALBUM}/${p1}`);
      assert.equal(img.status, 200);
      assert.equal(img.headers.get('content-type'), 'image/png');
      assert.ok(Buffer.from(await img.arrayBuffer()).equals(Buffer.from(samplePhoto('Ana'))));
      assert.equal((await fetch(`${base}/a/${'0'.repeat(36)}`)).status, 404);
      assert.equal((await fetch(`${base}/a/${ALBUM}/${'0'.repeat(32)}`)).status, 404);
    } finally {
      await new Promise((r) => server.close(r));
    }
    const noAlbum = await startHttpServer(0, {});
    try {
      assert.equal((await fetch(`http://127.0.0.1:${(noAlbum.address() as AddressInfo).port}/a/${ALBUM}`)).status, 404);
    } finally {
      await new Promise((r) => noAlbum.close(r));
    }
    const all = lines.join('\n');
    assert.ok(!all.includes(ALBUM) && !all.includes(p1) && !all.includes('the crew'));
  });
});
