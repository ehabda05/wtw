// The sealed album index (<dataDir>/albums/index.sealed): which photos each album keeps, plus the display
// metadata the gallery shows (title, contributor names, captions). AES-256-GCM via Sealer, bound to its path.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Sealer } from '../privacy/crypto.js';

export interface StoredPhoto {
  photoId: string;
  mime: string;
  addedAt: number;
  /** Contributor display name, when the platform or the plan gave one. */
  name?: string;
  caption?: string;
}

export interface StoredAlbum {
  albumId: string;
  /** Hashed space key (HMAC), so "homi delete album" / "homi stop" can drop the album's folder. */
  spaceKey?: string;
  title: string;
  photos: StoredPhoto[];
}

interface IndexDoc {
  v: 1;
  albums: Record<string, StoredAlbum>;
}

const AAD = 'albums:index';

export class AlbumIndex {
  readonly #file: string;
  readonly #sealer: Sealer;
  #doc?: IndexDoc;
  #chain: Promise<unknown> = Promise.resolve();

  constructor(root: string, sealer: Sealer) {
    this.#file = join(root, 'index.sealed');
    this.#sealer = sealer;
  }

  async #load(): Promise<IndexDoc> {
    if (this.#doc) return this.#doc;
    try {
      const raw = await readFile(this.#file);
      this.#doc = this.#sealer.openJson<IndexDoc>(raw, AAD);
    } catch (err) {
      if ((err as { code?: string }).code !== 'ENOENT') throw err;
      this.#doc = { v: 1, albums: {} };
    }
    return this.#doc;
  }

  /** Read-only snapshot of one album (a copy, so callers cannot mutate the cache). */
  async get(albumId: string): Promise<StoredAlbum | null> {
    await this.#chain;
    const a = (await this.#load()).albums[albumId];
    return a ? structuredClone(a) : null;
  }

  async all(): Promise<StoredAlbum[]> {
    await this.#chain;
    return Object.values((await this.#load()).albums).map((a) => structuredClone(a));
  }

  /** Serialized read-modify-write; the sealed file is replaced atomically (write + rename). */
  update<T>(fn: (albums: Record<string, StoredAlbum>) => T): Promise<T> {
    const run = this.#chain.then(async () => {
      const doc = await this.#load();
      const out = fn(doc.albums);
      await mkdir(join(this.#file, '..'), { recursive: true });
      const tmp = `${this.#file}.tmp`;
      await writeFile(tmp, this.#sealer.sealJson(doc, AAD));
      await rename(tmp, this.#file);
      return out;
    });
    this.#chain = run.catch(() => undefined);
    return run;
  }
}
