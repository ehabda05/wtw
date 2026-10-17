import { test } from 'node:test';
import assert from 'node:assert/strict';
import { geocode, haversineMeters, walkMinutes, mapsUrl, NEIGHBORHOODS, knownNeighborhoods } from '../../src/places/geo.js';

const idOf = (s: string) => geocode(s)?.ids.join('+') ?? null;

test('gazetteer has ~20 entries with sources and Boston-area coordinates', () => {
  assert.ok(NEIGHBORHOODS.length >= 20);
  const ids = new Set(NEIGHBORHOODS.map((n) => n.id));
  assert.equal(ids.size, NEIGHBORHOODS.length);
  for (const n of NEIGHBORHOODS) {
    assert.ok(n.source.length > 10, `${n.id} needs a source`);
    assert.ok(n.lat > 42.28 && n.lat < 42.42 && n.lon > -71.2 && n.lon < -71.0, `${n.id} outside Boston area`);
  }
  assert.ok(knownNeighborhoods().includes('Harvard Sq'));
});

test('centroids agree with the OSM extracts used for the snapshot', () => {
  const h = geocode('Harvard Square')!;
  const a = geocode('Allston')!;
  // research/places-api.md §3 query centers
  assert.ok(haversineMeters(h, { lat: 42.3732, lon: -71.1189 }) < 100);
  assert.ok(haversineMeters(a, { lat: 42.3529, lon: -71.1321 }) < 100);
});

test('aliases and normalization', () => {
  const cases: [string, string][] = [
    ['Harvard Square', 'harvard-square'],
    ['harvard sq', 'harvard-square'],
    ['HSQ', 'harvard-square'],
    ['the square', 'harvard-square'],
    ['near Harvard Square', 'harvard-square'],
    ['around harvard sq please', 'harvard-square'],
    ['Cambridge', 'harvard-square'],
    ['allston village', 'allston'],
    ['Allston', 'allston'],
    ['Harvard Ave & Brighton Ave', 'allston'],
    ['harvard avenue', 'allston'],
    ['central', 'central-square'],
    ['Central Sq.', 'central-square'],
    ['kendall', 'kendall-square'],
    ['Inman, Cambridge', 'inman-square'],
    ['near Porter', 'porter-square'],
    ['davis', 'davis-square'],
    ['Union Square', 'union-square-somerville'],
    ['Brighton Center', 'brighton-center'],
    ['coolidge corner', 'coolidge-corner'],
    ['Kenmore', 'fenway-kenmore'],
    ['fenway', 'fenway-kenmore'],
    ['copley', 'back-bay'],
    ['South End', 'south-end'],
    ['beacon hill', 'beacon-hill'],
    ['Downtown Crossing', 'downtown-crossing'],
    ['Boston', 'downtown-crossing'],
    ['chinatown', 'chinatown'],
    ['North End', 'north-end'],
    ['seaport', 'seaport'],
    ['JP', 'jamaica-plain'],
    ['jamaica plain', 'jamaica-plain'],
    ['MIT', 'mit'],
    ['bu', 'boston-university'],
    ['Boston University', 'boston-university'],
    // typos
    ['harvrd sq', 'harvard-square'],
    ['allstn', 'allston'],
    ['kendal square', 'kendall-square'],
    ['Porter Sqaure', 'porter-square'],
  ];
  for (const [input, id] of cases) assert.equal(idOf(input), id, input);
});

test('unknown or vague places return null (Homi asks, never calls out)', () => {
  for (const s of ['near me', 'here', 'my place', '', '   ', 'Paris', 'but', 'idk']) assert.equal(geocode(s), null, s);
  assert.equal(geocode(undefined), null);
});

test('"A + B" resolves to a labeled midpoint', () => {
  const h = geocode('Harvard Square')!;
  const a = geocode('Allston')!;
  for (const s of ['Harvard Square + Allston', 'harvard sq and allston', 'between Harvard and Allston', 'halfway between hsq & allston']) {
    const m = geocode(s);
    assert.ok(m, s);
    assert.equal(m.midpoint, true, s);
    assert.equal(m.label, 'halfway between Harvard Sq and Allston', s);
    assert.deepEqual(m.ids, ['harvard-square', 'allston']);
    assert.ok(Math.abs(m.lat - (h.lat + a.lat) / 2) < 1e-6);
    assert.ok(Math.abs(m.lon - (h.lon + a.lon) / 2) < 1e-6);
  }
  // same place twice is not a midpoint; the Allston intersection alias is one place
  assert.equal(geocode('allston and allston village')?.midpoint, false);
  assert.equal(geocode('Harvard Ave & Brighton Ave')?.midpoint, false);
  assert.equal(geocode('central + kendall')?.label, 'halfway between Central Sq and Kendall Sq');
});

test('haversine distance', () => {
  assert.ok(Math.abs(haversineMeters({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }) - 111_195) < 5);
  assert.equal(haversineMeters({ lat: 42.37, lon: -71.12 }, { lat: 42.37, lon: -71.12 }), 0);
  const d = haversineMeters(geocode('harvard sq')!, geocode('allston')!);
  assert.ok(d > 2200 && d < 2600, `Harvard Sq to Allston ${d} m`);
});

test('walkMinutes = ceil(m × 1.3 ÷ 78)', () => {
  assert.equal(walkMinutes(0), 0);
  assert.equal(walkMinutes(60), 1); // 78 / 78
  assert.equal(walkMinutes(61), 2);
  assert.equal(walkMinutes(600), 10); // 780 / 78 exactly
  assert.equal(walkMinutes(601), 11);
  assert.equal(walkMinutes(1200), 20);
  for (const m of [17, 333, 999, 1500]) assert.equal(walkMinutes(m), Math.ceil((m * 1.3) / 78));
});

test('mapsUrl carries only the restaurant name and coordinates', () => {
  const u = new URL(mapsUrl({ name: 'Tasty Thai & Noodle', lat: 42.3734734, lon: -71.1189431 }));
  assert.equal(u.origin, 'https://maps.apple.com');
  assert.deepEqual([...u.searchParams.keys()].sort(), ['ll', 'q']);
  assert.equal(u.searchParams.get('q'), 'Tasty Thai & Noodle');
  assert.equal(u.searchParams.get('ll'), '42.373473,-71.118943');
});
