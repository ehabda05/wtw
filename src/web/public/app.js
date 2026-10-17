// Whats the Word web demo: live iMessage-style group chat on the real Homi engine (Simulated iMessage).
// One SSE stream per browser; every browser sees the same chat and picks its own persona.

import { ChatView } from './chat.js';
import { HOMI_FACE, PEOPLE, avatarHTML, esc, nameOf, setToken, snippet, timeOf, withToken } from './format.js';
import { closePicker, initScale, initSheet, openPicker, renderCall, toast } from './ui.js';
import { initControls } from './controls.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode */
    }
  },
};

const params = new URLSearchParams(location.search);
const K = params.get('k') || '';
setToken(K);

const S = { tz: 'America/New_York', personas: ['ana', 'ben', 'sam', 'jo', 'maya', 'you'], persona: store.get('wtw.persona') || 'you', replyTo: null, now: Date.now(), gen: 0 };
if (!S.personas.includes(S.persona)) S.persona = 'you';

export async function api(path, body = {}) {
  const r = await fetch(withToken(path), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}
const report = (err) => toast(err.message || String(err));

// ───────────── chat ─────────────

const chatEl = $('chat');
const nearBottom = () => chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight < 160;
const toBottom = (smooth = true) => chatEl.scrollTo({ top: chatEl.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });

const view = new ChatView($('chatList'), {
  tz: () => S.tz,
  persona: () => S.persona,
  onDm: (e) => controls.addDm(e),
  onBubble: (el, e) => {
    const bw = el.querySelector('.bw');
    const open = (ev) => {
      if (ev.target.closest('a')) return;
      ev.preventDefault();
      openPicker(el, e, S.persona, (emoji) => react(e.ref, emoji), () => startReply(e));
    };
    bw.addEventListener('click', open);
    bw.addEventListener('contextmenu', open); // long-press (Android) / right-click
  },
});

function react(ref, emoji) {
  if (view.hasReacted(ref, emoji, S.persona)) return toast(`${nameOf(S.persona)} already reacted ${emoji}`);
  api('/api/react', { persona: S.persona, emoji, target: ref }).catch(report);
}

// Live entries are paced: Homi "types" briefly before each bubble; people and reactions appear at once.
let queue = [];
let draining = false;
let lastHomi = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isHomiBubble = (e) => e.from === 'homi' && (e.kind === 'send' || e.kind === 'reply' || e.kind === 'file');

async function drain() {
  if (draining) return;
  draining = true;
  const gen = S.gen;
  while (queue.length && gen === S.gen) {
    const e = queue.shift();
    if (isHomiBubble(e)) {
      const stick = nearBottom();
      view.showTyping();
      if (stick) toBottom();
      const ms = queue.length > 8 ? 70 : Date.now() - lastHomi < 1800 ? 300 : 750;
      await sleep(ms);
      if (gen !== S.gen) break;
      lastHomi = Date.now();
    }
    const stick = nearBottom();
    view.add(e);
    if (stick || e.from === S.persona) toBottom();
    else $('newPill').hidden = false;
  }
  draining = false;
  if (queue.length && gen !== S.gen) drain();
}

chatEl.addEventListener('scroll', () => {
  if (nearBottom()) $('newPill').hidden = true;
});
$('newPill').onclick = () => {
  $('newPill').hidden = true;
  toBottom();
};

// ───────────── persona chips, composer, reply, photo ─────────────

function renderPersonas() {
  $('personas').innerHTML =
    `<span class="pl">Typing as</span>` +
    S.personas
      .map((p) => `<button type="button" class="chip${p === S.persona ? ' on' : ''}" data-p="${p}" aria-pressed="${p === S.persona}">${avatarHTML(p, 'sm')}<span>${esc(PEOPLE[p]?.name ?? p)}</span></button>`)
      .join('');
  $('input').placeholder = `iMessage · as ${nameOf(S.persona)}`;
  document.body.dataset.persona = S.persona;
}
$('personas').addEventListener('click', (ev) => {
  const b = ev.target.closest('.chip');
  if (!b) return;
  S.persona = b.dataset.p;
  store.set('wtw.persona', S.persona);
  renderPersonas();
  view.refreshReactions();
  if (S.replyTo) startReply(S.replyTo);
  $('input').focus({ preventScroll: true });
});

function startReply(e) {
  S.replyTo = e;
  $('replyBar').hidden = false;
  $('replyText').innerHTML = `Replying to <b>${esc(nameOf(e.from))}</b> as ${esc(nameOf(S.persona))}: ${esc(snippet(e.text, 40))}`;
  $('input').focus({ preventScroll: true });
}
function clearReply() {
  S.replyTo = null;
  $('replyBar').hidden = true;
}
$('replyCancel').onclick = clearReply;

$('compose').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const input = $('input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  $('compose').classList.remove('has-text');
  const body = { persona: S.persona, text };
  if (S.replyTo?.ref) body.replyTo = S.replyTo.ref;
  clearReply();
  api('/api/say', body).catch((err) => {
    input.value = text;
    report(err);
  });
});
$('input').addEventListener('input', () => $('compose').classList.toggle('has-text', !!$('input').value.trim()));

