import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DateTime } from 'luxon';
import type { PlacesQuery } from '../../src/engine/types.js';
import { searchOffline, MAX_CANDIDATES } from '../../src/places/fallback.js';
import { geocode, haversineMeters, walkMinutes } from '../../src/places/geo.js';
import { openAt, wallClockDate } from '../../src/places/hours.js';
import type { Dataset, DatasetPlace } from '../../src/places/types.js';

const ny = (iso: string) => DateTime.fromISO(iso, { zone: 'America/New_York' }).toMillis();
const FRI_7PM = ny('2026-10-16T19:00'); // Friday
const FRI_1PM = ny('2026-10-16T13:00');

const HSQ = geocode('Harvard Square')!;
const M_PER_DEG_LAT = 111_195;
const north = (m: number) => ({ lat: Number((HSQ.lat + m / M_PER_DEG_LAT).toFixed(7)), lon: HSQ.lon });

function place(name: string, m: number, extra: Partial<DatasetPlace> = {}): DatasetPlace {
  return {
    osmId: `node/${Math.abs(hash(name))}`,
    name,
    amenity: 'restaurant',
    cuisine: [],
    diet: [],
    ...north(m),
    priceBand: 2,
    priceEstimated: true,
    area: 'harvard-square',
    ...extra,
  };
}
function hash(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return h || 1;
}

const LATE = 'Mo-Su 11:00-22:00';
const fixture: Dataset = {
  header: {} as Dataset['header'],
  places: [
    place('Thai Near', 200, { cuisine: ['thai'], hours: LATE }),
    place('Thai Lunch Only', 100, { cuisine: ['thai'], hours: 'Mo-Su 11:00-15:00' }),
    place('Thai Pricey', 150, { cuisine: ['thai'], hours: LATE, priceBand: 3 }),
    place('Taco Spot', 300, { cuisine: ['mexican'] }), // hours unknown
    place('Far Thai', 2000, { cuisine: ['thai'], hours: LATE }),
    place('Veg Thai', 400, { cuisine: ['thai'], diet: ['vegetarian', 'vegan'], hours: LATE }),
    place('Meaty Thai', 250, { cuisine: ['thai'], dietNo: ['vegetarian'], hours: LATE }),
    place('Coffee Bar', 50, { cuisine: ['coffee_shop'], amenity: 'cafe', priceBand: 1, hours: LATE }),
    place('Pizza Place', 500, { cuisine: ['pizza'], hours: 'Mo-Su 11:00-23:00' }),
    place('Ramen House', 350, { cuisine: ['ramen', 'japanese', 'noodle'], hours: LATE }),
  ],
};

const q = (over: Partial<PlacesQuery>): PlacesQuery => ({ cuisines: [], diet: [], near: 'Harvard Square', at: FRI_7PM, ...over });
const names = (r: { name: string }[]) => r.map((x) => x.name);

test('cuisine match first, then distance; ids, source, walk minutes', () => {
  const r = searchOffline(q({ cuisines: ['thai'] }), HSQ, { dataset: fixture });
  const thai = r.filter((x) => x.matchedCuisines.includes('thai'));
  assert.deepEqual(names(thai), ['Thai Pricey', 'Thai Near', 'Meaty Thai', 'Veg Thai']);
  assert.deepEqual(names(r.slice(0, thai.length)), names(thai), 'matches come first');
  assert.ok(!names(r).includes('Far Thai'), 'outside 1.2 km');
  r.forEach((x, i) => {
    assert.equal(x.id, i + 1);
    assert.equal(x.source, 'osm');
    assert.equal(x.priceEstimated, true);
    assert.equal(x.walkMinutes, walkMinutes(haversineMeters(HSQ, { lat: x.lat!, lon: x.lon! })));
    assert.match(x.mapsUrl!, /^https:\/\/maps\.apple\.com\/\?q=/);
  });
  assert.match(thai[0].why!, /matches thai/);
  // backups (non-matching) come after; with >= 3 meal places nearby, cafés are left out entirely
  const rest = names(r.slice(thai.length));
  assert.ok(rest.includes('Taco Spot'));
  assert.ok(!rest.includes('Coffee Bar'), 'a coffee shop is never a dinner backup when meals exist');
  assert.match(r.find((x) => x.name === 'Taco Spot')!.why!, /backup: not thai/);
});

