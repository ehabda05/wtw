// Places service for the runner: turns the engine's `lookup_places` / `lookup_weather` actions
// into `places_result` / `weather_result` events (docs/ARCHITECTURE.md, docs/HUNGRY_FLOW.md).
//
//   const places = createPlacesService(placesConfigFromEnv());
//   const { options, source } = await places.search(query);
//
// Provider choice (decision D5, research/places-api.md §5):
//   - default 'offline': bundled OSM snapshot, zero network calls
//   - 'google' (+ apiKey): Google Places Text Search, falling back to the snapshot on error,
//     timeout (3 s) or an empty answer
// The neighborhood string is geocoded locally (geo.ts) and never leaves the server.
//
// `source` values: 'google' | 'osm' | 'fallback' (Google failed, snapshot used: say so in
// "homi why") | 'no-coverage' (known neighborhood, but the snapshot has nothing near it) |
// 'unknown-neighborhood' (ask the group to pick a neighborhood).

import type { PlacesQuery } from '../engine/types.js';
import { searchOffline, hasCoverage, loadDataset } from './fallback.js';
import { geocode } from './geo.js';
import { searchGoogle } from './google.js';
import { geocodeGoogle } from './geocoding.js';
import type { Dataset, PlaceCandidate } from './types.js';
import { getWeather, type WeatherResult } from './weather.js';

export type PlacesSource =
  | 'google'
  | 'osm'
  | 'fallback'
  | 'no-coverage'
  | 'unknown-neighborhood'
  | 'unknown-location'
  | 'ambiguous-location'
  | 'provider-error'
  | 'provider-limit';

export interface PlacesConfig {
  provider?: 'offline' | 'google';
  apiKey?: string;
  /** Injected HTTP client (tests). Defaults to the global fetch, resolved at call time. */
  fetch?: typeof fetch;
  /** Clock (tests). */
  now?: () => number;
  timeoutMs?: number;
  maxSearchesPerDay?: number;
  /** Alternate snapshot (tests). */
  dataset?: Dataset;
}

export interface PlacesService {
  readonly provider: 'offline' | 'google';
  search(query: PlacesQuery): Promise<{ options: PlaceCandidate[]; source: PlacesSource }>;
  weather(near: string, at: number): Promise<WeatherResult | null>;
}

/** PLACES_PROVIDER=google and PLACES_API_KEY=... enable the live provider; anything else is offline. */
export function placesConfigFromEnv(env: Record<string, string | undefined> = process.env): PlacesConfig {
  const key = env.PLACES_API_KEY?.trim();
  const timeout = Number(env.PLACES_TIMEOUT_MS);
  const limit = Number(env.PLACES_MAX_SEARCHES_PER_DAY);
  return {
    provider: env.PLACES_PROVIDER?.trim().toLowerCase() === 'google' && key ? 'google' : 'offline',
    ...(key ? { apiKey: key } : {}),
    ...(Number.isFinite(timeout) && timeout >= 250 && timeout <= 30_000 ? { timeoutMs: timeout } : {}),
    ...(Number.isInteger(limit) && limit > 0 && limit <= 100_000 ? { maxSearchesPerDay: limit } : {}),
  };
}

export function createPlacesService(config: PlacesConfig = {}): PlacesService {
  const provider: 'offline' | 'google' = config.provider === 'google' && config.apiKey ? 'google' : 'offline';
  const now = config.now ?? (() => Date.now());
  const fetchImpl: typeof fetch = config.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const searches = new Map<string, { options: PlaceCandidate[]; source: PlacesSource; expiresAt: number }>();
  let usageDay = '';
  let dailySearches = 0;

  return {
    provider,

    async search(query) {
      const nowMs = now();
      const searchKey = JSON.stringify({ ...query, near: query.near.trim().toLowerCase(), at: query.at ? Math.floor(query.at / 3_600_000) : undefined });
      const cachedResult = provider === 'offline' ? searches.get(searchKey) : undefined;
      if (cachedResult && cachedResult.expiresAt > nowMs) return { options: cachedResult.options, source: cachedResult.source };
      searches.delete(searchKey);

      const day = new Date(nowMs).toISOString().slice(0, 10);
      if (day !== usageDay) {
        usageDay = day;
        dailySearches = 0;
      }
      if (provider === 'google' && dailySearches >= (config.maxSearchesPerDay ?? 500)) return { options: [], source: 'provider-limit' };
      if (provider === 'google') dailySearches++;

      let center = geocode(query.near);
      if (!center && provider === 'google') {
        let result: Awaited<ReturnType<typeof geocodeGoogle>>;
        try {
          result = await geocodeGoogle(query.near, {
            apiKey: config.apiKey as string,
            fetch: fetchImpl,
            timeoutMs: config.timeoutMs ?? 3000,
          });
        } catch {
          return { options: [], source: 'provider-error' };
        }
        if (result.kind === 'ambiguous') return { options: [], source: 'ambiguous-location' };
        if (result.kind === 'unresolved') return { options: [], source: 'unknown-location' };
        center = result.point;
      }
      if (!center) return { options: [], source: 'unknown-neighborhood' };

      let googleFailed = false;
      if (provider === 'google') {
        try {
          const options = await searchGoogle(query, center, {
            apiKey: config.apiKey!,
            fetch: fetchImpl,
            now: now(),
            timeoutMs: config.timeoutMs ?? 3000,
          });
          if (options.length > 0) return { options, source: 'google' };
          googleFailed = true;
        } catch {
          googleFailed = true;
        }
      }

      if (query.category && !['cafe'].includes(query.category)) {
        const result: { options: PlaceCandidate[]; source: PlacesSource } = {
          options: [],
          source: googleFailed ? 'provider-error' : 'no-coverage',
        };
        if (provider === 'offline') searches.set(searchKey, { ...result, expiresAt: nowMs + 60_000 });
        return result;
      }
      const dataset = config.dataset ?? loadDataset();
      const options = searchOffline(query, center, { dataset, now: nowMs });
      const source: PlacesSource = options.length === 0 && !hasCoverage(center, { dataset }) ? 'no-coverage' : googleFailed ? 'fallback' : 'osm';
      const result = { options, source };
      if (provider === 'offline') searches.set(searchKey, { ...result, expiresAt: nowMs + 5 * 60_000 });
      if (searches.size > 256) searches.delete(searches.keys().next().value as string);
      return result;
    },

    async weather(near, at) {
      const center = geocode(near);
      if (!center) return null;
      return getWeather(center.lat, center.lon, at, { fetch: fetchImpl, now: now(), timeoutMs: config.timeoutMs ?? 3000 });
    },
  };
}

export { geocode, haversineMeters, walkMinutes, mapsUrl, knownNeighborhoods, NEIGHBORHOODS } from './geo.js';
export { geocodeGoogle } from './geocoding.js';
export type { GeoPoint, Neighborhood } from './geo.js';
export { openAt } from './hours.js';
export { searchOffline, loadDataset } from './fallback.js';
export { OSM_ATTRIBUTION, OSM_CREDIT, GOOGLE_CREDIT } from './types.js';
export type { PlaceCandidate, Dataset, DatasetPlace } from './types.js';
export type { WeatherResult } from './weather.js';
