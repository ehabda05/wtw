// Retell webhook signature verification + call_analyzed parsing.
//
// Signature algorithm replicated from retell-sdk@6.2.7, file src/lib/webhook_auth.ts
// (npm tarball read on 2026-10-16, not executed):
//   header  X-Retell-Signature: "v=<timestamp_ms>,d=<hex>"   regex /^v=(\d+),d=([0-9a-f]+)$/i
//   digest  HMAC-SHA256(key = API key, message = rawBody + timestamp), lowercase hex (64 chars)
//   reject  if the timestamp is not a safe integer, the digest is not 64 hex chars, or
//           |now - timestamp| > 5 minutes (FIVE_MINUTES default timeout)
// Docs: https://docs.retellai.com/features/secure-webhook (only the API key with the webhook badge
// verifies; "within 5 minutes"; verify the RAW body, never a re-serialized one; egress IP 100.20.5.228).
//
// Payload: { event, call } where call_analyzed carries call.call_analysis.custom_analysis_data
//   https://docs.retellai.com/features/post-call-analysis-consumption
//   https://docs.retellai.com/features/webhook-overview (events, 2xx expected, 10 s timeout, 3 retries)

import { createHmac, timingSafeEqual } from 'node:crypto';
import { cleanAnswer, scrubCall } from './retell.js';

export const SIGNATURE_HEADER = 'x-retell-signature';
export const SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000;
const SHA_256_HEX_LENGTH = 64;

/** Same output as the SDK's `sign(body, apiKey)`: "v=<ts>,d=<hex>". Used by tests and local tools. */
export function signPayload(rawBody: string, apiKey: string, timestamp: number): string {
  const digest = createHmac('sha256', apiKey).update(rawBody + timestamp, 'utf8').digest('hex');
  return `v=${timestamp},d=${digest}`;
}

/** Verify an X-Retell-Signature header exactly as retell-sdk@6.2.7 does (see header comment). */
export function verifySignature(
  rawBody: string,
  apiKey: string,
  header: string | undefined | null,
  now: number = Date.now(),
  toleranceMs: number = SIGNATURE_TOLERANCE_MS,
): boolean {
  if (!apiKey || typeof header !== 'string' || typeof rawBody !== 'string') return false;
  const match = /^v=(\d+),d=([0-9a-f]+)$/i.exec(header);
  if (!match) return false;
  const poststamp = Number(match[1]);
  const hex = match[2]!;
  if (
    !Number.isSafeInteger(poststamp) ||
    !Number.isFinite(now) ||
    !Number.isFinite(toleranceMs) ||
    toleranceMs < 0 ||
    hex.length !== SHA_256_HEX_LENGTH ||
    Math.abs(now - poststamp) > toleranceMs
  ) {
    return false;
  }
  const expected = createHmac('sha256', apiKey).update(rawBody + poststamp, 'utf8').digest();
  const given = Buffer.from(hex, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Case-insensitive header lookup over a plain record. */
export function getHeader(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(headers ?? {})) {
    if (k.toLowerCase() === want) return Array.isArray(v) ? v[0] : v;
  }
  return undefined;
}

export type ParsedWebhook =
  | {
      kind: 'call_analyzed';
      /** Our opaque ref from call.metadata.callRef (undefined if missing). */
      callRef?: string;
      answer?: string;
      /** true when there is a usable answer and the call did not hit voicemail. */
      ok: boolean;
      successful?: boolean;
      inVoicemail?: boolean;
    }
  | { kind: 'ignored'; event: string }
  | { kind: 'invalid' };

/**
 * Parse a Retell call webhook body. Only call_analyzed matters; everything else is 'ignored'.
 * The transcript and any numbers are deleted from the parsed object before returning.
 */
export function parseWebhook(rawBody: string): ParsedWebhook {
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { kind: 'invalid' };
  }
  if (!payload || typeof payload !== 'object') return { kind: 'invalid' };
  const p = payload as Record<string, unknown>;
  const event = typeof p['event'] === 'string' ? (p['event'] as string) : '';
  const call = p['call'];
  if (event !== 'call_analyzed') {
    scrubCall(call);
    return event ? { kind: 'ignored', event } : { kind: 'invalid' };
  }
  if (!call || typeof call !== 'object') return { kind: 'invalid' };
  const c = call as Record<string, unknown>;

  const meta = c['metadata'];
  const callRef =
    meta && typeof meta === 'object' && typeof (meta as Record<string, unknown>)['callRef'] === 'string'
      ? ((meta as Record<string, unknown>)['callRef'] as string)
      : undefined;

  let answer: string | undefined;
  let successful: boolean | undefined;
  let inVoicemail: boolean | undefined;
  const ca = c['call_analysis'];
  if (ca && typeof ca === 'object') {
    const a = ca as Record<string, unknown>;
    const custom = a['custom_analysis_data'];
    if (custom && typeof custom === 'object') answer = cleanAnswer((custom as Record<string, unknown>)['answer']);
    if (typeof a['call_successful'] === 'boolean') successful = a['call_successful'] as boolean;
    if (typeof a['in_voicemail'] === 'boolean') inVoicemail = a['in_voicemail'] as boolean;
  }
  // Delete the transcript (and numbers) from memory as soon as the answer is extracted.
  scrubCall(c);
  delete p['call'];

  return { kind: 'call_analyzed', callRef, answer, ok: answer !== undefined && inVoicemail !== true, successful, inVoicemail };
}
