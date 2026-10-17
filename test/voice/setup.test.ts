import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { runSetup } from '../../src/voice/setup.js';
import { noNetwork, stubFetch } from './_helpers.js';

const FAKE_KEY = 'key_SHOULD_NEVER_BE_PRINTED';
const NUMBER = '+16175550100';
const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

async function dryRun(argv: string[], env: Record<string, string | undefined> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runSetup(['--dry-run', ...argv], { RETELL_API_KEY: FAKE_KEY, ...env }, { out: (l) => out.push(l), err: (l) => err.push(l), fetch: noNetwork });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

type Req = { method: string; path: string; body?: Record<string, any> };

test('dry-run poll: LLM + agent JSON with the privacy settings, no network, no secrets', async () => {
  const { code, out } = await dryRun(['--mode', 'poll']);
  assert.equal(code, 0);
  assert.ok(!out.includes(FAKE_KEY));
  const plan = JSON.parse(out) as { dryRun: boolean; mode: string; action: string; requests: Req[] };
  assert.equal(plan.action, 'create');
  assert.deepEqual(plan.requests.map((r) => `${r.method} ${r.path}`), ['POST /create-retell-llm', 'POST /create-agent']);

  const llm = plan.requests[0]!.body!;
  assert.equal(llm['start_speaker'], 'agent');
  assert.equal(llm['begin_message'], '{{question}}');
  assert.ok(String(llm['general_prompt']).includes('Ask exactly: {{question}}'));
  assert.equal(llm['general_tools'][0].type, 'end_call');

  const agent = plan.requests[1]!.body!;
  assert.deepEqual(agent['response_engine'], { type: 'retell-llm', llm_id: '<llm_id from create-retell-llm>' });
  assert.equal(agent['data_storage_setting'], 'everything_except_pii');
  assert.deepEqual(agent['pii_config'], { mode: 'post_call', categories: ['person_name', 'phone_number', 'address', 'email'] });
  assert.equal(agent['data_storage_retention_days'], 1);
  assert.deepEqual(agent['contact_memory_config'], { enable_read: false, enable_update: false });
  assert.equal(agent['opt_in_signed_url'], true);
  assert.equal(agent['post_call_analysis_data'].length, 1);
  assert.equal(agent['post_call_analysis_data'][0].type, 'string');
  assert.equal(agent['post_call_analysis_data'][0].name, 'answer');
  assert.ok(agent['post_call_analysis_data'][0].description.length > 20);
  assert.equal(agent['webhook_url'], null);
  assert.ok(agent['voice_id']);
});

test('dry-run webhook: basic_attributes_only, webhook_url, call_analyzed only, no pii_config', async () => {
  const { code, out } = await dryRun(['--mode', 'webhook', '--webhook-url', 'https://otto.example.dev/voice/retell']);
  assert.equal(code, 0);
  const agent = (JSON.parse(out).requests as Req[])[1]!.body!;
  assert.equal(agent['data_storage_setting'], 'basic_attributes_only');
  assert.equal(agent['pii_config'], undefined);
  assert.equal(agent['webhook_url'], 'https://otto.example.dev/voice/retell');
  assert.deepEqual(agent['webhook_events'], ['call_analyzed']);
  assert.equal(agent['data_storage_retention_days'], 1);
  assert.deepEqual(agent['contact_memory_config'], { enable_read: false, enable_update: false });
});

test('dry-run update when RETELL_AGENT_ID is set; --create overrides', async () => {
  const upd = JSON.parse((await dryRun(['--mode', 'poll'], { RETELL_AGENT_ID: 'agent_abc' })).out);
  assert.equal(upd.action, 'update');
  assert.deepEqual((upd.requests as Req[]).map((r) => `${r.method} ${r.path.split('/')[1]}`), ['GET get-agent', 'PATCH update-retell-llm', 'PATCH update-agent']);
  assert.equal((upd.requests as Req[])[2]!.body!['response_engine'], undefined);
  const forced = JSON.parse((await dryRun(['--create'], { RETELL_AGENT_ID: 'agent_abc' })).out);
  assert.equal(forced.action, 'create');
});

test('dry-run --bind-number never prints the number', async () => {
  const { code, out } = await dryRun(
    ['--mode', 'webhook', '--webhook-url', 'https://w.example.dev/voice/retell', '--bind-number', '--inbound-webhook-url', 'https://w.example.dev/voice/inbound'],
    { PHOTON_VOICE_NUMBER: NUMBER },
  );
  assert.equal(code, 0);
  assert.ok(!out.includes('6175550100'));
  const bind = (JSON.parse(out).requests as Req[])[2]!;
  assert.equal(bind.path, '/update-phone-number/<PHOTON_VOICE_NUMBER>');
  assert.equal(bind.body!['inbound_webhook_url'], 'https://w.example.dev/voice/inbound');
  assert.equal(bind.body!['outbound_agents'][0].weight, 1);
});

test('argument validation', async () => {
  assert.equal((await dryRun(['--mode', 'webhook'])).code, 2); // needs --webhook-url
  assert.equal((await dryRun(['--mode', 'webhook', '--webhook-url', 'http://insecure/x'])).code, 2);
  assert.equal((await dryRun(['--bind-number'])).code, 2); // no PHOTON_VOICE_NUMBER
  assert.equal((await dryRun(['--mode', 'mock'])).code, 2);
  assert.equal((await dryRun(['--wat'])).code, 2);
  const err: string[] = [];
  assert.equal(await runSetup([], {}, { out: () => {}, err: (l) => err.push(l), fetch: noNetwork }), 2); // no key, not dry-run
  assert.match(err.join(''), /RETELL_API_KEY/);
});

test('real run (stubbed fetch): create LLM, then agent, then bind number; prints the agent id', async () => {
  const s = stubFetch((url) => {
    if (url.endsWith('/create-retell-llm')) return { status: 201, body: { llm_id: 'llm_new' } };
    if (url.endsWith('/create-agent')) return { status: 201, body: { agent_id: 'agent_new' } };
    if (url.includes('/update-phone-number/')) return { status: 200, body: { phone_number: NUMBER } };
    return { status: 404, body: {} };
  });
  const out: string[] = [];
  const code = await runSetup(['--mode', 'poll', '--bind-number'], { RETELL_API_KEY: FAKE_KEY, PHOTON_VOICE_NUMBER: NUMBER }, { out: (l) => out.push(l), err: (l) => out.push(l), fetch: s.fetch });
  assert.equal(code, 0);
  assert.deepEqual(s.calls.map((c) => `${c.method} ${c.url}`), [
    'POST https://api.retellai.com/create-retell-llm',
    'POST https://api.retellai.com/create-agent',
    `PATCH https://api.retellai.com/update-phone-number/${NUMBER}`,
  ]);
  assert.ok(s.calls.every((c) => c.headers['Authorization'] === `Bearer ${FAKE_KEY}`));
  assert.equal((s.calls[1]!.body as Record<string, any>)['response_engine'].llm_id, 'llm_new');
  assert.ok(out.includes('RETELL_AGENT_ID=agent_new'));
  assert.ok(!out.join('\n').includes(FAKE_KEY) && !out.join('\n').includes('6175550100'));
});

test('real run update (stubbed fetch): reads llm_id from get-agent', async () => {
  const s = stubFetch((url, method) => {
    if (url.endsWith('/get-agent/agent_abc')) return { status: 200, body: { agent_id: 'agent_abc', response_engine: { type: 'retell-llm', llm_id: 'llm_old' } } };
    if (method === 'PATCH') return { status: 200, body: {} };
    return { status: 404, body: {} };
  });
  const code = await runSetup([], { RETELL_API_KEY: FAKE_KEY, RETELL_AGENT_ID: 'agent_abc' }, { out: () => {}, err: () => {}, fetch: s.fetch });
  assert.equal(code, 0);
  assert.deepEqual(s.calls.map((c) => `${c.method} ${c.url.replace('https://api.retellai.com', '')}`), [
    'GET /get-agent/agent_abc',
    'PATCH /update-retell-llm/llm_old',
    'PATCH /update-agent/agent_abc',
  ]);
});

test('CLI entry: `node --import tsx src/voice/setup.ts --dry-run` prints JSON and exits 0', () => {
  const r = spawnSync(process.execPath, ['--import', 'tsx', 'src/voice/setup.ts', '--dry-run', '--mode', 'poll'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, RETELL_API_KEY: FAKE_KEY, RETELL_AGENT_ID: '', VOICE_MODE: 'poll' },
    timeout: 60_000,
  });
  assert.equal(r.status, 0, r.stderr);
  const plan = JSON.parse(r.stdout);
  assert.equal(plan.dryRun, true);
  assert.equal(plan.requests[1].body.data_storage_retention_days, 1);
  assert.ok(!r.stdout.includes(FAKE_KEY));
});
