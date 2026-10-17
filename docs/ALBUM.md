# Shared album

After the night out, the group can keep a small event album: photos members explicitly hand to Homi, viewable on a members-only page, and removable by the person who added them. This is Act 4 of [DEMO.md](DEMO.md).

**Status:** the engine, the encrypted disk store, the gallery page and the offline sim all work and are tested. Album links in the sim and in tests are labeled **(demo link)**. Running it on real chats still needs the integration work at the end of this page.

## Commands

All of them must be addressed to Homi ("homi …", @homi, or a reply to a Homi message).

| Say | What happens | Who can |
|---|---|---|
| `homi start an album for tonight` (also "open/make/create an album") | Opens the group's album and posts its link. The title comes from the plan, e.g. "Ramen night · Fri Oct 23" (cuisine of the place, "night" for evening plans, the event day); with no plan it is "Our album · Sat Oct 17". One album per group: asking again re-posts the link. | anyone |
| a photo with the caption `homi add` (or `@homi`, `homi save …`, `homi add: caption`) | Adds the photo. The caption without the address is kept ("homi add the crew" → "the crew"). | anyone |
| a photo sent as an inline **reply to an album message** | Adds the photo. Needs the runner to pass `replyTo` on photo events (see "Contract changes"). | anyone |
| `homi album` / `homi show the album` / `where's the album` | Count, contributors and link. | anyone |
| `homi remove my photos` | Deletes all of your own photos, files included. | contributors (their own) |
| `homi remove photo 3` | Deletes photo #3 (numbers are shown on the album page). Refused for anyone but the person who added it: "Photo 3 is Ana's, so only Ana can remove it." | that photo's contributor |
| `homi delete album` | Deletes the album and every photo in it, for the whole group. The reply says that any member can do this. | **any member** |
| `homi stop` | Deletes everything Homi has for the chat, album photos included. | anyone |

`homi forget` deletes the plan only; the album stays until it is deleted (DEMO step 26).

### Only photos shared on purpose

A photo is kept only when the member clearly meant it for the album: an addressed caption that is empty or starts with add/save/keep/put/upload/album, or an inline reply to one of Homi's album messages. **Every other photo is deleted immediately** (the engine emits `album_delete` for it in the same step), and Homi says nothing. A `homi add` photo when no album exists is deleted too, with a hint to start one. Only JPEG, PNG, WebP and HEIC up to 10 MB are accepted.

### Acknowledgements (the low-noise rule)

- Homi reacts 👍 to every added photo.
- It posts the count line ("4 photos in the album from Ana, Jo and Maya.") **once, on the add that brings in the third contributor**, and again on every 10th photo.
- On surfaces where Homi cannot react (macOS local iMessage), it posts the count line after every add instead, so nobody wonders whether the photo arrived.
- `homi album` always answers with the count and the link.

In the demo, Ana sends 1, Jo 2 and Maya 1: the fourth photo is Maya's, Maya is the third contributor, and Homi posts exactly the DEMO step 16 line.

## What is stored where

| Where | What | Encrypted | Deleted when |
|---|---|---|---|
| `spaces` settings blob → `ext.album` | album id, title, created time/by (hashed member ID), Homi's album message IDs (max 5), and per photo: photo ID, contributor (hashed ID + display name), added time, caption without the address | yes, sealed with the settings | `homi remove my photos` / `remove photo N` (that photo), `homi delete album`, `homi stop` |
| `<DATA_DIR>/albums/_incoming/<photoId>` | inbound photo bytes, before the engine decides | yes, AES-256-GCM with `DATA_KEY`, bound to the photo ID | immediately when not shared on purpose; otherwise moved on keep; anything left after **10 minutes** is swept (and every leftover from an earlier run, at startup) |
| `<DATA_DIR>/albums/<albumId>/<photoId>` | kept photo bytes | yes, same as above | same as the album index |
| `<DATA_DIR>/albums/index.sealed` | which photos each album keeps, plus what the page shows: title, contributor display names, captions, added times, MIME type, and the hashed chat ID (so delete/stop can drop the folder) | yes, one sealed file | per photo / album, as above |

Photo IDs are random 128-bit values; uploaded file names are never used or stored. Homi never logs photo bytes, captions, photo IDs or album IDs; the HTTP server does not log `/a/…` paths. The bytes are kept exactly as sent; see "EXIF" below.

## Retention

The album is a group-level extra (PRIVACY.md, "Beyond a single plan"), so it does **not** follow the 24-hour plan rule. It stays until the group deletes it, a contributor removes their photos, or someone says `homi stop`. Photos that were not explicitly shared never outlive the step that received them, and the 10-minute sweep is the safety net.

## Access model (and its honest limits)

