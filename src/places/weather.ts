// Weather glance from the US National Weather Service (api.weather.gov): no key, free
// (research/places-api.md §5d).
//
// Endpoints verified 2026-10-16 against https://www.weather.gov/documentation/services-web-api :
//   - "A User Agent is required to identify your application."
//   - GET https://api.weather.gov/points/{latitude},{longitude} -> properties.forecast (12-hour
//     periods, 7 days) and properties.forecastHourly (hourly, 7 days); GeoJSON by default
//     (application/geo+json)
//   - period fields used: startTime, endTime, shortForecast, temperature, temperatureUnit,
//     probabilityOfPrecipitation.value (seen in the live response for BOX/69,101 in research)
//
// PRIVACY: the only thing NWS receives is our gazetteer centroid rounded to 2 decimals (~1 km).
// No neighborhood text, no names. Returns null on any failure, timeout (3 s per request), or
// when `at` is past the end of the forecast ("no forecast yet").

import { fetchJson } from './http.js';

export const NWS_BASE = 'https://api.weather.gov';
export const NWS_USER_AGENT = 'otto-hackharvard/0.1 (privacy-first planner)';

export interface WeatherResult {
  rainLikely: boolean;
  summary?: string;
}

export interface WeatherOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** epoch ms; defaults to Date.now() */
  now?: number;
}

interface NwsPeriod {
  startTime?: string;
  endTime?: string;
  shortForecast?: string;
  temperature?: number;
  temperatureUnit?: string;
  probabilityOfPrecipitation?: { value?: number | null } | null;
}

const RAIN_RE = /rain|showers|storm|drizzle/i;

/** 2-decimal coordinate formatted without trailing zeros (NWS redirects non-canonical forms). */
export function roundCoord(x: number): string {
  return String(Math.round(x * 100) / 100);
}

export function pointsUrl(lat: number, lon: number): string {
  return `${NWS_BASE}/points/${roundCoord(lat)},${roundCoord(lon)}`;
}

function getJson(url: string, opts: WeatherOptions): Promise<unknown> {
  return fetchJson(
    opts.fetch ?? globalThis.fetch,
    url,
    { method: 'GET', headers: { 'User-Agent': NWS_USER_AGENT, Accept: 'application/geo+json' } },
    opts.timeoutMs ?? 3000,
  );
}

/** Only follow forecast URLs on the NWS host itself. */
function nwsUrl(u: unknown): string | null {
  if (typeof u !== 'string') return null;
  try {
    const url = new URL(u);
    return url.protocol === 'https:' && url.hostname === 'api.weather.gov' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Pure: decide from one forecast period. */
export function classifyPeriod(p: NwsPeriod): WeatherResult {
  const pop = typeof p.probabilityOfPrecipitation?.value === 'number' ? p.probabilityOfPrecipitation.value : null;
  const text = p.shortForecast ?? '';
  // Rule: PoP >= 50, or the forecast text says rain/showers/storm/drizzle.
  // Exception: "Slight Chance ..." with a known PoP under 30 is not "likely" (avoids crying wolf).
  const slight = /^slight chance/i.test(text.trim()) && pop !== null && pop < 30;
  const rainLikely = (pop !== null && pop >= 50) || (RAIN_RE.test(text) && !slight);
  const parts: string[] = [];
  if (text) parts.push(text);
  if (typeof p.temperature === 'number') parts.push(`${p.temperature}°${p.temperatureUnit ?? 'F'}`);
  if (pop !== null) parts.push(`${pop}% chance of precipitation`);
  return parts.length ? { rainLikely, summary: parts.join(', ') } : { rainLikely };
}

/** Find the period whose [startTime, endTime) covers `at`. */
export function findPeriod(periods: NwsPeriod[], at: number): NwsPeriod | null {
  for (const p of periods) {
    const s = p.startTime ? Date.parse(p.startTime) : NaN;
    const e = p.endTime ? Date.parse(p.endTime) : NaN;
    if (Number.isFinite(s) && Number.isFinite(e) && at >= s && at < e) return p;
  }
  return null;
}

/**
 * Forecast at `at` (epoch ms) for a coordinate we derived ourselves. Uses the hourly forecast
 * when it covers `at`, else the 12-hour forecast. null if unavailable or out of range.
 */
export async function getWeather(lat: number, lon: number, at: number, opts: WeatherOptions = {}): Promise<WeatherResult | null> {
  try {
    const now = opts.now ?? Date.now();
    if (!Number.isFinite(at) || at < now - 60 * 60_000) return null; // past: nothing to forecast
    if (at > now + 7 * 24 * 60 * 60_000) return null; // beyond NWS's 7 days: "no forecast yet"

    const points = (await getJson(pointsUrl(lat, lon), opts)) as { properties?: { forecast?: unknown; forecastHourly?: unknown } };
    const hourly = nwsUrl(points?.properties?.forecastHourly);
    const twelve = nwsUrl(points?.properties?.forecast);
    const order = at - now <= 6 * 24 * 60 * 60_000 ? [hourly, twelve] : [twelve, hourly];

    for (const url of order) {
      if (!url) continue;
      const fc = (await getJson(url, opts)) as { properties?: { periods?: NwsPeriod[] } };
      const periods = Array.isArray(fc?.properties?.periods) ? fc.properties.periods : [];
      const p = findPeriod(periods, at);
      if (p) return classifyPeriod(p);
    }
    return null;
  } catch {
    return null;
  }
}
