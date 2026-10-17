/* Whats the Word motion demo (agent: Homi): deterministic timeline renderer.
 *
 * Reads script.json (schema in README.md next to this file), builds the chat once, then
 * window.__seek(ms) sets every element's position/opacity from the time alone. There are no
 * CSS transitions, keyframes or timers in the rendered state, so frame N is always identical.
 *
 * URL params: ?layout=vertical|landscape  ?render=1 (no playback loop, no controls)  ?t=ms
 */
(function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  const LAYOUT = params.get('layout') === 'vertical' ? 'vertical' : 'landscape';
  const RENDER = params.has('render');
  document.body.classList.add('layout-' + LAYOUT);
  if (RENDER) document.body.classList.add('render');

  const STAGE = LAYOUT === 'vertical' ? { w: 1080, h: 1920 } : { w: 1920, h: 1080 };
  const PHONE_W = 418, PHONE_H = 872;
  const PHONE_PLACE = LAYOUT === 'vertical'
    ? { s: 1.84, x: (1080 - PHONE_W * 1.84) / 2, y: 62 }
    : { s: 1.12, x: (1920 - PHONE_W * 1.12) / 2, y: (1080 - PHONE_H * 1.12) / 2 };

  // ---------- math ----------
  const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
  const prog = (t, s, d) => (d <= 0 ? (t >= s ? 1 : 0) : clamp((t - s) / d));
  const eOut = (x) => 1 - Math.pow(1 - x, 3);
  const eIn = (x) => x * x * x;
  const eInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const eBack = (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const accent = (s) => esc(s).replace(/\*([^*]+)\*/g, '<em>$1</em>');
  const $ = (id) => document.getElementById(id);
  const chars = (s) => Array.from(s);
  // display-only typography: keep units and separators from breaking awkwardly across lines
  const NB = '\u00a0';
  const tidy = (s) => String(s)
    .replace(/(\d+) min walk/g, `$1${NB}min${NB}walk`)
    .replace(/~(\$+) \(est\.\)/g, `~$1${NB}(est.)`)
    .replace(/open (\w{3}) (\d)/g, `open${NB}$1${NB}$2`)
    .replace(/ · /g, `${NB}· `)
    .replace(/(\d+) for (\d+)/g, `$1${NB}for${NB}$2`)
    .replace(/(\d)-(?=[a-z])/g, '$1‑') // "3-bedroom" never splits at the hyphen
    .replace(/ (\p{Extended_Pictographic}[\uFE0F\u200D\p{Extended_Pictographic}]*)$/u, `${NB}$1`);
  // Display-only labels: the words stay exactly as written, they just get a visual treatment.
  //   SIMULATED -> amber pill ("(SIMULATED)" drops its brackets), "(demo link)" -> grey pill,
  //   "Example listing \u00B7 estimated price" -> small label, URLs -> link blue, **text** -> bold.
  const fmt = (s) => esc(tidy(s))
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\(SIMULATED\)([.,:;]?)/g, '<span class="nw"><span class="tag sim">SIMULATED</span>$1</span>')
    .replace(/SIMULATED(?!<)/g, '<span class="tag sim">SIMULATED</span>')
    .replace(/\(demo link\)([.,:;]?)/g, '<span class="nw"><span class="tag link">demo link</span>$1</span>')
    .replace(/Example listing\s\u00B7\s?estimated price/g, '<span class="est">Example listing \u00B7 estimated price</span>')
    .replace(/(https?:\/\/[^\s<]+)/g, '<span class="url">$1</span>');

  // card: { head, rows: [...], sections: [{ title, rows }], foot, compact }
  // row: "plain line" | { k: "Days 1\u20134", icon: "\u2708\uFE0F", l: "label", note: "small line", r: "$25.02" }
  function rowHTML(r) {
    if (typeof r === 'string') return `<div class="c-line">${fmt(r)}</div>`;
    const ic = r.icon ? `<span class="ic">${esc(r.icon)}</span>` : '';
    const k = r.k ? `<span class="k">${fmt(r.k)}</span>` : '';
    const note = r.note ? `<span class="note">${fmt(r.note)}</span>` : '';
    const right = r.r != null ? `<span class="r">${fmt(r.r)}</span>` : '';
    return `<div class="c-row">${ic}${k}<span class="l">${fmt(r.l || '')}${note}</span>${right}</div>`;
  }
  function cardHTML(c) {
    let h = c.head ? `<div class="c-hd">${fmt(c.head)}</div>` : '';
    if (c.rows) h += `<div class="c-rows">${c.rows.map(rowHTML).join('')}</div>`;
    for (const s of c.sections || []) {
      h += (s.title ? `<div class="c-sec">${fmt(s.title)}</div>` : '') + `<div class="c-rows">${s.rows.map(rowHTML).join('')}</div>`;
    }
    if (c.foot) h += `<div class="c-ft">${fmt(c.foot)}</div>`;
    return h;
  }
  let artSeq = 0;
  const art = (name) => {
    const f = window.HOMI_PHOTOS && window.HOMI_PHOTOS[name];
    return f ? f('a' + artSeq++) : '';
  };

  const HOMI_FACE =
    '<svg viewBox="0 0 64 64" aria-hidden="true"><ellipse cx="24" cy="29.5" rx="4.6" ry="6.1" fill="#2b1a06"/>' +
    '<ellipse cx="40" cy="29.5" rx="4.6" ry="6.1" fill="#2b1a06"/><circle cx="25.5" cy="27" r="1.5" fill="#fff" opacity=".9"/>' +
    '<circle cx="41.5" cy="27" r="1.5" fill="#fff" opacity=".9"/></svg>';
  document.querySelectorAll('[data-homi-face]').forEach((el) => { el.innerHTML = HOMI_FACE; });

  function mix(hex, amt) {
    const n = parseInt(hex.replace('#', ''), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const m = (c) => Math.round(c + (255 - c) * amt);
    return `rgb(${m(r)},${m(g)},${m(b)})`;
  }

  // ---------- state ----------
  let S, members, items = [], captions = [], chapters = [], jumps = [], calls = [], composes = [], clocks = [], joins = [], albums = [];
  let endCard = null, titleCard = null;
  let DURATION = 60000, V_H = 600, clusterEls = [];
  const REACT_PAD = 16, TOP_PAD = 10, BOTTOM_PAD = 12;

  function avatarHTML(id, extra = '') {
    const m = members[id] || { name: '?', color: '#666' };
    if (m.bot) return `<div class="av homi ${extra}">${HOMI_FACE}</div>`;
    const c = m.color || '#777';
    return `<div class="av ${extra}" style="background:linear-gradient(160deg, ${mix(c, 0.28)}, ${c})">${esc((m.name || '?')[0])}</div>`;
  }
  const sideOf = (from) => (from === 'you' ? 'you' : members[from] && members[from].bot ? 'homi' : 'friend');

  // ---------- compile script.json into items ----------
  function compile(script) {
    S = script;
    members = {};
    for (const m of S.meta.members) members[m.id] = m;
    const ev = S.events.map((e, i) => Object.assign({}, e, { _i: i })).sort((a, b) => a.t - b.t || a._i - b._i);
    const byId = {};
    let auto = 0;
    for (const e of ev) {
      switch (e.type) {
        case 'message': {
          const it = { kind: 'msg', id: e.id || '_m' + auto++, from: e.from, text: e.text || '', t: e.t, reactions: [],
            card: e.card || null, photos: e.photos || (e.photo ? [e.photo] : null), quote: e.quote || null };
          if (e.typing > 0 && e.from === 'you') composes.push({ t0: e.t - e.typing, t1: e.t, text: e.text });
          else if (e.typing > 0) items.push({ kind: 'typing', from: e.from, t0: e.t - e.typing, t1: e.t });
          items.push(it);
          byId[it.id] = it;
          break;
        }
        case 'typing':
          items.push({ kind: 'typing', from: e.from, t0: e.t, t1: e.t + (e.duration || 1200), standalone: true });
          break;
        case 'divider':
          items.push({ kind: 'divider', t: e.t, text: e.text, style: e.style || '' });
          if (e.clock) clocks.push({ t: e.t, clock: e.clock });
          break;
        case 'system':
          items.push({ kind: 'system', t: e.t, text: e.text, member: e.addMember });
          if (e.addMember) joins.push({ t: e.t, id: e.addMember });
          break;
        case 'reaction': {
          const tg = byId[e.target];
          if (tg) tg.reactions.push({ t: e.t, emoji: e.emoji, from: e.from });
          else console.warn('reaction target not found (must be an earlier message id):', e.target);
          break;
        }
        case 'receipt': {
          const tg = byId[e.target];
          if (tg) items.splice(items.indexOf(tg) + 1, 0, { kind: 'receipt', t: e.t, text: e.text, target: tg });
          else console.warn('receipt target not found:', e.target);
          break;
        }
        case 'caption': captions.push({ t: e.t, until: e.until, text: e.text }); break;
        case 'chapter': chapters.push({ t: e.t, text: e.text }); break;
        case 'jump': jumps.push({ t: e.t, duration: e.duration || 1600, text: e.text || '', ticker: e.ticker || [] }); break;
        case 'call': calls.push(e); break;
        case 'end': endCard = e; break;
        case 'title': titleCard = e; break;
        case 'album': albums.push(e); break;
        default: console.warn('unknown event type', e.type);
      }
    }
    captions.forEach((c, i) => { if (c.until == null) c.until = captions[i + 1] ? captions[i + 1].t - 120 : c.t + 3500; });
    const lastT = ev.length ? ev[ev.length - 1].t : 0;
    DURATION = S.meta.duration || (endCard ? endCard.t + (endCard.duration || 6000) : lastT + 2500);
    for (const c of calls) {
      c.accept = c.accept == null ? 1300 : c.accept;
      c.endAt = c.endAt == null ? c.duration - 1000 : c.endAt;
      c.lines = c.lines || [];
    }
    if (S.meta.clock) clocks.unshift({ t: -1, clock: S.meta.clock });
  }

  // ---------- build DOM ----------
  function build() {
    $('chatTitle').textContent = S.meta.chat || 'the crew';
    const list = $('chatList');
    let prevSolid = null;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const el = document.createElement('div');
      it.el = el;
      if (it.kind === 'msg' || it.kind === 'typing') {
        const side = sideOf(it.from);
        it.side = side;
        el.className = `item ${side}`;
        const sameRun = prevSolid && prevSolid.kind === 'msg' && prevSolid.from === it.from;
        it.showName = it.kind === 'msg' && side !== 'you' && !sameRun;
        it.mt = sameRun ? 3 : 11;
        const name = it.showName ? `<div class="name">${esc(members[it.from] ? members[it.from].name : it.from)}</div>` : '';
        const slot = side === 'you' ? '' : `<div class="slot">${avatarHTML(it.from, 'avslot')}</div>`;
        let body, wide = false;
        if (it.kind === 'typing') body = '<div class="bubble typing"><i></i><i></i><i></i></div>';
        else {
          const quote = it.quote ? `<div class="quote">${fmt(it.quote)}</div>` : '';
          let main;
          if (it.card) { wide = true; main = `<div class="bubble card${it.card.compact ? ' compact' : ''}">${cardHTML(it.card)}</div>`; }
          else if (it.photos) {
            main = `<div class="pics${it.photos.length > 1 ? ' two' : ''}">${it.photos.map((p) => `<div class="pic">${art(p)}</div>`).join('')}</div>` +
              (it.text ? `<div class="bubble">${fmt(it.text)}</div>` : '');
          } else main = `<div class="bubble">${fmt(it.text)}</div>`;
          body = quote + main + '<div class="reacts"></div>';
        }
        el.innerHTML = `<div class="in">${name}<div class="row">${slot}<div class="bw${wide ? ' wide' : ''}">${body}</div></div></div>`;
        it.inEl = el.firstChild;
        it.rowEl = el.querySelector('.row');
        it.inEl.style.transformOrigin = side === 'you' ? '100% 100%' : '20px 100%';
        it.avEl = el.querySelector('.avslot');
        if (it.kind === 'typing') it.dots = Array.from(el.querySelectorAll('.typing i'));
        if (it.kind === 'msg') {
          // reactions grouped by emoji, in order of first landing
          it.reactions.sort((a, b) => a.t - b.t);
          it.groups = [];
          const reacts = el.querySelector('.reacts');
          reacts.style.flexDirection = side === 'you' ? 'row' : 'row-reverse';
          for (const r of it.reactions) {
            let g = it.groups.find((x) => x.emoji === r.emoji);
            if (!g) {
              g = { emoji: r.emoji, times: [] };
              g.el = document.createElement('div');
              g.el.className = 'pill';
              g.el.innerHTML = `<span>${esc(r.emoji)}</span><b></b>`;
              g.countEl = g.el.querySelector('b');
              reacts.appendChild(g.el);
              it.groups.push(g);
            }
            g.times.push(r.t);
          }
          it.flyers = it.reactions.map((r) => {
            const f = document.createElement('div');
            f.className = 'flyer';
            f.textContent = r.emoji;
            el.querySelector('.bw').appendChild(f);
            return { t: r.t, el: f };
          });
        }
        if (it.kind === 'msg') prevSolid = it;
      } else if (it.kind === 'divider') {
        el.className = 'item';
        el.innerHTML = `<div class="in divider ${it.style === 'jump' ? 'jumpdiv' : ''}"><span>${accent(it.text).replace(/<em>/g, '<b>').replace(/<\/em>/g, '</b>')}</span></div>`;
        it.inEl = el.firstChild;
        it.mt = 4;
        prevSolid = it;
      } else if (it.kind === 'system') {
        el.className = 'item';
        el.innerHTML = `<div class="in system">${it.member ? avatarHTML(it.member) : ''}<span>${esc(it.text)}</span></div>`;
        it.inEl = el.firstChild;
        it.mt = 6;
        prevSolid = it;
      } else if (it.kind === 'receipt') {
        el.className = 'item';
        el.innerHTML = `<div class="in receipt">${esc(it.text)}</div>`;
        it.inEl = el.firstChild;
        it.mt = 0;
      }
      list.appendChild(el);
    }
    // avatar runs: consecutive msg/typing items from the same sender after this one
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.avEl) continue;
      it.followers = [];
      for (let j = i + 1; j < items.length; j++) {
        const n = items[j];
        if ((n.kind === 'msg' || n.kind === 'typing') && n.from === it.from) it.followers.push(n);
        else break;
      }
    }
    // measure natural heights
    for (const it of items) it.h = it.el.offsetHeight;
    V_H = $('chatViewport').clientHeight;

    // header cluster: base roster (first 3) + joiners
    const cluster = $('cluster');
    const base = (S.meta.roster || []).slice(0, 3);
    clusterEls = [];
    for (const id of base) {
      cluster.insertAdjacentHTML('beforeend', avatarHTML(id));
      clusterEls.push({ id, el: cluster.lastElementChild, join: null });
    }
    for (const j of joins) {
      cluster.insertAdjacentHTML('beforeend', avatarHTML(j.id));
      clusterEls.push({ id: j.id, el: cluster.lastElementChild, join: j.t });
    }

    // chapters list
    const ol = $('chapters');
    chapters.forEach((c, i) => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="bar"><i></i></span><span class="n">${String(i + 1).padStart(2, '0')}</span><span>${esc(c.text)}</span>`;
      ol.appendChild(li);
      c.li = li;
      c.fill = li.querySelector('.bar i');
    });

    // call transcript lines
    for (const c of calls) {
      const tr = $('transcript');
      $('call').style.display = 'block';
      c.lineEls = c.lines.map((ln) => {
        const el = document.createElement('div');
        const isHomi = members[c.caller] && members[c.caller].name === ln.from;
        el.className = 'line' + (isHomi ? ' homi' : '');
        const words = ln.text.split(/\s+/);
        el.innerHTML = `<div class="sp"><span>${esc(ln.from)}</span><span class="wave">${'<i></i>'.repeat(5)}</span></div><div class="tx"></div>`;
        tr.appendChild(el);
        const tx = el.querySelector('.tx');
        tx.innerHTML = esc(ln.text);
        const h = el.offsetHeight;
        return { el, tx, words, h, bars: Array.from(el.querySelectorAll('.wave i')), lastK: -1 };
      });
      c.trH = tr.clientHeight;
      $('call').style.display = 'none';
    }
    if (calls[0]) {
      const c = calls[0];
      $('callName').textContent = members[c.caller] ? members[c.caller].name : c.caller || 'Homi';
      $('callNum').textContent = c.number || '';
      $('callTag').textContent = c.label || '';
      $('callTag').style.display = c.label ? '' : 'none';
      $('callNoteText').textContent = c.note || 'Simulated call audio';
    }

    if (endCard) {
      $('eTitle').textContent = endCard.title || 'Whats the Word';
      $('eLine').textContent = endCard.line || '';
      $('eTag').textContent = endCard.tagline || '';
      $('eBadge').textContent = endCard.badge || '';
      $('eBadge').style.display = endCard.badge ? '' : 'none';
      $('eQrLabel').textContent = endCard.qr || '';
      $('eQr').style.display = endCard.qr ? '' : 'none';
      $('eName').textContent = endCard.name || '';
      $('eName').style.display = endCard.name ? '' : 'none';
    }
    if (titleCard) {
      $('tTitle').textContent = titleCard.title || 'Whats the Word';
      $('tLine').textContent = titleCard.line || '';
    }

    // album screens: one tile set per album event, positioned per frame
    const grid = $('albumGrid');
    for (const a of albums) {
      a.box = document.createElement('div');
      a.box.style.cssText = 'position:absolute;inset:0;display:none';
      const removed = a.remove ? String(a.remove.by).toLowerCase() : null;
      let kept = 0;
      a.tiles = (a.photos || []).map((p, i) => {
        const el = document.createElement('div');
        el.className = 'tile';
        const who = members[p.by] ? members[p.by].name : p.by;
        el.innerHTML = art(p.art) + `<div class="by">${avatarHTML(p.by)}<span>${esc(who)}</span></div>`;
        a.box.appendChild(el);
        const gone = removed != null && (p.by === removed || String(who).toLowerCase() === removed);
        return { el, from: i, to: gone ? -1 : kept++ };
      });
      a.kept = kept;
      grid.appendChild(a.box);
    }

    const pw = $('phoneWrap');
    pw.style.transform = `translate(${PHONE_PLACE.x}px, ${PHONE_PLACE.y}px) scale(${PHONE_PLACE.s})`;
  }

  // ---------- per-frame ----------
  function presence(it, t) {
    switch (it.kind) {
      case 'msg': return eOut(prog(t, it.t, 340));
      case 'typing': return Math.min(eOut(prog(t, it.t0, 240)), 1 - eInOut(prog(t, it.t1 - 40, 220)));
      case 'divider': case 'system': return eOut(prog(t, it.t, 420));
      case 'receipt': return eOut(prog(t, it.t, 280));
    }
    return 0;
  }
  const entry = (it, t) => (it.kind === 'typing' ? eOut(prog(t, it.t0, 200)) : eOut(prog(t, it.t, 260)));

  let lastCap = null, lastChapIdx = -2, lastClock = null, lastSub = null;

  function renderChat(t) {
    let y = 0;
    for (const it of items) {
      const p = presence(it, t);
      it._p = p;
      if (p <= 0.0005) { it._vis = false; continue; }
      it._vis = true;
      const rp = it.kind === 'msg' && it.reactions.length ? REACT_PAD * eOut(prog(t, it.reactions[0].t - 260, 320)) : 0;
      y += it.mt * p + rp;
      it._y = y;
      y += it.h * p;
    }
    const offset = Math.max(0, y + TOP_PAD + BOTTOM_PAD - V_H);
    for (const it of items) {
      const el = it.el;
      if (!it._vis) { el.style.display = 'none'; continue; }
      const ty = it._y + TOP_PAD - offset;
      if (ty + it.h < -40) { el.style.display = 'none'; continue; }
      el.style.display = 'block';
      el.style.transform = `translate3d(0, ${ty.toFixed(2)}px, 0)`;
      const p = it._p;
      if (it.kind === 'msg') {
        const e = eOut(prog(t, it.t, 360));
        const s = 0.84 + 0.16 * eBack(prog(t, it.t, 440));
        it.inEl.style.opacity = clamp(e * 1.7).toFixed(3);
        it.inEl.style.transform = `translateY(${((1 - e) * 14).toFixed(2)}px) scale(${s.toFixed(4)})`;
        for (const g of it.groups) {
          let n = 0;
          for (const rt of g.times) if (rt <= t) n++;
          if (n === 0) { g.el.style.display = 'none'; continue; }
          g.el.style.display = 'flex';
          const a = Math.max(0, eBack(prog(t, g.times[0], 380)));
          const bump = n > 1 ? Math.sin(Math.PI * prog(t, g.times[n - 1], 320)) * 0.24 : 0;
          g.el.style.transform = `scale(${(a * (1 + bump)).toFixed(4)})`;
          const label = n > 1 ? String(n) : '';
          if (g.countEl.textContent !== label) g.countEl.textContent = label;
          g.countEl.style.display = label ? '' : 'none';
        }
        for (const f of it.flyers) {
          const fp = prog(t, f.t - 320, 320);
          if (fp <= 0 || fp >= 1) { f.el.style.display = 'none'; continue; }
          const e2 = eOut(fp);
          f.el.style.display = 'block';
          f.el.style.opacity = clamp(fp * 3).toFixed(3);
          f.el.style.transform = `translateY(${(-(1 - e2) * 30).toFixed(2)}px) scale(${(1.6 - 0.6 * e2).toFixed(3)})`;
        }
      } else if (it.kind === 'typing') {
        it.inEl.style.opacity = Math.min(eOut(prog(t, it.t0, 200)), 1 - prog(t, it.t1 - 70, 120)).toFixed(3);
        it.inEl.style.transform = `scale(${(0.75 + 0.25 * p).toFixed(4)})`;
        it.dots.forEach((d, i) => {
          const v = 0.5 + 0.5 * Math.sin((2 * Math.PI * t) / 1100 - i * 0.95);
          d.style.opacity = (0.32 + 0.68 * v).toFixed(3);
          d.style.transform = `translateY(${(-2.6 * v).toFixed(2)}px)`;
        });
      } else {
        it.inEl.style.opacity = p.toFixed(3);
      }
      if (it.avEl) {
        let hide = 0;
        for (const f of it.followers) hide = Math.max(hide, entry(f, t));
        const a = (it.kind === 'typing' ? p : clamp(eOut(prog(t, it.t, 300)) * 1.5)) * (1 - hide);
        it.avEl.style.opacity = a.toFixed(3);
      }
    }
  }

  function renderHeader(t) {
    let clock = clocks.length ? clocks[0].clock : '';
    for (const c of clocks) if (c.t <= t) clock = c.clock;
    if (clock !== lastClock) { $('clock').textContent = clock; lastClock = clock; }

    const baseCount = (S.meta.roster || []).length + 1; // + you
    let joined = 0;
    for (const j of joins) if (j.t <= t) joined++;
    const sub = `${baseCount + joined} people`;
    if (sub !== lastSub) { $('chatSub').textContent = sub; lastSub = sub; }

    // cluster: joiners pop in on the left, the others slide right
    let slots = [];
    const joiners = clusterEls.filter((c) => c.join != null);
    const base = clusterEls.filter((c) => c.join == null);
    let shift = 0;
    for (const j of joiners) shift = Math.max(shift, eInOut(prog(t, j.join + 150, 450)));
    base.forEach((c, i) => {
      const x = (i + shift) * 20;
      c.el.style.left = x.toFixed(2) + 'px';
      c.el.style.zIndex = String(10 - i);
      c.el.style.opacity = i === base.length - 1 ? (1 - shift).toFixed(3) : '1';
    });
    joiners.forEach((c) => {
      const a = Math.max(0, eBack(prog(t, c.join + 250, 500)));
      c.el.style.left = '0px';
      c.el.style.zIndex = '20';
      c.el.style.transform = `scale(${a.toFixed(4)})`;
      c.el.style.opacity = a > 0 ? '1' : '0';
    });
    slots = null;
  }

  function renderCompose(t) {
    let c = null;
    for (const x of composes) if (t >= x.t0 && t < x.t1) c = x;
    const field = { text: '', caret: false };
    if (c) {
      const all = chars(c.text);
      const n = Math.round(all.length * prog(t, c.t0 + 60, (c.t1 - c.t0) * 0.78));
      field.text = all.slice(0, n).join('');
      field.caret = n < all.length || Math.floor((t - c.t0) / 420) % 2 === 0;
    }
    $('ctext').textContent = field.text;
    $('ph').style.display = field.text ? 'none' : '';
    $('caret').style.display = c && field.caret ? 'inline-block' : 'none';
    $('send').style.display = field.text ? 'flex' : 'none';
    $('mic').style.display = field.text ? 'none' : '';
  }

  function renderJump(t) {
    let j = null;
    for (const x of jumps) if (t >= x.t && t < x.t + x.duration) j = x;
    const app = $('app'), el = $('jump');
    if (!j) { el.style.opacity = '0'; app.style.filter = ''; return; }
    const lt = t - j.t;
    const a = Math.min(eOut(prog(lt, 0, 320)), 1 - eIn(prog(lt, j.duration - 380, 380)));
    el.style.opacity = a.toFixed(3);
    app.style.filter = `blur(${(7 * a).toFixed(2)}px) brightness(${(1 - 0.35 * a).toFixed(3)})`;
    $('jumpText').textContent = j.text;
    const tick = $('jumpTick'), dots = $('jumpDots');
    const n = j.ticker.length;
    if (!n) { tick.innerHTML = ''; dots.innerHTML = ''; return; }
    if (tick.childElementCount !== 2) tick.innerHTML = '<span></span><span></span>';
    if (dots.childElementCount !== n) dots.innerHTML = '<i></i>'.repeat(n);
    const pos = prog(lt, 260, j.duration - 760) * (n - 1);
    const i = Math.min(n - 1, Math.floor(pos));
    const s = i >= n - 1 ? 0 : eInOut(clamp((pos - i - 0.55) / 0.45));
    const [cur, nxt] = tick.children;
    cur.textContent = j.ticker[i];
    cur.style.transform = `translateY(${(-s * 34).toFixed(2)}px)`;
    cur.style.opacity = (1 - s).toFixed(3);
    nxt.textContent = j.ticker[Math.min(n - 1, i + 1)];
    nxt.style.transform = `translateY(${((1 - s) * 34).toFixed(2)}px)`;
    nxt.style.opacity = s.toFixed(3);
    Array.from(dots.children).forEach((d, k) => { d.style.background = k <= i + (s > 0.5 ? 1 : 0) ? '#ffb547' : '#444'; });
  }

  const fmtTimer = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  function renderCall(t) {
    let c = null;
    for (const x of calls) if (t >= x.t && t < x.t + x.duration) c = x;
    const el = $('call');
    if (!c) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    const lt = t - c.t;
    const a = Math.min(eOut(prog(lt, 0, 240)), 1 - eIn(prog(lt, c.duration - 420, 420)));
    el.style.opacity = a.toFixed(3);
    el.style.transform = `scale(${(1.05 - 0.05 * eOut(prog(lt, 0, 500))).toFixed(4)})`;
    const acc = c.accept;
    // incoming rings
    const rings = el.querySelectorAll('.ring');
    rings.forEach((r, k) => {
      const ph = ((lt / 1500) + k / 3) % 1;
      const fade = 1 - prog(lt, acc, 260);
      r.style.transform = `scale(${(1 + 0.62 * ph).toFixed(3)})`;
      r.style.opacity = ((1 - ph) * 0.65 * fade).toFixed(3);
    });
    const s = eInOut(prog(lt, acc, 520));
    $('callWho').style.transform = `translateY(${(-34 * s).toFixed(2)}px) scale(${(1 - 0.22 * s).toFixed(4)})`;
    $('callState').textContent = lt < acc ? 'incoming call' : lt < c.endAt ? fmtTimer(lt - acc) : 'Call ended';
    $('callBtns').style.opacity = (1 - eOut(prog(lt, acc, 260))).toFixed(3);
    $('incall').style.opacity = eOut(prog(lt, acc + 120, 320)).toFixed(3);
    const press = Math.sin(Math.PI * prog(lt, acc - 220, 320));
    $('acceptBtn').style.transform = `scale(${(1 - 0.09 * press).toFixed(4)})`;
    const rp = prog(lt, acc - 220, 560);
    const rip = $('ripple');
    if (rp > 0 && rp < 1) {
      const d = 24 + 110 * eOut(rp);
      rip.style.display = 'block';
      rip.style.width = rip.style.height = d.toFixed(1) + 'px';
      rip.style.left = rip.style.top = (36 - d / 2).toFixed(1) + 'px';
      rip.style.opacity = (0.55 * (1 - rp)).toFixed(3);
    } else rip.style.display = 'none';
    const press2 = Math.sin(Math.PI * prog(lt, c.endAt - 260, 320));
    $('endBtn').style.transform = `scale(${(1 - 0.09 * press2).toFixed(4)})`;

    // transcript: newest line at the bottom, older ones above and dimmer
    const visible = [];
    c.lines.forEach((ln, i) => { if (lt >= ln.t) visible.push(i); else c.lineEls[i].el.style.display = 'none'; });
    const H = c.trH || 262;
    let bottom = H;
    for (let vi = visible.length - 1; vi >= 0; vi--) {
      const k = visible[vi];
      const L = c.lineEls[k];
      const ln = c.lines[k];
      L.el.style.display = 'block';
      const isLast = vi === visible.length - 1;
      const e = eOut(prog(lt, ln.t, 380));
      // the newest line sits at the bottom and pushes older ones up as it grows in
      const top = bottom - L.h;
      L.el.style.top = top.toFixed(2) + 'px';
      L.el.style.transform = `translateY(${((1 - e) * 16).toFixed(2)}px)`;
      L.el.style.opacity = (isLast ? e : 0.45).toFixed(3);
      bottom = isLast ? H - (L.h + 12) * e : top - 12;
      if (top + L.h < 0) L.el.style.display = 'none';
      const dur = ln.duration || 1500;
      const k2 = Math.ceil(L.words.length * prog(lt, ln.t + 120, dur));
      if (k2 !== L.lastK) {
        L.tx.innerHTML = esc(L.words.slice(0, k2).join(' ')) + (k2 < L.words.length ? ` <span class="dim">${esc(L.words.slice(k2).join(' '))}</span>` : '');
        L.lastK = k2;
      }
      const talking = lt >= ln.t && lt <= ln.t + dur + 120;
      L.bars.forEach((b, i) => {
        const h = talking ? 3 + 11 * Math.abs(Math.sin(lt / 85 + i * 1.7) * Math.sin(lt / 240 + i * 0.6)) : 3;
        b.style.height = h.toFixed(1) + 'px';
      });
    }
  }

  function renderCaption(t) {
    let cap = null;
    for (const c of captions) if (t >= c.t && t < c.until) cap = c;
    const el = $('caption');
    if (!cap) { el.style.opacity = '0'; return; }
    if (cap !== lastCap) { el.innerHTML = `<div class="cap">${accent(cap.text)}</div>`; lastCap = cap; }
    const a = Math.min(eOut(prog(t, cap.t, 380)), 1 - eIn(prog(t, cap.until - 300, 300)));
    el.style.opacity = a.toFixed(3);
    el.style.transform = `translateY(${((1 - eOut(prog(t, cap.t, 460))) * 20).toFixed(2)}px)`;
  }

  function renderChapters(t) {
    let idx = -1;
    chapters.forEach((c, i) => { if (t >= c.t) idx = i; });
    chapters.forEach((c, i) => {
      const next = chapters[i + 1] ? chapters[i + 1].t : endCard ? endCard.t : DURATION;
      c.li.className = i < idx ? 'past' : i === idx ? 'active' : '';
      const f = i < idx ? 1 : i === idx ? prog(t, c.t, next - c.t) : 0;
      c.fill.style.height = (f * 100).toFixed(2) + '%';
    });
    const tag = $('chapterTag');
    if (LAYOUT === 'vertical' && idx >= 0) {
      if (idx !== lastChapIdx) { tag.textContent = `${String(idx + 1).padStart(2, '0')} · ${chapters[idx].text}`; lastChapIdx = idx; }
      tag.style.opacity = eOut(prog(t, chapters[idx].t, 400)).toFixed(3);
    } else tag.style.opacity = '0';
  }

  function renderEnd(t) {
    const el = $('endcard');
    if (!endCard || t < endCard.t) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    const et = t - endCard.t;
    el.style.opacity = eOut(prog(et, 0, 600)).toFixed(3);
    const stag = (id, d) => {
      const e = eOut(prog(et, d, 600));
      const x = $(id);
      x.style.opacity = e.toFixed(3);
      x.style.transform = `translateY(${((1 - e) * 26).toFixed(2)}px)`;
    };
    const m = Math.max(0, eBack(prog(et, 150, 700)));
    $('eMark').style.transform = `scale(${m.toFixed(4)})`;
    stag('eTitle', 300); stag('eName', 400); stag('eLine', 480); stag('eTag', 640); stag('eBadge', 800); stag('eQr', 950);
  }

  const cellXY = (i) => ({ x: (i % 2) * 184, y: Math.floor(i / 2) * 184 });

  function renderAlbum(t) {
    let a = null;
    for (const x of albums) if (t >= x.t && t < x.t + x.duration) a = x;
    const el = $('album');
    if (!a) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    const lt = t - a.t;
    const up = eOut(prog(lt, 0, 460)), down = eIn(prog(lt, a.duration - 400, 400));
    el.style.transform = `translateY(${((1 - up + down) * 100).toFixed(3)}%)`;
    for (const x of albums) x.box.style.display = x === a ? 'block' : 'none';
    const rm = a.remove;
    const rp = rm ? prog(lt, rm.at, 380) : 0;
    const mv = rm ? eInOut(prog(lt, rm.at + 320, 480)) : 0;
    const set = (id, v) => { const n = $(id); if (n.textContent !== v) n.textContent = v; };
    set('albumHeader', a.header || 'Members only');
    set('albumTitle', a.title || '');
    set('albumSub', rm && lt >= rm.at + 320 ? a.subAfter || a.sub || '' : a.sub || '');
    set('albumFoot', a.foot || '');
    // the footer follows the grid: 2 rows of tiles, then 1 row once the removed photos are gone
    const rows0 = Math.ceil(a.tiles.length / 2), rows1 = Math.ceil(a.kept / 2);
    const footTop = 214 + (rows0 + (rows1 - rows0) * mv) * 184 + 12;
    $('albumFoot').style.top = footTop.toFixed(2) + 'px';
    $('albumToast').style.top = (footTop + 66).toFixed(2) + 'px';
    for (const tl of a.tiles) {
      const p0 = cellXY(tl.from);
      if (tl.to < 0) {
        const e = eIn(rp);
        tl.el.style.display = rp >= 1 ? 'none' : 'block';
        tl.el.style.transform = `translate(${p0.x}px, ${p0.y}px) scale(${(1 - 0.35 * e).toFixed(4)})`;
        tl.el.style.opacity = (1 - e).toFixed(3);
      } else {
        const p1 = cellXY(tl.to);
        const x = p0.x + (p1.x - p0.x) * mv, y = p0.y + (p1.y - p0.y) * mv;
        tl.el.style.display = 'block';
        tl.el.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`;
        tl.el.style.opacity = '1';
      }
    }
    const toast = $('albumToast');
    if (rm && rm.toast) {
      set('albumToast', rm.toast);
      const ta = Math.min(eOut(prog(lt, rm.at - 200, 300)), 1 - eIn(prog(lt, rm.at + 1500, 300)));
      toast.style.opacity = ta.toFixed(3);
    } else toast.style.opacity = '0';
  }

  function renderTitle(t) {
    const el = $('titlecard');
    if (!titleCard || t < titleCard.t || t >= titleCard.t + (titleCard.duration || 2000)) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    const lt = t - titleCard.t, d = titleCard.duration || 2000;
    el.style.opacity = (1 - eIn(prog(lt, d - 450, 450))).toFixed(3);
    const m = Math.max(0, eBack(prog(lt, 0, 600)));
    $('tMark').style.transform = `scale(${(0.6 + 0.4 * m).toFixed(4)})`;
    const e = eOut(prog(lt, 120, 500));
    $('tTitle').style.transform = `translateY(${((1 - e) * 18).toFixed(2)}px)`;
    $('tLine').style.opacity = eOut(prog(lt, 300, 500)).toFixed(3);
  }

  function render(t) {
    t = Math.max(0, Math.min(DURATION, t));
    renderChat(t);
    renderHeader(t);
    renderCompose(t);
    renderJump(t);
    renderCall(t);
    renderAlbum(t);
    renderTitle(t);
    renderCaption(t);
    renderChapters(t);
    renderEnd(t);
    return t;
  }

  // ---------- fit + playback ----------
  function fit() {
    const st = $('stage');
    if (RENDER) { st.style.transform = 'none'; st.style.left = '0px'; st.style.top = '0px'; return; }
    const availH = window.innerHeight - 56;
    const s = Math.min(window.innerWidth / STAGE.w, availH / STAGE.h);
    st.style.transform = `scale(${s})`;
    st.style.left = ((window.innerWidth - STAGE.w * s) / 2).toFixed(1) + 'px';
    st.style.top = ((availH - STAGE.h * s) / 2).toFixed(1) + 'px';
  }

  function startPlayback(start) {
    let playing = true, cur = start, last = performance.now();
    const scrub = $('scrub'), label = $('tlabel'), btn = $('playBtn');
    const tick = (now) => {
      if (playing) { cur += now - last; if (cur > DURATION) cur = 0; render(cur); }
      last = now;
      scrub.value = String(Math.round((cur / DURATION) * 1000));
      label.textContent = (cur / 1000).toFixed(1) + 's / ' + (DURATION / 1000).toFixed(1) + 's';
      requestAnimationFrame(tick);
    };
    btn.onclick = () => { playing = !playing; btn.textContent = playing ? 'Pause' : 'Play'; };
    scrub.oninput = () => { cur = (Number(scrub.value) / 1000) * DURATION; render(cur); };
    $('layoutBtn').onclick = () => {
      const p = new URLSearchParams(location.search);
      p.set('layout', LAYOUT === 'vertical' ? 'landscape' : 'vertical');
      p.set('t', String(Math.round(cur)));
      location.search = p.toString();
    };
    window.addEventListener('keydown', (e) => {
      if (e.key === ' ') { btn.click(); e.preventDefault(); }
      if (e.key === 'ArrowRight') { cur = Math.min(DURATION, cur + 2000); render(cur); }
      if (e.key === 'ArrowLeft') { cur = Math.max(0, cur - 2000); render(cur); }
    });
    requestAnimationFrame(tick);
  }

  async function main() {
    try {
      const script = window.__HOMI_SCRIPT__ || (await (await fetch('script.json', { cache: 'no-store' })).json());
      compile(script);
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      build();
      fit();
      window.addEventListener('resize', fit);
      window.__seek = render;
      window.__homi = { ready: true, duration: DURATION, fps: (S.meta && S.meta.fps) || 30, layout: LAYOUT, stage: STAGE };
      const start = Number(params.get('t') || 0);
      render(start);
      if (!RENDER) startPlayback(start);
    } catch (err) {
      const box = $('err');
      box.style.display = 'flex';
      box.innerHTML = 'Could not load script.json (' + esc(err.message) + ').<br>Browsers block fetch() on file:// pages: run <code>node story/render/serve.mjs</code> and open the URL it prints.';
      window.__homi = { ready: false, error: String(err) };
    }
  }
  main();
})();
