import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceService, voiceConfigFromEnv, type CallResult, type VoiceService } from '../../src/voice/index.js';
import { signPayload } from '../../src/voice/webhook.js';
import { fakeClock, noNetwork, PHONE_LIKE, stubFetch } from './_helpers.js';

const KEY = 'key_service_test';
const FROM = '+16175550100';
const TO = '+16175550142';
const OPTIONS = ['Fri Oct 23 · 7pm', 'Sat Oct 24 · 7pm'];
const SPOKEN = "Hi, this is Homi calling about your group's plan. Does Friday at 7 or Saturday at 7 work better for you?";
const req = (over: Partial<Parameters<VoiceService['placeCall']>[0]> = {}) => ({
  to: TO,
  question: 'Which works: Fri or Sat?',
  options: OPTIONS,
  callRef: 'ref_abc12345',
  planId: 'plan_1',
  member: 'mkey_sam',
  ...over,
});
const nextResult = (svc: VoiceService) => new Promise<CallResult>((resolve) => svc.onResult(resolve));

// ───────────── mock ─────────────

test('mock: default answer, simulated, no network', async () => {
  const clock = fakeClock();
  const svc = createVoiceService({ mode: 'mock' }, { now: clock.now, scheduleTimeout: clock.scheduleTimeout, fetch: noNetwork, log: () => {} });
  const p = nextResult(svc);
  await svc.placeCall(req({ to: 'persona:sam' }));
  assert.deepEqual(await p, { planId: 'plan_1', member: 'mkey_sam', answerText: 'Friday works', ok: true, simulated: true });
  assert.equal(svc.handleWebhook, undefined);
});

test('mock: scripted answer per member', async () => {
  const clock = fakeClock();
  const svc = createVoiceService({ mode: 'mock' }, { now: clock.now, scheduleTimeout: clock.scheduleTimeout, log: () => {} });
  svc.setScriptedAnswer!('mkey_sam', 'Saturday is better');
  const p = nextResult(svc);
  await svc.placeCall(req());
  assert.equal((await p).answerText, 'Saturday is better');
});

test('mock: a question that would leak a forbidden name is refused (ok: false)', async () => {
  const clock = fakeClock();
  const svc = createVoiceService(
    { mode: 'mock', forbiddenTokens: () => ['Sam'] },
    { now: clock.now, scheduleTimeout: clock.scheduleTimeout, log: () => {} },
  );
  const p = nextResult(svc);
  await svc.placeCall(req({ options: [], question: 'Sam, does Friday work?' }));
  assert.deepEqual(await p, { planId: 'plan_1', member: 'mkey_sam', answerText: undefined, ok: false, simulated: true });
});

// ───────────── poll ─────────────

test('poll: create-phone-call, then get-call every 4 s until analysis', async () => {
  const clock = fakeClock();
  const logs: string[] = [];
  let polls = 0;
  const s = stubFetch((url) => {
    if (url.endsWith('/v2/create-phone-call')) return { status: 201, body: { call_id: 'call_poll_1', call_status: 'registered' } };
    polls++;
    if (polls === 1) return { status: 200, body: { call_status: 'ongoing' } };
    if (polls === 2) return { status: 200, body: { call_status: 'ended', transcript: 'secret' } };
    return {
      status: 200,
      body: {
        call_status: 'ended',
        to_number: TO,
        transcript: 'User: Saturday works',
        metadata: { callRef: 'ref_abc12345' },
        call_analysis: { call_successful: true, in_voicemail: false, custom_analysis_data: { answer: 'Saturday works' } },
      },
    };
  });
  const svc = createVoiceService(
    { mode: 'poll', retellApiKey: KEY, fromNumber: FROM, agentId: 'agent_1' },
    { now: clock.now, scheduleTimeout: clock.scheduleTimeout, fetch: s.fetch, log: (l) => logs.push(l) },
  );
  const start = clock.now();
  const p = nextResult(svc);
  await svc.placeCall(req());
  const r = await p;
  assert.deepEqual(r, { planId: 'plan_1', member: 'mkey_sam', answerText: 'Saturday works', ok: true });
  assert.equal(polls, 3);
  assert.equal(clock.now() - start, 3 * 4000);
  const create = s.calls[0]!;
  assert.deepEqual((create.body as Record<string, unknown>)['retell_llm_dynamic_variables'], { question: SPOKEN });
  assert.deepEqual((create.body as Record<string, unknown>)['metadata'], { callRef: 'ref_abc12345' });
  assert.ok(s.calls.slice(1).every((c) => c.url === 'https://api.retellai.com/v2/get-call/call_poll_1' && c.method === 'GET'));
  for (const l of logs) assert.ok(!PHONE_LIKE.test(l) && !/Saturday|Friday/.test(l), l);
});

