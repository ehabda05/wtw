// Opening-hours evaluation at plan time, in America/New_York, independent of the server TZ.
//
// The opening_hours library (LGPL-3.0, used as an npm dependency, not copied) evaluates a JS
// Date through its LOCAL getters (getDay/getHours/...). If we passed `new Date(at)` on a server
// running in UTC, "Fri 7pm in Cambridge" would be read as "Fri 11pm". So we build a Date whose
// local fields equal the New York wall-clock time (via luxon) and hand that to the library.
//
// Caveat: if the server's own zone has a DST gap at that exact wall-clock time (e.g. a server
// in Europe evaluating 02:30 on its spring-forward night), the Date constructor shifts it by an
// hour. Run the server with TZ=UTC (no gaps) to rule this out entirely.

import opening_hours from 'opening_hours';
import { DateTime } from 'luxon';

export const PLACES_TZ = 'America/New_York';

/** Used by the library for public holidays (US/MA) and sunrise/sunset rules. */
const NOMINATIM_CONTEXT = { lat: 42.37, lon: -71.12, address: { country_code: 'us', state: 'MA' } };

const cache = new Map<string, opening_hours | null>();

/** A Date whose LOCAL fields (year..second) equal the wall-clock time of `at` in `zone`. */
export function wallClockDate(at: number, zone: string = PLACES_TZ): Date {
  const dt = DateTime.fromMillis(at, { zone });
  return new Date(dt.year, dt.month - 1, dt.day, dt.hour, dt.minute, dt.second, dt.millisecond);
}

/** Parsed opening_hours object, or null when the string does not parse. Cached per string. */
export function parseHours(hours: string): opening_hours | null {
  if (cache.has(hours)) return cache.get(hours) ?? null;
  let oh: opening_hours | null = null;
  try {
    oh = new opening_hours(hours, NOMINATIM_CONTEXT);
  } catch {
    oh = null;
  }
  if (cache.size > 2000) cache.clear();
  cache.set(hours, oh);
  return oh;
}

export function isValidHours(hours: string): boolean {
  return parseHours(hours) !== null;
}

/**
 * Is the place open at `at` (epoch ms)? true / false, or null when hours are unknown,
 * unparseable, or the rule itself says "unknown" for that moment.
 */
export function openAt(hours: string | undefined | null, at: number, zone: string = PLACES_TZ): boolean | null {
  if (!hours) return null;
  const oh = parseHours(hours);
  if (!oh) return null;
  const d = wallClockDate(at, zone);
  try {
    if (oh.getUnknown(d)) return null;
    return oh.getState(d);
  } catch {
    return null;
  }
}
