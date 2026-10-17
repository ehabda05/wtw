// Shared-album state (GroupState.space.ext.album, sealed with the settings) and small pure helpers.
// Only data members hand Homi on purpose is kept: photo ids, contributor, added time, caption without the address.

import type { Ctx, GroupState, MemberKey, MsgRef } from '../../types.js';
import type { EnginePlan } from '../../model.js';
import type { Step } from '../../plan/core.js';
import { clean, listJoin } from '../../util.js';

export interface AlbumPhoto {
  photoId: string;
  /** Contributor (hashed member key). */
  by: MemberKey;
  /** Contributor display name (plan name or the name the platform shows), when known. */
  name?: string;
  addedAt: number;
  /** Caption the member sent with the photo, without the "homi add" address. */
  caption?: string;
}

export interface AlbumState {
  /** Unguessable random id (ctx.newId): the album link is a capability link. */
  id: string;
  title: string;
  createdAt: number;
  createdBy: MemberKey;
  /** Homi's album messages (link posts); an inline reply with a photo to any of them counts as an add. */
  refs: MsgRef[];
  photos: AlbumPhoto[];
  /** The "N photos from A, B and C" line was posted for the third contributor. */
  announced3?: boolean;
}

export const ALBUM_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'] as const;

/** "Image/JPG; q=1" -> "image/jpeg". */
export function normalizeMime(mime: string): string {
  const m = mime.split(';')[0].trim().toLowerCase();
  return m === 'image/jpg' || m === 'image/pjpeg' ? 'image/jpeg' : m;
}

export function albumMimeOk(mime: string): boolean {
  return (ALBUM_MIME as readonly string[]).includes(normalizeMime(mime));
}
export const DEMO_BASE_URL = 'https://homi.example';
export const MAX_REFS = 5;

export function albumOf(s: GroupState): AlbumState | undefined {
  return s.space.ext?.album as AlbumState | undefined;
}

export function setAlbum(st: Step, a: AlbumState | undefined): void {
  const sp = st.s.space;
  if (a) {
    sp.ext = { ...(sp.ext ?? {}), album: a };
    return;
  }
  if (!sp.ext) return;
  delete sp.ext.album;
  if (Object.keys(sp.ext).length === 0) delete sp.ext;
}

/** The album link, and whether it is a demo link (no PUBLIC_BASE_URL, or the labeled demo host). */
export function albumLink(ctx: Ctx, id: string): string {
  const base = (ctx.publicBaseUrl ?? DEMO_BASE_URL).replace(/\/+$/, '');
  const demo = !ctx.publicBaseUrl || base === DEMO_BASE_URL;
  return `${base}/a/${id}${demo ? ' (demo link)' : ''}`;
}

/** Display name for a member: the plan's name for them first, then the platform's. */
export function nameFor(s: GroupState, key: MemberKey, platformName?: string): string | undefined {
  const p = s.plan as EnginePlan | null;
  const n = p?.members[key]?.name ?? (platformName ? clean(platformName, 30) : undefined);
  return n || undefined;
}

/** Contributors in order of their first photo. */
export function contributors(a: AlbumState): { by: MemberKey; name?: string; count: number }[] {
  const out = new Map<MemberKey, { by: MemberKey; name?: string; count: number }>();
  for (const ph of a.photos) {
    const c = out.get(ph.by) ?? { by: ph.by, name: ph.name, count: 0 };
    c.count++;
    if (!c.name && ph.name) c.name = ph.name;
    out.set(ph.by, c);
  }
  return [...out.values()];
}

/** "Ana, Jo and Maya", "Ana and 1 other", "2 people". */
export function fromWhom(a: AlbumState): string {
  const cs = contributors(a);
  const named = cs.filter((c) => c.name).map((c) => c.name as string);
  const others = cs.length - named.length;
  if (!named.length) return `${cs.length} ${cs.length === 1 ? 'person' : 'people'}`;
  if (!others) return listJoin(named);
  return listJoin([...named, `${others} ${others === 1 ? 'other' : 'others'}`]);
}

export function photoCount(n: number): string {
  return `${n} ${n === 1 ? 'photo' : 'photos'}`;
}
