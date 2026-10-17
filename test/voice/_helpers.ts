// Shared fakes for voice tests. No real network: every fetch is a stub.

export interface StubCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export type StubReply = { status: number; body?: unknown } | Error;

export function stubFetch(handler: (url: string, method: string, body: unknown) => StubReply) {
  const calls: StubCall[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const headers = { ...(init?.headers as Record<string, string> | undefined) };
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url, method, headers, body });
    const r = handler(url, method, body);
    if (r instanceof Error) throw r;
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), {
      status: r.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { fetch: fetchFn, calls };
}

export const noNetwork = (async () => {
  throw new Error('network must not be used in this test');
}) as typeof fetch;

/** Fake clock whose timers advance time and fire on the next macrotask. */
export function fakeClock(start = 1_792_000_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    scheduleTimeout: (fn: () => void, ms: number) => {
      t += ms;
      setImmediate(fn);
    },
  };
}

/** Matches anything that looks like a phone number. */
export const PHONE_LIKE = /\+?\d[\d\s().-]{6,}\d/;
