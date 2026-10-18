import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MessagesClient } from '../../src/llm/redacted.js';
import { redactWithSlots } from '../../src/llm/redacted.js';
import {
  NOTE_ON,
  buildRepairPrompt,
  restorePlaceholders,
  rewriteToCommand,
  routerFromConfig,
  routerFromEnv,
  validateRewrite,
  type RepairContext,
} from '../../src/llm/router.js';

const ON = { disableHostedLlm: false, apiKey: 'k' };
const CTX: RepairContext = {
  planState: 'collecting_availability',
  options: ['Thu Oct 22, 7pm', 'Fri Oct 23, 7pm', 'Sat Oct 24, 7pm'],
  members: 6,
  openFlows: [],
};

function fakeClient(answer: unknown, opts: { stop?: string; raw?: string; onCall?: (body: any, reqOpts: any) => void } = {}): MessagesClient {
  return {
    beta: {
      messages: {
        create: async (body: any, reqOpts: any) => {
          opts.onCall?.(body, reqOpts);
          const text = opts.raw ?? JSON.stringify(answer);
          return { stop_reason: opts.stop ?? 'end_turn', content: [{ type: 'text', text }] } as never;
        },
      },
    },
  } as unknown as MessagesClient;
}

test('the request carries only a redacted snippet and a context line without personal data', async () => {
  let body: any;
  let reqOpts: any;
  const r = await rewriteToCommand(
    ON,
    {
      text: 'homi Sam here (617) 555-0134 sam@example.com @sammy https://x.co/a: how much do Ben and I owe, it was 84 + 23.40 tip',
      knownNames: ['Sam', 'Ben'],
      context: CTX,
    },
    fakeClient({ rewrite: 'homi split 84 between [name2] me' }, { onCall: (b, o) => ((body = b), (reqOpts = o)) }),
  );
  const payload = JSON.stringify(body);
  for (const leak of [/555/, /example\.com/, /@sammy/, /x\.co/, /\bsam\b/i, /\bben\b/i]) assert.ok(!leak.test(payload), `leaked ${leak}`);
  assert.match(payload, /\b84\b/);
  assert.match(payload, /23\.40/);
  assert.match(payload, /\[name1\]/);
  assert.match(payload, /plan state: collecting_availability; open options: Thu Oct 22, 7pm \| Fri Oct 23, 7pm \| Sat Oct 24, 7pm; members: 6; open flows: none/);
  assert.equal(body.model, 'claude-haiku-5-5');
  assert.equal(body.betas, undefined);
  assert.equal(body.fallbacks, undefined);
  assert.equal(body.output_config.effort, 'low');
  assert.equal(body.output_config.format.type, 'json_schema');
  assert.equal(reqOpts.timeout, 4000);
  assert.equal(reqOpts.maxRetries, 0);
  assert.deepEqual(r, { rewrite: 'homi split 84 between [name2] me' });
});

test('HOMI_LLM_MODEL overrides the model', async () => {
  let body: any;
  const setup = routerFromConfig({ disableHostedLlm: false, anthropicApiKey: 'k' }, { HOMI_LLM_MODEL: 'claude-sonnet-5-5' });
  assert.ok(setup.repair);
  assert.equal(setup.note, NOTE_ON);
  await rewriteToCommand({ ...ON, model: 'claude-sonnet-5-5' }, { text: 'homi x', knownNames: [], context: CTX }, fakeClient({ rewrite: null }, { onCall: (b) => (body = b) }));
  assert.equal(body.model, 'claude-sonnet-5-5');
  // Models with a server-side refusal fallback opt into it.
  assert.deepEqual(body.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(body.fallbacks, 'default');
});

test('disabled (no key, or DISABLE_HOSTED_LLM) makes no call', async () => {
  let called = false;
  const c = fakeClient({ rewrite: 'homi settle up' }, { onCall: () => (called = true) });
  assert.equal(await rewriteToCommand({ disableHostedLlm: true, apiKey: 'k' }, { text: 'homi who owes', knownNames: [], context: CTX }, c), null);
  assert.equal(await rewriteToCommand({ disableHostedLlm: false }, { text: 'homi who owes', knownNames: [], context: CTX }, c), null);
  assert.equal(called, false);
  assert.equal(routerFromConfig({ disableHostedLlm: false }).repair, null);
  assert.equal(routerFromConfig({ disableHostedLlm: true, anthropicApiKey: 'k' }).repair, null);
});

test('refusal, garbage, null, thrown errors and timeouts all return null', async () => {
  const req = { text: 'homi blah 120', knownNames: [], context: CTX };
  assert.equal(await rewriteToCommand(ON, req, fakeClient({ rewrite: 'homi split 120 5 ways' }, { stop: 'refusal' })), null);
  assert.equal(await rewriteToCommand(ON, req, fakeClient(null, { raw: 'not json' })), null);
  assert.equal(await rewriteToCommand(ON, req, fakeClient({ rewrite: null })), null);
  assert.equal(await rewriteToCommand(ON, req, fakeClient({ nope: 1 })), null);
  const boom = { beta: { messages: { create: async () => { throw new Error('APIConnectionTimeoutError'); } } } } as unknown as MessagesClient;
  assert.equal(await rewriteToCommand(ON, req, boom), null);
  const ac = new AbortController();
  const hang = {
    beta: { messages: { create: (_b: unknown, o: { signal: AbortSignal }) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(new Error('aborted')))) } },
  } as unknown as MessagesClient;
  const pending = rewriteToCommand(ON, req, hang, ac.signal);
  ac.abort();
  assert.equal(await pending, null);
});

