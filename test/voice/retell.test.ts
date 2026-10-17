import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRetellClient, idempotencyKeyFor, RetellError } from '../../src/voice/retell.js';
import { noNetwork, PHONE_LIKE, stubFetch } from './_helpers.js';

const FROM = '+16175550100';
const TO = '+16175550142';

test('createPhoneCall: POST /v2/create-phone-call with Bearer auth and only question + callRef', async () => {
  const s = stubFetch(() => ({ status: 201, body: { call_id: 'call_123', call_status: 'registered', from_number: FROM, to_number: TO } }));
  const c = createRetellClient({ apiKey: 'key_abc', fetch: s.fetch });
  const r = await c.createPhoneCall({
    fromNumber: FROM,
    toNumber: TO,
    dynamicVariables: { question: 'Does Friday at 7 work for you?' },
    metadata: { callRef: 'ref_abc123' },
    agentId: 'agent_1',
  });
  assert.deepEqual(r, { callId: 'call_123' });
  assert.equal(s.calls.length, 1);
  const call = s.calls[0]!;
  assert.equal(call.url, 'https://api.retellai.com/v2/create-phone-call');
  assert.equal(call.method, 'POST');
  assert.equal(call.headers['Authorization'], 'Bearer key_abc');
  assert.deepEqual(call.body, {
    from_number: FROM,
    to_number: TO,
    retell_llm_dynamic_variables: { question: 'Does Friday at 7 work for you?' },
    metadata: { callRef: 'ref_abc123' },
    override_agent_id: 'agent_1',
    idempotency_key: 'ref_abc123',
  });
});

test('createPhoneCall: HTTP errors are typed and never leak numbers', async () => {
  const s = stubFetch(() => ({ status: 402, body: { message: `No payment method for ${FROM} calling ${TO}` } }));
  const c = createRetellClient({ apiKey: 'k', fetch: s.fetch });
  await assert.rejects(
    c.createPhoneCall({ fromNumber: FROM, toNumber: TO, dynamicVariables: { question: 'q' }, metadata: { callRef: 'ref_abc123' } }),
    (e: unknown) => {
      assert.ok(e instanceof RetellError);
      assert.equal(e.kind, 'http');
      assert.equal(e.status, 402);
      assert.ok(!PHONE_LIKE.test(e.message), e.message);
      assert.match(e.message, /POST \/v2\/create-phone-call/);
      return true;
    },
  );
  assert.equal(s.calls.length, 1); // 402 is not transient: no retry
});

test('createPhoneCall: one retry on 5xx (idempotency key makes it safe)', async () => {
  let n = 0;
  const s = stubFetch(() => (++n === 1 ? { status: 503, body: {} } : { status: 201, body: { call_id: 'call_retry' } }));
  const c = createRetellClient({ apiKey: 'k', fetch: s.fetch });
  const r = await c.createPhoneCall({ fromNumber: FROM, toNumber: TO, dynamicVariables: { question: 'q' }, metadata: { callRef: 'ref_abc123' } });
  assert.equal(r.callId, 'call_retry');
  assert.equal(s.calls.length, 2);
  assert.equal((s.calls[0]!.body as Record<string, unknown>)['idempotency_key'], (s.calls[1]!.body as Record<string, unknown>)['idempotency_key']);
});

test('createPhoneCall: rejects non-E.164 numbers before any request', async () => {
  const c = createRetellClient({ apiKey: 'k', fetch: noNetwork });
  await assert.rejects(
    c.createPhoneCall({ fromNumber: FROM, toNumber: '617-555-0142', dynamicVariables: { question: 'q' }, metadata: { callRef: 'ref_abc123' } }),
    (e: unknown) => e instanceof RetellError && e.kind === 'invalid_input' && !PHONE_LIKE.test(e.message),
  );
});

test('timeouts surface as kind "timeout"', async () => {
  const hang = ((_: unknown, init?: RequestInit) =>
    new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)))) as typeof fetch;
  const c = createRetellClient({ apiKey: 'k', fetch: hang, timeoutMs: 20 });
  // AbortSignal.timeout's timer is unref'd; in production the server keeps the loop alive.
  const keepAlive = setInterval(() => {}, 1000);
  try {
    await assert.rejects(c.getCall('call_1'), (e: unknown) => e instanceof RetellError && e.kind === 'timeout');
  } finally {
    clearInterval(keepAlive);
  }
});

test('network failures surface as kind "network"', async () => {
  const s = stubFetch(() => new TypeError('fetch failed'));
  const c = createRetellClient({ apiKey: 'k', fetch: s.fetch });
  await assert.rejects(c.getCall('call_1'), (e: unknown) => e instanceof RetellError && e.kind === 'network');
});

test('getCall: GET /v2/get-call/{id}, normalized and scrubbed', async () => {
  const s = stubFetch(() => ({
    status: 200,
    body: {
      call_id: 'call_1',
      call_status: 'ended',
      from_number: FROM,
      to_number: TO,
      transcript: 'User: Saturday is better',
      metadata: { callRef: 'ref_abc123' },
      disconnection_reason: 'agent_hangup',
      call_analysis: { call_successful: true, in_voicemail: false, custom_analysis_data: { answer: 'Saturday' } },
    },
  }));
  const c = createRetellClient({ apiKey: 'k', fetch: s.fetch });
  const info = await c.getCall('call_1');
  assert.equal(s.calls[0]!.url, 'https://api.retellai.com/v2/get-call/call_1');
  assert.equal(s.calls[0]!.method, 'GET');
  assert.deepEqual(info, {
    status: 'ended',
    analysis: { answer: 'Saturday', inVoicemail: false },
    ended: true,
    successful: true,
    disconnectionReason: 'agent_hangup',
    callRef: 'ref_abc123',
  });
});

test('getCall: not_connected and error count as ended; no analysis yet → undefined', async () => {
  for (const status of ['not_connected', 'error', 'ongoing', 'registered']) {
    const s = stubFetch(() => ({ status: 200, body: { call_status: status } }));
    const info = await createRetellClient({ apiKey: 'k', fetch: s.fetch }).getCall('c');
    assert.equal(info.ended, status === 'not_connected' || status === 'error');
    assert.equal(info.analysis, undefined);
  }
});

test('idempotency keys follow ^[A-Za-z0-9_-]{5,255}$', () => {
  assert.equal(idempotencyKeyFor('ref_abc123'), 'ref_abc123');
  assert.equal(idempotencyKeyFor('ref:abc/123'), 'ref_abc_123');
  assert.equal(idempotencyKeyFor('ab'), undefined);
});
