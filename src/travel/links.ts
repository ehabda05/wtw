// Dates and verifiable deep links for bookable trips (pure). Airbnb has no open public API (partner-only), so
// Homi links to an Airbnb SEARCH for the group's dates and guests instead of pretending to know a listing.

import type { TravelQuery } from '../engine/types.js';
import type { TripDates } from './providers.js';

const DAY = 24 * 60 * 60 * 1000;
/** Airlines open schedules roughly 11 months (about 330 days) ahead; beyond that everything is an estimate. */
export const BOOKABLE_DAYS = 330;

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Check-in / check-out for a query. TravelQuery carries a month, not a day, so check-in is the 15th
 * (docs/TRAVEL.md: an exact start date is a proposed contract addition). Undefined without a month.
 */
export function tripDates(q: TravelQuery): TripDates | undefined {
  if (q.month === undefined) return undefined;
  const start = Date.UTC(q.year, q.month - 1, 15);
  return { checkin: iso(start), checkout: iso(start + q.nights * DAY) };
}

/** True when the trip starts beyond what airlines and stays sell today (or has no month to price). */
export function isFarAhead(q: TravelQuery, now: number): boolean {
  const start = q.month === undefined ? Date.UTC(q.year, 6, 1) : Date.UTC(q.year, q.month - 1, 15);
  return start - now > BOOKABLE_DAYS * DAY;
}

/** https://www.airbnb.com/s/Tokyo--Japan/homes?checkin=2027-03-15&checkout=2027-03-25&adults=5 */
export function airbnbSearchUrl(place: string, dates: TripDates, adults: number): string {
  const slug = place
    .split(',')
    .map((s) => s.trim().replace(/\s+/g, '-'))
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('--');
  return `https://www.airbnb.com/s/${slug}/homes?checkin=${dates.checkin}&checkout=${dates.checkout}&adults=${adults}`;
}
