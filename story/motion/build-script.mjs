#!/usr/bin/env node
// Turns a plain-text storyboard / simulator transcript into script.json with automatic timing.
//
//   node story/motion/build-script.mjs story/motion/storyboard.txt story/motion/script.json
//
// Input format (one item per line; full reference in story/motion/README.md):
//   Name: message text            a chat message (Name = member id or display name)
//   + more text                   another bubble from the same sender, no typing indicator
//   ~Name: text                   a quick message from anyone: no typing indicator, short gap
//   ...text [#id]                 give a message an id (for @react / @receipt targets)
//   @member id Name [#color] [bot]   @roster id id ...   @chat Title   @clock 8:14   @fps 30
//   @chapter Title                @caption Text with *accent*   (@caption alone clears)
//   @divider Text | 8:14 [| jump] @system Text [+memberId]       @typing who ms
//   @jump ms Text | Sun Mon ...   @react emoji who [#id|^N]      @receipt Text [#id]
//   @wait ms                      @at ms
//   @call {json}  > Name: line  ...  @endcall                  @end {json}
//   @title {json}                 opening title card {"title","line","duration"}
//   @card Name {json}             a card bubble {"id","head","rows","sections","foot","hold"} (see README)
//   @photo Name art[,art] | caption [#id]   photo bubble(s) with generated art (ramen|friends|city|neon)
//   @album {json}                 full-screen album {"title","header","sub","subAfter","foot","photos","remove","duration"}
//   @quote text                   reply-quote line shown above the next message
// Lines starting with # are comments. No dependencies; Node 18+.

import { readFileSync, writeFileSync } from 'node:fs';

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error('usage: node build-script.mjs <storyboard.txt> <script.json>');
  process.exit(1);
}

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const len = (s) => Array.from(s).length;
const words = (s) => s.trim().split(/\s+/).filter(Boolean).length;

// ---- timing model (ms). Tuned so a 2-sentence bot message stays on screen long enough to read.
const TYPING = {
  you: (n) => clamp(260 + 36 * n, 550, 1150), // compose-bar typing
  bot: (n) => clamp(420 + 3 * n, 600, 850),
  friend: (n) => clamp(280 + 20 * n, 380, 720),
};
const HOLD = {
  bot: (n) => clamp(300 + 17 * n, 650, 2800),
  other: (n) => clamp(260 + 12 * n, 380, 800),
};
const BURST_GAP = 420;
const QUICK_GAP = 220;
// Cards are read like a receipt: longer hold, capped so a tall card never stalls the video.
const CARD_HOLD = (n) => clamp(800 + 10 * n, 1800, 6500);
const cardText = (c) => [c.head, c.foot, ...(c.rows || []), ...(c.sections || []).flatMap((x) => [x.title, ...x.rows])]
  .map((r) => (r == null ? '' : typeof r === 'string' ? r : [r.k, r.l, r.note, r.r].filter(Boolean).join(' ')))
  .join(' ');

const meta = { chat: 'the crew', fps: 30, members: [], roster: [] };
const events = [];
let T = 300;
let lastMsg = null; // { id, from, t }
let lastYouMsg = null;
let auto = 0;
let call = null;
let caption = null;
let pendingQuote = null;

