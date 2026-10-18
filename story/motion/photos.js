/* Placeholder "photos" for the album beat: drawn with SVG only (no real people, no image files).
 * window.HOMI_PHOTOS[name](uid) returns an SVG string; uid keeps gradient/filter ids unique per copy,
 * because a copy inside a hidden (display:none) element must not be the one the others reference.
 * Names: ramen, friends, city, neon.
 */
(function () {
  'use strict';
  const head = (u) => `<svg viewBox="0 0 200 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">`;

  // A ramen bowl seen from above on a dark wooden table.
  function ramen(u) {
    let grain = '';
    for (let i = 0; i < 9; i++) {
      const y = 8 + i * 23;
      grain += `<path d="M0 ${y} C60 ${y - 6} 120 ${y + 7} 200 ${y - 2}" stroke="#2a1a10" stroke-width="2" fill="none" opacity=".55"/>`;
    }
    let noodles = '';
    for (let i = 0; i < 7; i++) {
      const y = 112 + i * 7;
      noodles += `<path d="M${46 + i * 2} ${y} q10 -7 20 0 t20 0 t20 0 t20 0 t20 0" stroke="#f8e4a8" stroke-width="3.2" fill="none" stroke-linecap="round" opacity=".95"/>`;
    }
    return head(u) + `<defs>
      <radialGradient id="w${u}" cx="50%" cy="35%" r="80%"><stop offset="0" stop-color="#5b3b22"/><stop offset="1" stop-color="#1e130b"/></radialGradient>
      <radialGradient id="b${u}" cx="42%" cy="38%" r="65%"><stop offset="0" stop-color="#f6c886"/><stop offset=".7" stop-color="#d98c3c"/><stop offset="1" stop-color="#a85e22"/></radialGradient>
      <radialGradient id="l${u}" cx="50%" cy="20%" r="70%"><stop offset="0" stop-color="#fff3d6" stop-opacity=".35"/><stop offset="1" stop-color="#fff3d6" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="200" height="200" fill="url(#w${u})"/>${grain}
    <ellipse cx="102" cy="118" rx="84" ry="70" fill="#000" opacity=".35"/>
    <ellipse cx="100" cy="110" rx="82" ry="68" fill="#17171b"/>
    <ellipse cx="100" cy="110" rx="82" ry="68" fill="none" stroke="#c2402f" stroke-width="5" opacity=".9"/>
    <ellipse cx="100" cy="108" rx="71" ry="57" fill="url(#b${u})"/>
    ${noodles}
    <ellipse cx="76" cy="86" rx="21" ry="15" fill="#c98a5a" stroke="#7d4424" stroke-width="3"/>
    <ellipse cx="76" cy="86" rx="10" ry="6" fill="#e2b58c" opacity=".7"/>
    <ellipse cx="128" cy="92" rx="17" ry="13" fill="#fff6e8"/><ellipse cx="129" cy="93" rx="8.5" ry="7" fill="#f2a024"/>
    <ellipse cx="146" cy="110" rx="14" ry="11" fill="#fff6e8"/><ellipse cx="147" cy="111" rx="7" ry="5.5" fill="#f2a024"/>
    <rect x="96" y="54" width="24" height="34" rx="2" fill="#1b2a20" transform="rotate(-14 108 71)"/>
    <g fill="#7fc25a"><circle cx="102" cy="128" r="3.2"/><circle cx="110" cy="132" r="2.8"/><circle cx="95" cy="135" r="3"/><circle cx="118" cy="126" r="2.6"/><circle cx="88" cy="126" r="2.6"/></g>
    <rect x="128" y="10" width="7" height="118" rx="3" fill="#d9b27c" transform="rotate(32 131 69)"/>
    <rect x="142" y="12" width="7" height="118" rx="3" fill="#c79f68" transform="rotate(36 145 71)"/>
    <ellipse cx="100" cy="80" rx="70" ry="40" fill="url(#l${u})"/>
    <g stroke="#fff" stroke-width="3" fill="none" opacity=".18" stroke-linecap="round"><path d="M70 40 c-8 -10 8 -16 0 -28"/><path d="M98 34 c-8 -10 8 -16 0 -26"/><path d="M126 42 c-8 -10 8 -16 0 -28"/></g>
    </svg>`;
  }

  // Three friends as silhouettes against a warm sunset, string lights above.
  function friends(u) {
    let lights = '';
    for (let i = 0; i < 9; i++) {
      const x = 8 + i * 23, y = 22 + 10 * Math.sin(i * 0.9);
      lights += `<circle cx="${x}" cy="${y.toFixed(1)}" r="9" fill="#ffd27a" opacity=".22"/><circle cx="${x}" cy="${y.toFixed(1)}" r="3" fill="#fff0c4"/>`;
    }
    const person = (x, s, arm) => `<g transform="translate(${x} 0) scale(${s})" fill="#1a1020">
      <circle cx="0" cy="104" r="17"/><path d="M-34 200 C-34 150 -24 128 0 128 C24 128 34 150 34 200 Z"/>${arm || ''}</g>`;
    return head(u) + `<defs>
      <linearGradient id="s${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b2366"/><stop offset=".45" stop-color="#c2477a"/><stop offset=".75" stop-color="#f59a4a"/><stop offset="1" stop-color="#ffd27a"/></linearGradient>
      <radialGradient id="g${u}" cx="50%" cy="85%" r="55%"><stop offset="0" stop-color="#fff1c2" stop-opacity=".8"/><stop offset="1" stop-color="#fff1c2" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="200" height="200" fill="url(#s${u})"/>
    <circle cx="100" cy="176" r="70" fill="url(#g${u})"/>
    <path d="M0 22 Q100 52 200 18" stroke="#2a1830" stroke-width="1.2" fill="none" opacity=".6"/>${lights}
    ${person(50, 0.92, '<path d="M-28 150 L-46 92 L-38 89 L-18 140 Z"/><rect x="-52" y="80" width="12" height="14" rx="2"/>')}
    ${person(100, 1.05)}
    ${person(152, 0.95, '<path d="M26 150 L44 96 L36 93 L18 140 Z"/>')}
    <rect y="178" width="200" height="22" fill="#140c18"/>
    </svg>`;
  }

  // City lights at night with a reflection on the river.
  function city(u) {
    const B = [[0, 92, 26], [24, 70, 22], [44, 104, 30], [72, 54, 20], [90, 84, 28], [116, 40, 18], [132, 76, 26], [156, 96, 22], [176, 64, 24]];
    let bld = '', win = '', refl = '';
    B.forEach(([x, top, w], k) => {
      bld += `<rect x="${x}" y="${top}" width="${w + 1}" height="${140 - top}" fill="${k % 2 ? '#141a33' : '#10152b'}"/>`;
      for (let yy = top + 6; yy < 134; yy += 9) {
        for (let xx = x + 4; xx < x + w - 3; xx += 6) {
          const on = ((xx * 7 + yy * 13 + k * 5) % 11) < 5;
          if (on) win += `<rect x="${xx}" y="${yy}" width="3" height="4" fill="${(xx + yy) % 3 ? '#ffd88a' : '#9fd3ff'}" opacity=".9"/>`;
        }
      }
      refl += `<rect x="${x + 3}" y="${146 + (k % 3) * 4}" width="${w - 6}" height="2" fill="#ffd88a" opacity=".28"/>`;
    });
    let stars = '';
    for (let i = 0; i < 18; i++) stars += `<circle cx="${(i * 47) % 200}" cy="${(i * 29) % 46 + 4}" r="${i % 3 ? 0.8 : 1.3}" fill="#fff" opacity=".7"/>`;
    return head(u) + `<defs>
      <linearGradient id="n${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b1030"/><stop offset=".7" stop-color="#2b2a6b"/><stop offset="1" stop-color="#6a3d7a"/></linearGradient>
      <linearGradient id="r${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b1d44"/><stop offset="1" stop-color="#07081a"/></linearGradient>
    </defs>
    <rect width="200" height="200" fill="url(#n${u})"/>${stars}
    <circle cx="160" cy="26" r="11" fill="#fff4d8" opacity=".9"/>
    ${bld}${win}
    <rect y="140" width="200" height="60" fill="url(#r${u})"/>${refl}
    <rect x="0" y="139" width="200" height="2" fill="#ffd88a" opacity=".35"/>
    </svg>`;
  }

  // A neon sign on a dark brick wall.
  function neon(u) {
    let bricks = '';
    for (let r = 0; r < 12; r++) {
      for (let c = -1; c < 7; c++) {
        const x = c * 34 + (r % 2 ? 17 : 0);
        bricks += `<rect x="${x}" y="${r * 17}" width="32" height="15" rx="1.5" fill="${(r + c) % 3 ? '#231619' : '#2a1a1d'}"/>`;
      }
    }
    return head(u) + `<defs>
      <filter id="f${u}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3.2"/></filter>
      <radialGradient id="h${u}" cx="50%" cy="50%" r="55%"><stop offset="0" stop-color="#ff4fa3" stop-opacity=".35"/><stop offset="1" stop-color="#ff4fa3" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="200" height="200" fill="#140c0e"/>${bricks}
    <rect width="200" height="200" fill="url(#h${u})"/>
    <g fill="none" stroke-linecap="round" stroke-linejoin="round">
      <rect x="26" y="22" width="148" height="104" rx="22" stroke="#ff4fa3" stroke-width="7" filter="url(#f${u})" opacity=".9"/>
      <rect x="26" y="22" width="148" height="104" rx="22" stroke="#ffd0e8" stroke-width="2.4"/>
      <path d="M58 84 h84 a42 26 0 0 1 -84 0 z" stroke="#4ff0ff" stroke-width="7" filter="url(#f${u})"/>
      <path d="M58 84 h84 a42 26 0 0 1 -84 0 z" stroke="#d6fdff" stroke-width="2.4"/>
      <path d="M78 70 q6 -10 0 -20 M100 70 q6 -10 0 -20 M122 70 q6 -10 0 -20" stroke="#4ff0ff" stroke-width="6" filter="url(#f${u})"/>
      <path d="M78 70 q6 -10 0 -20 M100 70 q6 -10 0 -20 M122 70 q6 -10 0 -20" stroke="#d6fdff" stroke-width="2"/>
      <path d="M118 44 L150 76 M128 40 L156 72" stroke="#ffd36b" stroke-width="5" filter="url(#f${u})"/>
      <path d="M118 44 L150 76 M128 40 L156 72" stroke="#fff3c8" stroke-width="1.8"/>
    </g>
    <text x="100" y="152" text-anchor="middle" font-family="Segoe UI, system-ui, sans-serif" font-size="17" font-weight="700" letter-spacing="5" fill="#ffd0e8" opacity=".95">OPEN LATE</text>
    </svg>`;
  }

  // A restaurant receipt on a dark table: paper, a torn edge, line items and the total Homi reads.
  function receipt(u) {
    const line = (y, l, r, bold) =>
      `<text x="44" y="${y}" font-family="Consolas, 'Courier New', monospace" font-size="${bold ? 10.5 : 9}" font-weight="${bold ? 700 : 400}" fill="${bold ? '#1a1a1a' : '#3a3a3a'}">${l}</text>` +
      `<text x="156" y="${y}" text-anchor="end" font-family="Consolas, 'Courier New', monospace" font-size="${bold ? 10.5 : 9}" font-weight="${bold ? 700 : 400}" fill="${bold ? '#1a1a1a' : '#3a3a3a'}">${r}</text>`;
    let tear = 'M30 182';
    for (let x = 30; x <= 170; x += 7) tear += ` L${x + 3.5} ${x % 14 === 2 ? 186 : 182} L${x + 7} 182`;
    return `${head(u)}<defs><linearGradient id="w${u}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3b2a1e"/><stop offset="1" stop-color="#1b140f"/></linearGradient>
      <filter id="s${u}" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="6" stdDeviation="6" flood-color="#000" flood-opacity=".55"/></filter></defs>
      <rect width="200" height="200" fill="url(#w${u})"/>
      <g filter="url(#s${u})" transform="rotate(-3 100 100)">
        <path d="M30 14 H170 V182 ${tear.slice(7)} Z" fill="#f6f1e6"/>
        <text x="100" y="36" text-anchor="middle" font-family="Segoe UI, system-ui, sans-serif" font-size="13" font-weight="800" letter-spacing="2" fill="#1a1a1a">DAKZEN</text>
        <text x="100" y="48" text-anchor="middle" font-family="Consolas, 'Courier New', monospace" font-size="7.5" fill="#6a6a6a">195 ELM ST · SOMERVILLE</text>
        <line x1="44" y1="58" x2="156" y2="58" stroke="#c9c2b4" stroke-width="1" stroke-dasharray="2 2"/>
        ${line(72, 'PAD SEE EW', '16.00')}${line(84, 'GREEN CURRY', '17.00')}${line(96, 'TOM YUM', '15.00')}${line(108, 'THAI ICED TEA x3', '13.50')}${line(120, 'MANGO STICKY RICE', '14.00')}
        <line x1="44" y1="130" x2="156" y2="130" stroke="#c9c2b4" stroke-width="1" stroke-dasharray="2 2"/>
        ${line(142, 'SUBTOTAL', '75.50')}${line(153, 'TAX 7%', '5.29')}${line(164, 'SVC', '3.21')}
        <line x1="44" y1="169" x2="156" y2="169" stroke="#1a1a1a" stroke-width="1.2"/>
        ${line(178, 'TOTAL', '$84.00', true)}
      </g></svg>`;
  }

  window.HOMI_PHOTOS = { ramen, friends, city, neon, receipt };
})();
