// SpectrumHub with a fake SDK: one Spectrum(), telemetry off, telegram only with project credentials,
// [space, message] routed by platform, outbound through the cached space.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SpectrumHub, type SpectrumSdk } from '../../src/channels/spectrum.js';
import { Pacer, TelegramAdapter } from '../../src/channels/telegram.js';
import type { ChannelInbound } from '../../src/channels/types.js';

function fakeSdk(pairs: [unknown, unknown][]) {
  const captured: { opts?: Record<string, unknown>; stopped: boolean } = { stopped: false };
  const app = {
    messages: (async function* () {
      for (const p of pairs) yield p;
      await new Promise((r) => setTimeout(r, 10));
    })(),
    stop: async () => void (captured.stopped = true),
  };
  const sdk = {
    Spectrum: async (opts: Record<string, unknown>) => ((captured.opts = opts), app),
    reply: (content: string, target: { id: string }) => ({ kind: 'reply', content, target: target.id }),
    reaction: (emoji: string, target: { id: string }) => ({ kind: 'reaction', emoji, target: target.id }),
    edit: (content: string, target: { id: string }) => ({ kind: 'edit', content, target: target.id }),
    attachment: (buf: Buffer, o: { name: string }) => ({ kind: 'attachment', name: o.name, size: buf.length }),
  } as unknown as SpectrumSdk;
  return { sdk, captured };
}

const TOKEN = '123456:ABC_def-ghi';
const creds = { imessageLine: 'shared' as const, projectId: 'proj', projectSecret: 'secret', telegramBotToken: TOKEN };

test('no providers (telegram without credentials) -> Photon stream not started', async () => {
  const { sdk, captured } = fakeSdk([]);
  const hub = new SpectrumHub({ config: { spectrum: { imessageLine: 'shared', telegramBotToken: TOKEN }, logLevel: 'warn' }, loadSdk: async () => sdk });
  hub.register(new TelegramAdapter({ config: { spectrum: { imessageLine: 'shared', telegramBotToken: TOKEN }, telegramBotUsername: 'homi_bot' } }));
  assert.equal(await hub.start(), false);
  assert.equal(captured.opts, undefined);
});

test('one Spectrum with telemetry off; inbound routed by platform; outbound via cached space', async () => {
  const sent: unknown[] = [];
  const space = { id: '-1001', send: async (c: unknown) => (sent.push(c), { id: String(100 + sent.length), content: { type: 'text' } }) };
  const msg = { id: '55', platform: 'telegram', direction: 'inbound', content: { type: 'text', text: '@homi_bot dinner?' }, sender: { id: '42', handle: 'ana' }, space, timestamp: new Date(5) };
  const own = { ...msg, id: '56', direction: 'outbound' };
  const other = { ...msg, id: '57', platform: 'slack' };
  const { sdk, captured } = fakeSdk([[space, msg], [space, own], [space, other]]);
  const hub = new SpectrumHub({ config: { spectrum: creds, logLevel: 'warn' }, loadSdk: async () => sdk });
  const tg = new TelegramAdapter({ config: { spectrum: creds, telegramBotUsername: 'homi_bot' }, pacer: new Pacer({ intervalMs: 0 }) });
  hub.register(tg);
  const got: ChannelInbound[] = [];
  let resolveFirst!: () => void;
  const first = new Promise<void>((r) => (resolveFirst = r));
  await tg.start(async (m) => {
    got.push(m);
    resolveFirst();
  });
  assert.equal(await hub.start(), true);
  await first;
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(captured.opts?.telemetry, false);
  assert.deepEqual(captured.opts?.options, { logLevel: 'warn' });
  assert.equal(captured.opts?.projectId, 'proj');
  assert.equal((captured.opts?.providers as unknown[]).length, 1);
  assert.equal(got.length, 1, 'outbound echoes and unknown platforms are dropped');
  assert.equal(got[0].mentionsAgent, true);
  assert.equal(got[0].text, '@homi_bot dinner?');

  const ref = await tg.send('-1001', 'Thu 7pm');
  assert.equal(ref, '101');
  const rref = await tg.reply('-1001', '55', 'got it');
  assert.equal(rref, '102');
  assert.deepEqual(sent[1], { kind: 'reply', content: 'got it', target: '55' });
  await tg.react('-1001', '101', '👍');
  assert.deepEqual(sent[2], { kind: 'reaction', emoji: '👍', target: '101' });
  await hub.stop();
  assert.equal(captured.stopped, true);
});
