// Offline places search over the bundled OSM snapshot (src/places/data/harvard-allston.json).
// Default provider for the demo: makes ZERO network calls (docs/HUNGRY_FLOW.md §7-8,
// research/places-api.md §5b). The engine ranks and picks the final three (hungry.rank);
// this returns up to 30 eligible candidates.
//
// Filters (docs/HUNGRY_FLOW.md §3-4):
//   - within radius of the centroid (1.2 km; 1.6 km for a midpoint)
//   - price: estimated priceBand <= priceMax + 1 (estimates are soft; the engine ranks over-budget lower)
//   - diet: hard where the data has that diet:* tag (yes/only keeps, no drops); otherwise the
//     place stays with a soft "check: <diet>" note
//   - open at plan time (America/New_York): known-closed places are dropped; unknown = null
// Sort: cuisine match first (vote order), then distance.

import { readFileSync } from 'node:fs';
import type { PlacesQuery } from '../engine/types.js';
import { dietLabel, normalizeDiet, queryCuisineGroups, OSM_DIET_TAGS, SNACK_CUISINES } from './cuisine.js';
import { haversineMeters, mapsUrl, walkMinutes, type GeoPoint } from './geo.js';
import { openAt } from './hours.js';
import type { Dataset, DatasetPlace, PlaceCandidate } from './types.js';

export const DEFAULT_RADIUS_M = 1200;
export const MIDPOINT_RADIUS_M = 1600;
export const MAX_CANDIDATES = 30;

let cached: Dataset | null = null;

/** The bundled snapshot, read once from disk (no network). */
export function loadDataset(): Dataset {
  if (!cached) {
    const url = new URL('./data/harvard-allston.json', import.meta.url);
    cached = JSON.parse(readFileSync(url, 'utf8')) as Dataset;
  }
  return cached;
}

export interface OfflineOptions {
  dataset?: Dataset;
  /** Used when query.at is absent. Defaults to Date.now(). */
  now?: number;
  radiusM?: number;
  limit?: number;
}

interface Scored {
  place: DatasetPlace;
  distance: number;
  matched: string[];
  /** index of the best (earliest-voted) matched cuisine; Infinity if none */
  matchRank: number;
  dietCheck: string[];
  open: boolean | null;
}

/** Diets the data can confirm or rule out, plus what each requested diet accepts. */
function dietSatisfiers(d: string): string[] | null {
  if (d === 'vegetarian') return ['vegetarian', 'vegan'];
  if (d === 'pescatarian') return ['vegetarian', 'vegan'];
  if ((OSM_DIET_TAGS as readonly string[]).includes(d)) return [d];
  return null; // nut_allergy, shellfish_allergy, ...: never in OSM data
}

/** null = exclude; otherwise the soft "check:" notes. */
function dietFilter(place: DatasetPlace, diets: string[]): string[] | null {
  const check: string[] = [];
  for (const d of diets) {
    const ok = dietSatisfiers(d);
    if (!ok) {
      check.push(d);
      continue;
    }
    if (ok.some((t) => place.diet.includes(t))) continue;
    // Hard filter only where the data speaks: diet:<d>=no
    if (place.dietNo?.includes(d)) return null;
    check.push(d);
  }
  return check;
}

function isMealPlace(p: DatasetPlace): boolean {
  return p.cuisine.length === 0 ? p.amenity !== 'cafe' : !p.cuisine.every((c) => SNACK_CUISINES.has(c));
}

/**
 * Search the snapshot around `center`. Pure apart from reading the bundled file once.
 * Returns PlaceOption-shaped candidates with id = index + 1 and source "osm".
 */
