import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TelegramDirectChannel, checkTelegramBot, createTelegramDirectAdapters, splitTelegramText, telegramApi, type TelegramDirectOptions,
} from '../../src/channels/telegram-direct.js';
import { botIdFromToken, messageIdOf, normalizeTelegramUpdate } from '../../src/channels/telegram-direct-map.js';
import { Pacer } from '../../src/channels/telegram.js';
import type { ChannelInbound } from '../../src/channels/types.js';
import { loadConfig } from '../../src/config.js';
import { captureLogs, createLogger } from '../../src/privacy/logger.js';

const TOKEN = '7012345678:AAH-FakeTokenDoNotLog_0123456789abcdef';
const BOT_ID = 7012345678;
const BOT = 'homi_plans_bot';
const T0 = Date.parse('2026-10-17T15:00:00.000Z');
const SEC = Math.floor(T0 / 1000);
const GROUP = { id: -1001234567890, type: 'supergroup', title: 'Dinner crew' };
const ANA = { id: 987654321, is_bot: false, first_name: 'Ana', username: 'ana_b' };

type Body = Record<string, unknown>;
interface Call {
  method: string;
  url: string;
  body: Body;
  form?: FormData;
}
type Handler = (body: Body, n: number) => unknown;

/** Bot API JSON error reply. */
const apiErr = (code: number, description: string, parameters?: Body) =>
  new Response(JSON.stringify({ ok: false, error_code: code, description, ...(parameters ? { parameters } : {}) }), { status: code });

