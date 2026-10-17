// Interactive pieces: the tapback picker, the simulated incoming call, the ⚙️ sheet, toasts and phone scaling.

import { HOMI_FACE, esc, nameOf, snippet } from './format.js';

const $ = (id) => document.getElementById(id);
export const TAPBACKS = ['❤️', '👍', '👎', '😂', '❓'];

// ───────────── toast ─────────────

let toastTimer = 0;
export function toast(msg, ms = 2400) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// ───────────── tapback picker ─────────────

/** Opens the picker over a bubble. onPick(emoji) reacts; onReply() starts an inline reply. */
export function openPicker(itemEl, entry, who, onPick, onReply) {
  const picker = $('picker');
  const screen = $('screen');
  const bubble = itemEl.querySelector('.bubble, .pic, .attach') ?? itemEl;
  const sr = screen.getBoundingClientRect();
  const scale = sr.width / screen.offsetWidth || 1;
  const br = bubble.getBoundingClientRect();
  picker.innerHTML =
    `<div class="pk-bar" role="menu" aria-label="Tapback as ${esc(nameOf(who))}">` +
    TAPBACKS.map((e) => `<button type="button" class="pk-e" data-e="${e}" aria-label="React ${e}">${e}</button>`).join('') +
    `</div><div class="pk-who">Reacting as <b>${esc(nameOf(who))}</b> · <span>${esc(snippet(entry.text, 34))}</span></div>` +
    `<button type="button" class="pk-reply">↩︎ Reply as ${esc(nameOf(who))}</button>`;
  picker.hidden = false;
  const box = picker.firstElementChild;
  const w = box.offsetWidth;
  const top = Math.max(64, (br.top - sr.top) / scale - 62);
  const right = itemEl.classList.contains('you');
  let left = right ? (br.right - sr.left) / scale - w : (br.left - sr.left) / scale;
  left = Math.min(Math.max(8, left), screen.offsetWidth - w - 8);
  picker.style.setProperty('--pk-top', `${top}px`);
  picker.style.setProperty('--pk-left', `${left}px`);
  itemEl.classList.add('picked');
  const close = () => {
    picker.hidden = true;
    picker.innerHTML = '';
    itemEl.classList.remove('picked');
    picker.onclick = null;
  };
  picker.onclick = (ev) => {
    const b = ev.target.closest('button');
    if (b?.dataset.e) onPick(b.dataset.e);
    else if (b?.classList.contains('pk-reply')) onReply();
    close();
  };
}

export function closePicker() {
  const p = $('picker');
  if (!p.hidden) p.click();
}

// ───────────── simulated incoming call ─────────────

let hideTimer = 0;
let shownAt = 0;
let callId = 0;

