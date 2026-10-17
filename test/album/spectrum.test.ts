// Photon inbound images -> ChannelInbound kind 'photo' (src/channels/spectrum.ts), with plain SDK-shaped objects.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAPS, type ChannelInbound } from '../../src/channels/types.js';
import { MAX_INBOUND_PHOTO_BYTES, PlatformCache, SpectrumChannel, imageAttachments, readImage, type ContentLike } from '../../src/channels/spectrum.js';

const img = (mimeType: string, bytes = new Uint8Array([1, 2, 3]), size?: number): ContentLike => ({
  type: 'attachment', id: 'att', name: 'IMG_0001.HEIC', mimeType, ...(size !== undefined ? { size } : {}), read: async () => Buffer.from(bytes),
});

class TestChannel extends SpectrumChannel {
  readonly surface = 'telegram' as const;
  readonly caps = CAPS.telegram;
}

test('imageAttachments: single, reply-wrapped and grouped images; other attachments ignored', () => {
  assert.equal(imageAttachments(img('image/jpeg')).items.length, 1);
  assert.equal(imageAttachments(img('application/pdf')).items.length, 0);
  assert.equal(imageAttachments({ type: 'text', text: 'hi' }).items.length, 0);
  const reply = imageAttachments({ type: 'reply', target: { id: 'homi-7' }, content: img('image/png') });
  assert.equal(reply.replyTo, 'homi-7');
  assert.equal(reply.items.length, 1);
  const group = imageAttachments({ type: 'group', items: [{ content: img('image/webp') }, { content: { type: 'text', text: 'homi add' } }, { content: img('image/heic') }] });
  assert.equal(group.items.length, 2);
  assert.equal(group.caption, 'homi add');
});

test('readImage refuses anything over 10 MB, by declared size or actual bytes', async () => {
  assert.deepEqual(await readImage(img('image/png')), { mime: 'image/png', bytes: Buffer.from([1, 2, 3]) });
  assert.equal(await readImage(img('image/png', new Uint8Array([1]), MAX_INBOUND_PHOTO_BYTES + 1)), null);
  assert.equal(await readImage(img('image/png', new Uint8Array(MAX_INBOUND_PHOTO_BYTES + 1))), null);
});

test('deliver turns a remembered image message into one photo inbound per image, with the caption', async () => {
  const ch = new TestChannel(new PlatformCache());
  const got: ChannelInbound[] = [];
  await ch.start(async (m) => void got.push(m));
  const content: ContentLike = { type: 'group', items: [{ content: img('image/jpeg') }, { content: img('image/png') }, { content: { type: 'text', text: 'homi add' } }] };
  ch.remember({ id: '-100', send: async () => undefined }, { id: 'm1', content });
  const base = { surface: 'telegram' as const, spaceId: '-100', isGroup: true, msgId: 'm1', from: { handle: '42' }, mentionsAgent: false, at: 1 };
  await ch.deliver({ ...base, kind: 'text', text: 'homi add' });
  assert.deepEqual(got.map((m) => [m.kind, m.msgId, m.text, m.photo?.mime]), [['photo', 'm1', 'homi add', 'image/jpeg'], ['photo', 'm1:1', 'homi add', 'image/png']]);
  await ch.deliver({ ...base, msgId: 'm2', kind: 'text', text: 'plain text' });
  assert.equal(got.at(-1)?.kind, 'text', 'messages without images pass through unchanged');
});