const byName = (who) => {
  const k = who.trim().toLowerCase();
  const m = meta.members.find((x) => x.id.toLowerCase() === k || x.name.toLowerCase() === k);
  if (!m) throw new Error(`unknown member "${who}" (add an @member line)`);
  return m;
};
const takeId = (text) => {
  const m = /\s*\[#([\w-]+)\]\s*$/.exec(text);
  return m ? { text: text.slice(0, m.index), id: m[1] } : { text, id: null };
};
const closeCaption = (t) => { if (caption) { caption.until = t; caption = null; } };

function message(member, rawText, burst, extra = {}) {
  const { text, id } = takeId(rawText);
  const kind = member.id === 'you' ? 'you' : member.bot ? 'bot' : 'friend';
  const ev = Object.assign({ t: 0, type: 'message' }, extra, { id: id || extra.id || `m${++auto}`, from: member.id, text });
  for (const k of Object.keys(ev)) if (ev[k] === undefined) delete ev[k];
  if (!text) delete ev.text;
  delete ev.hold;
  if (pendingQuote) { ev.quote = pendingQuote; pendingQuote = null; }
  const n = len(extra.card ? cardText(extra.card) : text || ' ');
  if (burst === 'quick') {
    ev.t = T + QUICK_GAP;
  } else if (burst && lastMsg && lastMsg.from === member.id) {
    ev.t = lastMsg.t + BURST_GAP;
  } else {
    const typing = TYPING[kind](n);
    ev.t = T + typing;
    ev.typing = typing;
  }
  events.push(ev);
  let hold = extra.hold ?? (extra.card ? CARD_HOLD(n) : (kind === 'bot' ? HOLD.bot : HOLD.other)(n));
  if (burst === 'quick' && extra.hold == null) hold = Math.min(hold, 320);
  if (extra.photos) hold = Math.max(hold, 900);
  T = Math.max(T, ev.t + hold);
  lastMsg = { id: ev.id, from: member.id, t: ev.t };
  if (member.id === 'you') lastYouMsg = lastMsg;
}

const lines = readFileSync(inPath, 'utf8').split(/\r?\n/);
for (let i = 0; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line || line.startsWith('#')) continue;
  try {
    if (call) {
      if (line.startsWith('@endcall')) {
        const accept = call.accept ?? 1300;
        let s = accept + 380;
        for (const l of call.lines) {
          l.t = l.t ?? s;
          l.duration = l.duration ?? Math.max(700, 150 * words(l.text));
          s = l.t + l.duration + 380;
        }
        const last = call.lines[call.lines.length - 1];
        call.accept = accept;
        call.endAt = call.endAt ?? (last ? last.t + last.duration + 550 : accept + 2000);
        call.duration = call.duration ?? call.endAt + 950;
        call.t = T;
        events.push(call);
        T += call.duration;
        call = null;
        continue;
      }
      const m = /^>\s*([^:]+):\s*(.+)$/.exec(line);
      if (!m) throw new Error('inside @call, expected "> Name: text" or @endcall');
      call.lines.push({ from: m[1].trim(), text: m[2].trim() });
      continue;
    }
    if (line.startsWith('@')) {
      const sp = line.indexOf(' ');
      const cmd = (sp < 0 ? line : line.slice(0, sp)).slice(1);
      const arg = sp < 0 ? '' : line.slice(sp + 1).trim();
      switch (cmd) {
        case 'chat': meta.chat = arg; break;
        case 'clock': meta.clock = arg; break;
        case 'fps': meta.fps = Number(arg); break;
        case 'roster': meta.roster = arg.split(/\s+/); break;
        case 'member': {
          const parts = arg.split(/\s+/);
          const m = { id: parts[0], name: parts[1] || parts[0] };
          for (const p of parts.slice(2)) { if (p.startsWith('#')) m.color = p; else if (p === 'bot') m.bot = true; }
          meta.members.push(m);
          break;
        }
        case 'chapter': events.push({ t: T, type: 'chapter', text: arg }); break;
        case 'caption': {
          closeCaption(T);
          if (arg) { caption = { t: T, type: 'caption', text: arg }; events.push(caption); }
          break;
        }
        case 'divider': {
          const [text, clock, style] = arg.split('|').map((s) => s.trim());
          const ev = { t: T, type: 'divider', text };
          if (clock) ev.clock = clock;
          if (style) ev.style = style;
          events.push(ev);
          T += 550;
          break;
        }
        case 'system': {
          const m = /\s\+([\w-]+)$/.exec(arg);
          const ev = { t: T, type: 'system', text: m ? arg.slice(0, m.index) : arg };
          if (m) ev.addMember = m[1];
          events.push(ev);
          T += 900;
          break;
        }
        case 'typing': {
          const [who, ms] = arg.split(/\s+/);
          events.push({ t: T, type: 'typing', from: byName(who).id, duration: Number(ms) || 1200 });
          T += (Number(ms) || 1200) + 300;
          break;
        }
        case 'jump': {
          const m = /^(\d+)\s+(.*)$/.exec(arg);
          if (!m) throw new Error('@jump ms Text | tick tick ...');
          const [text, ticks] = m[2].split('|').map((s) => s.trim());
          events.push({ t: T, type: 'jump', duration: Number(m[1]), text, ticker: ticks ? ticks.split(/\s+/) : [] });
          T += Number(m[1]);
          break;
        }
        case 'react': {
          const [emoji, who, target] = arg.split(/\s+/);
          let id = lastMsg && lastMsg.id;
          if (target && target.startsWith('#')) id = target.slice(1);
          else if (target && target.startsWith('^')) {
            const k = Number(target.slice(1));
            const msgs = events.filter((e) => e.type === 'message');
            id = msgs[msgs.length - k] && msgs[msgs.length - k].id;
          }
          if (!id) throw new Error('@react: no target message');
          T += 260;
          events.push({ t: T, type: 'reaction', target: id, emoji, from: byName(who).id });
          break;
        }
        case 'receipt': {
          const { text, id } = takeId(arg);
          const target = id || (lastYouMsg && lastYouMsg.id);
          if (!target) throw new Error('@receipt: no target');
          T += 200;
          events.push({ t: T, type: 'receipt', target, text });
          T += 100;
          break;
        }
        case 'title': {
          const e = Object.assign({ t: T, type: 'title', duration: 2000 }, arg ? JSON.parse(arg) : {});
          events.push(e);
          T += e.duration - 200;
          break;
        }
        case 'card': {
          const sp2 = arg.indexOf(' ');
          const card = JSON.parse(arg.slice(sp2 + 1));
          const { id, hold, ...rest } = card;
          message(byName(arg.slice(0, sp2)), '', false, { id, hold, card: rest });
          break;
        }
        case 'photo': {
          const m = /^(\S+)\s+([\w,]+)\s*(?:\|\s*(.*))?$/.exec(arg);
          if (!m) throw new Error('@photo Name art[,art] | caption');
          const { text, id } = takeId(m[3] || '');
          message(byName(m[1]), text, false, { id: id || undefined, photos: m[2].split(',') });
          break;
        }
        case 'album': {
          const e = Object.assign({ t: T, type: 'album', duration: 3000 }, arg ? JSON.parse(arg) : {});
          events.push(e);
          T += e.duration;
          break;
        }
        case 'quote': pendingQuote = arg; break;
        case 'dm': {
          // A private thread shown inside the phone: {"tag","title","lines":[{from:"homi"|"me",text,t?}],"duration"?}
          const e = Object.assign({ t: T, type: 'dm', lines: [] }, arg ? JSON.parse(arg) : {});
          let s = 520;
          for (const ln of e.lines) {
            ln.t = ln.t ?? s;
            s = ln.t + clamp(420 + 17 * len(ln.text || ''), 800, 2600);
          }
          e.duration = e.duration ?? s + 700;
          events.push(e);
          T += e.duration;
          break;
        }
        case 'stat': {
          // Full-stage statistic with a count-up: {"n":88,"suffix":"%","line":"...","foot":"...","duration"?}
          const e = Object.assign({ t: T, type: 'stat', duration: 2600 }, arg ? JSON.parse(arg) : {});
          closeCaption(T);
          events.push(e);
          T += e.duration;
          break;
        }
        case 'pulse': events.push({ t: T + Number(arg || 0), type: 'pulse' }); break;
        case 'wait': T += Number(arg); break;
        case 'at': T = Number(arg); break;
        case 'call': call = Object.assign({ type: 'call', lines: [] }, arg ? JSON.parse(arg) : {}); break;
        case 'end': {
          closeCaption(T);
          const e = Object.assign({ t: T, type: 'end', duration: 6000 }, arg ? JSON.parse(arg) : {});
          events.push(e);
          meta.duration = e.t + e.duration;
          break;
        }
        default: throw new Error('unknown directive @' + cmd);
      }
      continue;
    }
    if (line.startsWith('~')) {
      const q = /^~([^:]{1,24}):\s*(.+)$/.exec(line);
      if (!q) throw new Error('expected "~Name: text"');
      message(byName(q[1]), q[2].trim(), 'quick');
      continue;
    }
    if (line.startsWith('+')) {
      if (!lastMsg) throw new Error('"+" continuation with no previous message');
      message(meta.members.find((m) => m.id === lastMsg.from), line.slice(1).trim(), true);
      continue;
    }
    const m = /^([^:]{1,24}):\s*(.+)$/.exec(line);
    if (!m) throw new Error('expected "Name: text" or a @directive');
    message(byName(m[1]), m[2].trim(), false);
  } catch (err) {
    console.error(`${inPath}:${i + 1}: ${err.message}\n  > ${line}`);
    process.exit(1);
  }
}
closeCaption(T);
if (!meta.duration) meta.duration = T + 1500;

const out = { version: 1, meta, events };
writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
console.log(`wrote ${outPath}: ${events.length} events, ${(meta.duration / 1000).toFixed(1)} s`);
