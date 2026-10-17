// Small HTTP helpers for the web demo: JSON bodies, static files, the LAN access token, LAN URLs.

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PUBLIC_DIR = fileURLToPath(new URL('./public/', import.meta.url));

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

export const APP_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; " +
  "base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** The public folder's files (name -> absolute path), read once: nothing outside it is ever served. */
export function publicFiles(dir = PUBLIC_DIR): Map<string, string> {
  const out = new Map<string, string>();
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isFile() && TYPES[extname(name)]) out.set(name, p);
  }
  return out;
}

export function serveFile(res: ServerResponse, path: string, extra: Record<string, string> = {}): void {
  const body = readFileSync(path);
  res.writeHead(200, {
    'content-type': TYPES[extname(path)] ?? 'application/octet-stream',
    'cache-control': 'no-cache',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...extra,
  });
  res.end(body);
}

export function sendJson(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra });
  res.end(JSON.stringify(body));
}

export async function readJson(req: IncomingMessage, limit = 16_384): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw Object.assign(new Error('body too large'), { status: 413 });
    chunks.push(c as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  throw Object.assign(new Error('body must be a JSON object'), { status: 400 });
}

// ───────────── access token (only when bound beyond loopback) ─────────────

export const TOKEN_COOKIE = 'wtw_k';

export function makeToken(): string {
  return randomBytes(9).toString('base64url');
}

export function isLoopback(host: string): boolean {
  return host === '127.0.0.1' || host === '::1' || host === 'localhost';
}

function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function cookieValue(req: IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

/**
 * ok when no token is required, or ?k= / the cookie matches. A matching ?k= also sets the cookie, so the album
 * page's images and links opened in new tabs keep working.
 */
export function checkAccess(req: IncomingMessage, url: URL, token: string | null): { ok: boolean; cookie?: string } {
  if (!token) return { ok: true };
  const q = url.searchParams.get('k');
  if (q && sameToken(q, token)) {
    return { ok: true, cookie: `${TOKEN_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200` };
  }
  const c = cookieValue(req, TOKEN_COOKIE);
  return { ok: !!c && sameToken(c, token) };
}

export const FORBIDDEN_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Link needed</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#000;color:#f5f5f7;font:17px/1.45 -apple-system,system-ui,sans-serif;text-align:center;padding:24px}p{color:#a1a1aa;max-width:28em}</style></head>
<body><main><h1>Ask for the demo link</h1><p>This Whats the Word demo is private. Open the full link the presenter shares (it ends in <b>?k=…</b>).</p></main></body></html>`;

/** http://<lan-ip>:<port>/ for every non-internal IPv4 address (what phones on the same Wi-Fi can open). */
export function lanUrls(port: number): { url: string; iface: string }[] {
  const out: { url: string; iface: string }[] = [];
  for (const [iface, list] of Object.entries(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === 'IPv4' && !a.internal) out.push({ url: `http://${a.address}:${port}/`, iface });
    }
  }
  return out;
}
