// Live web demo: an iMessage-style group chat in the browser, driven by the REAL Homi engine (DemoSession).
// Run: npx tsx src/web/server.ts   (PORT=5180, HOST=127.0.0.1; HOST=0.0.0.0 lets phones on the same Wi-Fi join and
// then requires the printed ?k= access token). Labeled everywhere: "Simulated iMessage · real Homi engine".
// Never logs message text: only startup lines, and error names for failed requests.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDuration } from '../runner/clock.js';
import { APP_CSP, FORBIDDEN_PAGE, checkAccess, isLoopback, lanUrls, makeToken, publicFiles, readJson, sendJson, serveFile } from './http.js';
import { homiIcon } from './icon.js';
import { DEMO_START, ScriptPlayer, loadScript, type ScriptStatus } from './script.js';
import { DemoError, DemoSession, type SessionEvent } from './session.js';
import type { RouterSetup } from '../llm/router.js';

export interface WebServerOptions {
  port?: number;
  host?: string;
  /** Access token; default: random when host is not loopback, none on loopback. null = never required. */
  token?: string | null;
  start?: string;
  tz?: string;
  scriptPath?: string;
  /** LLM repair router; default from env/.env (HOMI_LLM=on + ANTHROPIC_API_KEY), null = off. */
  llm?: RouterSetup | null;
}

export interface WebServer {
  server: Server;
  url: string;
  token: string | null;
  session: DemoSession;
  close(): Promise<void>;
}

const DEFAULT_SCRIPT = fileURLToPath(new URL('../../demo/demo.sim.txt', import.meta.url));

