// "Call Otto to RSVP": Retell's inbound call webhook.
//
// Verified 2026-10-16 against https://docs.retellai.com/features/inbound-call-webhook and
// https://docs.retellai.com/api-references/update-phone-number (inbound_webhook_url is set per number):
//   request  { event: "call_inbound", event_timestamp, call_inbound: { call_id, agent_id?, agent_version?,
//              from_number, to_number, custom_sip_headers? } }
//   response 2xx JSON { call_inbound: { dynamic_variables?, metadata?, override_agent_id?, override_agent_version?,
//              agent_override?, reject? } }   — every field optional; { call_inbound: { reject: true } } declines.
//   10 s per attempt, up to 3 attempts total; non-2xx is retried. Dedupe on event + call_inbound.call_id.
// Signature: same X-Retell-Signature scheme as call webhooks (https://docs.retellai.com/features/secure-webhook).
//
// Privacy: the caller's number is used for one lookup and never logged or stored here. The answer
// returned carries only the open question and an opaque callRef (PRIVACY.md §10).

import { assertSafeQuestion } from './script.js';
import { getHeader, SIGNATURE_HEADER, verifySignature } from './webhook.js';

export interface InboundLookupResult {
  question: string;
  callRef: string;
}

export interface InboundDeps {
  /** Find a plan where this caller (raw E.164 from Retell) is a pending, call-opted-in member. */
  lookupByPhone(phone: string): Promise<InboundLookupResult | null>;
  /** Webhook key. Defaults to process.env.RETELL_API_KEY; when unset, the signature is not checked (dev only). */
  apiKey?: string;
  now?: () => number;
  /** Lookup budget; Retell waits 10 s per attempt. */
  lookupTimeoutMs?: number;
}

export interface HttpReply {
  status: number;
  body: string;
}

const REJECT: HttpReply = { status: 200, body: JSON.stringify({ call_inbound: { reject: true } }) };
const MAX_BODY_BYTES = 64 * 1024;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | 'timeout'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const t = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), ms);
  });
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

/**
 * Handle Retell's inbound call webhook. Known pending member → the open question as a dynamic
 * variable plus { callRef } metadata; anyone else (or any failure) → reject. Fails closed.
 */
export async function handleInbound(
  rawBody: string,
  headers: Record<string, string>,
  deps: InboundDeps,
): Promise<HttpReply> {
  if (typeof rawBody !== 'string' || Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
    return { status: 413, body: '{"error":"too large"}' };
  }
  const apiKey = deps.apiKey ?? process.env['RETELL_API_KEY'];
  if (apiKey) {
    const now = deps.now ? deps.now() : Date.now();
    if (!verifySignature(rawBody, apiKey, getHeader(headers, SIGNATURE_HEADER), now)) {
      return { status: 401, body: '{"error":"invalid signature"}' };
    }
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: '{"error":"invalid json"}' };
  }
  const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  if (p['event'] !== 'call_inbound') return { status: 200, body: '{}' }; // not ours (e.g. chat_inbound)

  const ci = p['call_inbound'];
  const from = ci && typeof ci === 'object' ? (ci as Record<string, unknown>)['from_number'] : undefined;
  if (typeof from !== 'string' || !/^\+[1-9]\d{6,14}$/.test(from)) return REJECT;

  let found: InboundLookupResult | null | 'timeout';
  try {
    found = await withTimeout(deps.lookupByPhone(from), deps.lookupTimeoutMs ?? 7_000);
  } catch {
    return REJECT;
  }
  if (!found || found === 'timeout' || typeof found.callRef !== 'string' || found.callRef === '') return REJECT;
  try {
    assertSafeQuestion(found.question, []);
  } catch {
    return REJECT;
  }

  return {
    status: 200,
    body: JSON.stringify({
      call_inbound: {
        dynamic_variables: { question: found.question },
        metadata: { callRef: found.callRef },
      },
    }),
  };
}
