// Minimal Retell REST client (fetch only; the retell-sdk package is not a dependency).
//
// Verified 2026-10-16 against docs.retellai.com and retell-sdk@6.2.7 (src/resources/call.ts):
// - Auth: "Authorization: Bearer <key>", base "https://api.retellai.com"
//     https://docs.retellai.com/api-references/overview
// - POST /v2/create-phone-call → 201 { call_id, call_status, ... }
//     body: from_number, to_number (E.164, required), retell_llm_dynamic_variables (string values),
//     metadata (object), override_agent_id, override_agent_version, idempotency_key (^[A-Za-z0-9_-]{5,255}$,
//     "retry the same request for up to one hour without creating another call")
//     https://docs.retellai.com/api-references/create-phone-call
// - GET /v2/get-call/{call_id} → 200 { call_status: registered|not_connected|ongoing|ended|error,
//     call_analysis?: { call_successful, custom_analysis_data, in_voicemail, call_summary }, ... }
//     https://docs.retellai.com/api-references/get-call
//
// Privacy: errors never contain phone numbers. Request paths that embed a number are reported by a
// label, and any server error text is redacted. Transcripts are scrubbed from parsed responses.

export const RETELL_BASE_URL = 'https://api.retellai.com';
const DEFAULT_TIMEOUT_MS = 15_000;

export type RetellErrorKind = 'http' | 'timeout' | 'network' | 'invalid_response' | 'invalid_input';

export class RetellError extends Error {
  constructor(
    readonly kind: RetellErrorKind,
    /** Route label such as "POST /v2/create-phone-call". Never contains a phone number. */
    readonly endpoint: string,
    readonly status?: number,
    detail?: string,
  ) {
    super(`Retell ${endpoint} failed: ${kind}${status !== undefined ? ` ${status}` : ''}${detail ? ` (${detail})` : ''}`);
    this.name = 'RetellError';
  }

  /** Worth retrying: network trouble, timeouts, rate limits and 5xx. */
  get transient(): boolean {
    return this.kind === 'timeout' || this.kind === 'network' || (this.kind === 'http' && (this.status === 429 || (this.status ?? 0) >= 500));
  }
}

