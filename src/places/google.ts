// Optional live provider: Google Places API (New) Text Search.
// Used only when PLACES_PROVIDER=google AND PLACES_API_KEY is set (decision D5,
// research/places-api.md §5a). Otherwise Homi runs on the OSM snapshot alone.
//
// Request shape verified 2026-10-16 against
//   https://developers.google.com/maps/documentation/places/web-service/text-search
//   (page "Last updated 2026-10-15 UTC") and the Place resource reference
//   https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places
//   - POST https://places.googleapis.com/v1/places:searchText
//   - headers X-Goog-Api-Key, X-Goog-FieldMask (mandatory; omitting it is an error), Content-Type
//   - body: textQuery (required), locationBias.circle {center {latitude, longitude}, radius 0..50000},
//     priceLevels [PRICE_LEVEL_INEXPENSIVE..VERY_EXPENSIVE] (PRICE_LEVEL_FREE not allowed in a request),
//     pageSize 1..20 (the doc marks maxResultCount as deprecated in favor of pageSize)
//   - regularOpeningHours.periods[].open/close {day 0=Sunday..6, hour, minute}, place-local time
//
// PRIVACY (docs/PRIVACY.md §9, docs/HUNGRY_FLOW.md §6): the request carries ONLY a cuisine phrase
// ("thai restaurant"), price levels, and our gazetteer centroid rounded to 3 decimals (~100 m).
// Never the neighborhood text, names, numbers or device location. test/places/egress.test.ts
// asserts this.
//
// TERMS (research/places-api.md §1b, §2): results are NEVER written to disk or fed into the
// offline file; they live only in the returned array. Rows link to Google Maps (not Apple Maps)
// because Places content may not be used with a non-Google map (SST 14.2). Render with a
// template plus the "Google Maps" credit; do not pass these rows through an LLM.

import { DateTime } from 'luxon';
import type { PlacesQuery, PriceBand } from '../engine/types.js';
import { normalizeCuisineToken, normalizeDiet, queryCuisineGroups, SNACK_CUISINES } from './cuisine.js';
import { haversineMeters, walkMinutes, type GeoPoint } from './geo.js';
import { PLACES_TZ } from './hours.js';
import type { PlaceCandidate } from './types.js';
import { DEFAULT_RADIUS_M, MIDPOINT_RADIUS_M } from './fallback.js';
import { fetchJson } from './http.js';

export const GOOGLE_TEXT_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';

/** Pro + Enterprise fields only; billed at the highest SKU in the mask (Enterprise: priceLevel, regularOpeningHours). */
export const GOOGLE_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.primaryType',
  'places.types',
  'places.priceLevel',
  'places.regularOpeningHours',
  'places.location',
  'places.shortFormattedAddress',
].join(',');

const PRICE_LEVELS = [
  'PRICE_LEVEL_INEXPENSIVE',
  'PRICE_LEVEL_MODERATE',
  'PRICE_LEVEL_EXPENSIVE',
  'PRICE_LEVEL_VERY_EXPENSIVE',
] as const;

