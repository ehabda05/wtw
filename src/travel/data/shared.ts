// Shared pieces of the estimate models (pure).

import type { TravelListing } from '../../engine/types.js';
import type { City, OriginRegion } from '../../engine/ext/travel/geo.js';

export const EXAMPLE_LABEL = 'Example listing · estimated price';

export type Tier = 'budget' | 'comfort';

/** What a destination model needs: the query resolved against the gazetteer. */
export interface EstimateInput {
  origin: City;               // unknown origins arrive as { code: <name>, region: 'other' }
  destination: string;        // display name
  nights: number;
  travelers: number;
  month?: number;
  year: number;
  tier: Tier;
  interests: string[];
  /** Verifiable Airbnb search for the dates, when they are bookable. */
  staysSearchUrl?: string;
}

export interface EstimateParts {
  basis: string;
  itinerary: string[];
  listings: TravelListing[];
  savings: string[];
}

export const roundTo = (x: number, step: number): number => Math.round(x / step) * step;

/**
 * Per-person stay cost relative to a group of 4-6 sharing an apartment or rooms:
 * solo travelers pay for a whole room, pairs share one, big groups split bigger places.
 */
export function occupancy(travelers: number): number {
  if (travelers <= 1) return 1.6;
  if (travelers === 2) return 1.15;
  if (travelers === 3) return 1.1;
  if (travelers <= 6) return 1.0;
  return 0.95;
}

/** "3-bedroom" for 5 people; "two apartments" past 8. */
export function bedrooms(travelers: number): string {
  if (travelers <= 1) return 'studio';
  if (travelers > 8) return 'two';
  return `${Math.ceil(travelers / 2)}-bedroom`;
}

/** "Days 1–4", "Day 5". */
export function days(from: number, to: number): string {
  return from === to ? `Day ${from}` : `Days ${from}–${to}`;
}

/** Every estimated listing is an example with an estimated price (never a real, bookable listing). */
export function est(l: Omit<TravelListing, 'example' | 'estimate'>): TravelListing {
  return { ...l, example: true, estimate: true };
}

export type FlightTable = Record<OriginRegion, number>;
