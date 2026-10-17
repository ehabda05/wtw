#!/usr/bin/env node
// Tiny static file server for story/ (no dependencies). The motion page fetches script.json,
// which browsers block on file:// URLs, so preview it through this server:
//   node story/render/serve.mjs            -> http://127.0.0.1:5178/motion/index.html
//   node story/render/serve.mjs 8080
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

export function startServer(port = 0, root = STORY_ROOT) {
  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      let p = normalize(join(root, decodeURIComponent(url.pathname)));
      if (!p.startsWith(root)) { res.writeHead(403).end(); return; }
      let st = statSync(p, { throwIfNoEntry: false });
      if (st && st.isDirectory()) { p = join(p, 'index.html'); st = statSync(p, { throwIfNoEntry: false }); }
      if (!st) { res.writeHead(404).end('not found'); return; }
      const type = MIME[extname(p).toLowerCase()] || 'application/octet-stream';
      const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
      if (range) {
        const start = range[1] ? Number(range[1]) : 0;
        const end = range[2] ? Number(range[2]) : st.size - 1;
        res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Cache-Control': 'no-store' });
        createReadStream(p, { start, end }).pipe(res);
        return;
      }
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
      createReadStream(p).pipe(res);
    } catch (e) {
      res.writeHead(500).end(String(e));
    }
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok({ server, port: server.address().port })));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { port } = await startServer(Number(process.argv[2]) || 5178);
  console.log(`serving ${STORY_ROOT}`);
  console.log(`motion demo: http://127.0.0.1:${port}/motion/index.html?layout=vertical`);
  console.log(`             http://127.0.0.1:${port}/motion/index.html?layout=landscape`);
  console.log(`deck:        http://127.0.0.1:${port}/deck/index.html`);
}
