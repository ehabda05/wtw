// Bundled gazetteer: the neighborhood string a member typed is resolved HERE, on our server,
// and never leaves it (docs/PRIVACY.md §9, docs/HUNGRY_FLOW.md §6). Only the derived
// coordinate (rounded further by each provider) is ever sent anywhere.
//
// Centroids come from OpenStreetMap (© OpenStreetMap contributors, ODbL), looked up once at
// build time on 2026-10-16 through Nominatim (20 requests, 1 every 1.5 s, identifying
// User-Agent, per the OSMF usage policy). There are no runtime geocoding calls
// (research/places-api.md §5e). `source` records the OSM object behind each entry.
//
// Also: haversine distance, the walking-time estimate (research/places-api.md §5f) and the
// Apple Maps link we hand to members.

export interface LatLon {
  lat: number;
  lon: number;
}

export interface Neighborhood extends LatLon {
  id: string;
  /** Short display label used in chat ("Harvard Sq"). */
  label: string;
  name: string;
  /** Lowercase phrases people type. Normalized at load. */
  aliases: string[];
  /** City-level aliases: used only when nothing more specific matches ("cambridge", "boston"). */
  cityAliases?: string[];
  /** Where the coordinate came from. */
  source: string;
}

export interface GeoPoint extends LatLon {
  label: string;
  /** true when this is the midpoint of two or more neighborhoods ("A + B"). */
  midpoint: boolean;
  /** Gazetteer ids behind this point. */
  ids: string[];
}

const NOM = 'OSM via Nominatim, looked up 2026-10-16';

