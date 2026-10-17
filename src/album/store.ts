// Encrypted on-disk photo store: inbound bytes are sealed (AES-256-GCM, DATA_KEY) into albums/_incoming/<photoId>,
// album_keep moves them to albums/<albumId>/<photoId>, and anything not kept within 10 minutes is swept.

import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Sealer } from '../privacy/crypto.js';
import { SafeError } from '../privacy/logger.js';
import type { PhotoStore } from '../runner/handlers/types.js';
import { AlbumIndex, type StoredAlbum, type StoredPhoto } from './index-file.js';

export const PHOTO_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'] as const;
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const INCOMING_TTL_MS = 10 * 60_000;
/** Album and photo ids are path segments: strict charset, no dots, bounded length. */
export const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const INCOMING = '_incoming';

export class PhotoRejected extends SafeError {}

export function normalizePhotoMime(mime: string): string {
  const m = mime.split(';')[0].trim().toLowerCase();
  return m === 'image/jpg' || m === 'image/pjpeg' ? 'image/jpeg' : m;
}

export interface KeepMeta {
  spaceKey?: string;
  title: string;
  photo?: { name?: string; caption?: string; addedAt?: number };
}

export interface AlbumStoreOptions {
  /** DATA_DIR; photos live under <dataDir>/albums. */
  dataDir: string;
  sealer: Sealer;
  now?: () => number;
}

const photoAad = (photoId: string) => `albums:photo:${photoId}`;

export class AlbumStore implements PhotoStore {
  readonly root: string;
  readonly #sealer: Sealer;
  readonly #now: () => number;
  readonly #index: AlbumIndex;
  /** photoId -> received time, for photos waiting in _incoming. Unknown files there are leftovers: swept. */
  readonly #incoming = new Map<string, number>();

  constructor(opts: AlbumStoreOptions) {
    this.root = join(opts.dataDir, 'albums');
    this.#sealer = opts.sealer;
    this.#now = opts.now ?? Date.now;
    this.#index = new AlbumIndex(this.root, opts.sealer);
  }