export async function startWebServer(opts: WebServerOptions = {}): Promise<WebServer> {
  const host = opts.host ?? '127.0.0.1';
  const token = opts.token === undefined ? (isLoopback(host) ? null : makeToken()) : opts.token;
  const session = await DemoSession.create({ start: opts.start, tz: opts.tz, llm: opts.llm });
  const files = publicFiles();
  const scriptPath = opts.scriptPath ?? DEFAULT_SCRIPT;
  const clients = new Set<ServerResponse>();
  let player: ScriptPlayer | null = null;
  let scriptStatus: ScriptStatus = { playing: false, index: 0, total: 0, errors: 0, done: false };

  const write = (res: ServerResponse, event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const broadcast = (event: string, data: unknown) => {
    for (const c of clients) write(c, event, data);
  };
  const snapshot = () => ({
    group: session.group,
    personas: session.personas,
    tz: session.tz,
    now: session.now(),
    start: session.startedAt,
    demoStart: DEMO_START,
    entries: session.transcript(),
    call: session.call,
    script: scriptStatus,
  });
  session.subscribe((e: SessionEvent) => {
    if (e.type === 'entry') broadcast('entry', e.entry);
    else if (e.type === 'clock') broadcast('clock', { now: e.now });
    else if (e.type === 'call') broadcast('call', e.call);
    else broadcast('snapshot', snapshot());
  });
  const ping = setInterval(() => {
    for (const c of clients) c.write(': ping\n\n');
  }, 15_000);
  ping.unref();

  const stopScript = async () => {
    const p = player;
    player = null;
    if (p) {
      p.stop();
      await p.done;
    }
  };
  const playScript = async (speed: number) => {
    await stopScript();
    const lines = loadScript(scriptPath, session.personas);
    await session.reset(DEMO_START);
    const p = new ScriptPlayer(session, lines, {
      speed,
      onStatus: (s) => {
        if (player !== p && player !== null) return;
        scriptStatus = s;
        broadcast('script', s);
      },
    });
    player = p;
    p.start();
    return lines.length;
  };

  const api = async (req: IncomingMessage, res: ServerResponse, path: string): Promise<void> => {
    const b = await readJson(req);
    const str = (k: string) => (typeof b[k] === 'string' ? (b[k] as string) : undefined);
    switch (path) {
      case '/api/say': {
        const ref = await session.say(str('persona') ?? '', str('text') ?? '', str('replyTo') || undefined);
        return sendJson(res, 200, { ok: true, ref });
      }
      case '/api/react':
        await session.react(str('persona') ?? '', str('emoji') ?? '', str('target') ?? 'last');
        return sendJson(res, 200, { ok: true });
      case '/api/photo': {
        const ref = await session.photo(str('persona') ?? '', str('caption'), str('replyTo') || undefined);
        return sendJson(res, 200, { ok: true, ref });
      }
      case '/api/answer': {
        const out = await session.answer(str('persona') ?? '', b.decline === true ? null : (str('text') ?? ''));
        return sendJson(res, 200, { ok: true, ...out });
      }
      case '/api/ff': {
        const ms = b.nextDay === true ? session.msToNextDay() : typeof b.ms === 'number' ? b.ms : parseDuration(str('duration') ?? '');
        const out = await session.fastForward(ms);
        return sendJson(res, 200, { ok: true, ...out });
      }
      case '/api/reset':
        await stopScript();
        await session.reset(str('start'));
        scriptStatus = { playing: false, index: 0, total: 0, errors: 0, done: false };
        broadcast('script', scriptStatus);
        return sendJson(res, 200, { ok: true, now: session.now() });
      case '/api/script/play': {
        const speed = typeof b.speed === 'number' && b.speed > 0 ? Math.min(b.speed, 1000) : 1;
        const total = await playScript(speed);
        return sendJson(res, 200, { ok: true, total });
      }
      case '/api/script/stop':
        await stopScript();
        scriptStatus = { ...scriptStatus, playing: false };
        broadcast('script', scriptStatus);
        return sendJson(res, 200, { ok: true, status: scriptStatus });
      default:
        return sendJson(res, 404, { error: 'not found' });
    }
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // A malformed request target (e.g. "//") must never crash the demo: answer 400 and carry on.
    let url: URL;
    try {
      url = new URL('http://demo.local' + ((req.url ?? '/').startsWith('/') ? (req.url ?? '/') : `/${req.url}`));
    } catch {
      sendJson(res, 400, { error: 'bad request' });
      return;
    }
    const path = url.pathname;
    try {
      const access = checkAccess(req, url, token);
      if (!access.ok) {
        res.writeHead(403, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(FORBIDDEN_PAGE);
        return;
      }
      const cookie: Record<string, string> = access.cookie ? { 'set-cookie': access.cookie } : {};
      if (req.method === 'POST' && path.startsWith('/api/')) {
        // Cross-site pages cannot drive the demo: JSON only (forces a CORS preflight) and same-origin when sent.
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) return sendJson(res, 403, { error: 'cross-origin' });
        if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) return sendJson(res, 415, { error: 'send application/json' });
        return await api(req, res, path);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'method not allowed' });
      if (path === '/' || path === '/index.html') {
        const start = url.searchParams.get('start');
        if (start && session.pristine && !player) await session.reset(start);
        return serveFile(res, files.get('index.html')!, { ...cookie, 'content-security-policy': APP_CSP });
      }
      if (path === '/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no', ...cookie });
        res.write('retry: 2000\n\n');
        write(res, 'snapshot', snapshot());
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      if (path === '/api/state') return sendJson(res, 200, snapshot());
      if (path === '/api/transcript') return sendJson(res, 200, { entries: session.transcript(), now: session.now() });
      if (path === '/api/script') return sendJson(res, 200, scriptStatus);
      if (path === '/icon.png' || path === '/apple-touch-icon.png') {
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' });
        res.end(homiIcon());
        return;
      }
      let m = /^\/api\/sample\/((?:u)-\d+)$/.exec(path);
      if (m) {
        const png = session.samplePhoto(m[1]);
        if (!png) return sendJson(res, 404, { error: 'not found' });
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff' });
        res.end(Buffer.from(png));
        return;
      }
      m = /^\/api\/file\/(sim-\d+)$/.exec(path);
      if (m) {
        const f = session.file(m[1]);
        if (!f) return sendJson(res, 404, { error: 'not found' });
        const name = f.name.replace(/[^\w.-]+/g, '_');
        res.writeHead(200, { 'content-type': f.mime, 'content-disposition': `attachment; filename="${name}"`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        res.end(f.content);
        return;
      }
      if (path === '/a' || path.startsWith('/a/')) {
        // Album capability links: never logged. Same gallery as production (src/album/gallery.ts).
        const out = session.gallery ? await session.gallery.handle(path) : null;
        if (!out) return sendJson(res, 404, { error: 'not found' });
        res.writeHead(out.status, { ...out.headers, ...cookie });
        res.end(req.method === 'HEAD' ? undefined : out.body);
        return;
      }
      const f = files.get(path.slice(1));
      if (f && path.slice(1) !== 'index.html') return serveFile(res, f, cookie);
      return sendJson(res, 404, { error: 'not found' });
    } catch (err) {
      const e = err as { status?: number; message?: string; name?: string };
      const status = err instanceof DemoError ? 400 : e.status && e.status < 500 ? e.status : 500;
      if (status >= 500) process.stderr.write(`web: ${req.method} ${path.startsWith('/a/') ? '/a/:album' : path} failed (${e.name ?? 'Error'})\n`);
      if (!res.headersSent) sendJson(res, status, { error: status === 500 ? 'internal error' : (e.message ?? 'bad request') });
      else res.end();
    }
  };

  const server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
      else res.end();
    });
  });
  await new Promise<void>((ok, fail) => {
    server.once('error', fail);
    server.listen(opts.port ?? 5180, host, () => ok());
  });
  const port = (server.address() as AddressInfo).port;
  const shown = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
  return {
    server,
    url: `http://${shown.includes(':') ? `[${shown}]` : shown}:${port}/`,
    token,
    session,
    close: async () => {
      await stopScript();
      clearInterval(ping);
      for (const c of clients) c.end();
      clients.clear();
      await new Promise<void>((r) => server.close(() => r()));
      session.close();
    },
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flag = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const host = flag('--host') ?? process.env.HOST ?? '127.0.0.1';
  const port = Number(flag('--port') ?? process.env.PORT ?? 5180);
  const web = await startWebServer({ host, port, start: flag('--start') ?? process.env.START, token: process.env.WEB_TOKEN || undefined });
  const k = web.token ? `?k=${web.token}` : '';
  const out = [
    '',
    '  Whats the Word · Homi web demo  (Simulated iMessage · real Homi engine)',
    `  This computer:   ${web.url}${k}`,
  ];
  if (!isLoopback(host)) {
    const lan = lanUrls(port);
    for (const u of lan) out.push(`  Phones on Wi-Fi: ${u.url}${k}   (${u.iface})`);
    if (lan.length === 0) out.push('  No network address found: connect this computer to the Wi-Fi the phones use.');
    out.push('  Access token required on every device (the ?k=… part). Windows: allow Node.js on Private networks if asked.');
  } else {
    out.push('  Phones: restart with HOST=0.0.0.0 to join from the same Wi-Fi.');
  }
  const llmOn = web.session.llmNote.startsWith('LLM fallback ON');
  out.push(`  Everything${llmOn ? ' else' : ''} is offline: fake clock, in-memory data, simulated calls and payments. Ctrl+C to stop.`);
  for (const n of web.session.realCallNotes) out.push(`  ${n}`);
  out.push(`  ${web.session.llmNote}`);
  out.push('');
  process.stdout.write(out.join('\n') + '\n');
  const stop = () => void web.close().finally(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

const invoked = process.argv[1] ? resolve(process.argv[1]) : '';
if (invoked === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    process.stderr.write(`web: ${(err as Error).message}\n`);
    process.exit(1);
  });
}
