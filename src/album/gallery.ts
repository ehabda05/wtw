// Member-only gallery page: GET /a/<albumId> renders a grid, GET /a/<albumId>/<photoId> serves one decrypted image.
// The album id is an unguessable capability link; ids, captions and bytes are never logged (docs/ALBUM.md).

import type { PhotoStore } from '../runner/handlers/types.js';
import type { StoredAlbum } from './index-file.js';
import { AlbumStore, SAFE_ID } from './store.js';

export interface GalleryResponse {
  status: number;
  headers: Record<string, string>;
  body: string | Buffer;
}

export interface AlbumGallery {
  /** Handles a GET path under /a/; null when the path is not a gallery path at all. */
  handle(path: string): Promise<GalleryResponse | null>;
}

const PAGE_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex, nofollow',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

const STYLE = `
:root{--bg:#fafaf7;--fg:#1d1d1f;--muted:#6e6e73;--card:#fff;--line:#e5e5ea}
@media (prefers-color-scheme:dark){:root{--bg:#111;--fg:#f2f2f7;--muted:#a1a1a6;--card:#1c1c1e;--line:#2c2c2e}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.4 -apple-system,system-ui,sans-serif}
main{max-width:880px;margin:0 auto;padding:24px 16px}h1{font-size:1.4rem;margin:0 0 4px}
.sub{color:var(--muted);margin:0 0 20px;font-size:.9rem}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
@media (min-width:640px){.grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
figure{margin:0;background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden}
img{display:block;width:100%;aspect-ratio:1;object-fit:cover;background:var(--line)}
figcaption{padding:8px 10px;font-size:.85rem}figcaption b{font-weight:600}figcaption span{color:var(--muted)}
.empty{color:var(--muted);padding:40px 0;text-align:center}footer{color:var(--muted);font-size:.8rem;margin-top:24px}`;

/** The album page: title, "members only" label, a grid of photos with contributor names and captions. */
export function renderAlbumPage(a: StoredAlbum): string {
  const n = a.photos.length;
  const cards = a.photos
    .map((p, i) => {
      const who = p.name ? escapeHtml(p.name) : 'A member';
      const cap = p.caption ? ` <span>· ${escapeHtml(p.caption)}</span>` : '';
      const src = `/a/${encodeURIComponent(a.albumId)}/${encodeURIComponent(p.photoId)}`;
      return `<figure><img src="${src}" alt="Photo ${i + 1} from ${who}" loading="lazy"><figcaption><b>#${i + 1} ${who}</b>${cap}</figcaption></figure>`;
    })
    .join('');
  const body = n ? `<div class="grid">${cards}</div>` : `<p class="empty">No photos yet. Send one in the group with "homi add".</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${escapeHtml(a.title)}</title><style>${STYLE}</style></head>
<body><main><h1>${escapeHtml(a.title)}</h1><p class="sub">Members only · ${n} ${n === 1 ? 'photo' : 'photos'} · shared with Homi in your group chat</p>
${body}<footer>Anyone with this link can view the album, so keep it in the group. Remove your photos anytime with "homi remove my photos".</footer></main></body></html>`;
}

const NOT_FOUND = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Album not found</title><style>${STYLE}</style></head><body><main><h1>Album not found</h1><p class="sub">This album was deleted, has no photos yet, or the link is wrong.</p></main></body></html>`;

function notFound(): GalleryResponse {
  return { status: 404, headers: PAGE_HEADERS, body: NOT_FOUND };
}

export function createGallery(store: AlbumStore): AlbumGallery {
  return {
    async handle(path: string): Promise<GalleryResponse | null> {
      const m = /^\/a\/([^/]+)(?:\/([^/]+))?\/?$/.exec(path);
      if (!m) return path === '/a' || path.startsWith('/a/') ? notFound() : null;
      const albumId = safeDecode(m[1]);
      const photoId = m[2] === undefined ? undefined : safeDecode(m[2]);
      if (!albumId || !SAFE_ID.test(albumId) || (photoId !== undefined && !SAFE_ID.test(photoId))) return notFound();
      if (photoId === undefined) {
        const a = await store.album(albumId);
        return a ? { status: 200, headers: PAGE_HEADERS, body: renderAlbumPage(a) } : notFound();
      }
      const ph = await store.photo(albumId, photoId);
      if (!ph) return notFound();
      return {
        status: 200,
        headers: { 'content-type': ph.mime, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'; sandbox" },
        body: ph.bytes,
      };
    },
  };
}

/** The gallery for the runner's photo store, when it is the encrypted disk store. */
export function galleryFor(store: PhotoStore | undefined): AlbumGallery | undefined {
  return store instanceof AlbumStore ? createGallery(store) : undefined;
}

function safeDecode(s: string): string | undefined {
  try {
    return decodeURIComponent(s);
  } catch {
    return undefined;
  }
}