  #incomingPath(photoId: string): string {
    return join(this.root, INCOMING, photoId);
  }

  #albumPath(albumId: string, photoId?: string): string {
    return photoId ? join(this.root, albumId, photoId) : join(this.root, albumId);
  }

  /** Seals and stores inbound bytes; returns an opaque random id. Rejects other types and anything over 10 MB. */
  async put(bytes: Uint8Array, mime: string): Promise<string> {
    const m = normalizePhotoMime(mime);
    const code = (PHOTO_MIME as readonly string[]).indexOf(m);
    if (code < 0) throw new PhotoRejected('album: photo type not allowed');
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_PHOTO_BYTES) throw new PhotoRejected('album: photo empty or over 10 MB');
    const photoId = randomBytes(16).toString('hex');
    this.#incoming.set(photoId, this.#now());
    await mkdir(join(this.root, INCOMING), { recursive: true });
    const plain = Buffer.concat([Buffer.from([code]), Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)]);
    await writeFile(this.#incomingPath(photoId), this.#sealer.seal(plain, photoAad(photoId)));
    return photoId;
  }

  /** Moves an incoming photo into the album and records it in the sealed index. False if it is gone. */
  async keep(albumId: string, photoId: string, meta: KeepMeta): Promise<boolean> {
    if (!SAFE_ID.test(albumId) || albumId === INCOMING || !SAFE_ID.test(photoId)) return false;
    const dest = this.#albumPath(albumId, photoId);
    let mime: string;
    try {
      mime = await this.#mimeOf(this.#incomingPath(photoId), photoId);
      await mkdir(this.#albumPath(albumId), { recursive: true });
      await rename(this.#incomingPath(photoId), dest);
    } catch (err) {
      if ((err as { code?: string }).code !== 'ENOENT') throw err;
      if (!(await exists(dest))) return false;
      mime = await this.#mimeOf(dest, photoId);
    }
    this.#incoming.delete(photoId);
    await this.#index.update((albums) => {
      const a: StoredAlbum = albums[albumId] ?? { albumId, title: meta.title, photos: [] };
      a.title = meta.title;
      if (meta.spaceKey) a.spaceKey = meta.spaceKey;
      const prev = a.photos.find((p) => p.photoId === photoId);
      const ph: StoredPhoto = { ...prev, photoId, mime, addedAt: meta.photo?.addedAt ?? prev?.addedAt ?? this.#now() };
      if (meta.photo?.name) ph.name = meta.photo.name;
      if (meta.photo?.caption) ph.caption = meta.photo.caption;
      if (prev) Object.assign(prev, ph);
      else a.photos.push(ph);
      albums[albumId] = a;
    });
    return true;
  }

  /** Deletes photo files (kept or still incoming) and their index entries. Returns how many files went away. */
  async remove(photoIds: string[]): Promise<number> {
    const ids = new Set(photoIds.filter((id) => SAFE_ID.test(id)));
    if (!ids.size) return 0;
    const where = await this.#index.update((albums) => {
      const found: [string, string][] = [];
      for (const a of Object.values(albums)) {
        for (const p of a.photos) if (ids.has(p.photoId)) found.push([a.albumId, p.photoId]);
        a.photos = a.photos.filter((p) => !ids.has(p.photoId));
      }
      return found;
    });
    let n = 0;
    for (const [albumId, photoId] of where) n += await rmFile(this.#albumPath(albumId, photoId));
    for (const id of ids) {
      this.#incoming.delete(id);
      n += await rmFile(this.#incomingPath(id));
    }
    return n;
  }

  /** Drops every album of this space except `keepAlbumId` (after "homi delete album" or "homi stop"). */
  async prune(spaceKey: string, keepAlbumId?: string): Promise<number> {
    const gone = await this.#index.update((albums) => {
      const ids = Object.values(albums).filter((a) => a.spaceKey === spaceKey && a.albumId !== keepAlbumId).map((a) => a.albumId);
      for (const id of ids) delete albums[id];
      return ids;
    });
    for (const id of gone) await rm(this.#albumPath(id), { recursive: true, force: true });
    return gone.length;
  }

  /** Deletes incoming photos nobody kept within INCOMING_TTL_MS, and leftovers from an earlier run. */
  async sweep(): Promise<number> {
    let names: string[];
    try {
      names = await readdir(join(this.root, INCOMING));
    } catch {
      return 0;
    }
    const now = this.#now();
    let n = 0;
    for (const id of names) {
      const t = this.#incoming.get(id);
      if (t !== undefined && now - t < INCOMING_TTL_MS) continue;
      this.#incoming.delete(id);
      n += await rmFile(this.#incomingPath(id));
    }
    return n;
  }

  /** Periodic sweep (unref'd, so it never keeps the process alive). Returns a stop function. */
  startSweeper(intervalMs = 60_000): () => void {
    const t = setInterval(() => void this.sweep().catch(() => undefined), intervalMs);
    t.unref?.();
    return () => clearInterval(t);
  }

  async album(albumId: string): Promise<StoredAlbum | null> {
    if (!SAFE_ID.test(albumId) || albumId === INCOMING) return null;
    return this.#index.get(albumId);
  }

  /** Decrypts one kept photo of an album (null when the album or photo does not exist). */
  async photo(albumId: string, photoId: string): Promise<{ mime: string; bytes: Buffer } | null> {
    const a = await this.album(albumId);
    if (!a || !SAFE_ID.test(photoId) || !a.photos.some((p) => p.photoId === photoId)) return null;
    try {
      const plain = this.#sealer.open(await readFile(this.#albumPath(albumId, photoId)), photoAad(photoId));
      return { mime: PHOTO_MIME[plain[0]] ?? 'application/octet-stream', bytes: plain.subarray(1) };
    } catch (err) {
      if ((err as { code?: string }).code === 'ENOENT') return null;
      throw err;
    }
  }

  /** Number of photos waiting in _incoming (tests, /health). */
  pendingCount(): number {
    return this.#incoming.size;
  }

  async #mimeOf(path: string, photoId: string): Promise<string> {
    const plain = this.#sealer.open(await readFile(path), photoAad(photoId));
    return PHOTO_MIME[plain[0]] ?? 'application/octet-stream';
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function rmFile(p: string): Promise<number> {
  try {
    await rm(p);
    return 1;
  } catch {
    return 0;
  }
}
