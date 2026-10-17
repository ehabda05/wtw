// The chat list: iMessage-style runs (name on the first bubble, avatar + tail on the last), timestamps, tapback
// badges with counts, threaded-reply quotes, in-place edits, photos, .ics attachments and system lines.

import { avatarHTML, bubbleHTML, esc, nameOf, snippet, stampHTML, withToken } from './format.js';

const RUN_MS = 3 * 60_000;
const STAMP_GAP_MS = 40 * 60_000;

export class ChatView {
  constructor(list, opts) {
    this.list = list;
    this.opts = opts; // { tz(), persona(), onDm(entry), onBubble(el, entry) }
    this.reset();
  }

  reset() {
    this.list.innerHTML = '';
    this.byRef = new Map(); // ref -> { entry, el }
    this.reacts = new Map(); // target ref -> Map(emoji -> Set(from))
    this.lastAt = 0;
    this.run = null; // { from, at, el }
    this.typingEl = null;
    this.list.insertAdjacentHTML('beforeend', '<div class="intro"><span class="tag sim">Simulated iMessage</span> · real Homi engine<br><span>Pick who you are below, then text the group. Tap a bubble to react.</span></div>');
  }

  /** Renders one transcript entry. */
  add(e) {
    if (e.kind === 'edit') return this.#edit(e);
    if (e.kind === 'react') return this.#react(e);
    if (e.kind === 'dm') {
      this.opts.onDm?.(e);
      return this.#system(e.at, `🔒 Homi sent ${esc(nameOf(e.to))} a private message`, 'dmline');
    }
    if (e.from === 'system') return this.#system(e.at, esc(e.text), e.tag === 'ff' ? 'ff' : e.kind === 'call' ? 'callline' : '');
    if (e.kind === 'leave') return this.#system(e.at, 'Homi left the group', '');
    this.#message(e);
  }

  showTyping() {
    if (this.typingEl) return;
    const el = document.createElement('div');
    const cont = this.run && this.run.from === 'homi';
    el.className = `item homi typing first last${cont ? ' cont' : ''}`;
    el.innerHTML = `<div class="row"><div class="slot">${avatarHTML('homi')}</div><div class="bw"><div class="bubble typing tail"><i></i><i></i><i></i></div></div></div>`;
    this.list.appendChild(el);
    this.typingEl = el;
  }

  hideTyping() {
    this.typingEl?.remove();
    this.typingEl = null;
  }

  /** Re-draws every badge (the selected persona's own tapbacks are highlighted). */
  refreshReactions() {
    for (const ref of this.reacts.keys()) this.#badges(ref);
  }

  hasReacted(ref, emoji, who) {
    return !!this.reacts.get(ref)?.get(emoji)?.has(who);
  }

  // ───────────── internals ─────────────

  #stamp(at) {
    if (this.lastAt && at - this.lastAt < STAMP_GAP_MS) return false;
    const el = document.createElement('div');
    el.className = 'stamp';
    el.innerHTML = stampHTML(at, this.opts.tz());
    this.list.appendChild(el);
    this.run = null;
    return true;
  }

  #system(at, html, cls) {
    this.hideTyping();
    this.#stamp(at);
    this.lastAt = at;
    const el = document.createElement('div');
    el.className = `system ${cls}`;
    el.innerHTML = `<span>${html}</span>`;
    this.list.appendChild(el);
    this.run = null;
  }

  #message(e) {
    this.hideTyping();
    this.#stamp(e.at);
    this.lastAt = e.at;
    const side = e.from === 'you' ? 'you' : e.from === 'homi' ? 'homi' : 'friend';
    const cont = this.run && this.run.from === e.from && e.at - this.run.at < RUN_MS;
    if (cont) this.run.el.classList.remove('last');
    const el = document.createElement('div');
    el.className = `item ${side} ${cont ? 'cont' : 'first'} last`;
    el.dataset.ref = e.ref ?? '';
    const target = e.target ? this.byRef.get(e.target) : undefined;
    const quote = target
      ? `<div class="quote"><span class="qn">${esc(nameOf(target.entry.from))}</span> ${esc(snippet(target.entry.text, 54))}</div>`
      : '';
    let media = '';
    let text = e.text;
    if (e.photo && e.ref) {
      media = `<div class="pic"><img src="${esc(withToken(`/api/sample/${e.ref}`))}" alt="Sample photo from ${esc(nameOf(e.from))}" loading="lazy"></div>`;
      text = text.replace(/^📷\s*/, '').replace(/^\(photo\)$/, '');
    }
    let attach = '';
    if (e.kind === 'file' && e.file) {
      text = text.replace(new RegExp(`\\s*\\[${e.file.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]$`), '');
      attach = `<a class="attach" href="${esc(withToken(`/api/file/${e.ref}`))}" download="${esc(e.file.name)}"><span class="ai">📅</span><span><b>${esc(e.file.name)}</b><small>Calendar invite · tap to download</small></span></a>`;
    }
    const b = text ? bubbleHTML(text, e.from) : null;
    const bubble = b ? `<div class="bubble${b.card ? ' card' : ''}">${b.html}</div>` : '';
    el.innerHTML =
      `<div class="name">${esc(nameOf(e.from))}</div>` +
      `<div class="row"><div class="slot">${side === 'you' ? '' : avatarHTML(e.from)}</div>` +
      `<div class="bw${b?.card ? ' wide' : ''}">${quote}${media}${bubble}${attach}<div class="reacts"></div></div></div>` +
      `<div class="meta"></div>`;
    this.list.appendChild(el);
    this.run = { from: e.from, at: e.at, el };
    if (e.ref) {
      this.byRef.set(e.ref, { entry: e, el });
      this.opts.onBubble?.(el, e);
      if (this.reacts.has(e.ref)) this.#badges(e.ref);
    }
  }

  #edit(e) {
    const hit = this.byRef.get(e.target);
    if (!hit) return;
    hit.entry.text = e.text;
    const bubble = hit.el.querySelector('.bubble');
    if (!bubble) return;
    const b = bubbleHTML(e.text, hit.entry.from);
    bubble.className = `bubble${b.card ? ' card' : ''}`;
    bubble.innerHTML = b.html;
    hit.el.querySelector('.meta').textContent = 'Edited';
    hit.el.classList.remove('flash');
    void hit.el.offsetWidth;
    hit.el.classList.add('flash');
  }

  #react(e) {
    if (!e.target) return;
    let m = this.reacts.get(e.target);
    if (!m) this.reacts.set(e.target, (m = new Map()));
    if (!m.has(e.text)) m.set(e.text, new Set());
    m.get(e.text).add(e.from);
    this.#badges(e.target, e.text);
  }

  #badges(ref, fresh) {
    const hit = this.byRef.get(ref);
    const box = hit?.el.querySelector('.reacts');
    if (!box) return;
    const me = this.opts.persona();
    const m = this.reacts.get(ref) ?? new Map();
    box.innerHTML = [...m.entries()]
      .map(([emoji, who]) => {
        const mine = who.has(me) ? ' mine' : '';
        const pop = emoji === fresh ? ' pop' : '';
        const names = [...who].map(nameOf).join(', ');
        return `<span class="pill${mine}${pop}" title="${esc(names)}">${esc(emoji)}${who.size > 1 ? `<b>${who.size}</b>` : ''}</span>`;
      })
      .join('');
    hit.el.classList.toggle('reacted', m.size > 0);
  }
}
