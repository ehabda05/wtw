import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyAvailability, redactForLlm, type MessagesClient } from '../../src/llm/redacted.js';

const LABELS = ['Thu Oct 22, 7pm', 'Fri Oct 23, 7pm', 'Sat Oct 24, 7pm'];

test('redaction strips identifiers but keeps day and time words', () => {
  const out = redactForLlm(
    'sam here (617) 555-0134, sam@example.com @sammy https://x.co/a — fri after 8pm prob, not the 22nd',
    ['Sam'],
  );
  assert.ok(!/555|example\.com|@sammy|https|sam\b/i.test(out), out);
  assert.match(out, /fri/);
  assert.match(out, /8pm/);
  assert.match(out, /22nd/);
});

test('disabled by default: no client call is made', async () => {
  let called = false;
  const fake = { beta: { messages: { create: async () => { called = true; return {} as never; } } } } as unknown as MessagesClient;
  const r = await classifyAvailability({ disableHostedLlm: true, apiKey: 'k' }, 'idk depends', LABELS, [], fake);
  assert.equal(r, null);
  assert.equal(called, false);
  const r2 = await classifyAvailability({ disableHostedLlm: false }, 'idk depends', LABELS, [], fake);
  assert.equal(r2, null);
  assert.equal(called, false);
});

test('when enabled, only the redacted reply and option labels are sent', async () => {
  let sent: any;
  const fake = {
    beta: {
      messages: {
        create: async (body: any) => {
          sent = body;
          return { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"option_ids":[2,9],"vote":"maybe"}' }] } as never;
        },
      },
    },
  } as unknown as MessagesClient;
  const r = await classifyAvailability(
    { disableHostedLlm: false, apiKey: 'k' },
    'Ben here, text me 617-555-0199, friday could work if my shift ends',
    LABELS,
    ['Ben'],
    fake,
  );
  assert.deepEqual(r, { optionIds: [2], vote: 'maybe' });
  const payload = JSON.stringify(sent);
  assert.ok(!payload.includes('555'), 'phone number leaked');
  assert.ok(!/\bBen\b/.test(payload), 'name leaked');
  // Haiku 5.5 has no server-side fallback: no beta header, no fallbacks param (either would be wasted or a 400).
  assert.equal(sent.model, 'claude-haiku-5-5');
  assert.equal(sent.fallbacks, undefined);
  assert.equal(sent.betas, undefined);
});

test('refusals and malformed output return null', async () => {
  const refuse = { beta: { messages: { create: async () => ({ stop_reason: 'refusal', content: [] }) as never } } } as unknown as MessagesClient;
  assert.equal(await classifyAvailability({ disableHostedLlm: false, apiKey: 'k' }, 'x', LABELS, [], refuse), null);
  const junk = { beta: { messages: { create: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'nope' }] }) as never } } } as unknown as MessagesClient;
  assert.equal(await classifyAvailability({ disableHostedLlm: false, apiKey: 'k' }, 'x', LABELS, [], junk), null);
});