export const NEIGHBORHOODS: Neighborhood[] = [
  {
    id: 'harvard-square', label: 'Harvard Sq', name: 'Harvard Square, Cambridge',
    lat: 42.3734734, lon: -71.1189431, source: `${NOM}: node/2448023622 (place=square)`,
    aliases: ['harvard square', 'harvard sq', 'harvard', 'hsq', 'h sq', 'the square', 'harvard yard', 'harvard station', 'harvard university', 'harvard t'],
    cityAliases: ['cambridge', 'cambridge ma'],
  },
  {
    id: 'central-square', label: 'Central Sq', name: 'Central Square, Cambridge',
    lat: 42.3655086, lon: -71.1040007, source: `${NOM}: node/358260131 (place=neighbourhood)`,
    aliases: ['central square', 'central sq', 'central', 'csq', 'central station'],
  },
  {
    id: 'kendall-square', label: 'Kendall Sq', name: 'Kendall Square, Cambridge',
    lat: 42.362611, lon: -71.0876102, source: `${NOM}: node/13130783050 (place=locality)`,
    aliases: ['kendall square', 'kendall sq', 'kendall', 'kendall mit', 'ksq'],
  },
  {
    id: 'inman-square', label: 'Inman Sq', name: 'Inman Square, Cambridge',
    lat: 42.3736503, lon: -71.1006322, source: `${NOM}: node/6117711731 (place=neighbourhood)`,
    aliases: ['inman square', 'inman sq', 'inman'],
  },
  {
    id: 'porter-square', label: 'Porter Sq', name: 'Porter Square, Cambridge',
    lat: 42.3882451, lon: -71.1191462, source: `${NOM}: way/1499793000 (Porter Square plaza, highway=pedestrian)`,
    aliases: ['porter square', 'porter sq', 'porter'],
  },
  {
    id: 'davis-square', label: 'Davis Sq', name: 'Davis Square, Somerville',
    lat: 42.3963615, lon: -71.1222329, source: `${NOM}: way/42964295 (landuse=retail)`,
    aliases: ['davis square', 'davis sq', 'davis'],
  },
  {
    id: 'union-square-somerville', label: 'Union Sq', name: 'Union Square, Somerville',
    lat: 42.3797558, lon: -71.0962373, source: `${NOM}: node/12145453172 (place=square)`,
    aliases: ['union square', 'union sq', 'union square somerville', 'union sq somerville', 'union'],
  },
  {
    id: 'allston', label: 'Allston', name: 'Allston (Harvard Ave & Brighton Ave)',
    lat: 42.3529, lon: -71.1321,
    source:
      'Harvard Ave & Brighton Ave intersection = center of the Overpass extract (research/places-api.md §3); ' +
      'cross-checked: median of 81 OSM POIs on Harvard Ave/Brighton Ave in research/data/osm-allston.json is 42.3527,-71.1314',
    aliases: [
      'allston', 'allston village', 'allston ma', 'harvard ave', 'harvard avenue', 'brighton ave', 'brighton avenue',
      'harvard ave brighton ave', 'harvard avenue brighton avenue', 'harvard ave and brighton ave', 'allston harvard ave brighton ave',
    ],
  },
  {
    id: 'brighton-center', label: 'Brighton Center', name: 'Brighton Center, Boston',
    lat: 42.3491079, lon: -71.1534248, source: `${NOM}: node/9809363475 (place=neighbourhood)`,
    aliases: ['brighton center', 'brighton centre', 'brighton ctr', 'brighton'],
  },
  {
    id: 'coolidge-corner', label: 'Coolidge Corner', name: 'Coolidge Corner, Brookline',
    lat: 42.3421568, lon: -71.1212983, source: `${NOM}: node/158823507 (place=neighbourhood)`,
    aliases: ['coolidge corner', 'coolidge'],
  },
  {
    id: 'fenway-kenmore', label: 'Fenway/Kenmore', name: 'Kenmore Square, Fenway-Kenmore, Boston',
    lat: 42.3489029, lon: -71.0962064, source: `${NOM}: node/12861878333 (Kenmore Square, place=square)`,
    aliases: ['kenmore', 'kenmore square', 'kenmore sq', 'fenway', 'the fenway', 'fenway park', 'fenway kenmore'],
  },
  {
    id: 'back-bay', label: 'Back Bay', name: 'Back Bay (Copley Square), Boston',
    lat: 42.3499845, lon: -71.0765438, source: `${NOM}: way/1239199995 (Copley Square, leisure=park)`,
    aliases: ['back bay', 'backbay', 'copley', 'copley square', 'copley sq', 'newbury street', 'newbury st', 'newbury'],
  },
  {
    id: 'south-end', label: 'South End', name: 'South End, Boston',
    lat: 42.3428281, lon: -71.0737784, source: `${NOM}: relation/4033683 (place=suburb, centroid)`,
    aliases: ['south end', 'the south end', 'southend'],
  },
  {
    id: 'beacon-hill', label: 'Beacon Hill', name: 'Beacon Hill, Boston',
    lat: 42.3587085, lon: -71.067829, source: `${NOM}: relation/4033665 (place=suburb, centroid)`,
    aliases: ['beacon hill', 'charles street', 'charles st'],
  },
  {
    id: 'downtown-crossing', label: 'Downtown Crossing', name: 'Downtown Crossing, Boston',
    lat: 42.3554546, lon: -71.0605787, source: `${NOM}: node/158809257 (place=neighbourhood)`,
    aliases: ['downtown crossing', 'dtx', 'downtown', 'downtown boston'],
    cityAliases: ['boston', 'boston ma'],
  },
  {
    id: 'chinatown', label: 'Chinatown', name: 'Chinatown, Boston',
    lat: 42.3513291, lon: -71.0626228, source: `${NOM}: relation/4033667 (place=suburb, centroid)`,
    aliases: ['chinatown', 'china town'],
  },
  {
    id: 'north-end', label: 'North End', name: 'North End, Boston',
    lat: 42.3650974, lon: -71.0544954, source: `${NOM}: relation/4033677 (place=suburb, centroid)`,
    aliases: ['north end', 'the north end', 'northend', 'hanover street', 'hanover st'],
  },
  {
    id: 'seaport', label: 'Seaport', name: 'Seaport, Boston',
    lat: 42.3462652, lon: -71.0421584, source: `${NOM}: relation/20508884 (place=suburb, centroid)`,
    aliases: ['seaport', 'the seaport', 'seaport district', 'south boston waterfront', 'innovation district'],
  },
  {
    id: 'jamaica-plain', label: 'Jamaica Plain', name: 'Jamaica Plain, Boston',
    lat: 42.3116046, lon: -71.1143838, source: `${NOM}: relation/4033674 (place=suburb, centroid)`,
    aliases: ['jamaica plain', 'jp', 'j p', 'jamaica plains'],
  },
  {
    id: 'mit', label: 'MIT', name: 'MIT campus, Cambridge',
    lat: 42.3582529, lon: -71.0966272, source: `${NOM}: relation/65066 (amenity=university, centroid)`,
    aliases: ['mit', 'm i t', 'mit campus', 'massachusetts institute of technology'],
  },
  {
    id: 'boston-university', label: 'BU', name: 'Boston University, Boston',
    lat: 42.3504215, lon: -71.1032247, source: `${NOM}: relation/6587738 (amenity=university, centroid)`,
    aliases: ['bu', 'b u', 'boston university', 'boston u', 'bu campus'],
  },
];