test('known-closed at plan time is excluded; unknown hours kept as null', () => {
  const evening = searchOffline(q({ cuisines: ['thai'] }), HSQ, { dataset: fixture });
  assert.ok(!names(evening).includes('Thai Lunch Only'));
  assert.equal(evening.find((x) => x.name === 'Taco Spot')!.openAtPlanTime, null);
  assert.match(evening.find((x) => x.name === 'Taco Spot')!.why!, /hours unknown/);
  assert.equal(evening.find((x) => x.name === 'Thai Near')!.openAtPlanTime, true);

  const lunch = searchOffline(q({ cuisines: ['thai'], at: FRI_1PM }), HSQ, { dataset: fixture });
  assert.equal(lunch[0].name, 'Thai Lunch Only');
  assert.equal(lunch[0].openAtPlanTime, true);
});

test('price filter treats estimated bands softly (one band of slack; the engine ranks over-budget lower)', () => {
  const mid = searchOffline(q({ cuisines: ['thai'], priceMax: 2 }), HSQ, { dataset: fixture });
  assert.ok(names(mid).includes('Thai Pricey'), '$$$ (est.) is within one band of $$');
  const cheap = searchOffline(q({ cuisines: ['thai'], priceMax: 1 }), HSQ, { dataset: fixture });
  assert.ok(!names(cheap).includes('Thai Pricey'), '$$$ (est.) is two bands above $');
  assert.ok(names(cheap).includes('Thai Near'), '$$ (est.) stays for "cheap" so a dinner never collapses to cafés');
  assert.ok(!names(cheap).includes('Coffee Bar'));
});

test('diet: hard where the data has the tag, soft "check:" otherwise', () => {
  const veg = searchOffline(q({ cuisines: ['thai'], diet: ['vegetarian'] }), HSQ, { dataset: fixture });
  assert.ok(!names(veg).includes('Meaty Thai'), 'diet:vegetarian=no is excluded');
  const v = veg.find((x) => x.name === 'Veg Thai')!;
  assert.deepEqual(v.dietCheck, []);
  assert.deepEqual(v.diet, ['vegetarian', 'vegan']);
  const n = veg.find((x) => x.name === 'Thai Near')!;
  assert.deepEqual(n.dietCheck, ['vegetarian']);
  assert.match(n.why!, /check: vegetarian/);

  const nut = searchOffline(q({ cuisines: ['thai'], diet: ['nut allergy'] }), HSQ, { dataset: fixture });
  assert.ok(nut.length >= 4);
  for (const x of nut) assert.deepEqual(x.dietCheck, ['nut_allergy']);
  assert.match(nut[0].why!, /check: nut allergy/);
});

test('no cuisine match -> nearby general picks, meals before cafés, marked in why', () => {
  const r = searchOffline(q({ cuisines: ['ethiopian'] }), HSQ, { dataset: fixture });
  assert.ok(r.length > 0);
  assert.ok(r.every((x) => x.matchedCuisines.length === 0));
  assert.match(r[0].why!, /no ethiopian nearby, general pick/);
  assert.ok(!names(r).includes('Coffee Bar'), 'meal places only when at least 3 exist');
});

test('synonyms and broad tags match specific places', () => {
  const r = searchOffline(q({ cuisines: ['japanese', 'noodles'] }), HSQ, { dataset: fixture });
  assert.equal(r[0].name, 'Ramen House');
  assert.deepEqual(r[0].matchedCuisines, ['japanese', 'noodle']);
  assert.match(r[0].cuisine!, /^japanese;noodle;ramen/);
});

