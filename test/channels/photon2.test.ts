import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '@photon-ai/api';
import type { ListMessagesInput, SendMessageInput } from '@photon-ai/api';
import { Photon2Channel, createPhoton2Adapters, loadPhoton2Api, retryAfterMs, type Photon2AdminClient, type Photon2Client } from '../../src/channels/photon2.js';
import { normalizePhoton2, PHOTON2_CAPS } from '../../src/channels/photon2-map.js';
import { connectTelegram, describeApiError, telegramConnectKey, telegramNextSteps } from '../../src/channels/photon2-setup.js';
import type { ChannelInbound } from '../../src/channels/types.js';
import { loadConfig } from '../../src/config.js';
import { captureLogs, createLogger, silentLogger } from '../../src/privacy/logger.js';

const PRJ = 'pho_prj_test123';
const KEY = 'pho_sk_live_DO_NOT_LOG_42';
const T0 = Date.parse('2026-10-17T15:00:00.000Z');
const ALL = ['telegram', 'sms', 'imessage'] as const;
const iso = (ms: number) => new Date(ms).toISOString();

interface MsgOpts {
  id: string;
  at?: number;
  platform?: 'telegram' | 'sms' | 'imessage';
  text?: string;
  content?: Record<string, unknown>;
  space?: string;
  kind?: string;
  sender?: string;
  senderHandle?: string;
  senderDetails?: Record<string, unknown>;
  name?: string;
  parent?: string;
  status?: string;
  participants?: string[];
}

/** A schema-valid received Message (types.gen.d.ts ReceivedTelegramMessage / ReceivedSmsMessage). */
function msg(o: MsgOpts): Record<string, unknown> {
  const platform = o.platform ?? 'telegram';
  const at = iso(o.at ?? T0 + 1_000);
  const user = (id: string, handle: string, details: Record<string, unknown>, displayName?: string) => ({
    id, handle, kind: Object.keys(details).length ? 'agent' : 'human', platform, projectId: PRJ, details, metadata: displayName ? { displayName } : {},
  });
  return {
    id: o.id,
    platform,
    projectId: PRJ,
    status: o.status ?? 'received',
    content: o.content ?? { type: 'text', format: 'plain', text: o.text ?? 'hi' },
    createdAt: at,
    updatedAt: at,
    metadata: {},
    sentBy: user(o.sender ?? 'usr_ana', o.senderHandle ?? 'ana_b', o.senderDetails ?? {}, o.name ?? 'Ana'),
    receivedBy: user('usr_bot', platform === 'telegram' ? 'homi_test_bot' : '+16175550000', { resourceId: 'res_bot' }),
    space: { id: o.space ?? 'spc_grp', kind: o.kind ?? 'group', participantIds: o.participants ?? ['usr_ana', 'usr_bot', 'usr_ben'], platform, projectId: PRJ, details: {}, metadata: {} },
    timestamps: { receivedAt: at },
    ...(o.parent ? { parentMessageId: o.parent } : {}),
  };
}

type Page = { items: unknown[]; nextPageToken?: string };

class FakeClient implements Photon2Client {
  listCalls: ListMessagesInput[] = [];
  sendCalls: SendMessageInput[] = [];
  pages: Page[] = [];
  list: (i: ListMessagesInput) => Promise<Page> = async () => this.pages.shift() ?? { items: [] };
  sendImpl: (i: SendMessageInput) => Promise<unknown> = async () => ({ id: `sent_${this.sendCalls.length}`, status: 'dispatched' });
  spaces = new Map<string, unknown>();
  users = new Map<string, unknown>();
  typingCalls: unknown[] = [];
  listMessages(i: ListMessagesInput) {
    this.listCalls.push(i);
    return this.list(i);
  }
  sendMessage(i: SendMessageInput) {
    this.sendCalls.push(i);
    return this.sendImpl(i);
  }
  async getSpace(i: { path: { spaceId: string } }) {
    return this.spaces.get(i.path.spaceId);
  }
  async getUser(i: { path: { userId: string } }) {
    return this.users.get(i.path.userId);
  }
  async setSpaceTyping(i: unknown) {
    this.typingCalls.push(i);
    return {};
  }
  async getAttachment() {
    return { id: 'att_1', contentType: 'image/png', sizeBytes: 4 };
  }
  async downloadAttachment() {
    return new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
  }
}

