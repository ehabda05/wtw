import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { startWebServer, type WebServer } from '../../src/web/server.js';
import { getJson, openEvents, post } from './helpers.js';

const START = '2026-10-17T10:00:00-04:00';
let web: WebServer;

before(async () => {
  web = await startWebServer({ llm: null, port: 0, host: '127.0.0.1', start: START });
});
after(async () => {
  await web.close();
});

test('serves the app, its assets and the Homi icon; nothing outside public/', async () => {
  const page = await fetch(web.url);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Simulated iMessage · real Homi engine/);
  assert.match(html, /apple-mobile-web-app-capable/);
  assert.match(page.headers.get('content-security-policy') ?? '', /default-src 'self'/);
  for (const [path, type] of [['app.js', 'javascript'], ['style.css', 'css'], ['icon.png', 'image/png'], ['manifest.webmanifest', 'manifest']]) {
    const r = await fetch(new URL(path, web.url));
    assert.equal(r.status, 200, path);
    assert.match(r.headers.get('content-type') ?? '', new RegExp(type), path);
  }
  assert.equal((await fetch(new URL('/nope.js', web.url))).status, 404);
  assert.equal((await fetch(new URL('/%2e%2e/package.json', web.url))).status, 404);
  assert.equal(web.token, null, 'no token on loopback');
});

test('a message from "you" reaches the real engine: Homi posts options, live over SSE and in the transcript', async () => {
  await post(web.url, '/api/reset', { start: START });
  const events = await openEvents(new URL('/events', web.url).href);
  try {
    const snap = await events.next((e) => e.event === 'snapshot');
    assert.deepEqual((snap.data as { entries: unknown[] }).entries, []);
    const r = await post(web.url, '/api/say', { persona: 'you', text: '@homi dinner next week?' });
    assert.equal(r.status, 200);
    assert.match(r.body.ref, /^u-\d+$/);
    const opt = await events.next((e) => e.event === 'entry' && (e.data as { from: string; text: string }).from === 'homi' && /^3 · /.test((e.data as { text: string }).text));
    assert.match((opt.data as { text: string }).text, /^3 · Sat Oct 24 · 7pm$/);
    const t = await getJson(web.url, '/api/transcript');
    const options = t.entries.filter((e: { from: string; text: string }) => e.from === 'homi' && /^\d · /.test(e.text));
    assert.deepEqual(options.map((e: { text: string }) => e.text), ['1 · Thu Oct 22 · 7pm', '2 · Fri Oct 23 · 7pm', '3 · Sat Oct 24 · 7pm']);
    assert.ok(t.entries.every((e: { seq: number }) => e.seq > 0), 'every entry has a sequence number');

    // Tapback on option 2 as Jo, then a threaded reply as Ana.
    assert.equal((await post(web.url, '/api/react', { persona: 'jo', emoji: '❤️', target: '2' })).status, 200);
    const react = await events.next((e) => e.event === 'entry' && (e.data as { kind: string; from: string }).kind === 'react' && (e.data as { from: string }).from === 'jo');
    assert.equal((react.data as { target: string }).target, options[1].ref);
    const edit = await events.next((e) => e.event === 'entry' && (e.data as { kind: string }).kind === 'edit');
    assert.match((edit.data as { text: string }).text, /Fri 1/);
    const reply = await post(web.url, '/api/say', { persona: 'ana', text: 'works for me', replyTo: options[1].ref });
    assert.equal(reply.status, 200);
  } finally {
    events.close();
  }
});

