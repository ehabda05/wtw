import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_PERSONAS } from '../../src/channels/sim.js';
import { gapFor, parseScript } from '../../src/web/script.js';
import { startWebServer, type WebServer } from '../../src/web/server.js';
import { getJson, post, until } from './helpers.js';

let web: WebServer;

before(async () => {
  web = await startWebServer({ llm: null, port: 0, host: '127.0.0.1' });
});
after(async () => {
  await web.close();
});

test('parses demo/demo.sim.txt with the sim syntax; gaps are 1.2-2.5 s, /ff and /answer are instant', () => {
  const lines = parseScript(readFileSync('demo/demo.sim.txt', 'utf8'), DEFAULT_PERSONAS);
  assert.ok(lines.length > 60);
  assert.deepEqual(lines[0], { kind: 'say', persona: 'maya', text: 'guys we never hang out anymore', raw: 'maya: guys we never hang out anymore' });
  assert.ok(lines.some((l) => l.kind === 'react' && l.persona === 'jo' && l.emoji === '❤️' && l.target === '2'));
  assert.ok(lines.some((l) => l.kind === 'answer' && l.persona === 'sam' && l.text === 'friday works'));
  assert.ok(lines.some((l) => l.kind === 'ff' && l.ms === 12 * 3_600_000));
  assert.ok(lines.some((l) => l.kind === 'photo' && l.persona === 'jo' && l.caption === 'homi add'));
  for (const l of lines) {
    const g = gapFor(l);
    if (l.kind === 'ff' || l.kind === 'answer') assert.equal(g, 0);
    else assert.ok(g >= 1200 && g <= 2500, l.raw);
  }
});

test('script play starts (resetting to Sat Oct 17, 10am) and stop stops it', async () => {
  const r = await post(web.url, '/api/script/play', { speed: 4 });
  assert.equal(r.status, 200);
  assert.ok(r.body.total > 60);
  const st = await getJson(web.url, '/api/script');
  assert.equal(st.playing, true);
  assert.equal((await getJson(web.url, '/api/state')).start, Date.parse('2026-10-17T10:00:00-04:00'));
  await until(async () => (await getJson(web.url, '/api/transcript')).entries.length > 0);
  const stop = await post(web.url, '/api/script/stop');
  assert.equal(stop.status, 200);
  assert.equal(stop.body.status.playing, false);
  const n = (await getJson(web.url, '/api/transcript')).entries.length;
  await new Promise((res) => setTimeout(res, 900));
  assert.equal((await getJson(web.url, '/api/transcript')).entries.length, n, 'nothing new after stop');
});

test('the full scripted demo plays end to end on the real engine (docs/DEMO.md numbers)', async () => {
  const r = await post(web.url, '/api/script/play', { speed: 1000 });
  const total = r.body.total as number;
  const done = await until(async () => {
    const s = await getJson(web.url, '/api/script');
    return !s.playing && s.done ? s : undefined;
  }, 90_000);
  assert.equal(done.index, total);
  assert.equal(done.errors, 0, 'every script line ran');
  const { entries } = await getJson(web.url, '/api/transcript');
  const homi = entries.filter((e: { from: string }) => e.from === 'homi').map((e: { text: string }) => e.text).join('\n');
  const all = entries.map((e: { text: string }) => e.text).join('\n');
  assert.match(all, /\(simulated call\) answered: "friday works"/);
  assert.match(homi, /Fri Oct 23 · 7pm it is: 5 in/);
  assert.match(homi, /Hokkaido Ramen Santouka it is: 1 Bow Street, Cambridge/);
  assert.match(homi, /Show-up pledge for Fri Oct 23 · 7pm: \$10 each, back when you check in\. First, where should no-show money go \(everyone who pledges has to agree\)\?/);
  assert.match(homi, /6 of 6 pledged: \$60 held \(SIMULATED\)/);
  assert.match(homi, /Dinner \$141\.61 \(tax \$7\.81 \+ 20% tip \$22\.30\), paid by Ben/);
  assert.match(homi, /Ana \$25\.02 · Ben \$36\.45 · Jo \$30\.74 · Maya \$24\.38 · You \$25\.02/);
  assert.match(homi, /Jo → Ben \$15\.14/);
  assert.match(homi, /Pledge settled \(SIMULATED\): \$10 back to Ana, Ben, Jo, Maya and You/);
  assert.match(homi, /4 photos in the album from Ana, Jo and Maya/);
  assert.match(homi, /Removed Jo's 2 photos; 2 left in the album/);
  assert.match(homi, /Japan · late Mar 2030 · 10 nights · 5 from Boston/);
  assert.match(homi, /Comfort plan saved/);
  assert.match(homi, /Done: I've deleted this plan\./);

  // The album link in the chat opens this server's gallery (the same page production serves).
  const m = /https:\/\/homi\.example\/a\/([\w-]+) \(demo link\)/.exec(homi);
  assert.ok(m, 'album link posted');
  const page = await fetch(new URL(`/a/${m[1]}`, web.url));
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Ramen night · Fri Oct 23/);
  assert.match(html, /2 photos/);
  const img = /src="(\/a\/[^"]+)"/.exec(html);
  assert.ok(img);
  const photo = await fetch(new URL(img[1], web.url));
  assert.equal(photo.status, 200);
  assert.equal(photo.headers.get('content-type'), 'image/png');

  // Persona photos render from the generated sample image.
  const shot = entries.find((e: { photo?: unknown }) => e.photo);
  const sample = await fetch(new URL(`/api/sample/${shot.ref}`, web.url));
  assert.equal(sample.status, 200);
  assert.equal(sample.headers.get('content-type'), 'image/png');
});
