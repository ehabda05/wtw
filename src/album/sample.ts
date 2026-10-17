// Generated sample photos for the offline sim (no real images ship with the repo): a small PNG with a soft
// gradient and a sun-like disc, colored from a seed so each persona's "photo" looks different.

import { crc32, deflateSync } from 'node:zlib';

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}

function hue(seed: string): number {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) % 360;
}

function hsl(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

/** A size x size RGB PNG (default 96 px, about 1-3 KB). Deterministic for a given seed. */
export function samplePhoto(seed: string, size = 96): Uint8Array {
  const h = hue(seed);
  const top = hsl(h, 0.65, 0.72);
  const bottom = hsl((h + 40) % 360, 0.6, 0.38);
  const sun = hsl((h + 180) % 360, 0.8, 0.85);
  const raw = Buffer.alloc((size * 3 + 1) * size);
  const cx = size * 0.68;
  const cy = size * 0.36;
  const r2 = (size * 0.16) ** 2;
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    raw[row] = 0; // filter: none
    const t = y / (size - 1);
    for (let x = 0; x < size; x++) {
      const inSun = (x - cx) ** 2 + (y - cy) ** 2 <= r2;
      const c = inSun ? sun : [0, 1, 2].map((i) => Math.round(top[i] * (1 - t) + bottom[i] * t));
      raw.set(c, row + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