function channel(fake: FakeClient, extra: Partial<ConstructorParameters<typeof Photon2Channel>[0]> = {}) {
  let n = 0;
  const ch = new Photon2Channel({ client: fake, projectId: PRJ, platforms: ALL, now: () => T0, sleep: async () => undefined, newRef: () => `ref-${++n}`, ...extra });
  const got: ChannelInbound[] = [];
  ch.attach(async (m) => void got.push(m));
  return { ch, got };
}

const opts = { platforms: ALL, ownUserIds: new Set<string>(), ownMessageIds: new Set<string>() };

test('inbound mapping: Telegram group text -> telegram surface, stable sender id, display name, reply-to', () => {
  const n = normalizePhoton2(msg({ id: 'm1', text: 'homi dinner next week?', parent: 'm0' }), opts);
  assert.ok(!('skip' in n));
  assert.deepEqual(n.inbound, {
    surface: 'telegram', spaceId: 'spc_grp', isGroup: true, msgId: 'm1', at: T0 + 1_000,
    from: { handle: 'usr_ana', platformName: 'Ana' }, kind: 'text', text: 'homi dinner next week?', mentionsAgent: false, replyTo: 'm0',
  });
  assert.equal(n.agentId, 'usr_bot');
  assert.equal(n.agentHandle, 'homi_test_bot');
  const at = normalizePhoton2(msg({ id: 'm2', text: '@homi_test_bot dinner?' }), opts);
  assert.ok(!('skip' in at) && at.inbound.mentionsAgent, '@bot learned from receivedBy.handle counts as addressed');
  const two = normalizePhoton2(msg({ id: 'm3', kind: 'unknown', participants: ['usr_ana', 'usr_bot'] }), opts);
  assert.ok(!('skip' in two) && two.inbound.isGroup === false, 'unknown kind with 2 participants is direct');
});

test('inbound mapping: SMS/iMessage direct -> imessage-shared (addressed), SMS group -> imessage-dedicated, SMS reaction', () => {
  const dm = normalizePhoton2(msg({ id: 's1', platform: 'sms', kind: 'direct', participants: ['usr_ana', 'usr_bot'], name: '+16175550123' }), opts);
  assert.ok(!('skip' in dm));
  assert.equal(dm.inbound.surface, 'imessage-shared');
  assert.equal(dm.inbound.isGroup, false);
  assert.equal(dm.inbound.mentionsAgent, true);
  assert.equal(dm.inbound.from?.handle, 'usr_ana', 'Photon user id, never the phone handle');
  const grp = normalizePhoton2(msg({ id: 's2', platform: 'sms', kind: 'group' }), opts);
  assert.ok(!('skip' in grp) && grp.inbound.surface === 'imessage-dedicated' && grp.inbound.isGroup);
  const im = normalizePhoton2(msg({ id: 'i1', platform: 'imessage', kind: 'direct', participants: ['usr_ana', 'usr_bot'] }), opts);
  assert.ok(!('skip' in im) && im.inbound.surface === 'imessage-shared');
  const r = normalizePhoton2(msg({ id: 's3', platform: 'sms', content: { type: 'reaction', action: 'add', reaction: '👍' }, parent: 'sent_1' }), opts);
  assert.ok(!('skip' in r));
  assert.deepEqual(r.inbound.reaction, { emoji: '👍', target: 'sent_1' });
  const rm = normalizePhoton2(msg({ id: 's4', platform: 'sms', content: { type: 'reaction', action: 'remove', reaction: '👍' }, parent: 'sent_1' }), opts);
  assert.ok(!('skip' in rm) && rm.inbound.reaction?.removed === true);
  assert.deepEqual(normalizePhoton2(msg({ id: 's5', content: { type: 'space.typing.update', typing: true } }), opts), { skip: 'unsupported' });
  assert.deepEqual(normalizePhoton2(msg({ id: 'w1', platform: 'whatsapp' as 'sms' }), opts), { skip: 'platform' });
  assert.deepEqual(normalizePhoton2(msg({ id: 's6', platform: 'sms' }), { ...opts, platforms: ['telegram'] }), { skip: 'platform' }, 'PHOTON2_PLATFORMS filter');
});

