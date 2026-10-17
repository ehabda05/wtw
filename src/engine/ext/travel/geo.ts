// Travel gazetteer (pure data): origin cities Homi can price flights from, and destinations it knows.
// Only names from these tables (or a sanitized "trip to X" destination) ever reach a travel provider, so a
// member's name or number can never end up in a search query (docs/PRIVACY.md, docs/TRAVEL.md).

export type OriginRegion = 'us_east' | 'us_central' | 'us_west' | 'canada_east' | 'canada_west' | 'europe' | 'other';
export type DestKey = 'japan' | 'europe' | 'asia' | 'latam' | 'caribbean' | 'hawaii' | 'us' | 'world';

export interface City {
  name: string;           // display name, "Boston"
  code: string;           // airport code used on cards, "BOS"
  region: OriginRegion;
}

export interface Destination {
  name: string;           // display name, "Japan"
  key: DestKey;           // guide ("japan") or regional average
}

// [aliases (lowercase), name, code, region]. Short or ambiguous aliases (two letters, "la") only count after "from".
const CITY_ROWS: Array<[string[], string, string, OriginRegion]> = [
  [['boston', 'bos', 'logan'], 'Boston', 'BOS', 'us_east'],
  [['new york', 'new york city', 'nyc', 'jfk', 'manhattan', 'brooklyn'], 'New York', 'JFK', 'us_east'],
  [['newark', 'ewr'], 'Newark', 'EWR', 'us_east'],
  [['washington dc', 'washington d.c.', 'dc', 'd.c.', 'iad', 'dca'], 'Washington DC', 'IAD', 'us_east'],
  [['philadelphia', 'philly', 'phl'], 'Philadelphia', 'PHL', 'us_east'],
  [['atlanta', 'atl'], 'Atlanta', 'ATL', 'us_east'],
  [['miami', 'mia'], 'Miami', 'MIA', 'us_east'],
  [['orlando', 'mco'], 'Orlando', 'MCO', 'us_east'],
  [['charlotte', 'clt'], 'Charlotte', 'CLT', 'us_east'],
  [['raleigh', 'rdu'], 'Raleigh', 'RDU', 'us_east'],
  [['baltimore', 'bwi'], 'Baltimore', 'BWI', 'us_east'],
  [['pittsburgh', 'pit'], 'Pittsburgh', 'PIT', 'us_east'],
  [['providence', 'pvd'], 'Providence', 'PVD', 'us_east'],
  [['toronto', 'yyz'], 'Toronto', 'YYZ', 'canada_east'],
  [['montreal', 'yul'], 'Montreal', 'YUL', 'canada_east'],
  [['chicago', 'ord', 'chi'], 'Chicago', 'ORD', 'us_central'],
  [['dallas', 'dfw'], 'Dallas', 'DFW', 'us_central'],
  [['houston', 'iah'], 'Houston', 'IAH', 'us_central'],
  [['austin', 'aus'], 'Austin', 'AUS', 'us_central'],
  [['denver', 'den'], 'Denver', 'DEN', 'us_central'],
  [['minneapolis', 'msp'], 'Minneapolis', 'MSP', 'us_central'],
  [['detroit', 'dtw'], 'Detroit', 'DTW', 'us_central'],
  [['nashville', 'bna'], 'Nashville', 'BNA', 'us_central'],
  [['st. louis', 'st louis', 'stl'], 'St. Louis', 'STL', 'us_central'],
  [['san francisco', 'sf', 'bay area', 'sfo', 'oakland'], 'San Francisco', 'SFO', 'us_west'],
  [['san jose', 'sjc'], 'San Jose', 'SJC', 'us_west'],
  [['los angeles', 'la', 'lax'], 'Los Angeles', 'LAX', 'us_west'],
  [['seattle', 'sea'], 'Seattle', 'SEA', 'us_west'],
  [['portland', 'pdx'], 'Portland', 'PDX', 'us_west'],
  [['san diego', 'san'], 'San Diego', 'SAN', 'us_west'],
  [['las vegas', 'vegas', 'las'], 'Las Vegas', 'LAS', 'us_west'],
  [['phoenix', 'phx'], 'Phoenix', 'PHX', 'us_west'],
  [['salt lake city', 'salt lake', 'slc'], 'Salt Lake City', 'SLC', 'us_west'],
  [['vancouver', 'yvr'], 'Vancouver', 'YVR', 'canada_west'],
  [['london', 'lhr'], 'London', 'LHR', 'europe'],
  [['paris', 'cdg'], 'Paris', 'CDG', 'europe'],
  [['amsterdam', 'ams'], 'Amsterdam', 'AMS', 'europe'],
  [['frankfurt', 'fra'], 'Frankfurt', 'FRA', 'europe'],
  [['berlin', 'ber'], 'Berlin', 'BER', 'europe'],
  [['munich', 'muc'], 'Munich', 'MUC', 'europe'],
  [['madrid', 'mad'], 'Madrid', 'MAD', 'europe'],
  [['barcelona', 'bcn'], 'Barcelona', 'BCN', 'europe'],
  [['rome', 'fco'], 'Rome', 'FCO', 'europe'],
  [['milan', 'mxp'], 'Milan', 'MXP', 'europe'],
  [['dublin', 'dub'], 'Dublin', 'DUB', 'europe'],
  [['zurich', 'zrh'], 'Zurich', 'ZRH', 'europe'],
  [['lisbon', 'lis'], 'Lisbon', 'LIS', 'europe'],
];

