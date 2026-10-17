import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getHeader, parseWebhook, signPayload, SIGNATURE_TOLERANCE_MS, verifySignature } from '../../src/voice/webhook.js';
import { extractCallInfo } from '../../src/voice/retell.js';

const KEY = 'key_test_webhook_badge';
const NOW = 1_792_000_000_000;
const BODY = JSON.stringify({ event: 'call_analyzed', call: { call_id: 'call_1', metadata: { callRef: 'ref_abc123' } } });

/** Independent signer using WebCrypto, mirroring retell-sdk@6.2.7 src/lib/webhook_auth.ts `symmetric.sign`. */
async function sdkStyleSign(input: string, secret: string, timestamp: number): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(input + timestamp));
  const hex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `v=${timestamp},d=${hex}`;
}

test('signPayload matches the SDK algorithm (WebCrypto HMAC-SHA256 over body + timestamp)', async () => {
  assert.equal(signPayload(BODY, KEY, NOW), await sdkStyleSign(BODY, KEY, NOW));
  assert.match(signPayload(BODY, KEY, NOW), /^v=\d+,d=[0-9a-f]{64}$/);
});

test('valid signature verifies, including non-ASCII bodies and uppercase hex', async () => {
  assert.equal(verifySignature(BODY, KEY, signPayload(BODY, KEY, NOW), NOW), true);
  const unicode = JSON.stringify({ event: 'call_analyzed', note: 'café ✓' });
  assert.equal(verifySignature(unicode, KEY, await sdkStyleSign(unicode, KEY, NOW), NOW + 1000), true);
  const upper = signPayload(BODY, KEY, NOW).replace(/d=([0-9a-f]+)/, (_, h: string) => `d=${h.toUpperCase()}`);
  assert.equal(verifySignature(BODY, KEY, upper, NOW), true);
});

test('tampered body, digest, or wrong key fails', () => {
  const sig = signPayload(BODY, KEY, NOW);
  assert.equal(verifySignature(BODY.replace('ref_abc123', 'ref_evil00'), KEY, sig, NOW), false);
  assert.equal(verifySignature(BODY + ' ', KEY, sig, NOW), false); // raw body, byte for byte
  const flipped = sig.slice(0, -1) + (sig.endsWith('0') ? '1' : '0');
  assert.equal(verifySignature(BODY, KEY, flipped, NOW), false);
  assert.equal(verifySignature(BODY, 'other_key', sig, NOW), false);
  // timestamp is part of the MAC: changing v= breaks it
  assert.equal(verifySignature(BODY, KEY, sig.replace(`v=${NOW}`, `v=${NOW + 1}`), NOW), false);
});

test('stale or future timestamps outside 5 minutes fail; the boundary passes (SDK uses ">")', () => {
  const sig = signPayload(BODY, KEY, NOW);
  assert.equal(verifySignature(BODY, KEY, sig, NOW + SIGNATURE_TOLERANCE_MS), true);
  assert.equal(verifySignature(BODY, KEY, sig, NOW + SIGNATURE_TOLERANCE_MS + 1), false);
  assert.equal(verifySignature(BODY, KEY, sig, NOW - SIGNATURE_TOLERANCE_MS - 1), false);
});

test('malformed headers fail closed', () => {
  const good = signPayload(BODY, KEY, NOW);
  for (const h of [undefined, '', 'garbage', `v=${NOW}`, `v=abc,d=${'a'.repeat(64)}`, `v=${NOW},d=${'a'.repeat(63)}`, `v=${NOW},d=${'z'.repeat(64)}`, ` ${good}`, `v=99999999999999999999,d=${'a'.repeat(64)}`]) {
    assert.equal(verifySignature(BODY, KEY, h, NOW), false, String(h));
  }
  assert.equal(verifySignature(BODY, '', good, NOW), false);
});

test('getHeader is case-insensitive', () => {
  assert.equal(getHeader({ 'X-Retell-Signature': 'abc' }, 'x-retell-signature'), 'abc');
  assert.equal(getHeader({}, 'x-retell-signature'), undefined);
});

test('parseWebhook: call_analyzed → callRef + answer + ok', () => {
  const body = JSON.stringify({
    event: 'call_analyzed',
    call: {
      call_id: 'call_1',
      from_number: '+16175550100',
      to_number: '+16175550199',
      transcript: 'Agent: ... User: Friday works, Sam will drive',
      metadata: { callRef: 'ref_abc123' },
      call_analysis: { call_successful: true, in_voicemail: false, custom_analysis_data: { answer: '  Friday   works ' } },
    },
  });
  const r = parseWebhook(body);
  assert.deepEqual(r, { kind: 'call_analyzed', callRef: 'ref_abc123', answer: 'Friday works', ok: true, successful: true, inVoicemail: false });
  assert.ok(!JSON.stringify(r).includes('+1617'));
  assert.ok(!JSON.stringify(r).includes('Sam'));
});

test('parseWebhook: voicemail or missing answer is not ok', () => {
  const vm = parseWebhook(JSON.stringify({ event: 'call_analyzed', call: { metadata: { callRef: 'r1' }, call_analysis: { in_voicemail: true, custom_analysis_data: { answer: 'hi' } } } }));
  assert.equal(vm.kind === 'call_analyzed' && vm.ok, false);
  const none = parseWebhook(JSON.stringify({ event: 'call_analyzed', call: { metadata: { callRef: 'r1' }, call_analysis: { custom_analysis_data: {} } } }));
  assert.deepEqual(none, { kind: 'call_analyzed', callRef: 'r1', answer: undefined, ok: false, successful: undefined, inVoicemail: undefined });
  const noAnalysis = parseWebhook(JSON.stringify({ event: 'call_analyzed', call: {} }));
  assert.equal(noAnalysis.kind === 'call_analyzed' && noAnalysis.ok, false);
});

test('parseWebhook: other events ignored, junk invalid', () => {
  assert.deepEqual(parseWebhook(JSON.stringify({ event: 'call_ended', call: { transcript: 'x' } })), { kind: 'ignored', event: 'call_ended' });
  assert.deepEqual(parseWebhook(JSON.stringify({ event: 'call_started', call: {} })), { kind: 'ignored', event: 'call_started' });
  assert.deepEqual(parseWebhook('not json'), { kind: 'invalid' });
  assert.deepEqual(parseWebhook('{}'), { kind: 'invalid' });
});

test('extractCallInfo deletes transcript and numbers from the parsed object', () => {
  const call: Record<string, unknown> = {
    call_status: 'ended',
    transcript: 'secret words',
    transcript_object: [{ role: 'user', content: 'secret' }],
    recording_url: 'https://r',
    from_number: '+16175550100',
    to_number: '+16175550199',
    metadata: { callRef: 'r9' },
    call_analysis: { call_summary: 'Sam said Friday', custom_analysis_data: { answer: 'Friday' } },
  };
  const info = extractCallInfo(call);
  assert.deepEqual(info, { status: 'ended', analysis: { answer: 'Friday', inVoicemail: undefined }, ended: true, successful: undefined, disconnectionReason: undefined, callRef: 'r9' });
  for (const k of ['transcript', 'transcript_object', 'recording_url', 'from_number', 'to_number']) assert.ok(!(k in call), k);
  assert.ok(!('call_summary' in (call['call_analysis'] as object)));
});
