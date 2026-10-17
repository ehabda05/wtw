// Album copy (docs/DEMO.md Act 4) and the album title. Every chat message is <= 2 sentences.

import type { EnginePlan } from '../../model.js';
import type { Step } from '../../plan/core.js';
import { cuisineLabel, rankedCuisines } from '../../hungry.js';
import { capitalize, dayLabel, isoDay, local } from '../../util.js';
import { type AlbumState, albumLink, fromWhom, photoCount } from './model.js';

/** "Ramen night · Fri Oct 23" from the plan (cuisine/activity + event day), else "Our album · <today>". */
export function albumTitle(st: Step): string {
  const tz = st.s.space.tz;
  const p = st.s.plan as EnginePlan | null;
  const chosen = p?.options.find((o) => o.id === p.chosenOptionId);
  const at = p?.eventAt ?? chosen?.startsAt;
  if (!p || at === undefined) return `Our album · ${dayLabel(isoDay(st.ctx.now, tz))}`;
  const day = dayLabel(isoDay(at, tz));
  const tag = p.place?.cuisine?.split(/[;,]/)[0]?.trim() || (p.hungry ? rankedCuisines(p.hungry)[0]?.[0] : undefined);
  if (tag) {
    const evening = local(at, tz).hour >= 17;
    return `${capitalize(cuisineLabel(tag))}${evening ? ' night' : ''} · ${day}`;
  }
  return `${capitalize(p.activity || 'our plan')} · ${day}`;
}

export const ALBUM_COPY = {
  opened: (st: Step, a: AlbumState) =>
    `Album "${a.title}" is open to this group only: ${albumLink(st.ctx, a.id)}. Send photos with "homi add" or reply to this message; you can remove your own anytime with "homi remove my photos".`,
  alreadyOpen: (st: Step, a: AlbumState) =>
    `Album "${a.title}" is already open: ${albumLink(st.ctx, a.id)}. Send photos with "homi add" or reply to this message.`,
  status: (st: Step, a: AlbumState) =>
    a.photos.length
      ? `Album "${a.title}" has ${photoCount(a.photos.length)} from ${fromWhom(a)}: ${albumLink(st.ctx, a.id)}.`
      : `Album "${a.title}" has no photos yet: ${albumLink(st.ctx, a.id)}. Send photos with "homi add" or reply to this message.`,
  count: (a: AlbumState) => `${photoCount(a.photos.length)} in the album from ${fromWhom(a)}.`,
  noAlbum: () => `There's no album yet. Say "homi start an album" to open one for this group.`,
  addNeedsAlbum: () => `There's no album yet, so I didn't keep that photo. Say "homi start an album" first, then send it again.`,
  addHow: () => `Send the photo with "homi add" as its caption, or reply to the album message with it.`,
  badType: () => `I can only keep JPEG, PNG, WebP or HEIC photos, so I didn't keep that one.`,
  removedMine: (who: string | undefined, n: number, left: number) =>
    `Removed ${who ? `${who}'s` : 'your'} ${n === 1 ? 'photo' : `${n} photos`}; ${left ? `${left} left in the album` : 'the album is empty now'}.`,
  noneOfYours: () => `You don't have any photos in the album.`,
  removedOne: (n: number, left: number) => `Removed photo ${n}; ${left ? `${left} left in the album` : 'the album is empty now'}.`,
  noSuchPhoto: (n: number, total: number) => `There's no photo ${n}; the album has ${photoCount(total)}.`,
  notYours: (n: number, owner?: string) =>
    owner ? `Photo ${n} is ${owner}'s, so only ${owner} can remove it.` : `Photo ${n} isn't yours, so only the person who added it can remove it.`,
  deleted: (a: AlbumState) =>
    `Deleted the album "${a.title}" and ${a.photos.length ? `all ${photoCount(a.photos.length)}` : 'its link'} for the whole group (any member can do this).`,
  nothingToDelete: () => `There's no album to delete.`,
};

/** dump line: album "Ramen night · Fri Oct 23": 2 photos from Ana and Maya */
export function albumDumpLine(a: AlbumState): string {
  return a.photos.length ? `album "${a.title}": ${photoCount(a.photos.length)} from ${fromWhom(a)}` : `album "${a.title}": no photos yet`;
}
