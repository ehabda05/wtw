// Addressed album commands: start, show, remove my photos, remove photo N, delete album. Pure.
// Contributors control their own photos; deleting the whole album is open to any member (and says so).

import type { MessageEvent } from '../../types.js';
import { type Step, say } from '../../plan/core.js';
import { normText } from '../../util.js';
import { ALBUM_COPY as C, albumTitle } from './copy.js';
import { type AlbumState, albumOf, nameFor, setAlbum } from './model.js';

export type AlbumCommand =
  | { kind: 'start' }
  | { kind: 'show' }
  | { kind: 'add_hint' }
  | { kind: 'remove_mine' }
  | { kind: 'remove_one'; n: number }
  | { kind: 'delete' };

const PICS = '(?:photos?|pics?|pictures?)';
const START = /^(?:let'?s\s+|can you\s+|please\s+)?(?:start|open|make|create|begin|set up)\s+(?:an?\s+|the\s+|our\s+)?(?:new\s+)?(?:shared\s+|photo\s+)?album\b/;
const SHOW = new RegExp(`^(?:show(?: me| us)?\\s+)?(?:the\\s+|our\\s+)?(?:photo\\s+)?album(?:\\s+link)?\\??$|^(?:where(?:'s| is)|link to)\\s+(?:the\\s+|our\\s+)?album\\??$|^how many ${PICS}\\??$`);
const ADD = new RegExp(`^add(?:\\s+(?:this|these|that|my\\s+${PICS}|${PICS}|to\\s+(?:the\\s+)?album))?$`);
const REMOVE_MINE = new RegExp(`^(?:please\\s+)?(?:remove|delete|take down)\\s+(?:all\\s+)?my\\s+${PICS}(?:\\s+from\\s+the\\s+album)?$`);
const REMOVE_ONE = new RegExp(`^(?:please\\s+)?(?:remove|delete|take down)\\s+${PICS}\\s*#?(\\d{1,4})$`);
const DELETE = /^(?:please\s+)?(?:delete|remove|close|clear)\s+(?:the\s+|our\s+)?(?:whole\s+)?(?:photo\s+)?album$/;

export function parseAlbumCommand(body: string): AlbumCommand | null {
  const t = normText(body).replace(/[.!]+$/, '').trim();
  if (START.test(t)) return { kind: 'start' };
  if (DELETE.test(t)) return { kind: 'delete' };
  if (REMOVE_MINE.test(t)) return { kind: 'remove_mine' };
  const one = REMOVE_ONE.exec(t);
  if (one) return { kind: 'remove_one', n: Number(one[1]) };
  if (SHOW.test(t)) return { kind: 'show' };
  if (ADD.test(t)) return { kind: 'add_hint' };
  return null;
}

function start(st: Step, ev: MessageEvent): void {
  const open = albumOf(st.s);
  if (open) return say(st, C.alreadyOpen(st, open), 'prompted', 'album:open');
  const a: AlbumState = { id: st.ctx.newId(), title: albumTitle(st), createdAt: st.ctx.now, createdBy: ev.from.key, refs: [], photos: [] };
  setAlbum(st, a);
  say(st, C.opened(st, a), 'prompted', 'album:open');
}

function removeMine(st: Step, a: AlbumState, ev: MessageEvent): void {
  const mine = a.photos.filter((p) => p.by === ev.from.key);
  if (!mine.length) return say(st, C.noneOfYours());
  a.photos = a.photos.filter((p) => p.by !== ev.from.key);
  st.acts.push({ type: 'album_delete', photoIds: mine.map((p) => p.photoId) });
  const who = mine.find((p) => p.name)?.name ?? nameFor(st.s, ev.from.key, ev.from.platformName);
  say(st, C.removedMine(who, mine.length, a.photos.length));
}

function removeOne(st: Step, a: AlbumState, ev: MessageEvent, n: number): void {
  const ph = a.photos[n - 1];
  if (!ph) return say(st, C.noSuchPhoto(n, a.photos.length));
  if (ph.by !== ev.from.key) return say(st, C.notYours(n, ph.name));
  a.photos.splice(n - 1, 1);
  st.acts.push({ type: 'album_delete', photoIds: [ph.photoId] });
  say(st, C.removedOne(n, a.photos.length));
}

function deleteAlbum(st: Step, a: AlbumState): void {
  if (a.photos.length) st.acts.push({ type: 'album_delete', photoIds: a.photos.map((p) => p.photoId) });
  setAlbum(st, undefined);
  say(st, C.deleted(a));
}

/** Runs an addressed album command. Returns false when the text is not an album command. */
export function onAlbumCommand(st: Step, ev: MessageEvent, body: string): boolean {
  const cmd = parseAlbumCommand(body);
  if (!cmd) return false;
  if (cmd.kind === 'start') {
    start(st, ev);
    return true;
  }
  const a = albumOf(st.s);
  if (!a) {
    say(st, cmd.kind === 'delete' ? C.nothingToDelete() : C.noAlbum());
    return true;
  }
  switch (cmd.kind) {
    case 'show': say(st, C.status(st, a), 'prompted', 'album:open'); break;
    case 'add_hint': say(st, C.addHow()); break;
    case 'remove_mine': removeMine(st, a, ev); break;
    case 'remove_one': removeOne(st, a, ev, cmd.n); break;
    case 'delete': deleteAlbum(st, a); break;
  }
  return true;
}
