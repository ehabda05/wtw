import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ImessageCloudBinding,
  LocalImessageAdapter,
  imessageSurfaceOf,
  normalizeImessageCloud,
  normalizeImessageLocal,
  unwrapReply,
} from '../../src/channels/imessage.js';
import type { ChannelInbound } from '../../src/channels/types.js';
import type { MessageLike, SpaceLike } from '../../src/channels/spectrum.js';

const LINE = '+16175550000';
const space = (over: Record<string, unknown> = {}): SpaceLike & { phone?: string; type?: string } => ({
  id: 'any;+;chat123',
  type: 'group',
  phone: LINE,
  send: async () => undefined,
  ...over,
});

test('shared vs dedicated line picks the capability profile', () => {
  assert.equal(imessageSurfaceOf({ phone: 'shared' }), 'imessage-shared');
  assert.equal(imessageSurfaceOf({ phone: LINE }), 'imessage-dedicated');
});

test('reply content is unwrapped; mentions of our line set mentionsAgent', () => {
  assert.deepEqual(unwrapReply({ type: 'reply', content: { type: 'text', text: 'works' }, target: { id: 'g-1' } }), {
    inner: { type: 'text', text: 'works' },
    replyTo: 'g-1',
  });
  const msg: MessageLike = {
    id: 'g-2',
    content: { type: 'reply', content: { type: 'text', text: '@Homi friday works' }, target: { id: 'g-1' } },
    sender: { id: '+16175550134' },
    mentions: [{ address: LINE, start: 0, length: 5 }],
  };
  const n = normalizeImessageCloud(space(), msg);
  assert.equal(n.inbound?.kind, 'text');
  assert.equal(n.inbound?.text, '@Homi friday works');
  assert.equal(n.inbound?.replyTo, 'g-1');
  assert.equal(n.inbound?.mentionsAgent, true);
  assert.equal(n.inbound?.surface, 'imessage-dedicated');
  assert.deepEqual(n.inbound?.from, { handle: '+16175550134' }, 'no platformName: never a phone number');
  const noMention = normalizeImessageCloud(space(), { ...msg, mentions: [{ address: '+19999999999', start: 0, length: 3 }] });
  assert.equal(noMention.inbound?.mentionsAgent, false);
});

test('tapbacks become reactions on the full target message id', () => {
  const n = normalizeImessageCloud(space(), {
    id: 'g-9:reaction:1',
    content: { type: 'reaction', emoji: '❤️', target: { id: 'g-9', content: { type: 'text', text: 'Fri 7pm' } } },
    sender: { id: 'ana@example.com' },
  });
  assert.deepEqual(n.inbound?.reaction, { emoji: '❤️', target: 'g-9' });
});

test('addMember with our line -> added_to_group; any membership change refreshes the roster', () => {
  const added = normalizeImessageCloud(space(), { id: 'e1', content: { type: 'addMember', members: [LINE] }, sender: { id: '+1617' } });
  assert.equal(added.addedSelf, true);
  assert.equal(added.inbound?.kind, 'added_to_group');
  const other = normalizeImessageCloud(space(), { id: 'e2', content: { type: 'removeMember', members: ['+1999'] } });
  assert.equal(other.inbound, null);
  assert.equal(other.membershipChanged, true);
});

test('dedicated binding: first sight fetches the roster as a members inbound (hashable handles only)', async () => {
  const b = new ImessageCloudBinding({ config: { spectrum: { imessageLine: 'dedicated', projectId: 'p', projectSecret: 's' } } });
  const got: ChannelInbound[] = [];
  for (const a of b.adapters()) await a.start(async (m) => void got.push(m));
  const sp = space({ getMembers: async () => [{ id: '+16175550134' }, { id: 'ben@example.com' }] });
  await b.handle(sp, { id: 'g-1', content: { type: 'text', text: 'hi all' }, sender: { id: '+16175550134' } });
  await b.handle(sp, { id: 'g-2', content: { type: 'text', text: 'again' }, sender: { id: '+16175550134' } });
  assert.deepEqual(got.map((m) => m.kind), ['members', 'text', 'text'], 'roster fetched once per space');
  assert.deepEqual(got[0].members?.map((m) => m.handle), ['+16175550134', 'ben@example.com']);
  // shared line DMs route to the shared adapter
  await b.handle(space({ id: 'any;-;+16175550134', type: 'dm', phone: 'shared' }), { id: 'd-1', content: { type: 'text', text: 'hi' }, sender: { id: '+16175550134' } });
  assert.equal(got.at(-1)?.surface, 'imessage-shared');
  assert.equal(got.at(-1)?.isGroup, false);
});

test('local: allowlist drops chats that never had a Homi trigger; known chats pass; replies unwrap', () => {
  const known = new Set<string>();
  const opts = { isKnown: (id: string) => known.has(id) };
  const sp = space({ id: 'any;+;chat-local', phone: '' });
  const msg = (text: string, over: Partial<MessageLike> = {}): MessageLike => ({ id: `l-${text}`, content: { type: 'text', text }, sender: { id: '+16175550134' }, ...over });
  assert.equal(normalizeImessageLocal(sp, msg('mom says hi'), opts), null);
  const trig = normalizeImessageLocal(sp, msg('homi dinner next week?'), opts);
  assert.equal(trig?.surface, 'imessage-local');
  assert.equal(trig?.isGroup, true);
  known.add(sp.id);
  assert.equal(normalizeImessageLocal(sp, msg('friday works'), opts)?.text, 'friday works');
  const rep = normalizeImessageLocal(sp, { id: 'l-r', content: { type: 'reply', content: { type: 'text', text: 'yes' }, target: { id: 'stub-1', content: { type: 'custom' } } }, sender: { id: 'x' } }, opts);
  assert.deepEqual([rep?.text, rep?.replyTo], ['yes', 'stub-1']);
});

test('local: missing @spectrum-ts/imessage-local gives a clear install message', async () => {
  const a = new LocalImessageAdapter({ isKnown: () => false, loadModule: async () => Promise.reject(new Error('Cannot find package')) });
  await assert.rejects(a.provider(), /not installed.*bun add @spectrum-ts\/imessage-local/s);
});

test('local: replies are sent as plain space.send', async () => {
  const sent: unknown[] = [];
  const a = new LocalImessageAdapter({ isKnown: () => true });
  const sp = space({ id: 'c', send: async (c: unknown) => (sent.push(c), { id: 'syn-1', content: { type: 'text' } }) });
  a.remember(sp);
  const ref = await a.reply('c', 'u-1', 'hello');
  assert.equal(ref, 'syn-1');
  assert.deepEqual(sent, ['hello']);
});
