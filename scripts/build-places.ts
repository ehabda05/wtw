// Build the bundled offline places snapshot from the raw Overpass extracts.
//
//   node --import tsx scripts/build-places.ts
//
// In:  research/data/osm-harvard-square.json, research/data/osm-allston.json
//      (raw Overpass results, ODbL; query and coverage in research/places-api.md §3)
// Out: src/places/data/harvard-allston.json
//
// No network. Pure transform: name, normalized cuisine/diet tags, coordinates (node, or way
// center), short address, validated opening_hours, and an ESTIMATED price band from amenity and
// cuisine pattern only (research/places-api.md §5c). Unnamed places are skipped; duplicates
// (same normalized name within 60 m) are merged. The output stays under ODbL with attribution
// in its header (research/places-api.md §4).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeCuisines, normalizeDiet, OSM_DIET_TAGS } from '../src/places/cuisine.js';
import { estimatePriceBand, PRICE_RULES_NOTE } from '../src/places/price.js';
import { isValidHours } from '../src/places/hours.js';
import { haversineMeters } from '../src/places/geo.js';
import { OSM_ATTRIBUTION, type Dataset, type DatasetPlace, type DatasetSource } from '../src/places/types.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'src/places/data/harvard-allston.json');

/** Query parameters as run on 2026-10-16 (research/places-api.md §3). */
const SOURCES = [
  { file: 'research/data/osm-harvard-square.json', area: 'harvard-square', center: { lat: 42.3732, lon: -71.1189 } },
  { file: 'research/data/osm-allston.json', area: 'allston', center: { lat: 42.3529, lon: -71.1321 } },
] as const;
const RADIUS_M = 900;
const AMENITIES = ['restaurant', 'fast_food', 'cafe'];
const DEDUPE_METERS = 60;

interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}
interface OsmFile {
  osm3s?: { timestamp_osm_base?: string; copyright?: string };
  elements: OsmElement[];
}

const stats = { unnamedSkipped: 0, duplicatesMerged: 0, invalidHoursDropped: 0 };

function normName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^the /, '')
    .trim();
}

function address(t: Record<string, string>): string | undefined {
  const street = t['addr:street']?.trim();
  if (!street) return undefined;
  const num = t['addr:housenumber']?.trim();
  const city = t['addr:city']?.trim();
  return [num ? `${num} ${street}` : street, city].filter(Boolean).join(', ');
}

function diets(t: Record<string, string>, cuisines: string[]): { yes: string[]; no: string[] } {
  const yes = new Set<string>();
  const no = new Set<string>();
  for (const [k, v] of Object.entries(t)) {
    if (!k.startsWith('diet:')) continue;
    const d = normalizeDiet(k.slice(5));
    if (!(OSM_DIET_TAGS as readonly string[]).includes(d)) continue;
    const val = v.trim().toLowerCase();
    if (val === 'yes' || val === 'only') yes.add(d);
    else if (val === 'no') no.add(d);
  }
  // A place whose cuisine IS vegan/vegetarian serves that diet.
  if (cuisines.includes('vegan')) yes.add('vegan');
  if (cuisines.includes('vegetarian')) yes.add('vegetarian');
  // Vegan dishes are vegetarian dishes.
  if (yes.has('vegan')) yes.add('vegetarian');
  for (const d of yes) no.delete(d);
  const order = (a: string, b: string) =>
    (OSM_DIET_TAGS as readonly string[]).indexOf(a) - (OSM_DIET_TAGS as readonly string[]).indexOf(b);
  return { yes: [...yes].sort(order), no: [...no].sort(order) };
}

function toPlace(e: OsmElement, area: string): DatasetPlace | null {
  const t = e.tags ?? {};
  const name = t.name?.trim();
  if (!name) {
    stats.unnamedSkipped++;
    return null;
  }
  const lat = e.lat ?? e.center?.lat;
  const lon = e.lon ?? e.center?.lon;
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  const cuisine = normalizeCuisines(t.cuisine);
  const { yes, no } = diets(t, cuisine);
  let hours: string | undefined = t.opening_hours?.trim() || undefined;
  if (hours && !isValidHours(hours)) {
    stats.invalidHoursDropped++;
    hours = undefined;
  }
  const amenity = t.amenity ?? 'restaurant';
  const p: DatasetPlace = {
    osmId: `${e.type}/${e.id}`,
    name,
    amenity,
    cuisine,
    diet: yes,
    ...(no.length ? { dietNo: no } : {}),
    lat: Number(lat.toFixed(7)),
    lon: Number(lon.toFixed(7)),
    ...(address(t) ? { address: address(t) } : {}),
    ...(hours ? { hours } : {}),
    priceBand: estimatePriceBand(amenity, cuisine),
    priceEstimated: true,
    area,
  };
  return p;
}

