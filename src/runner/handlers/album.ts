// Shared album, runner side: inbound photo bytes go to the encrypted disk store (PhotoStore.put), and the engine's
// album_keep / album_delete actions move, index or delete them (docs/ALBUM.md). Never logs ids, captions or bytes.

import type { AlbumState } from '../../engine/ext/album/model.js';
import { AlbumStore } from '../../album/store.js';
import { Sealer } from '../../privacy/crypto.js';
import type { ActionHandler, ExtHandlerDeps, PhotoStore } from './types.js';

export interface AlbumHandlerDeps extends ExtHandlerDeps {
  /** DATA_KEY (32 bytes). Without it the album store is off: photos are never written to disk. */
  dataKey?: Buffer;
  /** Incoming-photo sweep interval; false turns the timer off (tests call store.sweep() directly). */
  sweepIntervalMs?: number | false;
}

/** album_keep / album_delete against an AlbumStore, using the post-apply album state for titles and names. */
export function albumActionHandler(store: AlbumStore): ActionHandler {
  return {
    types: ['album_keep', 'album_delete'],
    async run(action, ctx) {
      const album = ctx.state.space.ext?.album as AlbumState | undefined;
      if (action.type === 'album_keep') {
        const ph = album?.id === action.albumId ? album.photos.find((p) => p.photoId === action.photoId) : undefined;
        const photo = ph ? { name: ph.name, caption: ph.caption, addedAt: ph.addedAt } : undefined;
        await store.keep(action.albumId, action.photoId, { spaceKey: ctx.spaceKey, title: album?.title ?? 'Album', photo });
        return;
      }
      if (action.type === 'album_delete') {
        await store.remove(action.photoIds);
        // "homi delete album" / "homi stop": the space no longer has this album, so its folder goes too.
        await store.prune(ctx.spaceKey, album?.id);
      }
    },
  };
}

export function createAlbumHandler(deps: AlbumHandlerDeps): { handler: ActionHandler | null; photoStore?: PhotoStore } {
  if (!deps.dataKey) return { handler: null };
  const store = new AlbumStore({ dataDir: deps.dataDir, sealer: new Sealer(deps.dataKey), now: deps.now });
  if (deps.sweepIntervalMs !== false) store.startSweeper(deps.sweepIntervalMs ?? 60_000);
  void store.sweep().catch(() => undefined); // leftovers from an earlier run are never kept
  return { handler: albumActionHandler(store), photoStore: store };
}
