// "homi split the bill" with a receipt photo: the runner reads the total (Claude vision, injected here) and the
// engine's bill split does the rest, by head count, by the names given, or with a payer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAPS } from '../../src/channels/types.js';
import { loadEngine } from '../../src/runner/services.js';
import { makeEnv, textIn } from './helpers.js';

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);

function photoIn(spaceId: string, handle: string, caption?: string) {
  return { surface: 'imessage-dedicated' as const, spaceId, isGroup: true, kind: 'photo' as const, from: { handle, platformName: handle }, text: caption, msgId: `p-${Math.random()}`, mentionsAgent: false, at: 0, photo: { mime: 'image/png', bytes: PNG } };
}

async function envWithRoster(total: number | null) {
  const engine = (await loadEngine()) as never;
  const seen: string[] = [];
  const env = makeEnv({ engine, caps: CAPS['imessage-dedicated'], simple: true, runnerDeps: { readReceipt: async (_b, mime) => (seen.push(mime), total === null ? { status: 'unreadable' } : { status: 'ok', receipt: { total, currency: 'USD', items: [], arithmeticConsistent: true } }) } });
  await env.runner.handleInbound({ surface: 'imessage-dedicated', spaceId: 'g1', isGroup: true, kind: 'members', members: [{ handle: 'riad', platformName: 'Riad' }, { handle: 'esc', platformName: 'Escander' }, { handle: 'homi', isBot: true }], msgId: 'roster', mentionsAgent: false, at: 0 });
  return { env, seen };
}

test('a receipt photo captioned "homi split the bill" is read and split by the group size', async () => {
  const { env, seen } = await envWithRoster(84);
  await env.runner.handleInbound(photoIn('g1', 'riad', 'homi split the bill'));
  assert.deepEqual(seen, ['image/png']);
  const sends = env.adapter.sends();
  assert.ok(sends.some((s) => /\$84\.00 split 2 ways: \$42\.00 each\./.test(s)), sends.join(' | '));
  assert.ok(!/84\.00|\$84|split 84|2 ways/.test(env.lines.join('\n')), 'the amount and the command never reach the logs');
});

test('"homi split the bill between riad and escander, paid by riad" after a photo uses the names and the payer', async () => {
  const { env } = await envWithRoster(93.5);
  await env.runner.handleInbound(photoIn('g1', 'esc'));
  await env.runner.handleInbound(textIn('g1', 'riad', 'homi split the bill between riad and escander, paid by riad', { surface: 'imessage-dedicated' }));
  const last = env.adapter.sends().at(-1)!;
  assert.match(last, /\$93\.50/);
  assert.match(last, /Riad/);
  assert.match(last, /Escander/);
});

test('"homi split it 3 ways" after a photo honours the count; an explicit amount never touches the photo', async () => {
  const { env, seen } = await envWithRoster(60);
  await env.runner.handleInbound(photoIn('g1', 'riad'));
  await env.runner.handleInbound(textIn('g1', 'riad', 'homi split it 3 ways', { surface: 'imessage-dedicated' }));
  assert.match(env.adapter.sends().at(-1)!, /\$60\.00 split 3 ways: \$20\.00 each\./);
  await env.runner.handleInbound(photoIn('g1', 'riad'));
  await env.runner.handleInbound(textIn('g1', 'riad', 'homi split 45 3 ways', { surface: 'imessage-dedicated' }));
  assert.equal(seen.length, 1, 'an amount in the message means no receipt read');
  assert.match(env.adapter.sends().at(-1)!, /\$45\.00 split 3 ways/);
});

test('no readable total and missing image have distinct responses', async () => {
  const { env } = await envWithRoster(null);
  await env.runner.handleInbound(photoIn('g1', 'riad', 'homi split the bill'));
  assert.match(env.adapter.sends().at(-1)!, /couldn't read a total on that receipt/);
  const { env: bare, seen } = await envWithRoster(84);
  await bare.runner.handleInbound(textIn('g1', 'riad', 'homi split the bill', { surface: 'imessage-dedicated' }));
  assert.equal(seen.length, 0);
  assert.match(bare.adapter.sends().at(-1)!, /don't see a recent receipt image/);
});

test('a replied-to receipt is selected instead of a newer unrelated photo', async () => {
  const engine = (await loadEngine()) as never;
  const seen: number[] = [];
  const env = makeEnv({
    engine, caps: CAPS['imessage-dedicated'], simple: true,
    runnerDeps: { readReceipt: async (bytes) => {
      seen.push(bytes[0]);
      return { status: 'ok', receipt: { total: bytes[0], currency: 'USD', items: [], arithmeticConsistent: true } };
    } },
  });
  await env.runner.handleInbound({ ...photoIn('g1', 'riad'), msgId: 'receipt-1', photo: { mime: 'image/png', bytes: new Uint8Array([84]) } });
  await env.runner.handleInbound({ ...photoIn('g1', 'riad'), msgId: 'other-photo', photo: { mime: 'image/png', bytes: new Uint8Array([20]) } });
  await env.runner.handleInbound(textIn('g1', 'riad', 'homi split the bill 2 ways', { surface: 'imessage-dedicated', replyTo: 'receipt-1' }));
  assert.deepEqual(seen, [84]);
  assert.match(env.adapter.sends().at(-1)!, /\$84\.00/);
});

test('receipt splitting asks when human membership is unavailable and accepts an explicit spelled-out count', async () => {
  const engine = (await loadEngine()) as never;
  const env = makeEnv({
    engine, caps: CAPS['imessage-dedicated'], simple: true,
    runnerDeps: { readReceipt: async () => ({ status: 'ok', receipt: { total: 84, currency: 'USD', items: [], arithmeticConsistent: true } }) },
  });
  await env.runner.handleInbound(photoIn('g1', 'riad'));
  await env.runner.handleInbound(textIn('g1', 'riad', 'homi split the bill', { surface: 'imessage-dedicated' }));
  assert.match(env.adapter.sends().at(-1)!, /can't reliably count the people/);

  await env.runner.handleInbound(photoIn('g1', 'riad'));
  await env.runner.handleInbound(textIn('g1', 'riad', 'homi split the bill between these three people', { surface: 'imessage-dedicated' }));
  assert.match(env.adapter.sends().at(-1)!, /\$84\.00 split 3 ways: \$28\.00 each/);
});