test('views: one adapter per surface with honest caps; start/stop are shared and idempotent', async () => {
  const fake = new FakeClient();
  const ch = new Photon2Channel({ client: fake, projectId: PRJ, platforms: ALL, pollIntervalMs: 60_000 });
  const views = ch.adapters();
  assert.deepEqual(views.map((v) => v.surface), ['telegram', 'imessage-shared', 'imessage-dedicated']);
  assert.equal(views[0].caps, PHOTON2_CAPS.telegram);
  assert.equal(views[0].caps.reactionsIn, false, 'Telegram content has no reactions in the Photon 2.0 contract');
  assert.equal(views[1].caps.groups, false);
  assert.equal(new Photon2Channel({ client: fake, projectId: PRJ, platforms: ['telegram'] }).adapters().length, 1);
  for (const v of views) await v.start(async () => undefined);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(fake.listCalls.length, 1, 'one poller for all views');
  for (const v of views) await v.stop();
});

test('dedupe by message id; own outbound, agents and our sent ids are skipped', async () => {
  const fake = new FakeClient();
  const { ch, got } = channel(fake);
  const m1 = msg({ id: 'm1', text: 'homi dinner?' });
  fake.pages = [{ items: [m1, m1] }, { items: [m1, msg({ id: 'm2', text: 'fri works', at: T0 + 2_000 })] }];
  await ch.pollOnce();
  await ch.pollOnce();
  assert.deepEqual(got.map((m) => m.msgId), ['m1', 'm2'], 'overlapping pages deliver each message once');
  await ch.adapters()[0].send('spc_grp', 'Fri 7pm?'); // returns sent_1
  fake.pages = [{
    items: [
      msg({ id: 'sent_1', at: T0 + 3_000 }), // our own send echoed back
      msg({ id: 'o1', status: 'dispatched', at: T0 + 3_100 }),
      msg({ id: 'o2', sender: 'usr_bot', at: T0 + 3_200 }), // the agent that received earlier messages
      msg({ id: 'o3', sender: 'usr_other_bot', senderDetails: { managedBy: 'mgr_1' }, at: T0 + 3_300 }),
      msg({ id: 'm3', at: T0 + 3_400 }),
    ],
  }];
  await ch.pollOnce();
  assert.deepEqual(got.map((m) => m.msgId), ['m1', 'm2', 'm3']);
});

test('cursor: starts at boot (no replay), advances to the newest createdAt minus the overlap, follows nextPageToken', async () => {
  const fake = new FakeClient();
  const { ch, got } = channel(fake, { overlapMs: 10_000, bootGraceMs: 5_000 });
  fake.pages = [
    { items: [msg({ id: 'old', at: T0 - 3_600_000 }), msg({ id: 'a', at: T0 + 60_000 })], nextPageToken: 'p2' },
    { items: [msg({ id: 'b', at: T0 + 90_000 })] },
  ];
  await ch.pollOnce();
  const [c1, c2] = fake.listCalls;
  assert.deepEqual(c1.query, { createdSince: iso(T0 - 5_000), orderBy: 'created_at', order: 'asc', direction: 'received', pageSize: 100 });
  assert.equal(c1.path.id, PRJ);
  assert.deepEqual(c2.query, { ...c1.query, pageToken: 'p2' }, 'same query on the next page');
  assert.deepEqual(got.map((m) => m.msgId), ['a', 'b'], 'history before boot is never replayed');
  await ch.pollOnce();
  assert.equal(fake.listCalls[2].query?.createdSince, iso(T0 + 80_000), 'watermark (b) minus overlap');
  const oneFake = new FakeClient();
  await channel(oneFake, { platforms: ['telegram'] }).ch.pollOnce();
  assert.equal(oneFake.listCalls[0].query?.platform, 'telegram', 'a single configured platform is filtered server-side');
});

