// The Homi face as a PNG (amber disc, two eyes) for "Add to Home Screen" (iOS needs a PNG apple-touch-icon).
// Drawn in code like src/album/sample.ts, so no binary assets ship with the repo.

import { crc32, deflateSync } from 'node:zlib';

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}

const mix = (a: number, b: number, t: number) => Math.round(a + (b - a) * Math.max(0, Math.min(1, t)));

let cached: Buffer | undefined;

/** A size x size RGB PNG of the Homi avatar on a black tile (default 180 px). */
export function homiIcon(size = 180): Buffer {
  if (cached && size === 180) return cached;
  const raw = Buffer.alloc((size * 3 + 1) * size);
  const c = size / 2;
  const R = size * 0.42;
  const eye = (x: number, y: number, ex: number) => ((x - ex) / (size * 0.072)) ** 2 + ((y - size * 0.46) / (size * 0.095)) ** 2 <= 1;
  const glint = (x: number, y: number, ex: number) => (x - ex - size * 0.024) ** 2 + (y - size * 0.42) ** 2 <= (size * 0.024) ** 2;
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const i = row + 1 + x * 3;
      let rgb: [number, number, number] = [0, 0, 0];
      const d = Math.hypot(x - c, y - c);
      if (d <= R) {
        // radial gradient from the upper left: #ffdb8f -> #ffb547 -> #f08c1a
        const t = Math.hypot(x - size * 0.36, y - size * 0.3) / (R * 1.6);
        rgb = t < 0.5 ? [255, mix(0xdb, 0xb5, t * 2), mix(0x8f, 0x47, t * 2)] : [mix(255, 0xf0, (t - 0.5) * 2), mix(0xb5, 0x8c, (t - 0.5) * 2), mix(0x47, 0x1a, (t - 0.5) * 2)];
        const l = size * 0.375;
        const r = size * 0.625;
        if (eye(x, y, l) || eye(x, y, r)) rgb = [0x2b, 0x1a, 0x06];
        if (glint(x, y, l) || glint(x, y, r)) rgb = [240, 236, 228];
      }
      raw[i] = rgb[0];
      raw[i + 1] = rgb[1];
      raw[i + 2] = rgb[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  if (size === 180) cached = png;
  return png;
}