// ───────────────────────── normalization ─────────────────────────

const WORD_SUBS: Record<string, string> = {
  square: 'sq',
  sqr: 'sq',
  squre: 'sq',
  sqaure: 'sq',
  street: 'st',
  avenue: 'ave',
  av: 'ave',
  centre: 'center',
};

/** Lowercase, strip accents/punctuation, unify "square"->"sq" etc. Keeps "+" and "&" as tokens. */
export function normalizePlaceText(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/\+/g, ' + ')
    .replace(/&/g, ' & ')
    .replace(/[^a-z0-9+&]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => WORD_SUBS[w] ?? w)
    .join(' ');
}

const LEADING_FILLER =
  /^(?:(?:somewhere|anywhere|maybe|like|ok|okay|um|uh|lets|let s|how about|what about|meet|meeting|go|we|re|are|should|eat|food|dinner|lunch)\s+)*(?:(?:near|around|by|in|at|close to|next to|over by|towards|toward|to|from|of)\s+)*/;
const TRAILING_FILLER = /\s+(?:ish|area|please|pls|plz|maybe|way|side|neighborhood|neighbourhood|region|vicinity)$/;

function stripFiller(s: string): string {
  let out = s.replace(LEADING_FILLER, '');
  let prev = '';
  while (prev !== out) {
    prev = out;
    out = out.replace(TRAILING_FILLER, '');
  }
  return out.trim();
}

/** Matching form: no "+"/"&" tokens. */
function bare(s: string): string {
  return s.replace(/[+&]/g, ' ').replace(/\s+/g, ' ').trim();
}

interface AliasEntry {
  alias: string;
  words: string[];
  hood: Neighborhood;
  /** 1 = neighborhood alias, 0 = city-level fallback */
  priority: number;
}

