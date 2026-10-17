// Shared album through applyEvent (docs/DEMO.md Act 4): start, explicit adds only, the count line, contributors
// remove their own photos, any member deletes the album, stop deletes everything, forget leaves the album.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent, countSentences, detectAddressed, newGroupState } from '../../src/engine/index.js';
import type { Action, EngineEvent, GroupState } from '../../src/engine/types.js';
import type { AlbumState } from '../../src/engine/ext/album/model.js';
import { CAPS } from '../../src/channels/types.js';
import { Harness, texts } from '../engine/helpers.js';
import { makePlan } from '../runner/helpers.js';

const START = '2026-10-23T20:30:00-04:00';
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function ramenNight(): Harness {
  const h = new Harness({ start: START });
  h.state.space.introSent = true;
  h.state.plan = makePlan('plan-1', {
    state: 'confirmed',
    eventAt: Date.parse('2026-10-23T19:00:00-04:00'),
    place: { name: 'Hokkaido Ramen Santouka', cuisine: 'ramen;japanese;noodle', address: '1 Bow Street, Cambridge', source: 'osm' },
  });
  return h;
}

let seq = 0;
function photo(h: Harness, who: string, caption?: string, over: Partial<Extract<EngineEvent, { kind: 'photo' }>> = {}): Action[] {
  const n = ++seq;
  return h.apply({
    kind: 'photo', from: { key: `k-${who}`, platformName: cap(who) }, msgRef: `photo-msg-${n}`, photoId: `ph${n}`, mime: 'image/png',
    ...(caption ? { caption } : {}), addressed: caption ? detectAddressed(caption) : false, ...over,
  });
}

const albumOf = (s: GroupState) => s.space.ext?.album as AlbumState | undefined;
const say = (h: Harness, who: string, text: string) => h.say(who, text, { platformName: cap(who) });
const ofType = <T extends Action['type']>(acts: Action[], t: T) => acts.filter((a): a is Extract<Action, { type: T }> => a.type === t);

test('DEMO Act 4: start, 4 adds, one count line, Jo removes their photos, dump line', () => {
  const h = ramenNight();
  const open = say(h, 'you', 'homi start an album for tonight');
  const a = albumOf(h.state)!;
  assert.equal(a.title, 'Ramen night · Fri Oct 23');
  assert.deepEqual(texts(open), [
    `Album "Ramen night · Fri Oct 23" is open to this group only: https://homi.example/a/${a.id} (demo link). Send photos with "homi add" or reply to this message; you can remove your own anytime with "homi remove my photos".`,
  ]);
  assert.equal((open[0] as Extract<Action, { type: 'send' }>).tag, 'album:open');
  assert.deepEqual(a.refs, [h.refs.get('album:open')], 'the album message ref is captured from the sent event');

  const adds = [photo(h, 'ana', 'homi add'), photo(h, 'jo', 'homi add'), photo(h, 'jo', 'homi add'), photo(h, 'maya', 'homi add')];
  assert.deepEqual(adds.map((acts) => ofType(acts, 'album_keep').length), [1, 1, 1, 1]);
  assert.deepEqual(adds.map((acts) => ofType(acts, 'react').length), [1, 1, 1, 1], '👍 on every add');
  assert.deepEqual(adds.map((acts) => texts(acts)), [[], [], [], ['4 photos in the album from Ana, Jo and Maya.']]);
  assert.ok(adds.every((acts) => ofType(acts, 'album_delete').length === 0));
  assert.deepEqual(ofType(adds[0], 'album_keep')[0], { type: 'album_keep', albumId: a.id, photoId: albumOf(h.state)!.photos[0].photoId });

  const rm = say(h, 'jo', 'homi remove my photos');
  assert.deepEqual(texts(rm), ["Removed Jo's 2 photos; 2 left in the album."]);
  assert.deepEqual(ofType(rm, 'album_delete')[0].photoIds.length, 2);
  assert.deepEqual(albumOf(h.state)!.photos.map((p) => p.name), ['Ana', 'Maya']);

  const dump = texts(say(h, 'jo', 'homi what do you know'))[0];
  assert.match(dump, /album "Ramen night · Fri Oct 23": 2 photos from Ana and Maya/);
  for (const m of h.groupMessages()) assert.ok(countSentences(m.text) <= 2, m.text);
});

test('photos are kept only when shared on purpose; everything else is deleted at once, silently', () => {
  const h = ramenNight();
  say(h, 'you', 'homi start an album');
  for (const [caption, addressed] of [[undefined, false], ['lol look at this', false], ['homi where should we eat', true]] as const) {
    const acts = photo(h, 'ben', caption, { addressed });
    assert.deepEqual(acts.map((x) => x.type), ['album_delete'], String(caption));
  }
  assert.equal(albumOf(h.state)!.photos.length, 0);
  // Mention-only and "homi save" captions count; the caption is stored without the address.
  assert.equal(ofType(photo(h, 'ana', '@homi'), 'album_keep').length, 1);
  assert.equal(ofType(photo(h, 'ana', 'homi add: the crew at Santouka!'), 'album_keep').length, 1);
  assert.equal(albumOf(h.state)!.photos[1].caption, 'the crew at Santouka');
  // An inline reply to the album message counts (once the runner passes replyTo on photo events).
  const reply = photo(h, 'maya', undefined, { replyTo: h.refs.get('album:open') } as never);
  assert.equal(ofType(reply, 'album_keep').length, 1);
  // Wrong type: deleted with a short note.
  const gif = photo(h, 'jo', 'homi add', { mime: 'image/gif' });
  assert.deepEqual(gif.map((x) => x.type), ['album_delete', 'send']);
});