export const CITIES: City[] = CITY_ROWS.map(([, name, code, region]) => ({ name, code, region }));

const CITY_ALIAS = new Map<string, City>();
CITY_ROWS.forEach(([aliases], i) => {
  for (const a of aliases) CITY_ALIAS.set(a, CITIES[i]);
});

/** An alias that is safe to match anywhere in a message (not a 2-3 letter code or a common word). */
const NOT_BARE = new Set(['logan', 'oakland', 'austin', 'charlotte', 'phoenix', 'orlando', 'dallas', 'denver', 'houston', 'raleigh', 'paris', 'london', 'milan', 'providence', 'vegas']);
/** Airport codes that are also everyday words in caps ("I'm MAD"): they only count after "from". */
const NOT_BARE_CODE = new Set(['MAD', 'SAN', 'SEA', 'PIT', 'DEN', 'LAS', 'AUS', 'BER', 'MIA']);

function bareSafe(alias: string): boolean {
  return alias.length >= 4 && !NOT_BARE.has(alias);
}

export function cityByName(name: string): City | undefined {
  const n = name.toLowerCase().trim();
  return CITY_ALIAS.get(n) ?? CITIES.find((c) => c.name.toLowerCase() === n || c.code.toLowerCase() === n);
}

const DEST_ROWS: Array<[string[], string, DestKey]> = [
  [['japan', 'tokyo', 'kyoto', 'osaka'], 'Japan', 'japan'],
  [['italy', 'rome', 'florence', 'venice', 'amalfi', 'sicily', 'tuscany'], 'Italy', 'europe'],
  [['france', 'paris', 'provence'], 'France', 'europe'],
  [['spain', 'barcelona', 'madrid', 'seville'], 'Spain', 'europe'],
  [['portugal', 'lisbon', 'porto'], 'Portugal', 'europe'],
  [['greece', 'athens', 'santorini', 'mykonos'], 'Greece', 'europe'],
  [['uk', 'england', 'london', 'scotland', 'edinburgh'], 'the UK', 'europe'],
  [['ireland', 'dublin'], 'Ireland', 'europe'],
  [['iceland', 'reykjavik'], 'Iceland', 'europe'],
  [['germany', 'berlin', 'munich'], 'Germany', 'europe'],
  [['netherlands', 'amsterdam'], 'the Netherlands', 'europe'],
  [['croatia', 'dubrovnik'], 'Croatia', 'europe'],
  [['switzerland', 'zurich', 'swiss alps'], 'Switzerland', 'europe'],
  [['austria', 'vienna'], 'Austria', 'europe'],
  [['czechia', 'czech republic', 'prague'], 'Czechia', 'europe'],
  [['hungary', 'budapest'], 'Hungary', 'europe'],
  [['denmark', 'copenhagen'], 'Denmark', 'europe'],
  [['norway', 'oslo'], 'Norway', 'europe'],
  [['sweden', 'stockholm'], 'Sweden', 'europe'],
  [['europe'], 'Europe', 'europe'],
  [['korea', 'south korea', 'seoul', 'busan'], 'Korea', 'asia'],
  [['thailand', 'bangkok', 'phuket', 'chiang mai'], 'Thailand', 'asia'],
  [['vietnam', 'hanoi', 'saigon', 'ho chi minh city'], 'Vietnam', 'asia'],
  [['bali', 'indonesia'], 'Bali', 'asia'],
  [['taiwan', 'taipei'], 'Taiwan', 'asia'],
  [['philippines', 'manila'], 'the Philippines', 'asia'],
  [['singapore'], 'Singapore', 'asia'],
  [['hong kong'], 'Hong Kong', 'asia'],
  [['china', 'beijing', 'shanghai'], 'China', 'asia'],
  [['india', 'delhi', 'mumbai', 'goa'], 'India', 'asia'],
  [['malaysia', 'kuala lumpur'], 'Malaysia', 'asia'],
  [['mexico', 'mexico city', 'cancun', 'tulum', 'oaxaca'], 'Mexico', 'latam'],
  [['costa rica'], 'Costa Rica', 'latam'],
  [['peru', 'lima', 'machu picchu', 'cusco'], 'Peru', 'latam'],
  [['colombia', 'medellin', 'cartagena', 'bogota'], 'Colombia', 'latam'],
  [['argentina', 'buenos aires', 'patagonia'], 'Argentina', 'latam'],
  [['brazil', 'rio', 'rio de janeiro'], 'Brazil', 'latam'],
  [['chile', 'santiago'], 'Chile', 'latam'],
  [['puerto rico', 'san juan'], 'Puerto Rico', 'caribbean'],
  [['jamaica'], 'Jamaica', 'caribbean'],
  [['bahamas', 'the bahamas'], 'the Bahamas', 'caribbean'],
  [['dominican republic', 'punta cana'], 'the Dominican Republic', 'caribbean'],
  [['aruba'], 'Aruba', 'caribbean'],
  [['barbados'], 'Barbados', 'caribbean'],
  [['caribbean'], 'the Caribbean', 'caribbean'],
  [['hawaii', 'maui', 'oahu', 'honolulu', 'kauai'], 'Hawaii', 'hawaii'],
  [['new orleans', 'nola'], 'New Orleans', 'us'],
  [['nashville'], 'Nashville', 'us'],
  [['las vegas', 'vegas'], 'Las Vegas', 'us'],
  [['new york', 'nyc'], 'New York', 'us'],
  [['yellowstone'], 'Yellowstone', 'us'],
  [['grand canyon'], 'the Grand Canyon', 'us'],
  [['miami'], 'Miami', 'us'],
  [['austin'], 'Austin', 'us'],
  [['chicago'], 'Chicago', 'us'],
  [['san francisco'], 'San Francisco', 'us'],
  [['los angeles'], 'Los Angeles', 'us'],
  [['seattle'], 'Seattle', 'us'],
  [['denver'], 'Denver', 'us'],
  [['alaska'], 'Alaska', 'us'],
];

