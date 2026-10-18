// DEMO_SIMPLE=on: after the date locks Homi asks one question ("What are we feeling?"), maps the answers onto one of
// the 15 most-asked-for cuisines, and posts three curated Boston / Cambridge spots for it (no lookups, no network).
// Real places, picked as a demo starting point; addresses are from memory and the maps link searches by name, so
// the pin is a hint, not a promise. Edit this table to change the list.

import type { PlaceOption } from './types.js';

export interface CuratedPick extends PlaceOption {
  /** Short neighborhood label shown in the bubble instead of a walk time. */
  hood: string;
}

export type CuratedKey =
  | 'mexican' | 'italian' | 'chinese' | 'japanese' | 'thai' | 'indian' | 'american' | 'pizza'
  | 'mediterranean' | 'korean' | 'vietnamese' | 'middle_eastern' | 'seafood' | 'ethiopian' | 'spanish';

export const CURATED_KEYS: readonly CuratedKey[] = [
  'mexican', 'italian', 'chinese', 'japanese', 'thai', 'indian', 'american', 'pizza',
  'mediterranean', 'korean', 'vietnamese', 'middle_eastern', 'seafood', 'ethiopian', 'spanish',
];

export const CURATED_LABEL: Record<CuratedKey, string> = {
  mexican: 'Mexican', italian: 'Italian', chinese: 'Chinese', japanese: 'Japanese', thai: 'Thai', indian: 'Indian',
  american: 'Burgers & American', pizza: 'Pizza', mediterranean: 'Mediterranean', korean: 'Korean', vietnamese: 'Vietnamese',
  middle_eastern: 'Middle Eastern', seafood: 'Seafood', ethiopian: 'Ethiopian', spanish: 'Spanish tapas',
};

/** Engine cuisine tags (hungry.ts CUISINES) -> curated key. Unlisted tags (dessert, coffee, vegan ...) map to nothing. */
const TAG_TO_KEY: Record<string, CuratedKey> = {
  mexican: 'mexican',
  italian: 'italian',
  chinese: 'chinese', dumpling: 'chinese', noodle: 'chinese',
  japanese: 'japanese', sushi: 'japanese', ramen: 'japanese',
  thai: 'thai',
  indian: 'indian', nepalese: 'indian',
  american: 'american', burger: 'american', bbq: 'american', sandwich: 'american',
  pizza: 'pizza',
  mediterranean: 'mediterranean', greek: 'mediterranean',
  korean: 'korean',
  vietnamese: 'vietnamese',
  middle_eastern: 'middle_eastern', kebab: 'middle_eastern', falafel: 'middle_eastern',
  seafood: 'seafood',
  ethiopian: 'ethiopian',
  spanish: 'spanish',
};

export function curatedKeyOf(tag: string): CuratedKey | undefined {
  return TAG_TO_KEY[tag];
}

/** The curated cuisine with the most votes (first named wins ties); none named -> Mexican. */
export function pickCuratedKey(ranked: Array<[string, number]>): CuratedKey {
  for (const [tag] of ranked) {
    const k = curatedKeyOf(tag);
    if (k) return k;
  }
  return 'mexican';
}

const pick = (id: number, name: string, hood: string, address: string, lat: number, lon: number, priceBand: 1 | 2 | 3, cuisine: CuratedKey): CuratedPick => ({
  id, name, hood, address, lat, lon, priceBand, cuisine, source: 'curated', priceEstimated: true,
  mapsUrl: `https://maps.apple.com/?q=${encodeURIComponent(name)}&ll=${lat},${lon}`,
});

