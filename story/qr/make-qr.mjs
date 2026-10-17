// QR code + printable table tent for the judging table.
//
//   node story/qr/make-qr.mjs --sms +16175550100            (iMessage/SMS line: opens a new message to Homi)
//   node story/qr/make-qr.mjs --telegram homi_planner_bot    (opens "add Homi to a group" in Telegram)
//   node story/qr/make-qr.mjs --url https://github.com/you/homi
//
// Writes story/qr/homi-qr.svg and story/qr/table-tent.html (print it, fold in half).
// Needs the `qrcode` package from the story tools dir (story/README.md): HOMI_STORY_TOOLS (a package.json path),
// else %TEMP%/homi-story-tools, else %TEMP%/otto-story-tools (the folder's pre-rename name).

import { createRequire } from 'node:module';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const tools = process.env.HOMI_STORY_TOOLS
  ?? ['homi-story-tools', 'otto-story-tools'].map((d) => join(tmpdir(), d, 'package.json')).find((p) => existsSync(p))
  ?? join(tmpdir(), 'homi-story-tools', 'package.json');
const QRCode = createRequire(tools)('qrcode');

const [flag, value] = process.argv.slice(2);
if (!flag || !value) {
  console.error('usage: node story/qr/make-qr.mjs --sms +1XXXXXXXXXX | --telegram <bot_username> | --url <https://...>');
  process.exit(1);
}
let target;
let label;
if (flag === '--sms') {
  if (!/^\+\d{8,15}$/.test(value)) throw new Error('use E.164, e.g. +16175550100');
  target = `sms:${value}`;
  label = `Text Homi: ${value.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, '($1) $2-$3')}`;
} else if (flag === '--telegram') {
  target = `https://t.me/${value.replace(/^@/, '')}?startgroup=homi`;
  label = `Add Homi to your group: @${value.replace(/^@/, '')}`;
} else if (flag === '--url') {
  target = value;
  label = value.replace(/^https?:\/\//, '');
} else {
  throw new Error(`unknown flag ${flag}`);
}

const svg = await QRCode.toString(target, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#111111', light: '#ffffff' } });
writeFileSync(join(here, 'homi-qr.svg'), svg);

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const panel = `
  <section class="panel">
    <div class="mark"><span></span><span></span></div>
    <h1>Whats the Word</h1>
    <p class="tag">Homi, the friend who makes plans happen.</p>
    <div class="qr">${svg}</div>
    <p class="cta">${esc(label)}</p>
    <ul>
      <li>Finds a date. Nobody's calendar needed.</li>
      <li>Picks a place. Checks in with quiet friends.</li>
      <li>Splits the bill, keeps the photos, plans the next trip.</li>
      <li>Then forgets. Ask it what it knows.</li>
    </ul>
    <p class="foot">Built on Photon · HackHarvard 2026</p>
  </section>`;
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Whats the Word table tent</title>
<style>
  @page { size: letter portrait; margin: 0; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #111; }
  .sheet { width: 8.5in; height: 11in; display: grid; grid-template-rows: 1fr 1fr; }
  .panel { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 0.4in; border-bottom: 1px dashed #bbb; }
  .panel:first-child { transform: rotate(180deg); }
  .mark { width: 64px; height: 64px; border-radius: 50%; background: #ffb547; display: flex; gap: 10px; align-items: center; justify-content: center; }
  .mark span { width: 9px; height: 13px; border-radius: 50%; background: #2a1a00; }
  h1 { font-size: 48px; margin: 10px 0 0; letter-spacing: -1px; }
  .tag { margin: 4px 0 14px; font-size: 18px; color: #444; }
  .qr svg { width: 2.4in; height: 2.4in; }
  .cta { font-size: 22px; font-weight: 700; margin: 10px 0; }
  ul { list-style: none; padding: 0; margin: 4px 0 10px; font-size: 15px; color: #333; line-height: 1.5; }
  .foot { font-size: 12px; color: #777; }
</style></head><body><div class="sheet">${panel}${panel}</div></body></html>`;
writeFileSync(join(here, 'table-tent.html'), html);
console.log(`wrote story/qr/homi-qr.svg and story/qr/table-tent.html → ${target}`);