test('outbound: Idempotency-Key per send (reused on the 429 retry), sender = receiving agent, reply-to, fallback', async () => {
  const fake = new FakeClient();
  const sleeps: number[] = [];
  const { ch } = channel(fake, { sleep: async (ms) => void sleeps.push(ms) });
  fake.pages = [{ items: [msg({ id: 'm1', text: 'homi dinner?' })] }];
  await ch.pollOnce();
  const tg = ch.adapters()[0];
  assert.equal(await tg.send('spc_grp', 'Fri 7pm?'), 'sent_1');
  const s1 = fake.sendCalls[0];
  assert.deepEqual(s1.headers, { 'idempotency-key': 'ref-1' });
  assert.deepEqual(s1.body, { spaceId: 'spc_grp', senderId: 'usr_bot', content: { type: 'text', format: 'plain', text: 'Fri 7pm?' }, telegram: { richMessage: false } });
  await tg.reply('spc_grp', 'm1', 'Ana, Fri or Sat?');
  assert.equal(fake.sendCalls[1].body.parentMessageId, 'm1');
  assert.equal(fake.sendCalls[1].headers['idempotency-key'], 'ref-2');
  // 429 then success: same key, waits Retry-After
  let first = true;
  fake.sendImpl = async () => {
    if (first) {
      first = false;
      throw new ApiError('Too Many Requests', { status: 429, headers: new Headers({ 'retry-after': '3' }), body: { code: 'RATE_LIMITED' } });
    }
    return { id: 'sent_retry' };
  };
  assert.equal(await tg.send('spc_grp', 'ok'), 'sent_retry');
  assert.deepEqual(sleeps, [3_000]);
  assert.equal(fake.sendCalls[2].headers['idempotency-key'], fake.sendCalls[3].headers['idempotency-key']);
  // reply-to refused (422): plain send with a NEW key (same key + different input would be IDEMPOTENCY_KEY_REUSED)
  fake.sendImpl = async (i) => {
    if (i.body.parentMessageId) throw new ApiError('nope', { status: 422, headers: new Headers(), body: { code: 'UNSUPPORTED_CONTENT' } });
    return { id: 'sent_plain' };
  };
  assert.equal(await tg.reply('spc_grp', 'm1', 'x'), 'sent_plain');
  const [a, b] = fake.sendCalls.slice(-2);
  assert.ok(a.body.parentMessageId && !b.body.parentMessageId && a.headers['idempotency-key'] !== b.headers['idempotency-key']);
  // phone view: no inline reply, no telegram options; unknown space resolves our agent from participants
  fake.sendImpl = async () => ({ id: 'sent_sms' });
  fake.spaces.set('spc_sms', { id: 'spc_sms', platform: 'sms', participantIds: ['usr_x', 'usr_line'] });
  fake.users.set('usr_x', { id: 'usr_x', details: {} });
  fake.users.set('usr_line', { id: 'usr_line', details: { resourceId: 'res_line' } });
  await ch.adapters()[1].reply('spc_sms', 'm9', 'hey');
  assert.deepEqual(fake.sendCalls.at(-1)!.body, { spaceId: 'spc_sms', senderId: 'usr_line', content: { type: 'text', format: 'plain', text: 'hey' } });
  await tg.typing!('spc_grp', true);
  assert.deepEqual(fake.typingCalls[0], { path: { id: PRJ, spaceId: 'spc_grp' }, body: { senderId: 'usr_bot', typing: true } });
});

