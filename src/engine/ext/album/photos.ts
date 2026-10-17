// Photo events: keep a photo only when it was shared on purpose ("homi add" caption, or an inline reply to an
// album message); every other photo is deleted right away. Low-noise acks: see docs/ALBUM.md "Acknowledgements".

import type { EngineEvent, MsgRef } from '../../types.js';
import { type Step, react, say } from '../../plan/core.js';
import { detectAddressed, stripAddress } from '../../parse.js';
import { clean, normText } from '../../util.js';
import { ALBUM_COPY as C } from './copy.js';
import { type AlbumState, albumMimeOk, albumOf, contributors, nameFor } from './model.js';

type PhotoEvent = Extract<EngineEvent, { kind: 'photo' }>;

/** Caption words that mean "put this in the album" once the caption is addressed to Homi. */
const ADD_WORDS = /^(?:please\s+)?(?:add|save|keep|put|upload|album|for the album)\b/;

/** Caption without the address and without the leading "add" verb ("homi add the crew 🍜" -> "the crew 🍜"). */
export function captionOf(raw?: string): string | undefined {
  if (!raw) return undefined;
  const body = stripAddress(raw)
    .replace(/^(?:please\s+)?(?:add|save|keep|put|upload)\b(?:\s+(?:this|these|that|it))?(?:\s+to\s+(?:the\s+)?album)?[\s,:;.!-]*/i, '')
    .replace(/^for the album[\s,:;.!-]*/i, '');
  const c = clean(body, 120);
  return c || undefined;
}

/** True when the member explicitly shared this photo with Homi. */
export function explicitlyShared(ev: PhotoEvent, a: AlbumState | undefined): boolean {
  const replyTo = (ev as PhotoEvent & { replyTo?: MsgRef }).replyTo;
  if (a && replyTo && a.refs.includes(replyTo)) return true;
  const caption = ev.caption ?? '';
  const addressed = ev.addressed || (caption ? detectAddressed(caption) : false);
  if (!addressed) return false;
  const body = normText(stripAddress(caption));
  return body === '' || ADD_WORDS.test(body);
}

/** Low-noise rule: 👍 every add; post the count line when a third contributor joins and on every 10th photo. */
function acknowledge(st: Step, a: AlbumState, msgRef: MsgRef): void {
  const n = a.photos.length;
  const third = !a.announced3 && contributors(a).length >= 3;
  if (third) a.announced3 = true;
  if (st.ctx.caps.reactionsOut) react(st, msgRef);
  if (third || n % 10 === 0 || !st.ctx.caps.reactionsOut) say(st, C.count(a));
}

export function onPhoto(st: Step, ev: PhotoEvent): void {
  const discard = () => st.acts.push({ type: 'album_delete', photoIds: [ev.photoId] });
  const a = albumOf(st.s);
  if (!explicitlyShared(ev, a)) return void discard();
  if (!a) {
    discard();
    return say(st, C.addNeedsAlbum());
  }
  if (!albumMimeOk(ev.mime)) {
    discard();
    return say(st, C.badType());
  }
  if (a.photos.some((p) => p.photoId === ev.photoId)) return;
  const name = nameFor(st.s, ev.from.key, ev.from.platformName);
  const caption = captionOf(ev.caption);
  a.photos.push({ photoId: ev.photoId, by: ev.from.key, ...(name ? { name } : {}), addedAt: st.ctx.now, ...(caption ? { caption } : {}) });
  st.acts.push({ type: 'album_keep', albumId: a.id, photoId: ev.photoId });
  acknowledge(st, a, ev.msgRef);
}
