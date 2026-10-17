// Text -> safe HTML for chat bubbles: escaping, clickable links (album links open this server's /a/...),
// the demo's required labels (SIMULATED, simulated call, demo link, estimates) and Homi's multi-line cards.

export const PEOPLE = {
  ana: { name: 'Ana', color: '#E0567F' },
  ben: { name: 'Ben', color: '#2FA89A' },
  sam: { name: 'Sam', color: '#6DB35C' },
  jo: { name: 'Jo', color: '#3D8FE0' },
  maya: { name: 'Maya', color: '#8B6CF0' },
  you: { name: 'You', color: '#8E8E93' },
};

export const HOMI_FACE =
  '<svg viewBox="0 0 64 64" aria-hidden="true"><ellipse cx="24" cy="29.5" rx="4.6" ry="6.1" fill="#2b1a06"/>' +
  '<ellipse cx="40" cy="29.5" rx="4.6" ry="6.1" fill="#2b1a06"/><circle cx="25.5" cy="27" r="1.5" fill="#fff" opacity=".9"/>' +
  '<circle cx="41.5" cy="27" r="1.5" fill="#fff" opacity=".9"/></svg>';

export const nameOf = (id) => (id === 'homi' ? 'Homi' : PEOPLE[id]?.name ?? (id ? id[0].toUpperCase() + id.slice(1) : '?'));

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function mix(hex, amt) {
  const n = parseInt(hex.replace('#', ''), 16);
  const m = (c) => Math.round(c + (255 - c) * amt);
  return `rgb(${m((n >> 16) & 255)},${m((n >> 8) & 255)},${m(n & 255)})`;
}

export function avatarHTML(id, extra = '') {
  if (id === 'homi') return `<div class="av homi ${extra}">${HOMI_FACE}</div>`;
  const p = PEOPLE[id] ?? { name: nameOf(id), color: '#777' };
  return `<div class="av ${extra}" style="background:linear-gradient(160deg, ${mix(p.color, 0.28)}, ${p.color})">${esc(p.name[0])}</div>`;
}

let tokenParam = '';
/** The ?k= access token, appended to local links (album, files) so they open on phones too. */
export function setToken(k) {
  tokenParam = k ? `?k=${encodeURIComponent(k)}` : '';
}
export const withToken = (path) => path + (tokenParam ? (path.includes('?') ? '&' + tokenParam.slice(1) : tokenParam) : '');

const URL_RE = /https?:\/\/[^\s<>"]+/g;

/** Labels the demo must show wherever they apply (docs/DEMO.md), styled as small tags. */
function labels(html) {
  return html
    .replace(/\(simulated call\)/g, '<span class="tag sim">simulated call</span>')
    .replace(/\(demo link\)/g, '<span class="tag link">demo link</span>')
    .replace(/Example listing · estimated price/g, '<span class="est">Example listing · estimated price</span>')
    .replace(/\(est\.\)/g, '<span class="est">est.</span>')
    .replace(/\bSIMULATED\b/g, '<span class="tag sim">SIMULATED</span>');
}

/** Escapes text, turns URLs into links and highlights labels. */
export function inline(text) {
  let out = '';
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    let url = m[0];
    const trail = /[).,;:!?]+$/.exec(url);
    if (trail) url = url.slice(0, -trail[0].length);
    out += labels(esc(text.slice(last, m.index)));
    const album = /^https:\/\/homi\.example(\/a\/([\w-]+))$/.exec(url);
    const href = album ? withToken(album[1]) : url;
    out += `<a class="url" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(album ? `homi.example/a/${album[2].slice(0, 8)}…` : shortUrl(url))}</a>`;
    last = m.index + url.length;
  }
  return out + labels(esc(text.slice(last)));
}

/** Host plus "/…" (the full address is in the link itself). */
function shortUrl(url) {
  try {
    const u = new URL(url);
    return u.host + (u.pathname.length > 1 || u.search ? '/…' : '');
  } catch {
    return url.slice(0, 40);
  }
}

/** Splits "a · b · c" but keeps a quoted title such as "Ramen night · Fri Oct 23" in one piece. */
function splitDots(s) {
  const out = [];
  for (const part of s.split(' · ')) {
    const prev = out[out.length - 1];
    if (prev !== undefined && (prev.match(/"/g) ?? []).length % 2 === 1) out[out.length - 1] = `${prev} · ${part}`;
    else out.push(part);
  }
  return out;
}

const AMOUNT_ROW = /^(.+?)\s+(~?\$[\d,]+(?:\.\d\d)?)$/;
const PAIR = /^([A-Z][\w]*) (\$[\d,]+\.\d\d)$/;

function row(line) {
  const pairs = line.split(' · ');
  if (pairs.length > 1 && pairs.every((p) => PAIR.test(p))) {
    return pairs
      .map((p) => {
        const [, l, r] = PAIR.exec(p);
        return `<div class="c-row"><span class="l">${esc(l)}</span><span class="r">${esc(r)}</span></div>`;
      })
      .join('');
  }
  const day = /^(Days? [\d–-]+) · (.+)$/.exec(line);
  if (day) return `<div class="c-row"><span class="k">${esc(day[1])}</span><span class="l">${inline(day[2])}</span></div>`;
  const amt = AMOUNT_ROW.exec(line);
  if (amt && !line.startsWith('·') && !amt[1].endsWith(':') && amt[1].length < 40) {
    return `<div class="c-row"><span class="l">${inline(amt[1])}</span><span class="r">${esc(amt[2])}</span></div>`;
  }
  return `<div class="c-row"><span class="l">${inline(line)}</span></div>`;
}

/** { html, card } for a bubble. Homi's multi-line messages become cards (header, rows, footer). */
export function bubbleHTML(text, from) {
  const t = String(text ?? '');
  if (from === 'homi') {
    const lines = t.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length >= 3) {
      const footer = !lines[lines.length - 1].startsWith('·') ? lines.pop() : null;
      const head = lines.shift();
      return {
        card: true,
        html: `<div class="c-hd">${inline(head)}</div><div class="c-rows">${lines.map(row).join('')}</div>` + (footer ? `<div class="c-ft">${inline(footer)}</div>` : ''),
      };
    }
    const dump = /^(Here's everything I have for this chat:)\s([\s\S]+)$/.exec(t);
    if (dump) {
      const items = splitDots(dump[2]);
      return { card: true, html: `<div class="c-hd">${esc(dump[1])}</div><div class="c-rows">${items.map((i) => `<div class="c-row"><span class="l">${inline(i)}</span></div>`).join('')}</div>` };
    }
    const opt = /^(\d{1,2}) · ([\s\S]+)$/.exec(t);
    if (opt) return { card: false, html: `<b class="num">${esc(opt[1])}</b> ${inline(opt[2])}` };
  }
  return { card: false, html: inline(t) };
}

/** iMessage-style timestamp: "<b>Sat, Oct 17</b> at 10:00 AM". */
export function stampHTML(at, tz) {
  const d = new Date(at);
  const day = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' }).format(d);
  return `<b>${esc(day)}</b> at ${esc(timeOf(at, tz))}`;
}

export function timeOf(at, tz, opts = {}) {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', ...opts }).format(new Date(at));
}

export function snippet(text, n = 42) {
  const one = String(text ?? '').replace(/\s+/g, ' ').trim();
  return one.length > n ? one.slice(0, n - 1) + '…' : one;
}
