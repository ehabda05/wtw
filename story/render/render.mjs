#!/usr/bin/env node
// Deterministic frame capture + encode for the Whats the Word motion demo (agent: Homi).
//
//   node story/render/render.mjs                       # both MP4s + posters, frames deleted after
//   node story/render/render.mjs --only=vertical       # one layout
//   node story/render/render.mjs --stills=1000,15000   # just PNG stills to story/out/stills (for checking)
//   node story/render/render.mjs --keep-frames         # keep story/out/frames/*
//   node story/render/render.mjs --deck-pdf            # export story/deck/deck.pdf only
//   node story/render/render.mjs --deck-stills         # PNG of every deck slide to story/out/stills
//   node story/render/render.mjs --poster=19400        # time (ms) used for the poster PNGs
//
// Tools are NOT installed in the project (Windows MAX_PATH). They live in HOMI_TOOLS, else the first of
// %TEMP%\homi-story-tools or %TEMP%\otto-story-tools (the pre-rename folder) that has node_modules,
// with playwright-core and ffmpeg-static.
// Browser: installed Microsoft Edge (EDGE_PATH to override). ffmpeg: FFMPEG env, else ffmpeg-static,
// else ffmpeg on PATH.
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, copyFileSync, statSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import os from 'node:os';
import { startServer, STORY_ROOT } from './serve.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? true] : [a, true]; }),
);
const TMP = join(os.homedir(), 'AppData', 'Local', 'Temp');
const TOOLS = process.env.HOMI_TOOLS
  || ['homi-story-tools', 'otto-story-tools'].map((d) => join(TMP, d)).find((d) => existsSync(join(d, 'node_modules')))
  || join(TMP, 'homi-story-tools');
const requireTools = createRequire(join(TOOLS, 'package.json'));
const { chromium } = requireTools('playwright-core');

const OUT = join(STORY_ROOT, 'out');
const FPS = Number(args.fps || 30);
const LAYOUTS = {
  vertical: { w: 1080, h: 1920, file: 'homi-phone-1080x1920.mp4', poster: 'homi-poster-1080x1920.png' },
  landscape: { w: 1920, h: 1080, file: 'homi-demo-1920x1080.mp4', poster: 'homi-poster-1920x1080.png' },
};
const POSTER_T = Number(args.poster || 81500); // the bill-split card (Act 3)

function findEdge() {
  const c = [
    process.env.EDGE_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);
  return c.find((p) => existsSync(p));
}

function findFfmpeg() {
  const cands = [process.env.FFMPEG];
  try { cands.push(requireTools('ffmpeg-static')); } catch { /* not installed */ }
  cands.push('ffmpeg');
  for (const c of cands.filter(Boolean)) {
    const r = spawnSync(c, ['-hide_banner', '-version'], { encoding: 'utf8' });
    if (r.status === 0) return c;
  }
  throw new Error('No working ffmpeg. Set FFMPEG=path\\to\\ffmpeg.exe or reinstall ffmpeg-static in ' + TOOLS);
}

async function launch() {
  const executablePath = findEdge();
  if (executablePath) return chromium.launch({ executablePath, headless: true });
  return chromium.launch({ channel: 'msedge', headless: true }).catch(() => chromium.launch({ headless: true }));
}

async function openLayout(browser, base, name) {
  const L = LAYOUTS[name];
  const page = await browser.newPage({ viewport: { width: L.w, height: L.h }, deviceScaleFactor: 1 });
  page.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') console.log(`[${name}] ${m.text()}`); });
  await page.goto(`${base}/motion/index.html?layout=${name}&render=1`);
  await page.waitForFunction(() => window.__homi && (window.__homi.ready || window.__homi.error));
  const info = await page.evaluate(() => window.__homi);
  if (!info.ready) throw new Error(`motion page failed: ${info.error}`);
  // Raw CDP screenshots are several times faster than page.screenshot() for long frame runs.
  const cdp = await page.context().newCDPSession(page).catch(() => null);
  return { page, cdp, info, L };
}

async function capture(ctx, t, path) {
  // seek, then wait two animation frames so the new state is painted before the capture
  await ctx.page.evaluate((ms) => new Promise((ok) => { window.__seek(ms); requestAnimationFrame(() => requestAnimationFrame(ok)); }), t);
  if (ctx.cdp) {
    const { data } = await ctx.cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true });
    writeFileSync(path, Buffer.from(data, 'base64'));
  } else {
    await ctx.page.screenshot({ path, type: 'png' });
  }
}