const PRICE_FROM_LEVEL: Record<string, PriceBand> = {
  PRICE_LEVEL_FREE: 1,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

/** Google place types that are not "<x>_restaurant" but tell us the cuisine. */
const TYPE_CUISINE: Record<string, string[]> = {
  hamburger_restaurant: ['burger'],
  coffee_shop: ['coffee_shop'],
  cafe: ['coffee_shop'],
  ice_cream_shop: ['ice_cream', 'dessert'],
  dessert_shop: ['dessert'],
  dessert_restaurant: ['dessert'],
  donut_shop: ['donut'],
  bagel_shop: ['bagel', 'breakfast'],
  bakery: ['bakery'],
  sandwich_shop: ['sandwich'],
  juice_shop: ['juice'],
  tea_house: ['tea'],
  breakfast_restaurant: ['breakfast'],
  brunch_restaurant: ['brunch'],
  middle_eastern_restaurant: ['middle_eastern'],
  barbecue_restaurant: ['bbq'],
  steak_house: ['steak_house'],
  fine_dining_restaurant: ['fine_dining'],
  vegan_restaurant: ['vegan'],
  vegetarian_restaurant: ['vegetarian'],
};
const GENERIC_TYPES = new Set(['restaurant', 'food', 'point_of_interest', 'establishment', 'meal_takeaway', 'meal_delivery', 'store', 'bar']);

export interface GoogleOptions {
  apiKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** epoch ms; defaults to Date.now() */
  now?: number;
  /** Max textQuery calls per search (one per top cuisine). Each call costs quota. */
  maxQueries?: number;
}

interface GPoint {
  day?: number;
  hour?: number;
  minute?: number;
}
interface GPlace {
  id?: string;
  displayName?: { text?: string; languageCode?: string };
  primaryType?: string;
  types?: string[];
  priceLevel?: string;
  regularOpeningHours?: { openNow?: boolean; periods?: { open?: GPoint; close?: GPoint }[] };
  location?: { latitude?: number; longitude?: number };
  shortFormattedAddress?: string;
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** Cuisine tag -> the only free text Google sees. "coffee_shop" -> "coffee shop", "thai" -> "thai restaurant". */
export function textQueryFor(tag: string | undefined): string {
  if (!tag) return 'restaurant';
  const words = tag.replace(/_/g, ' ');
  return SNACK_CUISINES.has(tag) ? words : `${words} restaurant`;
}

export function textQueryForCategory(category: NonNullable<PlacesQuery['category']>): string {
  return {
    cafe: 'cafe',
    bowling: 'bowling alley',
    museum: 'museum',
    park: 'park',
    activity: 'things to do',
  }[category];
}

/** Exactly what leaves the server for one Google call. Exported for the egress test. */
export function buildGoogleRequest(
  cuisineTag: string | undefined,
  center: { lat: number; lon: number },
  priceMax: PriceBand | undefined,
  radiusM: number,
  customTextQuery?: string,
): { url: string; body: Record<string, unknown> } {
  const body: Record<string, unknown> = {
    textQuery: customTextQuery ?? textQueryFor(cuisineTag),
    locationBias: { circle: { center: { latitude: round3(center.lat), longitude: round3(center.lon) }, radius: radiusM } },
    pageSize: 20,
  };
  if (priceMax !== undefined && priceMax < 4) body.priceLevels = PRICE_LEVELS.slice(0, priceMax);
  return { url: GOOGLE_TEXT_SEARCH_URL, body };
}

/** Is a regularOpeningHours.periods schedule open at `at` (New York wall clock)? */
export function periodsOpenAt(periods: { open?: GPoint; close?: GPoint }[] | undefined, at: number): boolean | null {
  if (!periods || periods.length === 0) return null;
  const dt = DateTime.fromMillis(at, { zone: PLACES_TZ });
  const WEEK = 7 * 24 * 60;
  const t = (dt.weekday % 7) * 24 * 60 + dt.hour * 60 + dt.minute; // luxon 7=Sun -> 0
  for (const p of periods) {
    if (!p.open || p.open.day === undefined) continue;
    const o = p.open.day * 1440 + (p.open.hour ?? 0) * 60 + (p.open.minute ?? 0);
    if (!p.close || p.close.day === undefined) return true; // open 24/7 is encoded as an open with no close
    let c = p.close.day * 1440 + (p.close.hour ?? 0) * 60 + (p.close.minute ?? 0);
    if (c <= o) c += WEEK;
    if ((t >= o && t < c) || (t + WEEK >= o && t + WEEK < c)) return true;
  }
  return false;
}

function cuisinesOf(p: GPlace): string[] {
  const out: string[] = [];
  const types = [p.primaryType, ...(p.types ?? [])].filter((x): x is string => !!x);
  for (const t of types) {
    if (GENERIC_TYPES.has(t)) continue;
    const tags = TYPE_CUISINE[t] ?? (t.endsWith('_restaurant') ? normalizeCuisineToken(t) : []);
    for (const tag of tags) if (!out.includes(tag)) out.push(tag);
  }
  return out;
}

async function callOnce(
  req: { url: string; body: Record<string, unknown> },
  opts: GoogleOptions,
): Promise<GPlace[]> {
  const json = (await fetchJson(
    opts.fetch ?? globalThis.fetch,
    req.url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': opts.apiKey,
        'X-Goog-FieldMask': GOOGLE_FIELD_MASK,
      },
      body: JSON.stringify(req.body),
    },
    opts.timeoutMs ?? 3000,
  )) as { places?: GPlace[] } | null;
  return Array.isArray(json?.places) ? json.places : [];
}

/**
 * Live search. Throws on HTTP error, timeout (3 s) or malformed response so the caller can
 * fall back to the snapshot. Returns [] when Google has nothing usable.
 */
