import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { startHttpServer } from '../../src/http/server.js';
import { createLogger } from '../../src/privacy/logger.js';
import type { VoiceService } from '../../src/runner/services.js';

test('GET /health, POST /voice/* passes the raw body, 404 otherwise, bodies never logged', async () => {
  const lines: string[] = [];
  const got: { raw: string; headers: Record<string, string> }[] = [];
  const voice: VoiceService = {
    placeCall: async () => undefined,
    onResult: () => undefined,
    handleWebhook: async (raw, headers) => {
      got.push({ raw, headers });
      return { status: 204, body: '' };
    },
    handleInbound: async () => ({ status: 200, body: JSON.stringify({ call_inbound: { reject: true } }) }),
  };
  const server = await startHttpServer(0, { voice, logger: createLogger({ level: 'debug', sink: (l) => lines.push(l) }), health: () => ({ surfaces: ['sim'] }) });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const h = await fetch(`${base}/health`);
    assert.equal(h.status, 200);
    const hb = (await h.json()) as { ok: boolean; surfaces: string[] };
    assert.equal(hb.ok, true);
    assert.deepEqual(hb.surfaces, ['sim']);
    const body = '{"event":"call_analyzed","call":{"to_number":"+16175550134","transcript":"friday works"}}';
    const w = await fetch(`${base}/voice/retell`, { method: 'POST', body, headers: { 'x-retell-signature': 'v=1,d=abc' } });
    assert.equal(w.status, 204);
    assert.equal(got[0].raw, body, 'exact raw bytes for signature verification');
    assert.equal(got[0].headers['x-retell-signature'], 'v=1,d=abc');
    const i = await fetch(`${base}/voice/inbound`, { method: 'POST', body: '{}' });
    assert.deepEqual(await i.json(), { call_inbound: { reject: true } });
    assert.equal((await fetch(`${base}/nope`)).status, 404);
    assert.equal((await fetch(`${base}/health`, { method: 'POST' })).status, 404);
  } finally {
    await new Promise((r) => server.close(r));
  }
  const all = lines.join('\n');
  assert.ok(!all.includes('6175550134') && !all.includes('friday works') && !all.includes('abc'));
});

test('voice endpoints 404 when the voice service has no webhook handlers', async () => {
  const server = await startHttpServer(0, { voice: { placeCall: async () => undefined, onResult: () => undefined } });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    assert.equal((await fetch(`${base}/voice/retell`, { method: 'POST', body: '{}' })).status, 404);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