/** Strip anything that could be a phone number, email or long id from a server message, and cap length. */
export function redact(text: string): string {
  return text
    .replace(/[^\s@"']+@[^\s@"']+/g, '[email]')
    .replace(/\+?\d[\d\s().-]{5,}\d/g, '[number]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

/** Same path-segment encoder as retell-sdk@6.2.7 src/internal/utils/path.ts (keeps "+" for E.164). */
export function encodePathSegment(s: string): string {
  return s.replace(/[^A-Za-z0-9\-._~!$&'()*+,;=:@]+/g, encodeURIComponent);
}

const E164 = /^\+[1-9]\d{6,14}$/;
export function isE164(n: string): boolean {
  return typeof n === 'string' && E164.test(n);
}

export interface CreatePhoneCallInput {
  fromNumber: string;
  toNumber: string;
  /** String values only (Retell schema). We send { question } and nothing else. */
  dynamicVariables: Record<string, string>;
  /** Opaque, non-personal: { callRef }. */
  metadata: Record<string, string>;
  agentId?: string;
  agentVersion?: string | number;
  /** Defaults to a value derived from metadata.callRef, so a retried request never dials twice. */
  idempotencyKey?: string;
}

export interface CallInfo {
  status: string;
  /** Present once post-call analysis has run. */
  analysis?: { answer?: string; inVoicemail?: boolean };
  ended: boolean;
  successful?: boolean;
  disconnectionReason?: string;
  callRef?: string;
}

export interface RetellClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export interface RequestOptions {
  /** Route label for errors and logs when the path embeds something sensitive (a phone number). */
  label?: string;
  query?: Record<string, string | number | undefined>;
  timeoutMs?: number;
}

export interface RetellClient {
  createPhoneCall(input: CreatePhoneCallInput): Promise<{ callId: string }>;
  getCall(callId: string): Promise<CallInfo>;
  request<T = unknown>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
}

const SENSITIVE_CALL_FIELDS = [
  'transcript', 'transcript_object', 'transcript_with_tool_calls', 'scrubbed_transcript_with_tool_calls',
  'recording_url', 'recording_multi_channel_url', 'scrubbed_recording_url', 'scrubbed_recording_multi_channel_url',
  'public_log_url', 'knowledge_base_retrieved_contents_url', 'from_number', 'to_number',
  'retell_llm_dynamic_variables', 'collected_dynamic_variables', 'custom_sip_headers',
];

/** Drop transcripts, recordings and numbers from a parsed Retell call object (in place). */
export function scrubCall(call: unknown): void {
  if (!call || typeof call !== 'object') return;
  const c = call as Record<string, unknown>;
  for (const k of SENSITIVE_CALL_FIELDS) delete c[k];
  const analysis = c['call_analysis'];
  if (analysis && typeof analysis === 'object') delete (analysis as Record<string, unknown>)['call_summary'];
}

/** Normalize the free-text answer from post-call analysis. */
export function cleanAnswer(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/\s+/g, ' ').trim().slice(0, 200);
  return s === '' ? undefined : s;
}

/** Extract only what Homi needs from a Retell call object, then scrub it. */
export function extractCallInfo(call: Record<string, unknown>): CallInfo {
  const status = typeof call['call_status'] === 'string' ? (call['call_status'] as string) : 'unknown';
  const ca = call['call_analysis'];
  let analysis: CallInfo['analysis'];
  let successful: boolean | undefined;
  if (ca && typeof ca === 'object') {
    const a = ca as Record<string, unknown>;
    const custom = a['custom_analysis_data'];
    const answer = custom && typeof custom === 'object' ? cleanAnswer((custom as Record<string, unknown>)['answer']) : undefined;
    analysis = { answer, inVoicemail: typeof a['in_voicemail'] === 'boolean' ? (a['in_voicemail'] as boolean) : undefined };
    if (typeof a['call_successful'] === 'boolean') successful = a['call_successful'] as boolean;
  }
  const meta = call['metadata'];
  const callRef = meta && typeof meta === 'object' && typeof (meta as Record<string, unknown>)['callRef'] === 'string'
    ? ((meta as Record<string, unknown>)['callRef'] as string) : undefined;
  const reason = typeof call['disconnection_reason'] === 'string' ? (call['disconnection_reason'] as string) : undefined;
  scrubCall(call);
  return {
    status,
    analysis,
    ended: status === 'ended' || status === 'error' || status === 'not_connected',
    successful,
    disconnectionReason: reason,
    callRef,
  };
}

/** Retell idempotency keys must match ^[A-Za-z0-9_-]{5,255}$. */
export function idempotencyKeyFor(callRef: string): string | undefined {
  if (/^[A-Za-z0-9_-]{5,255}$/.test(callRef)) return callRef;
  const cleaned = callRef.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 255);
  return cleaned.length >= 5 ? cleaned : undefined;
}

export function createRetellClient(opts: RetellClientOptions): RetellClient {
  if (!opts.apiKey) throw new RetellError('invalid_input', 'client', undefined, 'missing API key');
  const base = (opts.baseUrl ?? RETELL_BASE_URL).replace(/\/+$/, '');
  const doFetch = opts.fetch ?? globalThis.fetch;
  const defaultTimeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function request<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown, ro: RequestOptions = {}): Promise<T> {
    const label = ro.label ?? `${method} ${path}`;
    let url = base + path;
    if (ro.query) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(ro.query)) if (v !== undefined) qs.set(k, String(v));
      const q = qs.toString();
      if (q) url += `?${q}`;
    }
    const headers: Record<string, string> = { Authorization: `Bearer ${opts.apiKey}`, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res: Response;
    try {
      res = await doFetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(ro.timeoutMs ?? defaultTimeout),
      });
    } catch (e) {
      const name = (e as { name?: string } | null)?.name;
      if (name === 'TimeoutError' || name === 'AbortError') throw new RetellError('timeout', label);
      throw new RetellError('network', label);
    }
    let text = '';
    try {
      text = await res.text();
    } catch {
      throw new RetellError('network', label, res.status);
    }
    if (!res.ok) {
      let detail: string | undefined;
      try {
        const j = JSON.parse(text) as Record<string, unknown>;
        const msg = j['message'] ?? j['error_message'] ?? j['error'];
        if (typeof msg === 'string') detail = redact(msg);
      } catch {
        /* non-JSON error body: say nothing about it */
      }
      throw new RetellError('http', label, res.status, detail);
    }
    if (text === '') return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new RetellError('invalid_response', label, res.status);
    }
  }

  async function createPhoneCall(input: CreatePhoneCallInput): Promise<{ callId: string }> {
    const label = 'POST /v2/create-phone-call';
    if (!isE164(input.fromNumber)) throw new RetellError('invalid_input', label, undefined, 'from number is not E.164');
    if (!isE164(input.toNumber)) throw new RetellError('invalid_input', label, undefined, 'to number is not E.164');
    for (const v of Object.values(input.dynamicVariables)) {
      if (typeof v !== 'string') throw new RetellError('invalid_input', label, undefined, 'dynamic variables must be strings');
    }
    const body: Record<string, unknown> = {
      from_number: input.fromNumber,
      to_number: input.toNumber,
      retell_llm_dynamic_variables: input.dynamicVariables,
      metadata: input.metadata,
    };
    if (input.agentId) body['override_agent_id'] = input.agentId;
    if (input.agentVersion !== undefined && input.agentVersion !== '') body['override_agent_version'] = input.agentVersion;
    const key = input.idempotencyKey ?? (input.metadata['callRef'] ? idempotencyKeyFor(input.metadata['callRef']) : undefined);
    if (key) body['idempotency_key'] = key;

    // One retry on transient failure is safe only with an idempotency key (no double dial).
    const attempts = key ? 2 : 1;
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await request<Record<string, unknown>>('POST', '/v2/create-phone-call', body, { label });
        const callId = res?.['call_id'];
        scrubCall(res);
        if (typeof callId !== 'string' || callId === '') throw new RetellError('invalid_response', label);
        return { callId };
      } catch (e) {
        lastErr = e;
        if (!(e instanceof RetellError) || !e.transient) break;
      }
    }
    throw lastErr;
  }

  async function getCall(callId: string): Promise<CallInfo> {
    const label = 'GET /v2/get-call/:call_id';
    const res = await request<Record<string, unknown>>('GET', `/v2/get-call/${encodePathSegment(callId)}`, undefined, { label });
    if (!res || typeof res !== 'object') throw new RetellError('invalid_response', label);
    return extractCallInfo(res);
  }

  return { createPhoneCall, getCall, request };
}