/** Richer record wins; gaps are filled from the other one. */
function merge(a: DatasetPlace, b: DatasetPlace): DatasetPlace {
  const score = (p: DatasetPlace) => (p.hours ? 4 : 0) + (p.cuisine.length ? 2 : 0) + (p.address ? 1 : 0) + p.diet.length;
  const [keep, other] = score(b) > score(a) ? [b, a] : [a, b];
  const merged: DatasetPlace = { ...keep };
  if (!merged.hours && other.hours) merged.hours = other.hours;
  if (!merged.address && other.address) merged.address = other.address;
  if (merged.cuisine.length === 0 && other.cuisine.length) {
    merged.cuisine = other.cuisine;
    merged.priceBand = estimatePriceBand(merged.amenity, merged.cuisine);
  }
  for (const d of other.diet) if (!merged.diet.includes(d)) merged.diet.push(d);
  return merged;
}

function build(): Dataset {
  const places: DatasetPlace[] = [];
  const seenIds = new Set<string>();
  const sources: DatasetSource[] = [];

  for (const src of SOURCES) {
    const raw = JSON.parse(readFileSync(resolve(ROOT, src.file), 'utf8')) as OsmFile;
    sources.push({
      file: src.file,
      area: src.area,
      query: { center: src.center, radiusM: RADIUS_M, amenities: AMENITIES },
      osmTimestamp: raw.osm3s?.timestamp_osm_base ?? 'unknown',
      elements: raw.elements.length,
    });
    for (const e of raw.elements) {
      const p = toPlace(e, src.area);
      if (!p) continue;
      if (seenIds.has(p.osmId)) {
        stats.duplicatesMerged++;
        continue;
      }
      seenIds.add(p.osmId);
      const key = normName(p.name);
      const dupIdx = places.findIndex((q) => normName(q.name) === key && haversineMeters(q, p) <= DEDUPE_METERS);
      if (dupIdx >= 0) {
        places[dupIdx] = merge(places[dupIdx], p);
        stats.duplicatesMerged++;
        continue;
      }
      places.push(p);
    }
  }

  places.sort((a, b) => a.area.localeCompare(b.area) || a.name.localeCompare(b.name) || a.osmId.localeCompare(b.osmId));

  const byArea: Record<string, number> = {};
  for (const p of places) byArea[p.area] = (byArea[p.area] ?? 0) + 1;

  return {
    header: {
      attribution: OSM_ATTRIBUTION,
      license: 'ODbL-1.0',
      licenseUrl: 'https://opendatacommons.org/licenses/odbl/1-0/',
      builtAt: new Date().toISOString(),
      sources,
      note:
        'Derived from OpenStreetMap; this file is a Derivative Database under ODbL 1.0. ' +
        'Prices are ESTIMATES (priceEstimated: true), shown as "~$$ (est.)". ' +
        PRICE_RULES_NOTE +
        ' Cuisine and diet tags are normalized from OSM cuisine=* and diet:*=yes|only. ' +
        'opening_hours kept only when the opening_hours library parses it. ' +
        'Built by scripts/build-places.ts; see research/places-api.md.',
      counts: {
        places: places.length,
        byArea,
        withCuisine: places.filter((p) => p.cuisine.length > 0).length,
        withHours: places.filter((p) => p.hours).length,
        withAddress: places.filter((p) => p.address).length,
        withDiet: places.filter((p) => p.diet.length > 0).length,
        ...stats,
      },
    },
    places,
  };
}

function serialize(d: Dataset): string {
  // Header pretty-printed; one place per line keeps diffs reviewable.
  const header = JSON.stringify(d.header, null, 2).replace(/\n/g, '\n  ');
  const rows = d.places.map((p) => '    ' + JSON.stringify(p)).join(',\n');
  return `{\n  "header": ${header},\n  "places": [\n${rows}\n  ]\n}\n`;
}

const dataset = build();
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, serialize(dataset), 'utf8');

const c = dataset.header.counts;
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 1000) / 10}%` : '-');
console.log(`wrote ${OUT}`);
console.log(`places: ${c.places}  ${JSON.stringify(c.byArea)}`);
for (const area of Object.keys(c.byArea)) {
  const ps = dataset.places.filter((p) => p.area === area);
  console.log(
    `  ${area}: cuisine ${pct(ps.filter((p) => p.cuisine.length).length, ps.length)}, ` +
      `hours ${pct(ps.filter((p) => p.hours).length, ps.length)}, address ${pct(ps.filter((p) => p.address).length, ps.length)}, ` +
      `diet ${ps.filter((p) => p.diet.length).length}, price $/$$/$$$ ${[1, 2, 3].map((b) => ps.filter((p) => p.priceBand === b).length).join('/')}`,
  );
}
console.log(`skipped unnamed ${c.unnamedSkipped}, merged duplicates ${c.duplicatesMerged}, dropped invalid hours ${c.invalidHoursDropped}`);