const ALIASES: AliasEntry[] = [];
for (const hood of NEIGHBORHOODS) {
  for (const a of hood.aliases) {
    const alias = bare(normalizePlaceText(a));
    ALIASES.push({ alias, words: alias.split(' '), hood, priority: 1 });
  }
  for (const a of hood.cityAliases ?? []) {
    const alias = bare(normalizePlaceText(a));
    ALIASES.push({ alias, words: alias.split(' '), hood, priority: 0 });
  }
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

function containsWords(hay: string[], needle: string[]): boolean {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

/** Resolve one phrase (no midpoint handling) to a neighborhood, or null. */
function matchOne(phrase: string): Neighborhood | null {
  const s = bare(stripFiller(phrase));
  if (!s) return null;
  const candidates = [s, s.replace(/^the /, '')];

  // 1. exact alias
  for (const c of candidates) {
    const hit = ALIASES.filter((e) => e.alias === c).sort((x, y) => y.priority - x.priority)[0];
    if (hit) return hit.hood;
  }

  // 2. alias contained as whole words; most specific wins (priority, then length)
  const words = s.split(' ');
  const contained = ALIASES.filter((e) => containsWords(words, e.words)).sort(
    (x, y) => y.priority - x.priority || y.alias.length - x.alias.length,
  );
  if (contained[0]) return contained[0].hood;

  // 3. fuzzy: typo-tolerant match of a 1-3 word window against aliases of >= 5 chars
  let best: { e: AliasEntry; d: number } | null = null;
  for (const e of ALIASES) {
    if (e.alias.length < 5) continue;
    const maxD = e.alias.length >= 8 ? 2 : 1;
    for (let i = 0; i < words.length; i++) {
      for (let len = Math.max(1, e.words.length - 1); len <= e.words.length + 1 && i + len <= words.length; len++) {
        const window = words.slice(i, i + len).join(' ');
        if (Math.abs(window.length - e.alias.length) > maxD) continue;
        const d = levenshtein(window, e.alias);
        if (d <= maxD && (!best || d < best.d || (d === best.d && e.priority > best.e.priority))) best = { e, d };
      }
    }
  }
  return best ? best.e.hood : null;
}

const MIDPOINT_PREFIX =
  /^(?:(?:somewhere|meet|meeting|lets meet|let s meet)\s+)*(?:(?:half ?way|midway|in the middle|middle|in)\s+)?(?:between|of)\s+/;
const SPLITTER = /\s+(?:\+|&|and|\/)\s+|\s*\+\s*|\s*\/\s*/;

/**
 * Neighborhood text -> centroid, or null if we don't know it (Otto then asks the group to
 * pick from the list; we never call out to a geocoder).
 * "A + B", "A and B", "between A and B" -> midpoint, labeled "halfway between A and B".
 */
export function geocode(near: string | null | undefined): GeoPoint | null {
  if (!near || typeof near !== 'string') return null;
  const norm = normalizePlaceText(near.slice(0, 200));
  if (!norm) return null;

  // 1. whole string is one known alias (handles "Harvard Ave & Brighton Ave")
  const whole = bare(stripFiller(norm));
  const exact = ALIASES.filter((e) => e.alias === whole || e.alias === whole.replace(/^the /, '')).sort(
    (x, y) => y.priority - x.priority,
  )[0];
  if (exact) return pointFor(exact.hood);

  // 2. two or more places -> midpoint
  const body = norm.replace(MIDPOINT_PREFIX, '');
  const parts = body.split(SPLITTER).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const hoods = parts.map(matchOne);
    if (hoods.every((h): h is Neighborhood => h !== null)) {
      const unique = hoods.filter((h, i) => hoods.findIndex((x) => x.id === h.id) === i);
      if (unique.length >= 2) return midpointOf(unique);
    }
  }

  // 3. single neighborhood anywhere in the text
  const one = matchOne(norm);
  return one ? pointFor(one) : null;
}

function pointFor(h: Neighborhood): GeoPoint {
  return { lat: h.lat, lon: h.lon, label: h.label, midpoint: false, ids: [h.id] };
}

function midpointOf(hoods: Neighborhood[]): GeoPoint {
  const lat = hoods.reduce((s, h) => s + h.lat, 0) / hoods.length;
  const lon = hoods.reduce((s, h) => s + h.lon, 0) / hoods.length;
  const labels = hoods.map((h) => h.label);
  const label =
    labels.length === 2
      ? `halfway between ${labels[0]} and ${labels[1]}`
      : `between ${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
  return { lat: Number(lat.toFixed(7)), lon: Number(lon.toFixed(7)), label, midpoint: true, ids: hoods.map((h) => h.id) };
}

/** Labels Otto can offer when a neighborhood is unknown ("Which neighborhood? Harvard Sq, Allston, ..."). */
export function knownNeighborhoods(): string[] {
  return NEIGHBORHOODS.map((h) => h.label);
}

// ───────────────────────── distance, walking, links ─────────────────────────

const EARTH_RADIUS_M = 6_371_008.8;

/** Great-circle distance in meters. */
export function haversineMeters(a: LatLon, b: LatLon): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Detour factor for streets vs straight line (research/places-api.md §5f). */
export const DETOUR_FACTOR = 1.3;
/** 1.3 m/s adult walking speed = 78 m/min (research/places-api.md §5f). */
export const WALK_METERS_PER_MIN = 78;

/** Estimated walking minutes for a straight-line distance: ceil(m × 1.3 ÷ 78). Label it "~N min walk". */
export function walkMinutes(meters: number): number {
  return Math.ceil((meters * DETOUR_FACTOR) / WALK_METERS_PER_MIN);
}

/**
 * Apple Maps link built from the restaurant's own name and coordinates only: no member data,
 * no origin, no neighborhood text. The member's device opens it; our server makes no call.
 */
export function mapsUrl(place: { name: string; lat: number; lon: number }): string {
  const q = encodeURIComponent(place.name);
  return `https://maps.apple.com/?q=${q}&ll=${place.lat.toFixed(6)},${place.lon.toFixed(6)}`;
}
