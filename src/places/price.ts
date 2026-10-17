// Price band estimate for OSM places. OSM has no price data in our areas (0 of 235 POIs,
// research/places-api.md §3), so the band is a TEAM ESTIMATE from amenity type and cuisine
// pattern only (research/places-api.md §5c). It never encodes a per-restaurant fact and is
// never copied from Google or Yelp. Always rendered as "~$$ (est.)" (Place.priceEstimated).

import type { PriceBand } from '../engine/types.js';
import { SNACK_CUISINES } from './cuisine.js';

/** amenity=* values that are counter-service or snack places. */
const CHEAP_AMENITIES = new Set(['fast_food', 'cafe', 'ice_cream', 'bubble_tea', 'bakery', 'food_court']);

/**
 * Small override list: cuisine patterns that usually mean a pricier sit-down meal.
 * Deliberately short. Add a pattern here only with a team decision noted in NOTES.md.
 */
const PRICEY_CUISINES = new Set(['steak_house', 'fine_dining', 'french']);

export const PRICE_RULES_NOTE =
  'priceBand is a team estimate, not data: fast_food/cafe/ice_cream/bubble_tea/bakery (amenity or cuisine) -> $; ' +
  'restaurant -> $$; cuisine steak_house/fine_dining/french -> $$$. OSM has no price tags here; nothing was copied from Google or Yelp.';

export function estimatePriceBand(amenity: string | undefined, cuisines: readonly string[]): PriceBand {
  if (amenity && CHEAP_AMENITIES.has(amenity)) return 1;
  if (cuisines.length > 0 && cuisines.every((c) => SNACK_CUISINES.has(c))) return 1;
  if (cuisines.some((c) => PRICEY_CUISINES.has(c))) return 3;
  return 2;
}