test('poll: gives up after 4 minutes with ok: false', async () => {
  const clock = fakeClock();
  let polls = 0;
  const s = stubFetch((url) => {
    if (url.endsWith('/v2/create-phone-call')) return { status: 201, body: { call_id: 'call_slow' } };
    polls++;
    return { status: 200, body: { call_status: 'ongoing' } };
  });
  const svc = createVoiceService(
    { mode: 'poll', retellApiKey: KEY, fromNumber: FROM },
    { now: clock.now, scheduleTimeout: clock.scheduleTimeout, fetch: s.fetch, log: () => {} },
  );
  const p = nextResult(svc);
  await svc.placeCall(req());
  assert.deepEqual(await p, { planId: 'plan_1', member: 'mkey_sam', ok: false });
  assert.equal(polls, 60); // 240 s / 4 s
});

test('poll: ended call with no analysis gives up after a grace period', async () => {
  const clock = fakeClock();
  const s = stubFetch((url) =>
    url.endsWith('/v2/create-phone-call') ? { status: 201, body: { call_id: 'c' } } : { status: 200, body: { call_status: 'not_connected' } },
  );
  const svc = createVoiceService({ mode: 'poll', retellApiKey: KEY, fromNumber: FROM }, { now: clock.now, scheduleTimeout: clock.scheduleTimeout, fetch: s.fetch, log: () => {} });
  const p = nextResult(svc);
  await svc.placeCall(req());
  assert.equal((await p).ok, false);
  assert.ok(s.calls.length < 25);
});

test('poll: create failure (402) reports ok: false and placeCall resolves', async () => {
  const clock = fakeClock();
  const logs: string[] = [];
  const s = stubFetch(() => ({ status: 402, body: { message: `entitlement required for ${FROM}` } }));
  const svc = createVoiceService({ mode: 'poll', retellApiKey: KEY, fromNumber: FROM }, { now: clock.now, scheduleTimeout: clock.scheduleTimeout, fetch: s.fetch, log: (l) => logs.push(l) });
  const p = nextResult(svc);
  await svc.placeCall(req());
  assert.deepEqual(await p, { planId: 'plan_1', member: 'mkey_sam', ok: false });
  assert.ok(logs.some((l) => l.includes('402')));
  for (const l of logs) assert.ok(!PHONE_LIKE.test(l), l);
});

test('poll: a bad destination never reaches the network', async () => {
  const clock = fakeClock();
  const svc = createVoiceService({ mode: 'poll', retellApiKey: KEY, fromNumber: FROM }, { now: clock.now, scheduleTimeout: clock.scheduleTimeout, fetch: noNetwork, log: () => {} });
  const p = nextResult(svc);
  await svc.placeCall(req({ to: 'persona:sam' }));
  assert.equal((await p).ok, false);
});

test('poll/webhook need a key and an E.164 from number', () => {
  const deps = { now: () => 0 };
  assert.throws(() => createVoiceService({ mode: 'poll', fromNumber: FROM }, deps), /RETELL_API_KEY/);
  assert.throws(() => createVoiceService({ mode: 'webhook', retellApiKey: KEY, fromNumber: '617' }, deps), /PHOTON_VOICE_NUMBER/);
});

// ───────────── webhook ─────────────

function analyzedBody(callRef: string, answer?: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    event: 'call_analyzed',
    call: {
      call_id: 'call_w1',
      to_number: TO,
      transcript: 'User: Friday',
      metadata: { callRef },
      call_analysis: { in_voicemail: false, custom_analysis_data: answer === undefined ? {} : { answer } },
      ...extra,
    },
  });
}

function webhookService(fetchFn: typeof fetch, timers?: Array<{ fn: () => void; ms: number }>, lookup?: Parameters<typeof createVoiceService>[1]['lookupByPhone']) {
  const t = { now: 1_792_000_000_000 };
  const svc = createVoiceService(
    { mode: 'webhook', retellApiKey: KEY, fromNumber: FROM },
    {
      now: () => t.now,
      scheduleTimeout: (fn, ms) => void timers?.push({ fn, ms }),
      fetch: fetchFn,
      log: () => {},
      lookupByPhone: lookup,
    },
  );
  return { svc, t };
}

test('webhook: call_analyzed with a valid signature reports the answer once', async () => {
  const s = stubFetch(() => ({ status: 201, body: { call_id: 'call_w1' } }));
  const { svc, t } = webhookService(s.fetch);
  const results: CallResult[] = [];
  svc.onResult((r) => results.push(r));
  await svc.placeCall(req());
  assert.equal(s.calls.length, 1);

  const body = analyzedBody('ref_abc12345', 'Friday works');
  const sig = { 'X-Retell-Signature': signPayload(body, KEY, t.now) };
  assert.deepEqual(await svc.handleWebhook!(body, sig), { status: 200, body: '' });
  assert.deepEqual(results, [{ planId: 'plan_1', member: 'mkey_sam', answerText: 'Friday works', ok: true }]);

  // Retell retries deliveries: a duplicate is acknowledged but not reported again.
  assert.equal((await svc.handleWebhook!(body, sig)).status, 200);
  assert.equal(results.length, 1);
});

