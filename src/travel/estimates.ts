// Estimates provider (deterministic, no I/O). Used whenever the dates are too far ahead to book (about 11
// months) or no live provider is configured. Every listing is example: true, estimate: true; stays that describe
// a listing are titled "Example listing · estimated price"; destinations without a guide get a "rough regional
// average". result.estimates is always true here.

import type { TravelQuery, TravelResult } from '../engine/types.js';
import { type City, cityByName, destinationByName } from '../engine/ext/travel/geo.js';
import { type EstimateInput, type EstimateParts } from './data/shared.js';
import { japanEstimate } from './data/japan.js';
import { regionalEstimate } from './data/regions.js';
import { airbnbSearchUrl, isFarAhead, tripDates } from './links.js';

export const ESTIMATES_SOURCE = 'estimates';

function originOf(name: string): City {
  return cityByName(name) ?? { name, code: name.replace(/[^A-Za-z ]/g, '').trim().slice(0, 20) || 'home', region: 'other' };
}

export function estimateTrip(q: TravelQuery, now: number): TravelResult {
  const dest = destinationByName(q.destination);
  const key = dest?.key ?? 'world';
  const nights = Math.max(1, Math.round(q.nights));
  const travelers = Math.max(1, Math.round(q.travelers));
  const dates = tripDates(q);
  const bookable = !!dates && !isFarAhead(q, now);
  const place = key === 'japan' ? 'Tokyo, Japan' : q.destination;
  const x: EstimateInput = {
    origin: originOf(q.origin),
    destination: dest?.name ?? q.destination,
    nights,
    travelers,
    month: q.month,
    year: q.year,
    tier: q.tier,
    interests: q.interests,
  };
  if (bookable && dates) x.staysSearchUrl = airbnbSearchUrl(place, dates, travelers);
  const parts: EstimateParts = key === 'japan' ? japanEstimate(x) : regionalEstimate(key, x);
  return {
    query: q,
    estimates: true,
    basis: parts.basis,
    itinerary: parts.itinerary,
    listings: parts.listings,
    savings: parts.savings,
    lastMinute: [],
    totalPerPersonUsd: parts.listings.reduce((s, l) => s + l.pricePerPersonUsd, 0),
    source: ESTIMATES_SOURCE,
  };
}