test('429 backoff honors Retry-After; other errors back off exponentially (capped); success resets', async () => {
  const fake = new FakeClient();
  const { ch } = channel(fake, { pollIntervalMs: 1_500, maxBackoffMs: 10_000 });
  fake.list = async () => {
    throw new ApiError('Too Many Requests', { status: 429, headers: new Headers({ 'retry-after': '7' }), body: { code: 'RATE_LIMITED' } });
  };
  assert.equal(await ch.pollOnce(), 7_000);
  fake.list = async () => ({ items: [] });
  assert.equal(await ch.pollOnce(), 1_500);
  fake.list = async () => {
    throw Object.assign(new Error('upstream'), { status: 503 });
  };
  assert.deepEqual([await ch.pollOnce(), await ch.pollOnce(), await ch.pollOnce()], [3_000, 6_000, 10_000]);
  assert.equal(retryAfterMs({ status: 429, headers: new Headers({ 'retry-after': new Date(T0 + 4_000).toUTCString() }) }, T0), 4_000);
  assert.equal(retryAfterMs({ status: 429 }), 2_000);
  assert.equal(retryAfterMs({ status: 500 }), undefined);
});

test('photo attachments become kind photo (bytes in memory); caption kept', async () => {
  const fake = new FakeClient();
  const { ch, got } = channel(fake);
  const content = { type: 'group', parts: [{ type: 'attachment', attachmentId: 'att_1' }, { type: 'text', format: 'plain', text: 'homi album' }] };
  fake.pages = [{ items: [msg({ id: 'p1', content })] }];
  await ch.pollOnce();
  assert.equal(got[0].kind, 'photo');
  assert.equal(got[0].text, 'homi album');
  assert.deepEqual(got[0].photo, { mime: 'image/png', bytes: new Uint8Array([137, 80, 78, 71]) });
});

test('logs never contain message text, phone numbers, ids or the API key', async () => {
  const cap = captureLogs();
  try {
    const fake = new FakeClient();
    const { ch } = channel(fake, { logger: createLogger({ level: 'debug' }) });
    fake.pages = [{ items: [msg({ id: 'm1', text: 'SECRET_PLAN at +16175550123' }), msg({ id: 'm2', platform: 'sms', senderHandle: '+16175550123', name: '+16175550123' })] }];
    await ch.pollOnce();
    fake.list = async () => {
      throw new ApiError(`bad key ${KEY} for SECRET_PLAN`, { status: 401, headers: new Headers(), body: { detail: `SECRET_PLAN ${KEY}` } });
    };
    await ch.pollOnce();
    fake.list = async () => {
      throw new ApiError(`SECRET_PLAN ${KEY}`, { status: 500, headers: new Headers(), body: { detail: 'SECRET_PLAN' } });
    };
    await ch.pollOnce();
    fake.sendImpl = async () => {
      throw new ApiError('SECRET_PLAN rejected', { status: 409, headers: new Headers(), body: { code: 'SPACE_NOT_SENDABLE' } });
    };
    await assert.rejects(ch.adapters()[0].send('spc_grp', 'SECRET_PLAN'));
    await createPhoton2Adapters({ photon2: { platforms: [...ALL] }, telegramBotUsername: undefined }, createLogger({ level: 'debug' }));
  } finally {
    cap.restore();
  }
  const all = cap.lines.join('\n');
  assert.ok(cap.lines.length >= 3, 'something was logged');
  for (const bad of ['SECRET_PLAN', '+1617', '6175550123', KEY, 'pho_sk_', 'spc_grp', 'usr_ana', PRJ]) assert.ok(!all.includes(bad), `log leaked ${bad}`);
});