test('midpoints search a 1.6 km radius', () => {
  const mid = { ...HSQ, midpoint: true };
  const r = searchOffline(q({ cuisines: ['thai'] }), mid, { dataset: fixture });
  assert.ok(!names(r).includes('Far Thai')); // 2 km
  const wide = searchOffline(q({ cuisines: ['thai'] }), mid, {
    dataset: { ...fixture, places: [...fixture.places, place('Edge Thai', 1500, { cuisine: ['thai'], hours: LATE })] },
  });
  assert.ok(names(wide).includes('Edge Thai'));
  const single = searchOffline(q({ cuisines: ['thai'] }), HSQ, {
    dataset: { ...fixture, places: [...fixture.places, place('Edge Thai', 1500, { cuisine: ['thai'], hours: LATE })] },
  });
  assert.ok(!names(single).includes('Edge Thai'));
});

test('real snapshot: Allston korean, capped at 30, split groups keep the runner-up', () => {
  const allston = geocode('allston')!;
  const r = searchOffline(q({ cuisines: ['korean'], near: 'allston' }), allston, {});
  assert.ok(r.length >= 3 && r.length <= MAX_CANDIDATES);
  assert.ok(r[0].matchedCuisines.includes('korean'));
  const split = searchOffline(q({ cuisines: ['coffee_shop', 'chinese', 'korean', 'pizza'], near: 'allston' }), allston, {});
  assert.equal(split.length, MAX_CANDIDATES);
  for (const c of ['coffee_shop', 'chinese', 'korean', 'pizza']) {
    assert.ok(split.some((x) => x.matchedCuisines.includes(c)), `${c} represented`);
  }
  assert.ok(split.every((x) => x.openAtPlanTime !== false));
});

test('wallClockDate: local fields equal New York wall clock', () => {
  const d = wallClockDate(ny('2026-10-16T19:05'));
  assert.deepEqual([d.getDay(), d.getHours(), d.getMinutes()], [5, 19, 5]);
  assert.equal(openAt('Mo-Fr 11:00-14:00', ny('2026-10-16T12:00')), true);
  assert.equal(openAt('Mo-Fr 11:00-14:00', ny('2026-10-16T20:00')), false);
  assert.equal(openAt(undefined, FRI_7PM), null);
  assert.equal(openAt('not hours at all', FRI_7PM), null);
  assert.equal(openAt('Mo-Su 11:00-22:00; PH off', ny('2026-11-26T12:00')), false, 'Thanksgiving (US PH)');
});

test('opening hours give the same answer whatever the server TZ', () => {
  const probe = fileURLToPath(new URL('./fixtures/tz-probe.ts', import.meta.url));
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const run = (tz: string | null) => {
    const env = { ...process.env };
    if (tz === null) delete env.TZ;
    else env.TZ = tz;
    const res = spawnSync(process.execPath, ['--import', 'tsx', probe], { cwd: root, env, encoding: 'utf8', timeout: 60_000 });
    assert.equal(res.status, 0, res.stderr);
    return JSON.parse(res.stdout) as { correct: (boolean | null)[]; naive: boolean[]; wall: number[] };
  };
  const expected = [true, false, false, true, true];
  const unset = run(null);
  assert.deepEqual(unset.correct, expected);
  assert.deepEqual(unset.wall, [5, 19, 5]);
  for (const tz of ['Asia/Tokyo', 'UTC', 'America/Los_Angeles']) {
    const r = run(tz);
    assert.deepEqual(r.correct, expected, tz);
    assert.deepEqual(r.wall, [5, 19, 5], tz);
  }
  // The probe is sensitive: passing a raw Date (the bug we avoid) is wrong in Tokyo.
  assert.notDeepEqual(run('Asia/Tokyo').naive, expected);
});