export function searchOffline(query: PlacesQuery, center: GeoPoint, opts: OfflineOptions = {}): PlaceCandidate[] {
  const data = opts.dataset ?? loadDataset();
  const at = query.at ?? opts.now ?? Date.now();
  const radius = opts.radiusM ?? (center.midpoint ? MIDPOINT_RADIUS_M : DEFAULT_RADIUS_M);
  const limit = opts.limit ?? MAX_CANDIDATES;
  const groups = queryCuisineGroups(query.cuisines ?? []);
  const diets = [...new Set((query.diet ?? []).map(normalizeDiet).filter(Boolean))];

  const eligible: Scored[] = [];
  for (const place of data.places) {
    const distance = haversineMeters(center, place);
    if (distance > radius) continue;
    // Snapshot prices are team ESTIMATES (OSM has none), so an estimate may sit one band above the budget; the
    // engine's ranking penalizes it. Real prices (if a dataset ever has them) are a hard filter.
    if (query.priceMax !== undefined && place.priceBand > query.priceMax + 1) continue;
    const dietCheck = dietFilter(place, diets);
    if (dietCheck === null) continue;
    const open = openAt(place.hours, at);
    if (open === false) continue;
    const matched: string[] = [];
    let matchRank = Infinity;
    groups.forEach((g, i) => {
      if (g.matches.some((m) => place.cuisine.includes(m))) {
        matched.push(g.tag);
        matchRank = Math.min(matchRank, i);
      }
    });
    eligible.push({ place, distance, matched, matchRank, dietCheck, open });
  }

  const byDistance = (a: Scored, b: Scored) => a.distance - b.distance || a.place.name.localeCompare(b.place.name);
  const matched = eligible.filter((s) => s.matched.length > 0).sort(byDistance);
  // General (no cuisine match) picks: real meal places only when there are enough of them, so a dinner plan
  // never gets a coffee or donut shop just because it is the closest door.
  const unmatched = eligible.filter((s) => s.matched.length === 0);
  const meals = unmatched.filter((s) => isMealPlace(s.place));
  const general = (meals.length >= 3 ? meals : unmatched).sort(
    (a, b) => Number(isMealPlace(b.place)) - Number(isMealPlace(a.place)) || byDistance(a, b),
  );

  // If the matches alone overflow the cap, share the slots across requested cuisines so the
  // engine still sees the runner-up cuisine (it builds a 2 + 1 compromise for split groups).
  let picked: Scored[];
  if (matched.length > limit) {
    const perCuisine = groups.map((g) => matched.filter((s) => s.matched.includes(g.tag)));
    const chosen = new Set<Scored>();
    for (let round = 0; chosen.size < limit; round++) {
      let progressed = false;
      for (const list of perCuisine) {
        if (round < list.length && chosen.size < limit) {
          chosen.add(list[round]);
          progressed = true;
        }
      }
      if (!progressed) break;
    }
    picked = [...chosen];
  } else {
    picked = [...matched, ...general].slice(0, limit);
  }

  picked.sort((a, b) => {
    const am = a.matched.length > 0 ? 0 : 1;
    const bm = b.matched.length > 0 ? 0 : 1;
    if (am !== bm) return am - bm;
    if (am === 0) return a.matchRank - b.matchRank || byDistance(a, b);
    return Number(isMealPlace(b.place)) - Number(isMealPlace(a.place)) || byDistance(a, b);
  });

  const anyMatch = matched.length > 0;
  const wanted = groups.map((g) => g.tag.replace(/_/g, ' '));
  return picked.map((s, i) => toCandidate(s, i + 1, { anyMatch, wanted, center }));
}

function toCandidate(
  s: Scored,
  id: number,
  ctx: { anyMatch: boolean; wanted: string[]; center: GeoPoint },
): PlaceCandidate {
  const p = s.place;
  // Matched cuisines first so "cuisine" reads right ("thai;vietnamese" for a Thai search).
  const cuisine = [...s.matched.filter((m) => p.cuisine.includes(m)), ...p.cuisine.filter((c) => !s.matched.includes(c))];
  const why: string[] = [];
  if (s.matched.length > 0) why.push(`matches ${s.matched.map((m) => m.replace(/_/g, ' ')).join(' + ')}`);
  else if (ctx.wanted.length === 0) why.push(`near ${ctx.center.label}`);
  else if (ctx.anyMatch) why.push(`backup: not ${ctx.wanted.join('/')}`);
  else why.push(`no ${ctx.wanted.join('/')} nearby, general pick`);
  if (s.open === null) why.push('hours unknown');
  for (const d of s.dietCheck) why.push(`check: ${dietLabel(d)}`);
  why.push('OSM snapshot, price est.');

  const out: PlaceCandidate = {
    id,
    name: p.name,
    ...(cuisine.length ? { cuisine: cuisine.join(';') } : {}),
    priceBand: p.priceBand,
    priceEstimated: true,
    ...(p.address ? { address: p.address } : {}),
    lat: p.lat,
    lon: p.lon,
    mapsUrl: mapsUrl(p),
    source: 'osm',
    diet: [...p.diet],
    ...(p.hours ? { hours: p.hours } : {}),
    osmId: p.osmId,
    walkMinutes: walkMinutes(s.distance),
    openAtPlanTime: s.open,
    why: why.join(' · '),
    matchedCuisines: [...s.matched],
    dietCheck: [...s.dietCheck],
    distanceMeters: Math.round(s.distance),
  };
  return out;
}

/** True when the snapshot has at least one place within `radiusM` of the point. */
export function hasCoverage(center: GeoPoint, opts: { dataset?: Dataset; radiusM?: number } = {}): boolean {
  const data = opts.dataset ?? loadDataset();
  const radius = opts.radiusM ?? (center.midpoint ? MIDPOINT_RADIUS_M : DEFAULT_RADIUS_M);
  return data.places.some((p) => haversineMeters(center, p) <= radius);
}