test('config: SURFACES=photon2 without keys warns by variable name (never values) and boots no adapter', async () => {
  const keys = { DATA_KEY: Buffer.alloc(32, 7).toString('base64'), ID_SALT: 'salt-salt-salt-salt-salt' };
  const warns: string[] = [];
  const c = loadConfig({ env: { SURFACES: 'photon2', ...keys, PHOTON_PROJECT_ID: 'pho_prj_stablecli' }, loadDotEnv: false, warn: (m) => warns.push(m) });
  assert.deepEqual(c.surfaces, ['photon2']);
  assert.deepEqual(c.photon2, { apiKey: undefined, projectId: undefined, platforms: ['telegram', 'sms', 'imessage'] });
  assert.ok(warns.some((w) => w.includes('PHOTON2_API_KEY is not set')));
  assert.ok(warns.some((w) => w.includes('PHOTON2_PROJECT_ID is not set') && w.includes('PHOTON_PROJECT_ID')), 'Stable CLI name is ignored, with a hint');
  assert.ok(warns.every((w) => !w.includes('pho_prj_stablecli')));
  assert.deepEqual(await createPhoton2Adapters(c, silentLogger), []);

  const w2: string[] = [];
  const env2 = { SURFACES: 'photon2', ...keys, PHOTON2_API_KEY: 'sk_wrong_SECRET', PHOTON2_PROJECT_ID: 'prj_wrong', PHOTON2_PLATFORMS: 'Telegram, sms' };
  const c2 = loadConfig({ env: env2, loadDotEnv: false, warn: (m) => w2.push(m) });
  assert.deepEqual(c2.photon2.platforms, ['telegram', 'sms']);
  assert.equal(w2.length, 2, 'prefix warnings for both');
  assert.ok(w2.every((w) => !w.includes('SECRET') && !w.includes('prj_wrong')));
  const bad = (env: Record<string, string>) => () => loadConfig({ env: { ...keys, ...env }, loadDotEnv: false, warn: () => {} });
  assert.throws(bad({ SURFACES: 'photon2', PHOTON2_PLATFORMS: 'telegram,fax' }), /unknown platform "fax"/);
  assert.throws(bad({ SURFACES: 'telegram,photon2' }), /both telegram/);
  assert.throws(bad({ SURFACES: 'imessage,photon2' }), /both imessage/);
  assert.deepEqual(bad({ SURFACES: 'telegram,photon2', PHOTON2_PLATFORMS: 'sms,imessage' })().surfaces, ['telegram', 'photon2']);
  const quiet: string[] = [];
  loadConfig({ env: { SURFACES: 'sim' }, loadDotEnv: false, warn: (m) => quiet.push(m) });
  assert.ok(quiet.every((w) => !w.includes('photon2')), 'no photon2 warnings when the surface is off');
});

type AdminFake = Photon2AdminClient & { inputs: unknown[] };
function admin(over: { connect?: (i: unknown) => Promise<unknown>; op?: (i: unknown) => Promise<unknown> }): AdminFake {
  const inputs: unknown[] = [];
  return {
    inputs,
    countSpaces: async () => ({ count: 0 }),
    platforms: {
      listProjectPlatforms: async () => ({ platforms: [] }),
      connectTelegramBot: async (i) => (inputs.push(i), (over.connect ?? (async () => ({})))(i)),
      getOperation: async (i) => (inputs.push(i), (over.op ?? (async () => ({})))(i)),
    },
  };
}

