import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { handleInbound } from '../../src/voice/inbound.js';
import { signPayload } from '../../src/voice/webhook.js';

const KEY = 'key_inbound_test';
const NOW = 1_792_000_000_000;
const MEMBER = '+16175550142';
const QUESTION = "Hi, it's Homi, thanks for calling about your group's plan. Does Friday at 7 or Saturday at 7 work better for you?";

function inboundBody(from: string | null = MEMBER, event = 'call_inbound'): string {
  return JSON.stringify({
    event,
    event_timestamp: NOW,
    call_inbound: { call_id: 'call_in_1', agent_id: 'agent_x', agent_version: 1, from_number: from ?? undefined, to_number: '+16175550100' },
  });
}

const signed = (body: string) => ({ 'X-Retell-Signature': signPayload(body, KEY, NOW) });
const lookup = async (phone: string) => (phone === MEMBER ? { question: QUESTION, callRef: 'ref_inbound_1' } : null);

let savedKey: string | undefined;
before(() => {
  savedKey = process.env['RETELL_API_KEY'];
  delete process.env['RETELL_API_KEY'];
});
after(() => {
  if (savedKey !== undefined) process.env['RETELL_API_KEY'] = savedKey;
});

test('known pending member → question as dynamic variable + opaque callRef metadata', async () => {
  const body = inboundBody();
  const r = await handleInbound(body, signed(body), { apiKey: KEY, now: () => NOW, lookupByPhone: lookup });
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.body), {
    call_inbound: { dynamic_variables: { question: QUESTION }, metadata: { callRef: 'ref_inbound_1' } },
  });
  assert.ok(!r.body.includes(MEMBER));
});

test('unknown caller → reject', async () => {
  const body = inboundBody('+16175550999');
  const r = await handleInbound(body, signed(body), { apiKey: KEY, now: () => NOW, lookupByPhone: lookup });
  assert.deepEqual(r, { status: 200, body: '{"call_inbound":{"reject":true}}' });
});

test('bad or stale signature → 401 and no lookup', async () => {
  const body = inboundBody();
  let looked = false;
  const deps = { apiKey: KEY, now: () => NOW, lookupByPhone: async () => ((looked = true), null) };
  assert.equal((await handleInbound(body, { 'x-retell-signature': signPayload(body, 'wrong', NOW) }, deps)).status, 401);
  assert.equal((await handleInbound(body, {}, deps)).status, 401);
  const stale = { 'x-retell-signature': signPayload(body, KEY, NOW - 6 * 60_000) };
  assert.equal((await handleInbound(body, stale, deps)).status, 401);
  assert.equal(looked, false);
});

test('RETELL_API_KEY from env is used when deps.apiKey is absent', async () => {
  process.env['RETELL_API_KEY'] = KEY;
  try {
    const body = inboundBody();
    assert.equal((await handleInbound(body, {}, { now: () => NOW, lookupByPhone: lookup })).status, 401);
    assert.equal((await handleInbound(body, signed(body), { now: () => NOW, lookupByPhone: lookup })).status, 200);
  } finally {
    delete process.env['RETELL_API_KEY'];
  }
});

test('no key configured → signature not checked (dev only)', async () => {
  const body = inboundBody();
  const r = await handleInbound(body, {}, { lookupByPhone: lookup });
  assert.equal(JSON.parse(r.body).call_inbound.metadata.callRef, 'ref_inbound_1');
});

test('fails closed: lookup error, lookup timeout, unsafe question, bad caller id', async () => {
  const body = inboundBody();
  const deps = { now: () => NOW };
  const reject = '{"call_inbound":{"reject":true}}';
  assert.equal((await handleInbound(body, {}, { ...deps, lookupByPhone: async () => { throw new Error('db down'); } })).body, reject);
  assert.equal(
    (await handleInbound(body, {}, { ...deps, lookupTimeoutMs: 20, lookupByPhone: () => new Promise(() => {}) })).body,
    reject,
  );
  assert.equal(
    (await handleInbound(body, {}, { ...deps, lookupByPhone: async () => ({ question: 'Call me at +1 617 555 0100', callRef: 'r' }) })).body,
    reject,
  );
  assert.equal((await handleInbound(inboundBody('anonymous'), {}, { ...deps, lookupByPhone: lookup })).body, reject);
  assert.equal((await handleInbound(inboundBody(null), {}, { ...deps, lookupByPhone: lookup })).body, reject);
});

test('other events get an empty 200; junk gets 400', async () => {
  assert.deepEqual(await handleInbound(inboundBody(MEMBER, 'chat_inbound'), {}, { lookupByPhone: lookup }), { status: 200, body: '{}' });
  assert.equal((await handleInbound('nope', {}, { lookupByPhone: lookup })).status, 400);
});
