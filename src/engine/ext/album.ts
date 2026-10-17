// Shared album (docs/ALBUM.md, docs/DEMO.md Act 4): one group-level album in space.ext.album, photos kept only
// when shared on purpose, contributors remove their own, any member deletes the album, "homi stop" deletes all.
import type { Extension } from './types.js';
import { onAlbumCommand } from './album/commands.js';
import { albumDumpLine } from './album/copy.js';
import { MAX_REFS, albumOf } from './album/model.js';
import { onPhoto } from './album/photos.js';

export const album: Extension = {
  name: 'album',

  onMessage(st, ev, body, addressed) {
    if (!addressed) return false;
    return onAlbumCommand(st, ev, body);
  },

  onEvent(st, ev) {
    if (ev.kind !== 'photo') return false;
    onPhoto(st, ev);
    return true;
  },

  onSent(st, tag, msgRef) {
    if (tag !== 'album:open') return false;
    const a = albumOf(st.s);
    if (a && !a.refs.includes(msgRef)) a.refs = [...a.refs, msgRef].slice(-MAX_REFS);
    return true;
  },

  // "homi forget" deletes the plan only; the album stays until "homi delete album" or "homi stop" (DEMO step 26).

  onStop(st) {
    const a = albumOf(st.s);
    if (a?.photos.length) st.acts.push({ type: 'album_delete', photoIds: a.photos.map((p) => p.photoId) });
  },

  dump(state) {
    const a = albumOf(state);
    return a ? [albumDumpLine(a)] : [];
  },
};