export async function searchGoogle(query: PlacesQuery, center: GeoPoint, opts: GoogleOptions): Promise<PlaceCandidate[]> {
  const now = opts.now ?? Date.now();
  const at = query.at ?? now;
  const radius = center.radiusMeters ?? (center.midpoint ? MIDPOINT_RADIUS_M : DEFAULT_RADIUS_M);
  const groups = queryCuisineGroups(query.cuisines ?? []);
  const queries = groups.length
    ? groups.slice(0, opts.maxQueries ?? 2).map((g) => ({ tag: g.tag, text: textQueryFor(g.tag) }))
    : [{ tag: undefined, text: query.category ? textQueryForCategory(query.category) : 'restaurant' }];

  const results = await Promise.all(
    queries.map(({ tag, text }) => callOnce(buildGoogleRequest(tag, center, query.priceMax, radius, text), opts).then((ps) => ({ tag, ps }))),
  );

  const diets = [...new Set((query.diet ?? []).map(normalizeDiet).filter(Boolean))];
  const seen = new Set<string>();
  const rows: Omit<PlaceCandidate, 'id'>[] = [];
  for (const { tag, ps } of results) {
    for (const p of ps) {
      const name = p.displayName?.text?.trim();
      const lat = p.location?.latitude;
      const lon = p.location?.longitude;
      if (!name || typeof lat !== 'number' || typeof lon !== 'number') continue;
      const key = p.id ?? `${name}@${lat.toFixed(4)},${lon.toFixed(4)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const distance = haversineMeters(center, { lat, lon });
      if (distance > radius * 1.5) continue; // locationBias is a bias, not a restriction
      const priceBand = p.priceLevel ? PRICE_FROM_LEVEL[p.priceLevel] : undefined;
      if (query.priceMax !== undefined && priceBand !== undefined && priceBand > query.priceMax) continue;

      let open = periodsOpenAt(p.regularOpeningHours?.periods, at);
      if (Math.abs(at - now) < 15 * 60_000 && typeof p.regularOpeningHours?.openNow === 'boolean') {
        open = p.regularOpeningHours.openNow;
      }
      if (open === false) continue;

      let cuisines = cuisinesOf(p);
      // A generic "restaurant" returned for "thai restaurant": trust the query's relevance.
      if (cuisines.length === 0 && tag) cuisines = [tag];
      const matched = groups.filter((g) => g.matches.some((m) => cuisines.includes(m))).map((g) => g.tag);
      const dietCheck = diets.filter((d) => !cuisines.includes(d));

      const why = [
        matched.length ? `matches ${matched.join(' + ')}` : 'nearby pick',
        ...(open === null ? ['hours unknown'] : []),
        ...dietCheck.map((d) => `check: ${d.replace(/_/g, ' ')}`),
        'Google Maps',
      ];
      const ordered = [...matched.filter((m) => cuisines.includes(m)), ...cuisines.filter((c) => !matched.includes(c))];
      rows.push({
        name,
        ...(ordered.length ? { cuisine: ordered.join(';') } : {}),
        ...(priceBand !== undefined ? { priceBand, priceEstimated: false } : {}),
        ...(p.shortFormattedAddress ? { address: p.shortFormattedAddress } : {}),
        lat,
        lon,
        mapsUrl: googleMapsUrl(name, p.id),
        source: 'google',
        walkMinutes: walkMinutes(distance),
        openAtPlanTime: open,
        why: why.join(' · '),
        matchedCuisines: matched,
        dietCheck,
        distanceMeters: Math.round(distance),
        ...(p.id ? { googlePlaceId: p.id } : {}),
      });
    }
  }

  const rank = (r: Omit<PlaceCandidate, 'id'>) => {
    const i = groups.findIndex((g) => r.matchedCuisines.includes(g.tag));
    return i < 0 ? Infinity : i;
  };
  rows.sort((a, b) => rank(a) - rank(b) || a.distanceMeters - b.distanceMeters);
  return rows.slice(0, 20).map((r, i) => ({ id: i + 1, ...r }));
}

/** Google Maps URL (documented "Maps URLs" search form). Name + place id only. */
export function googleMapsUrl(name: string, placeId?: string): string {
  const q = `query=${encodeURIComponent(name)}`;
  return `https://www.google.com/maps/search/?api=1&${q}${placeId ? `&query_place_id=${encodeURIComponent(placeId)}` : ''}`;
}
