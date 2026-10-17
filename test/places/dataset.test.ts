// Sanity checks on the generated snapshot (scripts/build-places.ts -> src/places/data/harvard-allston.json).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadDataset } from '../../src/places/fallback.js';
import { isValidHours } from '../../src/places/hours.js';
import { normalizeCuisines, normalizeDiet } from '../../src/places/cuisine.js';
import { estimatePriceBand } from '../../src/places/price.js';
import { OSM_ATTRIBUTION } from '../../src/places/types.js';

const data = loadDataset();

test('header carries ODbL attribution and estimate note', () => {
  assert.equal(data.header.attribution, '© OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright)');
  assert.equal(data.header.attribution, OSM_ATTRIBUTION);
  assert.equal(data.header.license, 'ODbL-1.0');
  assert.match(data.header.note, /estimate/i);
  assert.ok(!Number.isNaN(Date.parse(data.header.builtAt)));
  assert.deepEqual(
    data.header.sources.map((s) => s.file),
    ['research/data/osm-harvard-square.json', 'research/data/osm-allston.json'],
  );
});

test('counts are plausible and consistent', () => {
  const c = data.header.counts;
  assert.equal(c.places, data.places.length);
  assert.ok(data.places.length >= 200, `only ${data.places.length} places`);
  assert.ok(c.byArea['harvard-square'] >= 80);
  assert.ok(c.byArea['allston'] >= 130);
  assert.equal(c.byArea['harvard-square'] + c.byArea['allston'], data.places.length);
  assert.equal(c.withCuisine, data.places.filter((p) => p.cuisine.length).length);
  assert.equal(c.withHours, data.places.filter((p) => p.hours).length);
  assert.ok(c.withCuisine / c.places > 0.7, 'cuisine coverage should match research (~75-89%)');
  assert.ok(c.withHours / c.places > 0.4, 'hours coverage should match research (~43-70%)');
  assert.equal(c.unnamedSkipped, 3);
});

test('no unnamed places, unique ids, sane coordinates', () => {
  const ids = new Set<string>();
  for (const p of data.places) {
    assert.ok(p.name && p.name.trim() === p.name && p.name.length > 0, `bad name for ${p.osmId}`);
    assert.match(p.osmId, /^(node|way|relation)\/\d+$/);
    assert.ok(!ids.has(p.osmId), `duplicate ${p.osmId}`);
    ids.add(p.osmId);
    assert.ok(p.lat > 42.33 && p.lat < 42.39 && p.lon > -71.16 && p.lon < -71.09, `${p.name} out of area`);
    assert.ok(['restaurant', 'fast_food', 'cafe'].includes(p.amenity));
    assert.ok(['harvard-square', 'allston'].includes(p.area));
  }
});

test('prices are estimates only, tags normalized, hours all parse', () => {
  for (const p of data.places) {
    assert.equal(p.priceEstimated, true);
    assert.ok([1, 2, 3].includes(p.priceBand));
    for (const c of p.cuisine) assert.match(c, /^[a-z][a-z0-9_]*$/, `${p.name}: cuisine ${c}`);
    for (const d of p.diet) assert.ok(['vegetarian', 'vegan', 'halal', 'kosher', 'gluten_free', 'lactose_free'].includes(d));
    if (p.hours) assert.ok(isValidHours(p.hours), `${p.name}: ${p.hours}`);
    // nothing that looks like third-party (Google/Yelp) data
    for (const k of Object.keys(p)) assert.ok(!/rating|review|priceLevel|yelp|google/i.test(k), k);
  }
  // fast food / cafés estimated cheap
  for (const p of data.places.filter((x) => x.amenity !== 'restaurant')) assert.equal(p.priceBand, 1, p.name);
});

test('no duplicate name within 60 m (dedupe by name + proximity)', () => {
  const key = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  for (let i = 0; i < data.places.length; i++) {
    for (let j = i + 1; j < data.places.length; j++) {
      const a = data.places[i];
      const b = data.places[j];
      if (key(a.name) !== key(b.name)) continue;
      const dLat = (a.lat - b.lat) * 111_195;
      const dLon = (a.lon - b.lon) * 111_195 * Math.cos((a.lat * Math.PI) / 180);
      assert.ok(Math.hypot(dLat, dLon) > 60, `${a.name} duplicated`);
    }
  }
});

test('cuisine / diet / price normalization rules', () => {
  assert.deepEqual(normalizeCuisines('sandwich;coffee_shop'), ['sandwich', 'coffee_shop']);
  assert.deepEqual(normalizeCuisines('Ramen'), ['ramen', 'japanese', 'noodle']);
  assert.deepEqual(normalizeCuisines('dumplings; barbecue'), ['dumpling', 'bbq']);
  assert.deepEqual(normalizeCuisines('tex-mex'), ['mexican']);
  assert.deepEqual(normalizeCuisines('açaí'), ['acai']);
  assert.deepEqual(normalizeCuisines('regional'), []);
  assert.deepEqual(normalizeCuisines('szechuan'), ['sichuan', 'chinese']);
  assert.equal(normalizeDiet('gluten-free'), 'gluten_free');
  assert.equal(normalizeDiet('dairy free'), 'lactose_free');
  assert.equal(estimatePriceBand('fast_food', ['burger']), 1);
  assert.equal(estimatePriceBand('cafe', []), 1);
  assert.equal(estimatePriceBand('restaurant', ['bubble_tea']), 1);
  assert.equal(estimatePriceBand('restaurant', ['thai']), 2);
  assert.equal(estimatePriceBand('restaurant', ['steak_house']), 3);
  assert.equal(estimatePriceBand('restaurant', ['french']), 3);
});
