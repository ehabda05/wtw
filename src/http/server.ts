// Tiny node:http server: GET /health, POST /voice/retell, POST /voice/inbound, GET /a/<albumId>[/<photoId>]
// (shared album, docs/ALBUM.md). 404 otherwise. Bodies, headers and album paths are never logged.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { silentLogger, type Logger } from '../privacy/logger.js';
import type { VoiceService } from '../runner/services.js';
import type { AlbumGallery } from '../album/gallery.js';

export const MAX_BODY_BYTES = 1_000_000;

export interface HttpDeps {
  voice?: VoiceService;
  logger?: Logger;
  /** Extra fields for /health (never personal data). */
  health?: () => Record<string, unknown>;
  /** Shared-album gallery (galleryFor(ext.photoStore) from src/album). Unset = album links 404. */
  album?: AlbumGallery;
}

function readBody(req: IncomingMessage, limit = MAX_BODY_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function headersOf(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    out[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
  }
  return out;
}

function send(res: ServerResponse, status: number, body: string, type = 'application/json'): void {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

export function createHttpHandler(deps: HttpDeps) {
  const log = deps.logger ?? silentLogger;
  const started = Date.now();
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const path = (req.url ?? '/').split('?')[0];
    try {
      if (req.method === 'GET' && path === '/health') {
        send(res, 200, JSON.stringify({ ok: true, uptimeS: Math.round((Date.now() - started) / 1000), ...(deps.health?.() ?? {}) }));
        return;
      }
      if (req.method === 'POST' && (path === '/voice/retell' || path === '/voice/inbound')) {
        const handler = path === '/voice/retell' ? deps.voice?.handleWebhook : deps.voice?.handleInbound;
        if (!deps.voice || !handler) {
          send(res, 404, JSON.stringify({ error: 'voice webhook not enabled' }));
          return;
        }
        const raw = await readBody(req);
        const out = await handler.call(deps.voice, raw, headersOf(req));
        send(res, out.status, out.body);
        log.info('http: voice webhook', { path, status: out.status });
        return;
      }
      if ((req.method === 'GET' || req.method === 'HEAD') && (path === '/a' || path.startsWith('/a/'))) {
        // Capability links: the album id is the secret, so the path is never logged.
        const out = deps.album ? await deps.album.handle(path) : null;
        if (!out) {
          send(res, 404, JSON.stringify({ error: 'not found' }));
          return;
        }
        res.writeHead(out.status, out.headers);
        res.end(req.method === 'HEAD' ? undefined : out.body);
        return;
      }
      send(res, 404, JSON.stringify({ error: 'not found' }));
    } catch (err) {
      const status = (err as { status?: number }).status ?? 500;
      log.warn('http: request failed', { path: path.startsWith('/a/') ? '/a/:album' : path, status, err });
      if (!res.headersSent) send(res, status, JSON.stringify({ error: status === 413 ? 'body too large' : 'internal error' }));
      else res.end();
    }
  };
}

export function startHttpServer(port: number, deps: HttpDeps): Promise<Server> {
  const handler = createHttpHandler(deps);
  const server = createServer((req, res) => void handler(req, res));
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}