test('photon2:telegram: empty body + stable Idempotency-Key; 202 prints the setup link; 409 in-progress shows that operation', async () => {
  const setupUrl = 'https://t.me/PhotonSetupBot?start=abc';
  const started = admin({ connect: async () => ({ operationId: 'op_new', state: 'pending', detail: { setupUrl }, cancellable: true }) });
  const r = await connectTelegram(started, PRJ, telegramConnectKey(PRJ));
  assert.deepEqual(started.inputs[0], { path: { id: PRJ }, body: {}, headers: { idempotencyKey: telegramConnectKey(PRJ) } });
  assert.equal(telegramConnectKey(PRJ), telegramConnectKey(PRJ), 're-runs replay the same operation');
  assert.notEqual(telegramConnectKey(PRJ, true), telegramConnectKey(PRJ));
  assert.equal(r.outcome, 'started');
  assert.ok(telegramNextSteps(r).join('\n').includes(setupUrl));

  const operationUrl = `https://api.photon.codes/v1/projects/${PRJ}/platforms/operations/op_1`;
  const busy = admin({
    connect: async () => {
      throw new ApiError('Telegram Provision In Progress', {
        status: 409, headers: new Headers(), body: { code: 'TELEGRAM_PROVISION_IN_PROGRESS', status: 409, operationId: 'op_1', operationUrl },
      });
    },
    op: async () => ({ operation: { operationId: 'op_1', state: 'running', detail: { setupUrl, botUsername: 'homi_wtw_bot', botToken: 'NEVER_SHOW' } } }),
  });
  const r2 = await connectTelegram(busy, PRJ, telegramConnectKey(PRJ, true));
  assert.equal(r2.outcome, 'in_progress');
  assert.equal(r2.operationId, 'op_1');
  assert.equal(r2.operationUrl, operationUrl);
  assert.equal(r2.setupUrl, setupUrl);
  assert.deepEqual(r2.details, { botUsername: 'homi_wtw_bot' });
  assert.deepEqual(busy.inputs[1], { path: { id: PRJ, operationId: 'op_1' } });
  const text = telegramNextSteps(r2).join('\n');
  for (const s of ['409', operationUrl, setupUrl, 'homi_wtw_bot']) assert.ok(text.includes(s), s);
  assert.ok(!text.includes('NEVER_SHOW'));
  assert.ok(telegramNextSteps({ details: {}, state: 'failed' }).join('\n').includes('--fresh'));

  const other = admin({
    connect: async () => {
      throw new ApiError('Project deleted SECRET', { status: 409, headers: new Headers(), body: { code: 'TELEGRAM_PROJECT_DELETED', detail: 'SECRET' } });
    },
  });
  const err = await connectTelegram(other, PRJ, 'k').catch((e: unknown) => e);
  assert.equal(describeApiError(err), 'HTTP 409 TELEGRAM_PROJECT_DELETED');
});

test('real @photon-ai/api client (fake fetch): request shapes, Bearer auth, Idempotency-Key header', async () => {
  const seen: { method: string; url: URL; auth: string | null; idem: string | null; body: string }[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(input, init);
    seen.push({ method: req.method, url: new URL(req.url), auth: req.headers.get('authorization'), idem: req.headers.get('idempotency-key'), body: await req.text() });
    const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
    if (req.method === 'GET') return json(200, { items: [msg({ id: 'm1', text: 'homi dinner?' })] });
    const sent = msg({ id: 'sent_real', sender: 'usr_bot', senderDetails: { resourceId: 'res_bot' }, status: 'dispatched' });
    return json(202, { ...sent, timestamps: { dispatchedAt: iso(T0 + 2_000) } });
  }) as typeof fetch;
  const api = await loadPhoton2Api(KEY, { fetch: fetchFn });
  const { ch, got } = channel(api as unknown as FakeClient);
  await ch.pollOnce();
  assert.equal(got.length, 1, 'schema-valid Message decoded and mapped');
  assert.equal(got[0].text, 'homi dinner?');
  const get = seen[0];
  assert.equal(get.url.origin + get.url.pathname, `https://api.photon.codes/v1/projects/${PRJ}/messages`);
  assert.equal(get.url.searchParams.get('direction'), 'received');
  assert.equal(get.url.searchParams.get('order'), 'asc');
  assert.equal(get.url.searchParams.get('createdSince'), iso(T0 - 5_000));
  assert.equal(get.auth, `Bearer ${KEY}`);
  assert.equal(await ch.adapters()[0].send('spc_grp', 'Fri 7pm?'), 'sent_real');
  const post = seen[1];
  assert.equal(post.method, 'POST');
  assert.equal(post.idem, 'ref-1');
  assert.deepEqual(JSON.parse(post.body), { spaceId: 'spc_grp', senderId: 'usr_bot', content: { type: 'text', format: 'plain', text: 'Fri 7pm?' }, telegram: { richMessage: false } });
});