test('bad input is a 400 with a reason; cross-site and non-JSON posts are refused', async () => {
  const bad = await post(web.url, '/api/say', { persona: 'zed', text: 'hi' });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /unknown persona/);
  assert.equal((await post(web.url, '/api/say', { persona: 'ana', text: '   ' })).status, 400);
  assert.equal((await post(web.url, '/api/react', { persona: 'ana', emoji: '❤️', target: 'sim-9999' })).status, 400);
  assert.equal((await post(web.url, '/api/ff', { ms: -5 })).status, 400);
  assert.equal((await post(web.url, '/api/reset', {}, { origin: 'http://evil.example' })).status, 403);
  const plain = await fetch(new URL('/api/reset', web.url), { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
  assert.equal(plain.status, 415);
});

test('fast-forward fires the nudge and the simulated call; typing the answer resolves it', async () => {
  await post(web.url, '/api/reset', { start: START });
  await post(web.url, '/api/say', { persona: 'you', text: '@homi dinner next week?' });
  await post(web.url, '/api/say', { persona: 'sam', text: 'homi you can call me' });
  const ff = await post(web.url, '/api/ff', { duration: '12h' });
  assert.equal(ff.status, 200);
  assert.equal(ff.body.now, Date.parse('2026-10-17T22:00:00-04:00'));
  let state = await getJson(web.url, '/api/state');
  assert.equal(state.call?.persona, 'sam');
  assert.equal(state.call?.state, 'ringing');
  assert.ok(state.entries.some((e: { from: string; text: string }) => e.from === 'system' && /Fast-forward \+12h/.test(e.text)));

  const ans = await post(web.url, '/api/answer', { persona: 'sam', text: 'friday works' });
  assert.deepEqual(ans.body, { ok: true, answered: true });
  state = await getJson(web.url, '/api/state');
  assert.equal(state.call.state, 'answered');
  assert.ok(state.entries.some((e: { from: string; text: string }) => e.from === 'homi' && /Sam's in for Fri \(by phone\)/.test(e.text)));

  // An answer with no call ringing is remembered for the next call (the script's /answer line).
  assert.deepEqual((await post(web.url, '/api/answer', { persona: 'ben', text: 'saturday' })).body, { ok: true, answered: false });
  const next = await post(web.url, '/api/ff', { nextDay: true });
  assert.equal(next.body.now, Date.parse('2026-10-18T10:00:00-04:00'));
});

test('reset starts a fresh chat for every connected browser', async () => {
  await post(web.url, '/api/say', { persona: 'maya', text: 'guys we never hang out anymore' });
  const a = await openEvents(new URL('/events', web.url).href);
  const b = await openEvents(new URL('/events', web.url).href);
  try {
    await a.next((e) => e.event === 'snapshot');
    await b.next((e) => e.event === 'snapshot');
    assert.equal((await post(web.url, '/api/reset', { start: START })).status, 200);
    for (const s of [a, b]) {
      const snap = await s.next((e) => e.event === 'snapshot' && (e.data as { entries: unknown[] }).entries.length === 0);
      assert.equal((snap.data as { now: number }).now, Date.parse(START));
    }
    assert.deepEqual((await getJson(web.url, '/api/transcript')).entries, []);
  } finally {
    a.close();
    b.close();
  }
});

test('beyond loopback every request needs the access token (?k= once, then the cookie)', async () => {
  const locked = await startWebServer({ llm: null, port: 0, host: '127.0.0.1', token: 'test-token-123', start: START });
  try {
    assert.equal((await fetch(locked.url)).status, 403);
    assert.equal((await fetch(new URL('/events', locked.url))).status, 403);
    assert.equal((await fetch(new URL('/?k=wrong', locked.url))).status, 403);
    const ok = await fetch(new URL('/?k=test-token-123', locked.url));
    assert.equal(ok.status, 200);
    const cookie = (ok.headers.get('set-cookie') ?? '').split(';')[0];
    assert.match(cookie, /^wtw_k=/);
    const withCookie = await fetch(new URL('/api/state', locked.url), { headers: { cookie } });
    assert.equal(withCookie.status, 200);
    const say = await fetch(new URL('/api/say?k=test-token-123', locked.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ persona: 'you', text: 'hi' }),
    });
    assert.equal(say.status, 200);
  } finally {
    await locked.close();
  }
});

test('a malformed request target ("//") gets an answer and never crashes the server', async () => {
  const { request } = await import('node:http');
  const port = Number(new URL(web.url).port);
  const status = await new Promise<number>((resolve, reject) => {
    const r = request({ host: '127.0.0.1', port, path: '//', method: 'GET' }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    r.on('error', reject);
    r.end();
  });
  assert.ok(status >= 200 && status < 500, `status ${status}`);
  const again = await fetch(new URL('/', web.url));
  assert.equal(again.status, 200);
});