test('validation: canonical commands and vote replies pass; inventions, long text and unasked deletes do not', () => {
  const said = buildRepairPrompt({ text: 'homi how much do we each owe, it was 120', knownNames: [], context: CTX }).redacted;
  assert.equal(validateRewrite('homi split 120 5 ways', said, CTX), 'homi split 120 5 ways');
  assert.equal(validateRewrite('@homi: settle up', said, CTX), 'homi settle up');
  assert.equal(validateRewrite('fri or sat works', said, CTX), 'fri or sat works');
  assert.equal(validateRewrite('1 3', said, CTX), '1 3');
  assert.equal(validateRewrite('anything but thu', said, CTX), 'anything but thu');
  assert.equal(validateRewrite('none', said, CTX), 'none');
  assert.equal(validateRewrite('split 120 5 ways', said, CTX), null, 'must start with homi');
  assert.equal(validateRewrite('homi split 999 5 ways', said, CTX), null, 'invented amount');
  assert.equal(validateRewrite('homi split 120 + 18% tip 5 ways', said, CTX), null, 'invented tip');
  assert.equal(validateRewrite('homi let\'s do a $10 show-up pledge', said, CTX), null, 'invented pledge amount');
  assert.equal(validateRewrite('homi lock oct 22', said, CTX), 'homi lock oct 22', 'option-label numbers are fine');
  assert.equal(validateRewrite(`homi ${'x'.repeat(200)}`, said, CTX), null, 'too long');
  assert.equal(validateRewrite('homi stop', said, CTX), null, 'unasked delete');
  assert.equal(validateRewrite('homi split 120 between [name1] me', said, CTX), null, 'placeholder not in the snippet');
  assert.equal(validateRewrite(42, said, CTX), null);
  const quit = buildRepairPrompt({ text: 'homi please delete everything and leave', knownNames: [], context: CTX }).redacted;
  assert.equal(validateRewrite('homi stop', quit, CTX), 'homi stop');
});

test('numbered placeholders restore from the original text, locally', () => {
  const text = 'homi Jo covered the uber 23.40, split it w Ana and me';
  const names = ['Ana', 'Jo'];
  const { text: red, slots } = redactWithSlots(text, names);
  assert.ok(!/\bjo\b|\bana\b/i.test(red), red);
  const jo = Object.keys(slots).find((k) => slots[k] === 'Jo')!;
  const ana = Object.keys(slots).find((k) => slots[k] === 'Ana')!;
  assert.equal(restorePlaceholders(`homi [${jo}] paid 23.40 for the uber, split [${ana}] [${jo}] me`, text, names), 'homi Jo paid 23.40 for the uber, split Ana Jo me');
  assert.equal(restorePlaceholders('homi [name9] paid', text, names), null, 'unknown slot');
  assert.equal(restorePlaceholders('homi [name] paid', text, names), null, 'ambiguous bare placeholder');
  assert.equal(restorePlaceholders('homi [name] paid 5', 'homi Jo paid 5', names), 'homi Jo paid 5');
  // amounts and years stay readable; phone numbers do not
  const r = redactWithSlots('homi split 142.50 5 ways, japan in 2030, call 617-555-0134', []);
  assert.match(r.text, /142\.50 5 ways/);
  assert.match(r.text, /2030/);
  assert.match(r.text, /\[number1\]/);
  assert.equal(restorePlaceholders('homi note call [number1]', 'homi split 142.50 5 ways, japan in 2030, call 617-555-0134', []), 'homi note call 617-555-0134');
});

test('web/sim opt-in: HOMI_LLM=on or DISABLE_HOSTED_LLM=false, AND a key; reads .env only for those vars', () => {
  const none = join(tmpdir(), 'homi-no-such-env-file');
  assert.equal(routerFromEnv({}, none).repair, null);
  assert.match(routerFromEnv({}, none).note, /^LLM fallback OFF/);
  assert.equal(routerFromEnv({ HOMI_LLM: 'on' }, none).repair, null);
  assert.match(routerFromEnv({ HOMI_LLM: 'on' }, none).note, /ANTHROPIC_API_KEY/);
  assert.ok(routerFromEnv({ HOMI_LLM: 'on', ANTHROPIC_API_KEY: 'k' }, none).repair);
  assert.equal(routerFromEnv({ HOMI_LLM: 'on', ANTHROPIC_API_KEY: 'k' }, none).note, NOTE_ON);
  assert.ok(routerFromEnv({ DISABLE_HOSTED_LLM: 'false', ANTHROPIC_API_KEY: 'k' }, none).repair);
  assert.equal(routerFromEnv({ HOMI_LLM: 'off', DISABLE_HOSTED_LLM: 'false', ANTHROPIC_API_KEY: 'k' }, none).repair, null);
  assert.equal(routerFromEnv({ ANTHROPIC_API_KEY: 'k' }, none).repair, null, 'a key alone does not turn it on');
  const dir = mkdtempSync(join(tmpdir(), 'homi-env-'));
  try {
    const f = join(dir, '.env');
    writeFileSync(f, 'HOMI_LLM=on\nANTHROPIC_API_KEY=from-file\n');
    assert.ok(routerFromEnv({}, f).repair);
    assert.equal(routerFromEnv({ HOMI_LLM: 'off' }, f).repair, null, 'the environment wins over .env');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