/** Shows / updates / hides the call screen. onAnswer(persona, text|null) answers a ringing (interactive) call. */
export function renderCall(c, onAnswer) {
  const el = $('call');
  clearTimeout(hideTimer);
  if (!c) {
    el.hidden = true;
    return;
  }
  const who = nameOf(c.persona);
  if (c.id !== callId || el.hidden) {
    callId = c.id;
    shownAt = Date.now();
    el.innerHTML =
      `<div class="call-tag">Homi is calling ${esc(who)} · <b>simulated call</b></div>` +
      `<div class="call-who"><div class="ring-wrap"><i></i><i></i><div class="big-av av homi">${HOMI_FACE}</div></div>` +
      `<div class="cname">Homi</div><div class="cstate" id="callState">calling ${esc(who)}…</div></div>` +
      `<div class="call-line homi"><div class="sp">Homi asks</div><div class="tx">${esc(c.question)}</div></div>` +
      `<div class="call-line them" id="callThem" hidden><div class="sp">${esc(who)}</div><div class="tx" id="callAnswer"></div></div>` +
      `<form class="call-form" id="callForm" hidden><label for="callInput">What does ${esc(who)} say?</label>` +
      `<input id="callInput" autocomplete="off" enterkeyhint="send" placeholder="e.g. friday works" maxlength="300">` +
      `<div class="call-btns"><button type="button" class="decline" id="callDecline">Don't pick up</button><button type="submit" class="accept">Answer as ${esc(who)}</button></div></form>` +
      `<button type="button" class="call-hide" id="callHide">Hide</button>` +
      `<div class="call-sim">No audio · no phone network · you type the answer</div>`;
    el.hidden = false;
    $('callHide').onclick = () => (el.hidden = true);
    $('callDecline').onclick = () => onAnswer(c.persona, null);
    $('callForm').onsubmit = (ev) => {
      ev.preventDefault();
      const v = $('callInput').value.trim();
      if (v) onAnswer(c.persona, v);
    };
  }
  const state = $('callState');
  const them = $('callThem');
  const form = $('callForm');
  if (c.state === 'ringing') {
    if (c.scripted && c.answer) {
      state.textContent = `${who} picked up`;
      them.hidden = false;
      $('callAnswer').textContent = c.answer;
      form.hidden = true;
    } else {
      state.textContent = `ringing ${who}…`;
      form.hidden = false;
      setTimeout(() => $('callInput')?.focus({ preventScroll: true }), 50);
    }
    return;
  }
  form.hidden = true;
  if (c.state === 'answered') {
    state.textContent = `${who} answered · call ended`;
    them.hidden = false;
    $('callAnswer').textContent = c.answer ?? '';
  } else {
    state.textContent = `${who} didn't pick up`;
  }
  const minShow = 4200 - (Date.now() - shownAt);
  hideTimer = setTimeout(() => (el.hidden = true), Math.max(2200, minShow));
}

// ───────────── sheet (mobile ⚙️) ─────────────

export function initSheet() {
  const open = () => document.body.classList.add('sheet-open');
  const close = () => document.body.classList.remove('sheet-open');
  $('gearBtn').onclick = () => (document.body.classList.contains('sheet-open') ? close() : open());
  $('sheetBackdrop').onclick = close;
  $('sheetClose').onclick = close;
  return { close };
}

// ───────────── phone scaling ─────────────

const PHONE_W = 418;
const PHONE_H = 872;

/** Desktop: scale the phone frame to the viewport height (crisp at any size, up to 1.3x for projectors). */
export function initScale() {
  const wrap = $('phoneWrap');
  const fit = () => {
    const mobile = window.matchMedia('(max-width: 599px)').matches;
    document.body.classList.toggle('mobile', mobile);
    if (mobile) {
      // iOS: follow the visual viewport (keyboard open/closed) and keep the page itself from scrolling away.
      wrap.style.removeProperty('--s');
      const vv = window.visualViewport;
      document.documentElement.style.setProperty('--app-h', `${Math.round(vv ? vv.height : window.innerHeight)}px`);
      if (window.scrollY) window.scrollTo(0, 0);
      return;
    }
    // Width left for the phone: the window minus the visible side columns, their gaps and the page padding.
    const layout = document.querySelector('.layout');
    const gap = parseFloat(getComputedStyle(layout).columnGap) || 24;
    const wide = window.innerWidth >= 1240;
    const cols = wide ? [...document.querySelectorAll('.side')] : [$('panel')];
    const sides = cols.reduce((n, el) => n + el.getBoundingClientRect().width + gap, 0);
    const availW = Math.max(300, window.innerWidth - 48 - sides);
    const s = Math.min((window.innerHeight - 36) / PHONE_H, availW / PHONE_W, 1.3);
    wrap.style.setProperty('--s', String(Math.max(0.5, s)));
  };
  window.addEventListener('resize', fit);
  window.visualViewport?.addEventListener('resize', fit);
  window.visualViewport?.addEventListener('scroll', () => document.body.classList.contains('mobile') && fit());
  fit();
  return fit;
}