const DEST_ALIAS = new Map<string, Destination>();
for (const [aliases, name, key] of DEST_ROWS) for (const a of aliases) DEST_ALIAS.set(a, { name, key });
const DEST_ALIASES = [...DEST_ALIAS.keys()].sort((a, b) => b.length - a.length);

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The known destination named at the start of `phrase` ("japan for 2030" -> Japan). */
export function destinationAt(phrase: string): Destination | undefined {
  const p = phrase.toLowerCase();
  for (const a of DEST_ALIASES) if (new RegExp(`^${esc(a)}(?![\\w'])`).test(p)) return DEST_ALIAS.get(a);
  return undefined;
}

/** A known destination named anywhere in `text`. */
export function destinationIn(text: string): Destination | undefined {
  const t = text.toLowerCase();
  for (const a of DEST_ALIASES) if (new RegExp(`(?:^|[^\\w'])${esc(a)}(?![\\w'])`).test(t)) return DEST_ALIAS.get(a);
  return undefined;
}

export function destinationByName(name: string): Destination | undefined {
  const n = name.toLowerCase();
  return DEST_ALIAS.get(n) ?? [...DEST_ALIAS.values()].find((d) => d.name.toLowerCase() === n);
}

const CITY_ALIASES = [...CITY_ALIAS.keys()].sort((a, b) => b.length - a.length);

/**
 * The origin city in a message: "from <city>" first (any alias), else a bare city name (safe aliases only), else
 * an uppercase airport code ("BOS"). Cities that are also the trip's destination are skipped.
 * `lower` is the normalized lowercase text, `raw` the original (for uppercase codes).
 */
export function originIn(lower: string, raw: string, destination?: string): City | undefined {
  const dest = destination?.toLowerCase();
  const isDest = (c: City) => !!dest && (c.name.toLowerCase() === dest || destinationByName(c.name)?.name.toLowerCase() === dest);
  for (const a of CITY_ALIASES) {
    const m = new RegExp(`\\b(?:from|leaving|out of|flying out of|based in|live in|living in)\\s+${esc(a)}(?![\\w'])`).exec(lower);
    const c = CITY_ALIAS.get(a);
    if (m && c && !isDest(c)) return c;
  }
  for (const a of CITY_ALIASES) {
    if (!bareSafe(a)) continue;
    const c = CITY_ALIAS.get(a);
    if (c && !isDest(c) && new RegExp(`(?:^|[^\\w'])${esc(a)}(?![\\w'])`).test(lower)) return c;
  }
  for (const m of raw.matchAll(/\b([A-Z]{3})\b/g)) {
    const c = NOT_BARE_CODE.has(m[1]) ? undefined : CITIES.find((x) => x.code === m[1]);
    if (c && !isDest(c)) return c;
  }
  return undefined;
}