/** Fake api.telegram.org: routes by method name, records every call, answers { ok: true, result }. */
function fakeTelegram(handlers: Record<string, Handler> = {}) {
  const calls: Call[] = [];
  let nextId = 500;
  const counts: Record<string, number> = {};
  const defaults: Record<string, Handler> = {
    getMe: () => ({ id: BOT_ID, is_bot: true, first_name: 'Homi', username: BOT, can_join_groups: true, can_read_all_group_messages: true }),
    deleteWebhook: () => true,
    getUpdates: () => [],
    sendMessage: () => ({ message_id: nextId++, date: SEC }),
    sendDocument: () => ({ message_id: nextId++, date: SEC }),
    getFile: (b) => ({ file_id: b.file_id, file_size: 3, file_path: 'photos/file_1.jpg' }),
    download: () => new Response(new Uint8Array([255, 216, 255]), { status: 200 }),
  };
  const fetchFn = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = url.includes('/file/bot') ? 'download' : url.slice(url.lastIndexOf('/') + 1);
    const form = init?.body instanceof FormData ? init.body : undefined;
    const body = form || !init?.body ? {} : (JSON.parse(String(init.body)) as Body);
    calls.push({ method, url, body, ...(form ? { form } : {}) });
    counts[method] = (counts[method] ?? 0) + 1;
    const h = handlers[method] ?? defaults[method] ?? (() => true);
    const out = await h(body, counts[method]);
    if (out instanceof Response) return out;
    return new Response(JSON.stringify({ ok: true, result: out }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { fetchFn, calls, of: (m: string) => calls.filter((c) => c.method === m) };
}

function channel(fake: ReturnType<typeof fakeTelegram>, extra: Partial<TelegramDirectOptions> = {}) {
  const ch = new TelegramDirectChannel({
    token: TOKEN, botUsername: BOT, fetchFn: fake.fetchFn, now: () => T0,
    pacer: new Pacer({ intervalMs: 0, sleep: async () => undefined }), ...extra,
  });
  const got: ChannelInbound[] = [];
  ch.attach(async (m) => void got.push(m));
  return { ch, got };
}

const msg = (id: number, text?: string, extra: Body = {}) => ({ message_id: id, date: SEC, chat: GROUP, from: ANA, ...(text !== undefined ? { text } : {}), ...extra });
/** getUpdates handler serving the given pages in order, then []. */
const pages = (...ps: unknown[][]): Handler => (_b, n) => ps[n - 1] ?? [];

test('group messages: @bot / /start@bot / reply-to addressing, "homi" left to the engine, own messages dropped', async () => {
  const fake = fakeTelegram({
    getUpdates: pages([
      { update_id: 10, message: msg(55, '@homi_plans_bot dinner next week?') },
      { update_id: 11, message: msg(56, 'homi dinner next week?') },
      { update_id: 12, message: msg(57, '/start@homi_plans_bot homi') },
      { update_id: 13, message: msg(58, 'fri works', { reply_to_message: { message_id: 501 } }) },
      { update_id: 14, message: { ...msg(59, 'Dinner, next week'), from: { id: BOT_ID, is_bot: true, first_name: 'Homi' } } },
      { update_id: 15, message: msg(60, undefined, { new_chat_members: [{ id: BOT_ID, is_bot: true, first_name: 'Homi' }] }) },
      { update_id: 16, message: msg(61, undefined, { new_chat_title: 'renamed' }) },
    ]),
  });
  const { ch, got } = channel(fake);
  assert.equal(await ch.pollOnce(), 0, 'updates arrived: poll again right away');
  assert.deepEqual(got[0], {
    surface: 'telegram', spaceId: '-1001234567890', isGroup: true, msgId: '55', at: SEC * 1000,
    from: { handle: '987654321', platformName: 'Ana' }, kind: 'text', text: '@homi_plans_bot dinner next week?', mentionsAgent: true,
  });
  assert.equal(got[1].mentionsAgent, false, '"homi ..." goes through detectAddressed in the runner');
  assert.equal(got[2].mentionsAgent, true, '?startgroup= deep link');
  assert.equal(got[3].replyTo, '501');
  assert.deepEqual(got.slice(4).map((m) => m.kind), ['added_to_group'], 'own message and service notices dropped');
  const gu = fake.of('getUpdates')[0].body;
  assert.deepEqual(gu, { timeout: 25, allowed_updates: ['message', 'edited_message', 'message_reaction'] });
  assert.ok(fake.of('getUpdates')[0].url.startsWith('https://api.telegram.org/bot'));
});

test('private chat is always addressed; edits arrive as a new text with their own id; forum topic roots are not replies', () => {
  const dm = normalizeTelegramUpdate({ update_id: 1, message: { ...msg(9, 'hi'), chat: { id: 987654321, type: 'private', first_name: 'Ana' } } }, { botUsername: BOT });
  assert.equal(dm[0].type, 'inbound');
  if (dm[0].type !== 'inbound') return;
  assert.equal(dm[0].inbound.isGroup, false);
  assert.equal(dm[0].inbound.mentionsAgent, true);
  assert.equal(dm[0].inbound.spaceId, '987654321');
  const ed = normalizeTelegramUpdate({ update_id: 2, edited_message: msg(55, 'actually 2 3', { edit_date: SEC + 60 }) }, { botUsername: BOT });
  assert.ok(ed[0].type === 'inbound' && ed[0].inbound.msgId === `55:edit:${SEC + 60}` && ed[0].inbound.text === 'actually 2 3');
  const topic = normalizeTelegramUpdate({ update_id: 3, message: msg(70, 'x', { is_topic_message: true, message_thread_id: 3, reply_to_message: { message_id: 3 } }) }, {});
  assert.ok(topic[0].type === 'inbound' && topic[0].inbound.replyTo === undefined);
  assert.deepEqual(normalizeTelegramUpdate({ update_id: 4, message: { ...msg(1, 'x'), chat: { id: -100, type: 'channel' } } }, {}), [{ type: 'skip', reason: 'channel' }]);
  assert.equal(botIdFromToken(TOKEN), String(BOT_ID));
  assert.equal(messageIdOf('55:edit:1'), 55);
  assert.equal(messageIdOf('reaction:-1:5'), undefined);
});

test('reactions: added emoji vote, removals flagged, anonymous ignored; reactionsIn is opt-in', () => {
  const r = (old: string[], neu: string[], user: Body | null = ANA) =>
    normalizeTelegramUpdate({
      update_id: 1,
      message_reaction: { chat: GROUP, message_id: 501, date: SEC, ...(user ? { user } : { actor_chat: GROUP }), old_reaction: old.map((emoji) => ({ type: 'emoji', emoji })), new_reaction: neu.map((emoji) => ({ type: 'emoji', emoji })) },
    }, { botId: String(BOT_ID) });
  const add = r([], ['👍']);
  assert.ok(add[0].type === 'inbound');
  if (add[0].type === 'inbound') assert.deepEqual(add[0].inbound.reaction, { emoji: '👍', target: '501' });
  const swap = r(['👍'], ['❤']);
  assert.deepEqual(swap.map((e) => (e.type === 'inbound' ? [e.inbound.reaction?.emoji, !!e.inbound.reaction?.removed] : e.type)), [['👍', true], ['❤', false]]);
  assert.deepEqual(r([], ['👍'], null), [{ type: 'skip', reason: 'anonymous' }]);
  const fake = fakeTelegram();
  assert.equal(channel(fake).ch.caps.reactionsIn, false);
  assert.equal(channel(fake, { reactionsIn: true }).ch.caps.reactionsIn, true);
  assert.equal(channel(fake).ch.caps.surface, 'telegram');
});

test('offset advances, re-sent updates are not delivered twice, stale backlog is skipped', async () => {
  const old = { ...msg(40, 'from yesterday'), date: SEC - 3600 };
  const fake = fakeTelegram({
    getUpdates: pages(
      [{ update_id: 100, message: msg(1, 'a') }, { update_id: 101, message: msg(2, 'b') }, { update_id: 102, message: old }],
      [{ update_id: 101, message: msg(2, 'b') }, { update_id: 103, message: msg(3, 'c') }],
    ),
  });
  const { ch, got } = channel(fake);
  await ch.pollOnce();
  await ch.pollOnce();
  assert.deepEqual(got.map((m) => m.text), ['a', 'b', 'c']);
  assert.equal(fake.of('getUpdates')[1].body.offset, 103);
  await ch.pollOnce();
  assert.equal(fake.of('getUpdates')[2].body.offset, 104);
});

test('backoff: 429 honors retry_after, errors back off exponentially, a rejected token waits the max', async () => {
  const replies: (() => Response | unknown[])[] = [
    () => apiErr(429, 'Too Many Requests: retry after 7', { retry_after: 7 }),
    () => apiErr(502, 'Bad Gateway'),
    () => apiErr(502, 'Bad Gateway'),
    () => apiErr(409, 'Conflict: terminated by other getUpdates request'),
    () => [],
    () => apiErr(401, 'Unauthorized'),
  ];
  const fake = fakeTelegram({ getUpdates: (_b, n) => replies[n - 1]() });
  const { ch } = channel(fake, { maxBackoffMs: 60_000 });
  assert.equal(await ch.pollOnce(), 7_000);
  assert.equal(await ch.pollOnce(), 2_000);
  assert.equal(await ch.pollOnce(), 4_000);
  assert.equal(await ch.pollOnce(), 8_000, '409 waits at least 5 s');
  assert.equal(await ch.pollOnce(), 250, 'recovered; empty long poll');
  assert.equal(await ch.pollOnce(), 60_000);
});

test('outbound call shapes: send, reply, edit (not-modified ignored), react, typing, leave, dm, .ics document', async () => {
  const fake = fakeTelegram({ editMessageText: (_b, n) => (n === 2 ? apiErr(400, 'Bad Request: message is not modified') : true) });
  const { ch } = channel(fake);
  const chat = '-1001234567890';
  assert.equal(await ch.send(chat, 'Dinner, next week'), '500');
  assert.deepEqual(fake.of('sendMessage')[0].body, { chat_id: -1001234567890, text: 'Dinner, next week', link_preview_options: { is_disabled: true } });
  assert.equal(await ch.reply(chat, '55', 'got it'), '501');
  assert.deepEqual(fake.of('sendMessage')[1].body.reply_parameters, { message_id: 55, allow_sending_without_reply: true });
  await ch.edit(chat, '500', 'Dinner, next week ✓ 2 of 5');
  await ch.edit(chat, '500', 'Dinner, next week ✓ 2 of 5');
  assert.deepEqual(fake.of('editMessageText')[0].body, { chat_id: -1001234567890, message_id: 500, text: 'Dinner, next week ✓ 2 of 5' });
  await ch.react(chat, '55', '❤️');
  assert.deepEqual(fake.of('setMessageReaction')[0].body, { chat_id: -1001234567890, message_id: 55, reaction: [{ type: 'emoji', emoji: '❤' }] });
  await ch.typing(chat, true);
  await ch.typing(chat, false);
  assert.deepEqual(fake.of('sendChatAction').map((c) => c.body), [{ chat_id: -1001234567890, action: 'typing' }]);
  await ch.leave(chat);
  assert.deepEqual(fake.of('leaveChat')[0].body, { chat_id: -1001234567890 });
  await ch.dm('987654321', 'private check-in');
  assert.equal(fake.of('sendMessage')[2].body.chat_id, 987654321);
  const ref = await ch.file(chat, 'dinner.ics', 'text/calendar', 'BEGIN:VCALENDAR', 'Add it to your calendar');
  const form = fake.of('sendDocument')[0].form!;
  assert.equal(ref, '503');
  assert.equal(form.get('chat_id'), '-1001234567890');
  assert.equal(form.get('caption'), 'Add it to your calendar');
  assert.equal((form.get('document') as File).name, 'dinner.ics');
  assert.equal(await (form.get('document') as File).text(), 'BEGIN:VCALENDAR');
  assert.deepEqual(splitTelegramText('a'.repeat(5000)).map((s) => s.length), [4096, 904]);
});

test('outbound 429: waits retry_after once, then sends; paced per chat', async () => {
  const sleeps: number[] = [];
  const fake = fakeTelegram({ sendMessage: (_b, n) => (n === 1 ? apiErr(429, 'Too Many Requests: retry after 2', { retry_after: 2 }) : { message_id: 900 + n }) });
  const { ch } = channel(fake, { pacer: new Pacer({ intervalMs: 1_000, now: () => 0, sleep: async (ms) => void sleeps.push(ms) }) });
  assert.equal(await ch.send('-1', 'hello'), '902');
  assert.equal(fake.of('sendMessage').length, 2);
  assert.ok(sleeps.includes(2_000));
  await ch.send('-1', 'again');
  assert.ok(sleeps.includes(1_000), 'second message to the same chat waits ~1 s');
});

test('supergroup migration: the notice keeps the plan on the old space; a migrated send is retried on the new id', async () => {
  const OLD = { id: -555, type: 'group', title: 'g' };
  const NEW = { id: -100777, type: 'supergroup', title: 'g' };
  const fake = fakeTelegram({
    getUpdates: pages([
      { update_id: 1, message: { ...msg(10, undefined, { migrate_to_chat_id: NEW.id }), chat: OLD } },
      { update_id: 2, message: { ...msg(1, undefined, { migrate_from_chat_id: OLD.id }), chat: NEW } },
      { update_id: 3, message: { ...msg(2, 'fri works'), chat: NEW } },
    ]),
  });
  const { ch, got } = channel(fake);
  await ch.pollOnce();
  assert.deepEqual(got.map((m) => [m.spaceId, m.text]), [['-555', 'fri works']]);
  await ch.send('-555', 'locked: friday');
  assert.equal(fake.of('sendMessage')[0].body.chat_id, -100777);

  const fake2 = fakeTelegram({ sendMessage: (b) => (b.chat_id === -556 ? apiErr(400, 'Bad Request: group chat was upgraded to a supergroup chat', { migrate_to_chat_id: -100888 }) : { message_id: 1 }) });
  const { ch: ch2 } = channel(fake2);
  assert.equal(await ch2.send('-556', 'hi'), '1');
  await ch2.send('-556', 'again');
  assert.deepEqual(fake2.of('sendMessage').map((c) => c.body.chat_id), [-556, -100888, -100888]);
});

test('photos: largest size via getFile + download, caption kept; too big or failing stays a plain message', async () => {
  const photo = [{ file_id: 'small', width: 90, height: 90, file_size: 1_000 }, { file_id: 'large', width: 1280, height: 960, file_size: 3 }];
  const big = [{ file_id: 'huge', width: 4000, height: 4000, file_size: 50_000_000 }];
  const fake = fakeTelegram({
    getUpdates: pages([
      { update_id: 1, message: msg(5, undefined, { photo: [photo[1], photo[0]].map((p) => ({ ...p, file_size: p.file_id === 'large' ? 3 : 1 })), caption: 'homi add' }) },
      { update_id: 2, message: msg(6, undefined, { photo: big }) },
    ]),
  });
  const { ch, got } = channel(fake);
  await ch.pollOnce();
  assert.equal(fake.of('getFile')[0].body.file_id, 'large');
  assert.ok(fake.of('download')[0].url.endsWith('/photos/file_1.jpg'));
  assert.equal(got[0].kind, 'photo');
  assert.equal(got[0].text, 'homi add');
  assert.deepEqual(got[0].photo, { mime: 'image/jpeg', bytes: new Uint8Array([255, 216, 255]) });
  assert.equal(got[1].kind, 'other', 'over 10 MB: not downloaded');
  assert.equal(fake.of('getFile').length, 1);
});

test('start: getMe learns the username, deleteWebhook keeps pending updates; stop confirms the offset', async () => {
  let delivered!: () => void;
  const first = new Promise<void>((r) => (delivered = r));
  const fake = fakeTelegram({ getUpdates: pages([{ update_id: 41, message: msg(7, '@homi_plans_bot hi') }]) });
  const ch = new TelegramDirectChannel({ token: TOKEN, fetchFn: fake.fetchFn, now: () => T0 });
  const got: ChannelInbound[] = [];
  await ch.start(async (m) => void (got.push(m), delivered()));
  await first;
  await ch.stop();
  assert.equal(ch.botUsername, BOT);
  assert.equal(got[0].mentionsAgent, true, 'mention detected with the username from getMe');
  assert.deepEqual(fake.of('deleteWebhook')[0].body, { drop_pending_updates: false });
  assert.deepEqual(fake.calls.slice(0, 2).map((c) => c.method), ['getMe', 'deleteWebhook']);
  const last = fake.of('getUpdates').at(-1)!.body;
  assert.equal(last.offset, 42);
  assert.equal(last.timeout, 0);
});

test('telegram:check summary: username and flags, webhook yes/no without the URL', async () => {
  const fake = fakeTelegram({
    getMe: () => ({ id: BOT_ID, username: BOT, can_join_groups: true, can_read_all_group_messages: false }),
    getWebhookInfo: () => ({ url: 'https://fusor.example/secret-path', pending_update_count: 3 }),
  });
  const r = await checkTelegramBot(telegramApi(TOKEN, { fetchFn: fake.fetchFn }));
  assert.deepEqual(r, { id: String(BOT_ID), username: BOT, canJoinGroups: true, canReadAllGroupMessages: false, webhookSet: true, pendingUpdates: 3 });
  assert.ok(!JSON.stringify(r).includes('fusor'));
});

test('config: telegram-direct token fallback, reactions opt-in, conflicts with telegram and photon2 Telegram, skip without token', () => {
  const keys = { DATA_KEY: Buffer.alloc(32, 7).toString('base64'), ID_SALT: 'salt-salt-salt-salt-salt' };
  const load = (env: Record<string, string>, warns: string[] = []) => loadConfig({ env: { ...keys, ...env }, loadDotEnv: false, warn: (m) => warns.push(m) });
  const c = load({ SURFACES: 'telegram-direct', TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_REACTIONS: 'on' });
  assert.deepEqual(c.surfaces, ['telegram-direct']);
  assert.deepEqual(c.telegramDirect, { token: TOKEN, reactions: true });
  assert.equal(load({ SURFACES: 'telegram-direct', SPECTRUM_TELEGRAM_BOT_TOKEN: TOKEN }).telegramDirect.token, TOKEN, 'falls back to the Spectrum token');
  assert.equal(load({ SURFACES: 'sim' }).telegramDirect.reactions, false);
  assert.throws(() => load({ SURFACES: 'telegram,telegram-direct', TELEGRAM_BOT_TOKEN: TOKEN }), /both telegram \(Spectrum\) and telegram-direct/);
  assert.throws(() => load({ SURFACES: 'photon2,telegram-direct', TELEGRAM_BOT_TOKEN: TOKEN }), /PHOTON2_PLATFORMS=sms,imessage/);
  assert.throws(() => load({ SURFACES: 'photon2,telegram-direct', PHOTON2_PLATFORMS: 'telegram,sms' }), /photon2 with Telegram/);
  assert.deepEqual(load({ SURFACES: 'photon2,telegram-direct', PHOTON2_PLATFORMS: 'sms,imessage', TELEGRAM_BOT_TOKEN: TOKEN }).surfaces, ['photon2', 'telegram-direct']);
  const warns: string[] = [];
  const none = load({ SURFACES: 'telegram-direct' }, warns);
  assert.ok(warns.some((w) => w.includes('TELEGRAM_BOT_TOKEN is not set')));
  assert.deepEqual(createTelegramDirectAdapters(none, createLogger({ level: 'silent' })), []);
  const w2: string[] = [];
  load({ SURFACES: 'telegram-direct', TELEGRAM_BOT_TOKEN: 'not-a-SECRETTOKEN-value' }, w2);
  assert.ok(w2.some((w) => w.includes('does not look like')) && w2.every((w) => !w.includes('SECRETTOKEN')));
  const ad = createTelegramDirectAdapters(c, createLogger({ level: 'silent' }));
  assert.equal(ad.length, 1);
  assert.equal(ad[0].caps.reactionsIn, true);
});

test('logs never contain the token, message text, names or ids', async () => {
  const cap = captureLogs();
  try {
    const fake = fakeTelegram({
      getMe: () => apiErr(401, `Unauthorized ${TOKEN}`),
      getUpdates: (_b, n) => {
        if (n === 1) return [{ update_id: 5, message: msg(5, 'SECRET_PLAN at +16175550123', { photo: [{ file_id: 'p', width: 1, height: 1 }] }) }];
        if (n === 2) throw new TypeError(`fetch failed https://api.telegram.org/bot${TOKEN}/getUpdates SECRET_PLAN`);
        return apiErr(400, `Bad Request: SECRET_PLAN ${TOKEN}`);
      },
      getFile: () => apiErr(400, 'Bad Request: SECRET_PLAN file'),
      sendMessage: () => apiErr(403, `Forbidden: SECRET_PLAN ${TOKEN}`),
    });
    const { ch } = channel(fake, { logger: createLogger({ level: 'debug' }) });
    ch.attach(async () => {
      throw new Error('SECRET_PLAN handler');
    });
    await ch.init();
    await ch.pollOnce();
    await ch.pollOnce();
    await ch.pollOnce();
    await assert.rejects(ch.send('-1001234567890', 'SECRET_PLAN'), (e: Error) => !e.message.includes(TOKEN) && !e.message.includes('SECRET'));
  } finally {
    cap.restore();
  }
  const all = cap.lines.join('\n');
  assert.ok(cap.lines.length >= 4, 'something was logged');
  for (const bad of [TOKEN, TOKEN.split(':')[1], 'SECRET', '6175550123', 'Ana', 'ana_b', '987654321', '1001234567890']) assert.ok(!all.includes(bad), `log leaked ${bad}`);
});