async function renderLayout(browser, base, name, ffmpeg) {
  const ctx = await openLayout(browser, base, name);
  const { page, info, L } = ctx;
  const dir = join(OUT, 'frames', name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const n = Math.min(Number(args.limit || Infinity), Math.ceil((info.duration / 1000) * FPS));
  const t0 = Date.now();
  for (let f = 0; f < n; f++) {
    await capture(ctx, (f * 1000) / FPS, join(dir, String(f).padStart(5, '0') + '.png'));
    if (f % 150 === 0) console.log(`[${name}] frame ${f}/${n}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  await capture(ctx, POSTER_T, join(OUT, L.poster));
  await page.close();
  const mp4 = join(OUT, L.file);
  console.log(`[${name}] encoding ${mp4}`);
  const r = spawnSync(ffmpeg, [
    '-y', '-hide_banner', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(dir, '%05d.png'),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-movflags', '+faststart', mp4,
  ], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('ffmpeg failed for ' + name);
  if (!args['keep-frames']) rmSync(dir, { recursive: true, force: true });
  console.log(`[${name}] done: ${(statSync(mp4).size / 1e6).toFixed(2)} MB, ${n} frames, ${(n / FPS).toFixed(2)} s`);
}

async function stills(browser, base, list) {
  const dir = join(OUT, 'stills');
  mkdirSync(dir, { recursive: true });
  const names = args.only ? [args.only] : Object.keys(LAYOUTS);
  for (const name of names) {
    const ctx = await openLayout(browser, base, name);
    const { page } = ctx;
    for (const t of list) {
      const p = join(dir, `${name}-${String(t).padStart(5, '0')}.png`);
      await capture(ctx, t, p);
      console.log(p);
    }
    await page.close();
  }
}

async function deckPdf(browser, base) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto(`${base}/deck/index.html?print=1`);
  await page.waitForFunction(() => window.__deckReady === true);
  await page.emulateMedia({ media: 'print' });
  const pdf = join(STORY_ROOT, 'deck', 'deck.pdf');
  await page.pdf({ path: pdf, width: '13.333in', height: '7.5in', printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 }, preferCSSPageSize: true });
  await page.close();
  console.log(`deck pdf: ${pdf} (${(statSync(pdf).size / 1e6).toFixed(2)} MB)`);
}

async function deckStills(browser, base) {
  const dir = join(OUT, 'stills');
  mkdirSync(dir, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(`${base}/deck/index.html`);
  const count = await page.evaluate(() => document.querySelectorAll('.slide').length);
  for (let i = 1; i <= count; i++) {
    await page.goto(`${base}/deck/index.html?s=${i}#${i}`);
    await page.waitForFunction(() => window.__deckReady === true);
    await page.waitForTimeout(400);
    const p = join(dir, `deck-${i}.png`);
    await page.screenshot({ path: p });
    console.log(p);
  }
  await page.close();
}

const { server, port } = await startServer(0);
const base = `http://127.0.0.1:${port}`;
const browser = await launch();
try {
  mkdirSync(OUT, { recursive: true });
  if (args['deck-pdf']) await deckPdf(browser, base);
  else if (args['deck-stills']) await deckStills(browser, base);
  else if (args.stills) await stills(browser, base, String(args.stills).split(',').map(Number));
  else {
    const ffmpeg = findFfmpeg();
    console.log('ffmpeg:', ffmpeg);
    const names = args.only ? [args.only] : Object.keys(LAYOUTS);
    await Promise.all(names.map((n) => renderLayout(browser, base, n, ffmpeg)));
    const fr = join(OUT, 'frames');
    if (!args['keep-frames'] && existsSync(fr) && readdirSync(fr).length === 0) rmSync(fr, { recursive: true, force: true });
    // the vertical poster doubles as the generic poster
    if (existsSync(join(OUT, LAYOUTS.vertical.poster))) copyFileSync(join(OUT, LAYOUTS.vertical.poster), join(OUT, 'homi-poster.png'));
  }
} finally {
  await browser.close();
  server.close();
}
