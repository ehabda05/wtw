import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Pacer, TelegramAdapter, isStartGroup, isTelegramAddressed, normalizeTelegram, retryAfterSeconds } from '../../src/channels/telegram.js';

const BOT = 'otto_plans_bot';

test('mention regex: @bot and /cmd@bot, case-insensitive, not other bots or emails', () => {
  assert.ok(isTelegramAddressed('hey @otto_plans_bot dinner?', BOT));
  assert.ok(isTelegramAddressed('@Otto_Plans_Bot', BOT));
  assert.ok(isTelegramAddressed('/plan@otto_plans_bot next week', BOT));
  assert.ok(!isTelegramAddressed('@otto_plans_bot2 hi', BOT));
  assert.ok(!isTelegramAddressed('mail me x@otto_plans_bot.com', BOT));
  assert.ok(!isTelegramAddressed('/plan next week', BOT), 'bare /plan is left to detectAddressed');
  assert.ok(!isTelegramAddressed('anything', undefined));
});

test('"/start@bot <token>" from the ?startgroup= deep link counts as addressed', () => {
  assert.ok(isStartGroup('/start@otto_plans_bot otto', BOT));
  const n = normalizeTelegram({ id: '-1001' }, { id: '42', content: { type: 'text', text: '/start@otto_plans_bot hello' }, sender: { id: '7' } }, { botUsername: BOT });
  assert.equal(n?.mentionsAgent, true);
  assert.equal(n?.isGroup, true);
});

test('normalize text / reaction / private chat / group content', () => {
  const ts = new Date(1_700_000_000_000);
  const text = normalizeTelegram({ id: '-1002' }, { id: '55', content: { type: 'text', text: 'lol' }, sender: { id: '123', handle: 'ana_b' }, timestamp: ts }, { botUsername: BOT });
  assert.deepEqual(text, { surface: 'telegram', spaceId: '-1002', isGroup: true, msgId: '55', at: ts.getTime(), from: { handle: '123', platformName: 'ana_b' }, kind: 'text', text: 'lol', mentionsAgent: false });
  // reaction target stub id == String(message_id) == the id space.send returned for that bubble
  const r = normalizeTelegram(
    { id: '-1002' },
    { id: 'reaction:-1002:77:1700000000:123:❤', content: { type: 'reaction', emoji: '❤', target: { id: '77', content: { type: 'custom' } } }, sender: { id: '123' } },
    { botUsername: BOT },
  );
  assert.deepEqual(r?.reaction, { emoji: '❤', target: '77' });
  const dm = normalizeTelegram({ id: '123' }, { id: '9', content: { type: 'text', text: 'hi' }, sender: { id: '123' } }, { botUsername: BOT });
  assert.equal(dm?.isGroup, false);
  assert.equal(dm?.mentionsAgent, true, 'private chat with the bot is always addressed');
  const grp = normalizeTelegram(
    { id: '-1' },
    { id: '10', content: { type: 'group', items: [{ id: '10:0', content: { type: 'attachment' } }, { id: '10:1', content: { type: 'text', text: 'caption @otto_plans_bot' } }] }, sender: { id: '5' } },
    { botUsername: BOT },
  );
  assert.equal(grp?.text, 'caption @otto_plans_bot');
  assert.equal(grp?.mentionsAgent, true);
  assert.equal(normalizeTelegram({ id: '-1' }, { id: '1', content: { type: 'text', text: 'x' } }, {}), null, 'no sender -> dropped');
});

test('retry_after extraction', () => {
  assert.equal(retryAfterSeconds({ parameters: { retry_after: 7 } }), 7);
  assert.equal(retryAfterSeconds({ response: { parameters: { retry_after: 3 } } }), 3);
  assert.equal(retryAfterSeconds(new Error('Too Many Requests: retry after 12')), 12);
  assert.equal(retryAfterSeconds(new Error('Bad Request: chat not found')), undefined);
});

test('pacer: 1 message / 3 s per chat, independent chats, one retry after 429', async () => {
  let now = 0;
  const sleeps: number[] = [];
  const pacer = new Pacer({ now: () => now, sleep: async (ms) => void (sleeps.push(ms), (now += ms)) });
  const order: string[] = [];
  await Promise.all([
    pacer.run('-1', async () => void order.push(`a@${now}`)),
    pacer.run('-1', async () => void order.push(`b@${now}`)),
    pacer.run('-2', async () => void order.push(`c@${now}`)),
  ]);
  assert.ok(order.includes('a@0'));
  assert.ok(order.some((o) => o.startsWith('b@') && Number(o.slice(2)) >= 3000), order.join());
  let attempts = 0;
  const v = await pacer.run('-3', async () => {
    attempts++;
    if (attempts === 1) throw Object.assign(new Error('429'), { parameters: { retry_after: 2 } });
    return 'ok';
  });
  assert.equal(v, 'ok');
  assert.equal(attempts, 2);
  assert.ok(sleeps.includes(2000));
  await assert.rejects(pacer.run('-4', async () => Promise.reject(new Error('Forbidden: bot was kicked'))));
});

test('leave uses the Bot API leaveChat and never exposes the token in errors', async () => {
  const token = '123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ0123456789';
  const calls: { url: string; body: string }[] = [];
  const okFetch = (async (url: string, init: { body: string }) => {
    calls.push({ url, body: init.body });
    return { ok: true, status: 200 } as Response;
  }) as unknown as typeof fetch;
  const a = new TelegramAdapter({ config: { spectrum: { imessageLine: 'shared', telegramBotToken: token }, telegramBotUsername: BOT }, fetchFn: okFetch });
  await a.leave('-100123');
  assert.equal(calls[0].url, `https://api.telegram.org/bot${token}/leaveChat`);
  assert.deepEqual(JSON.parse(calls[0].body), { chat_id: -100123 });
  const failFetch = (async () => ({ ok: false, status: 403 }) as Response) as unknown as typeof fetch;
  const b = new TelegramAdapter({ config: { spectrum: { imessageLine: 'shared', telegramBotToken: token } }, fetchFn: failFetch });
  await assert.rejects(b.leave('-1'), (err: Error) => !err.message.includes(token) && /403/.test(err.message));
});

test('provider is never registered without Photon project credentials', async () => {
  const a = new TelegramAdapter({ config: { spectrum: { imessageLine: 'shared', telegramBotToken: '1:abc' }, telegramBotUsername: BOT } });
  assert.equal(await a.provider(), null);
});
