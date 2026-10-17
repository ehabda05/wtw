// Types for the bundled OSM dataset (src/places/data/harvard-allston.json) and for the
// candidates this module returns. Engine contracts live in src/engine/types.ts (not edited here).

import type { PlaceOption, PriceBand } from '../engine/types.js';

export const OSM_ATTRIBUTION =
  '© OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright)';
/** Short credit line for chat answers built from the snapshot (research/places-api.md §4). */
export const OSM_CREDIT = 'Data © OpenStreetMap contributors (ODbL)';
/** Credit for answers built from Google Places results (research/places-api.md §1b). */
export const GOOGLE_CREDIT = 'Google Maps';

export interface DatasetPlace {
  /** "node/123" or "way/456" */
  osmId: string;
  name: string;
  amenity: string;
  /** Normalized engine tags, e.g. ["ramen", "japanese", "noodle"] */
  cuisine: string[];
  /** From diet:*=yes|only (and cuisine=vegan/vegetarian), normalized. */
  diet: string[];
  /** From diet:*=no. Lets the diet filter be hard where the data says so. */
  dietNo?: string[];
  lat: number;
  lon: number;
  address?: string;
  /** Raw OSM opening_hours, kept only if the opening_hours library parses it. */
  hours?: string;
  priceBand: PriceBand;
  priceEstimated: true;
  /** Which source extract it came from: "harvard-square" | "allston". */
  area: string;
}

export interface DatasetSource {
  file: string;
  area: string;
  query: { center: { lat: number; lon: number }; radiusM: number; amenities: string[] };
  osmTimestamp: string;
  elements: number;
}

export interface DatasetHeader {
  attribution: string;
  license: string;
  licenseUrl: string;
  builtAt: string;
  sources: DatasetSource[];
  note: string;
  counts: {
    places: number;
    byArea: Record<string, number>;
    withCuisine: number;
    withHours: number;
    withAddress: number;
    withDiet: number;
    unnamedSkipped: number;
    duplicatesMerged: number;
    invalidHoursDropped: number;
  };
}

export interface Dataset {
  header: DatasetHeader;
  places: DatasetPlace[];
}

/** What search() returns: the engine's PlaceOption plus a few fields that explain the pick. */
export interface PlaceCandidate extends PlaceOption {
  /** Requested cuisines (engine tags, vote order) this place matched. Empty = general nearby pick. */
  matchedCuisines: string[];
  /** Diet needs we could not confirm from the data: render as "check: nut allergy". */
  dietCheck: string[];
  /** Straight-line meters from the neighborhood centroid (or midpoint). */
  distanceMeters: number;
  /** Google place ID (storable indefinitely per Google policy). Google rows only. */
  googlePlaceId?: string;
}