export const CURATED: Record<CuratedKey, readonly CuratedPick[]> = {
  mexican: [
    pick(1, "El Jefe's Taqueria", 'Harvard Square', '14 Brattle Street, Cambridge', 42.3733, -71.1200, 1, 'mexican'),
    pick(2, 'Lolita Cocina & Tequila Bar', 'Back Bay', '271 Dartmouth Street, Boston', 42.3505, -71.0775, 3, 'mexican'),
    pick(3, 'Villa México Café', 'Downtown', '296 Franklin Street, Boston', 42.3556, -71.0537, 1, 'mexican'),
  ],
  italian: [
    pick(1, "Giacomo's Ristorante", 'North End', '355 Hanover Street, Boston', 42.3652, -71.0533, 2, 'italian'),
    pick(2, "Carmelina's", 'North End', '307 Hanover Street, Boston', 42.3645, -71.0541, 2, 'italian'),
    pick(3, 'Mamma Maria', 'North End', '3 North Square, Boston', 42.3637, -71.0536, 3, 'italian'),
  ],
  chinese: [
    pick(1, 'Mary Chung', 'Central Square', '464 Massachusetts Avenue, Cambridge', 42.3637, -71.1012, 1, 'chinese'),
    pick(2, 'Dumpling House', 'Central Square', '950 Massachusetts Avenue, Cambridge', 42.3663, -71.1079, 2, 'chinese'),
    pick(3, 'Gourmet Dumpling House', 'Chinatown', '52 Beach Street, Boston', 42.3512, -71.0609, 1, 'chinese'),
  ],
  japanese: [
    pick(1, 'Cafe Sushi', 'Harvard Square', '1105 Massachusetts Avenue, Cambridge', 42.3717, -71.1143, 2, 'japanese'),
    pick(2, 'Santouka Ramen', 'Harvard Square', '1 Bow Street, Cambridge', 42.3722, -71.1168, 2, 'japanese'),
    pick(3, 'Yume Wo Katare', 'Porter Square', '1923 Massachusetts Avenue, Cambridge', 42.3883, -71.1197, 1, 'japanese'),
  ],
  thai: [
    pick(1, '9 Tastes', 'Harvard Square', '50 JFK Street, Cambridge', 42.3722, -71.1206, 1, 'thai'),
    pick(2, 'Dakzen', 'Davis Square', '195 Elm Street, Somerville', 42.3961, -71.1227, 2, 'thai'),
    pick(3, 'Brown Sugar Café', 'Fenway', '1033 Commonwealth Avenue, Boston', 42.3522, -71.1217, 2, 'thai'),
  ],
  indian: [
    pick(1, 'Punjabi Dhaba', 'Inman Square', '225 Hampshire Street, Cambridge', 42.3733, -71.1009, 1, 'indian'),
    pick(2, 'Tanjore', 'Harvard Square', '18 Eliot Street, Cambridge', 42.3721, -71.1209, 2, 'indian'),
    pick(3, 'Mela', 'South End', '578 Tremont Street, Boston', 42.3436, -71.0714, 2, 'indian'),
  ],
  american: [
    pick(1, "Mr. Bartley's Burger Cottage", 'Harvard Square', '1246 Massachusetts Avenue, Cambridge', 42.3727, -71.1172, 1, 'american'),
    pick(2, 'Tasty Burger', 'Harvard Square', '40 JFK Street, Cambridge', 42.3725, -71.1205, 1, 'american'),
    pick(3, 'Shake Shack', 'Harvard Square', '92 Winthrop Street, Cambridge', 42.3722, -71.1210, 1, 'american'),
  ],
  pizza: [
    pick(1, "Pinocchio's Pizza & Subs", 'Harvard Square', '74 Winthrop Street, Cambridge', 42.3723, -71.1208, 1, 'pizza'),
    pick(2, 'Regina Pizzeria', 'North End', '11½ Thacher Street, Boston', 42.3654, -71.0567, 2, 'pizza'),
    pick(3, 'Otto', 'Harvard Square', '1432 Massachusetts Avenue, Cambridge', 42.3741, -71.1198, 1, 'pizza'),
  ],
  mediterranean: [
    pick(1, 'Oleana', 'Inman Square', '134 Hampshire Street, Cambridge', 42.3718, -71.0992, 3, 'mediterranean'),
    pick(2, 'Sofra Bakery & Cafe', 'Huron Village', '1 Belmont Street, Cambridge', 42.3816, -71.1406, 1, 'mediterranean'),
    pick(3, 'Committee', 'Seaport', '50 Northern Avenue, Boston', 42.3531, -71.0470, 3, 'mediterranean'),
  ],
  korean: [
    pick(1, 'Koreana', 'Central Square', '158 Prospect Street, Cambridge', 42.3685, -71.1003, 2, 'korean'),
    pick(2, 'Bonchon', 'Harvard Square', '57 JFK Street, Cambridge', 42.3722, -71.1208, 2, 'korean'),
    pick(3, 'Kaju Tofu House', 'Allston', '58 Harvard Avenue, Boston', 42.3531, -71.1322, 2, 'korean'),
  ],
  vietnamese: [
    pick(1, "Le's", 'Harvard Square', '36 JFK Street, Cambridge', 42.3724, -71.1205, 1, 'vietnamese'),
    pick(2, 'Pho Pasteur', 'Chinatown', '682 Washington Street, Boston', 42.3513, -71.0623, 1, 'vietnamese'),
    pick(3, 'Phở Hòa', 'Chinatown', '17 Beach Street, Boston', 42.3515, -71.0600, 1, 'vietnamese'),
  ],
  middle_eastern: [
    pick(1, 'Falafel Corner', 'Harvard Square', '8 Eliot Street, Cambridge', 42.3721, -71.1212, 1, 'middle_eastern'),
    pick(2, 'The Halal Guys', 'Harvard Square', '1215 Massachusetts Avenue, Cambridge', 42.3721, -71.1157, 1, 'middle_eastern'),
    pick(3, 'Boston Shawarma', 'Fenway', '315 Huntington Avenue, Boston', 42.3415, -71.0877, 1, 'middle_eastern'),
  ],
  seafood: [
    pick(1, 'Neptune Oyster', 'North End', '63 Salem Street, Boston', 42.3634, -71.0557, 3, 'seafood'),
    pick(2, 'The Daily Catch', 'North End', '323 Hanover Street, Boston', 42.3647, -71.0539, 2, 'seafood'),
    pick(3, 'Legal Sea Foods', 'Park Square', '26 Park Plaza, Boston', 42.3514, -71.0690, 3, 'seafood'),
  ],
  ethiopian: [
    pick(1, 'Addis Red Sea', 'South End', '544 Tremont Street, Boston', 42.3441, -71.0702, 2, 'ethiopian'),
    pick(2, 'Asmara', 'Central Square', '739 Massachusetts Avenue, Cambridge', 42.3655, -71.1048, 2, 'ethiopian'),
    pick(3, 'Fasika', 'East Somerville', '145 Broadway, Somerville', 42.3863, -71.0862, 1, 'ethiopian'),
  ],
  spanish: [
    pick(1, 'Toro', 'South End', '1704 Washington Street, Boston', 42.3371, -71.0749, 3, 'spanish'),
    pick(2, 'Barcelona Wine Bar', 'South End', '525 Tremont Street, Boston', 42.3446, -71.0707, 3, 'spanish'),
    pick(3, 'Taberna de Haro', 'Brookline', '999 Beacon Street, Brookline', 42.3455, -71.1091, 2, 'spanish'),
  ],
};

/** Kept for the Mexican-only demo and tests. */
export const BOSTON_MEXICAN: readonly CuratedPick[] = CURATED.mexican;

/** "$", "$$", "$$$" without the "(est.)" tail: in the demo the band is a label, not a measurement. */
export function curatedPrice(band: 1 | 2 | 3 | 4 | undefined): string | undefined {
  return band ? '$'.repeat(band) : undefined;
}
