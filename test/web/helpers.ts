// Helpers for the web demo tests: JSON POSTs and a tiny SSE reader on top of fetch.

export interface SseEvent {
  event: string;
  data: unknown;
}

export async function post(base: string, path: string, body: unknown = {}, headers: Record<string, string> = {}): Promise<{ status: number; body: any }> {
  const r = await fetch(new URL(path, base), { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

export async function getJson(base: string, path: string): Promise<any> {
  const r = await fetch(new URL(path, base));
  return r.json();
}

/** Opens /events and collects every event; next(pred) waits for the first (new or past) match. */
export async function openEvents(url: string) {
  const ac = new AbortController();
  const res = await fetch(url, { signal: ac.signal, headers: { accept: 'text/event-stream' } });
  if (!res.ok || !res.body) throw new Error(`events: HTTP ${res.status}`);
  const seen: SseEvent[] = [];
  const waiters: { pred: (e: SseEvent) => boolean; resolve: (e: SseEvent) => void }[] = [];
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const pump = async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          let event = 'message';
          let data = '';
          for (const line of block.split('\n')) {
            if (line.startsWith('event: ')) event = line.slice(7);
            else if (line.startsWith('data: ')) data += line.slice(6);
          }
          if (!data) continue;
          const e = { event, data: JSON.parse(data) as unknown };
          seen.push(e);
          for (const w of [...waiters]) {
            if (w.pred(e)) {
              waiters.splice(waiters.indexOf(w), 1);
              w.resolve(e);
            }
          }
        }
      }
    } catch {
      /* aborted */
    }
  };
  void pump();
  return {
    seen,
    next(pred: (e: SseEvent) => boolean, timeoutMs = 10_000): Promise<SseEvent> {
      const hit = seen.find(pred);
      if (hit) return Promise.resolve(hit);
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timed out waiting for an SSE event')), timeoutMs);
        waiters.push({ pred, resolve: (e) => (clearTimeout(t), resolve(e)) });
      });
    },
    close() {
      ac.abort();
    },
  };
}

export async function until<T>(fn: () => Promise<T | undefined | false>, timeoutMs = 30_000, everyMs = 100): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, everyMs));
  }
}