- The link is `PUBLIC_BASE_URL/a/<albumId>`. The album ID comes from `ctx.newId()`, which the runner sets to `randomUUID()` (122 random bits), so the link is a **capability link**: hard to guess, but **anyone who has it can view the album**. It is meant to stay in the group chat.
- `GET /a/<albumId>` renders a simple grid (decrypted on the fly) with contributor names, captions and a "Members only" label. `GET /a/<albumId>/<photoId>` serves one image, only if that photo belongs to that album. Unknown, deleted or empty albums, foreign photo IDs and malformed IDs all return the same 404.
- Pages are sent with `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`, a strict CSP and `X-Frame-Options: DENY`.
- **Production should not rely on a bearer link.** Use per-member signed links sent by DM, with an expiry, and an actual sign-in (see below).
- An album only appears on the page once its first photo is kept; before that the link shows "Album not found".
- Without `PUBLIC_BASE_URL` (tests, the sim) links point at `https://homi.example` and are labeled "(demo link)".
- Mounting the server under a path prefix is not supported (image URLs are absolute `/a/…`).

## How it is wired

- Engine (pure): `src/engine/ext/album.ts` with `album/model.ts` (state + helpers), `album/copy.ts` (copy and title), `album/commands.ts`, `album/photos.ts`.
- Runner: `src/runner/handlers/album.ts` builds the `AlbumStore` (`src/album/store.ts`, sealed index in `src/album/index-file.ts`) and handles `album_keep` (move + index) and `album_delete` (delete files, then drop any album folder the chat no longer has). The store is the runner's `PhotoStore`, so inbound bytes go there before the engine sees an opaque ID.
- HTTP: `src/http/server.ts` routes `GET /a/…` to `src/album/gallery.ts` when `HttpDeps.album` is set.
- Photon: `src/channels/spectrum.ts` turns image attachments on inbound messages (plain, reply-wrapped or grouped, up to 10 per message) into `kind: 'photo'` inbounds, reading the bytes in memory through the SDK's `attachment.read()`.
- Sim: `/photo <persona> [caption]` sends a generated sample PNG (`src/album/sample.ts`); no caption means "not shared". Photos are sealed with the sim's key in a temp folder that is deleted on exit.

To turn it on in `src/index.ts`, pass the key and the gallery:

```ts
const ext = createExtHandlers({ ...deps, dataKey: config.dataKey }); // needs `dataKey?: Buffer` on ExtHandlerDeps
await startHttpServer(config.port, { ...httpDeps, album: galleryFor(ext.photoStore) });
```

Without `dataKey` the album store stays off and photos are never written to disk (the engine still answers commands).

## Contract changes still needed

- **`replyTo` on photo events.** `EngineEvent` `photo` has no `replyTo`, and `Runner.#photoEvents` does not pass `m.replyTo`. The engine already reads an optional `replyTo` and matches it against the album message IDs, so adding `replyTo?: MsgRef` to the event and `...(m.replyTo ? { replyTo: m.replyTo } : {})` in the runner makes "reply to the album message" work.
- **`dataKey` on `ExtHandlerDeps`**, passed from `config.dataKey` in `src/index.ts` (the sim already passes it).
- **Rejected uploads are silent.** When `PhotoStore.put` refuses a file (wrong type, over 10 MB), the runner logs an error and the engine never hears about it. A small `photo_rejected` event would let Homi say why.

## What the real app still needs

- **Photon attachment fetching per channel.** The mapping above is written against spectrum-ts 12.11 typings and unit-tested with SDK-shaped objects, but not against live traffic. Check per surface: whether Telegram delivers a captioned photo as one grouped message or as text plus attachment, whether cloud iMessage attachments are fetchable from a shared or dedicated line, and how macOS local iMessage exposes them (its allowlist currently drops messages from unknown chats before any of this runs). The Photon docs' "fetching attachments" page is the place to start.
- **Object storage with signed URLs** (S3, R2 or similar) instead of the local disk, so photos survive redeploys and the server does not stream images. Keep client-side or server-side encryption with our own key, and serve through short-lived signed URLs.
- **Per-member auth.** Signed, expiring links per member sent by DM (or a sign-in with the chat platform), revoked when someone leaves the group or the album is deleted.
- **EXIF and location stripping.** Phone photos usually carry GPS coordinates and device data. Strip metadata on ingest (and convert HEIC to JPEG for browsers other than Safari) before storing.
- **Moderation and reporting.** A way to report a photo, a hold-and-review path, and abuse-content scanning where the law requires it.
- **Storage quotas and limits** per group and per member (count and bytes), plus rate limits on uploads and on `/a/…`.
- **Credentials and settings**, none of which exist yet: storage bucket, region and access keys (for example `ALBUM_BUCKET`, `ALBUM_REGION`, `ALBUM_ACCESS_KEY_ID`, `ALBUM_SECRET_ACCESS_KEY`), a link-signing secret (`ALBUM_LINK_SECRET`) and link lifetime, and `PUBLIC_BASE_URL` on HTTPS. `DATA_KEY` already encrypts the files and index.
- Thumbnails and pagination for big albums, and a "download all" for members before the album is deleted.
