// Tiny HTTP helper for the live providers: one deadline covers the request AND reading the
// body. Uses a normal (ref'd) timer rather than AbortSignal.timeout(), whose unref'd timer
// can let a hung request outlive its deadline when nothing else keeps the process busy.

export async function fetchJson(
  doFetch: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<unknown> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error(`timeout after ${timeoutMs} ms`)), timeoutMs);
  try {
    const res = await doFetch(url, { ...init, signal: ac.signal });
    if (!res.ok) throw new Error(`http ${res.status}`);
    return await Promise.race([
      res.json(),
      new Promise<never>((_, reject) => ac.signal.addEventListener('abort', () => reject(ac.signal.reason), { once: true })),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