$('camBtn').onclick = () => {
  const bar = $('photoBar');
  bar.hidden = !bar.hidden;
  $('photoWho').textContent = nameOf(S.persona);
  if (!bar.hidden) $('photoCaption').select();
};
$('photoCancel').onclick = () => ($('photoBar').hidden = true);
$('photoForm').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const caption = $('photoCaption').value.trim();
  $('photoBar').hidden = true;
  const body = { persona: S.persona, caption };
  if (S.replyTo?.ref) body.replyTo = S.replyTo.ref;
  clearReply();
  api('/api/photo', body).catch(report);
});

// ───────────── clock + stream ─────────────

function setClock(now) {
  S.now = now;
  $('sbClock').textContent = timeOf(now, S.tz).replace(/\s?[AP]M$/, '');
  controls.setClock(now, S.tz);
}

const fill = (t) => {
  $('input').value = t;
  $('compose').classList.add('has-text');
  $('input').focus({ preventScroll: true });
};
const controls = initControls({ api, report, toast, fill });
const sheet = initSheet();
controls.onAction = () => sheet.close();
initScale();
renderPersonas();
$('brandMark').innerHTML = HOMI_FACE;
$('cluster').innerHTML = ['ana', 'homi', 'ben'].map((p) => avatarHTML(p)).join('');

function connect() {
  const es = new EventSource(withToken('/events'));
  es.addEventListener('snapshot', (m) => {
    const s = JSON.parse(m.data);
    S.gen++;
    queue = [];
    S.tz = s.tz;
    S.personas = s.personas;
    view.reset();
    controls.reset(s);
    for (const e of s.entries) view.add(e);
    toBottom(false);
    renderCall(s.call && s.call.state === 'ringing' ? s.call : null, answer);
    setClock(s.now);
    document.body.classList.remove('offline');
  });
  es.addEventListener('entry', (m) => {
    queue.push(JSON.parse(m.data));
    drain();
  });
  es.addEventListener('clock', (m) => setClock(JSON.parse(m.data).now));
  es.addEventListener('call', (m) => renderCall(JSON.parse(m.data), answer));
  es.addEventListener('script', (m) => controls.setScript(JSON.parse(m.data)));
  es.onerror = () => document.body.classList.add('offline');
  es.onopen = () => document.body.classList.remove('offline');
}

function answer(persona, text) {
  api('/api/answer', text === null ? { persona, decline: true } : { persona, text }).catch(report);
}

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') {
    closePicker();
    clearReply();
    $('photoBar').hidden = true;
    sheet.close();
  }
});

connect();