test('webhook: bad signature → 401, other events → 200 and ignored, unknown callRef ignored', async () => {
  const s = stubFetch(() => ({ status: 201, body: { call_id: 'call_w1' } }));
  const { svc, t } = webhookService(s.fetch);
  const results: CallResult[] = [];
  svc.onResult((r) => results.push(r));
  await svc.placeCall(req());

  const body = analyzedBody('ref_abc12345', 'Friday works');
  assert.equal((await svc.handleWebhook!(body, { 'x-retell-signature': signPayload(body, 'nope', t.now) })).status, 401);
  assert.equal((await svc.handleWebhook!(body, {})).status, 401);
  const ended = JSON.stringify({ event: 'call_ended', call: { metadata: { callRef: 'ref_abc12345' } } });
  assert.equal((await svc.handleWebhook!(ended, { 'x-retell-signature': signPayload(ended, KEY, t.now) })).status, 200);
  const stranger = analyzedBody('ref_unknown', 'Friday');
  assert.equal((await svc.handleWebhook!(stranger, { 'x-retell-signature': signPayload(stranger, KEY, t.now) })).status, 200);
  assert.equal(results.length, 0);
});

test('webhook: pending call expires after 30 min with ok: false', async () => {
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const s = stubFetch(() => ({ status: 201, body: { call_id: 'call_w1' } }));
  const { svc, t } = webhookService(s.fetch, timers);
  const results: CallResult[] = [];
  svc.onResult((r) => results.push(r));
  await svc.placeCall(req());
  assert.equal(timers.length, 1);
  assert.equal(timers[0]!.ms, 30 * 60_000);
  t.now += 30 * 60_000;
  timers[0]!.fn();
  assert.deepEqual(results, [{ planId: 'plan_1', member: 'mkey_sam', ok: false }]);
  // a late webhook after expiry is ignored
  const body = analyzedBody('ref_abc12345', 'Friday works');
  assert.equal((await svc.handleWebhook!(body, { 'x-retell-signature': signPayload(body, KEY, t.now) })).status, 200);
  assert.equal(results.length, 1);
});

test('webhook: inbound "call Homi to RSVP" then call_analyzed maps back to the plan', async () => {
  const { svc, t } = webhookService(noNetwork, [], async (phone) =>
    phone === TO ? { question: SPOKEN, callRef: 'ref_in_777', planId: 'plan_9', member: 'mkey_ana' } : null,
  );
  const results: CallResult[] = [];
  svc.onResult((r) => results.push(r));

  const inbound = JSON.stringify({ event: 'call_inbound', call_inbound: { call_id: 'call_in', from_number: TO, to_number: FROM } });
  const r = await svc.handleInbound!(inbound, { 'x-retell-signature': signPayload(inbound, KEY, t.now) });
  assert.deepEqual(JSON.parse(r.body), { call_inbound: { dynamic_variables: { question: SPOKEN }, metadata: { callRef: 'ref_in_777' } } });

  const stranger = JSON.stringify({ event: 'call_inbound', call_inbound: { call_id: 'call_x', from_number: '+16175550999', to_number: FROM } });
  const rej = await svc.handleInbound!(stranger, { 'x-retell-signature': signPayload(stranger, KEY, t.now) });
  assert.deepEqual(JSON.parse(rej.body), { call_inbound: { reject: true } });
  assert.equal((await svc.handleInbound!(inbound, {})).status, 401);

  const body = analyzedBody('ref_in_777', 'Saturday');
  await svc.handleWebhook!(body, { 'x-retell-signature': signPayload(body, KEY, t.now) });
  assert.deepEqual(results, [{ planId: 'plan_9', member: 'mkey_ana', answerText: 'Saturday', ok: true }]);
});

test('voiceConfigFromEnv', () => {
  assert.deepEqual(voiceConfigFromEnv({}), { mode: 'mock', retellApiKey: undefined, agentId: undefined, fromNumber: undefined, agentVersion: undefined });
  const c = voiceConfigFromEnv({ VOICE_MODE: 'Webhook', RETELL_API_KEY: 'k', RETELL_AGENT_ID: 'a', PHOTON_VOICE_NUMBER: FROM, RETELL_AGENT_VERSION: '3' });
  assert.deepEqual(c, { mode: 'webhook', retellApiKey: 'k', agentId: 'a', fromNumber: FROM, agentVersion: 3 });
  assert.equal(voiceConfigFromEnv({ VOICE_MODE: 'bogus' }).mode, 'mock');
});