test('without an album, "homi add" photos are deleted and Homi says how to start one', () => {
  const h = ramenNight();
  const acts = photo(h, 'ana', 'homi add');
  assert.deepEqual(ofType(acts, 'album_delete')[0].photoIds, [`ph${seq}`]);
  assert.match(texts(acts)[0], /no album yet/);
  assert.equal(albumOf(h.state), undefined);
  assert.equal(ofType(photo(h, 'ana'), 'album_delete').length, 1);
});

test('only contributors remove their own photos', () => {
  const h = ramenNight();
  say(h, 'you', 'homi start an album');
  photo(h, 'ana', 'homi add');
  photo(h, 'jo', 'homi add');
  const refused = say(h, 'ben', 'homi remove photo 1');
  assert.deepEqual(texts(refused), ["Photo 1 is Ana's, so only Ana can remove it."]);
  assert.equal(ofType(refused, 'album_delete').length, 0);
  assert.deepEqual(texts(say(h, 'ben', 'homi remove my photos')), ["You don't have any photos in the album."]);
  assert.match(texts(say(h, 'ana', 'homi remove photo 9'))[0], /no photo 9/);
  const ok = say(h, 'ana', 'homi remove photo 1');
  assert.deepEqual(texts(ok), ['Removed photo 1; 1 left in the album.']);
  assert.equal(ofType(ok, 'album_delete')[0].photoIds.length, 1);
  assert.deepEqual(albumOf(h.state)!.photos.map((p) => p.name), ['Jo']);
});

test('any member deletes the album; "homi album" shows the count and link', () => {
  const h = ramenNight();
  say(h, 'you', 'homi start an album');
  const id = albumOf(h.state)!.id;
  photo(h, 'ana', 'homi add');
  photo(h, 'jo', 'homi add');
  const status = say(h, 'sam', 'homi album');
  assert.deepEqual(texts(status), [`Album "Ramen night · Fri Oct 23" has 2 photos from Ana and Jo: https://homi.example/a/${id} (demo link).`]);
  const del = say(h, 'ben', 'homi delete album');
  assert.equal(ofType(del, 'album_delete')[0].photoIds.length, 2);
  assert.match(texts(del)[0], /^Deleted the album "Ramen night · Fri Oct 23" and all 2 photos for the whole group \(any member can do this\)\.$/);
  assert.equal(albumOf(h.state), undefined);
  assert.match(texts(say(h, 'ben', 'homi album'))[0], /no album yet/);
  assert.equal(texts(say(h, 'ben', 'homi delete album'))[0], "There's no album to delete.");
});

test('"homi stop" deletes every photo; "homi forget" keeps the album', () => {
  const h = ramenNight();
  say(h, 'you', 'homi start an album');
  photo(h, 'ana', 'homi add');
  photo(h, 'maya', 'homi add');
  say(h, 'ana', 'homi forget');
  assert.equal(h.plan, null);
  assert.equal(albumOf(h.state)!.photos.length, 2, 'the album outlives the plan (DEMO step 26)');
  const stop = say(h, 'ana', 'homi stop');
  assert.equal(ofType(stop, 'album_delete')[0].photoIds.length, 2);
  assert.equal(albumOf(h.state), undefined);
});

test('title fallback without a plan, real links without the demo label, count line on every add without reactions', () => {
  const st0 = newGroupState('space-x');
  st0.space.introSent = true;
  const ctx = { now: Date.parse('2026-10-17T10:00:00-04:00'), caps: { ...CAPS.sim, reactionsOut: false }, retentionHours: 24, quietHours: [23, 9] as [number, number], newId: () => 'album-abc', publicBaseUrl: 'https://wtw.example.com/' };
  const r = applyEvent(st0, { kind: 'message', from: { key: 'k-ana' }, text: 'homi start an album', msgRef: 'm1', addressed: true }, ctx);
  assert.equal(albumOf(r.state)!.title, 'Our album · Sat Oct 17');
  assert.match(texts(r.actions)[0], /: https:\/\/wtw\.example\.com\/a\/album-abc\. Send photos/);
  const p = applyEvent(r.state, { kind: 'photo', from: { key: 'k-ana', platformName: 'Ana' }, msgRef: 'm2', photoId: 'p1', mime: 'image/jpeg', caption: 'homi add', addressed: true }, ctx);
  assert.deepEqual(p.actions.map((a) => a.type), ['album_keep', 'send']);
  assert.deepEqual(texts(p.actions), ['1 photo in the album from Ana.']);
});
