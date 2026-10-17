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
import type { Dataset, PlaceCandidate } from './types.js';
import { getWeather, type WeatherResult } from './weather.js';

export type PlacesSource = 'google' | 'osm' | 'fallback' | 'no-coverage' | 'unknown-neighborhood';

export interface PlacesConfig {
  provider?: 'offline' | 'google';
  apiKey?: string;
  /** Injected HTTP client (tests). Defaults to the global fetch, resolved at call time. */
  fetch?: typeof fetch;
  /** Clock (tests). */
  now?: () => number;
  timeoutMs?: number;
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
  return env.PLACES_PROVIDER?.trim().toLowerCase() === 'google' && key ? { provider: 'google', apiKey: key } : { provider: 'offline' };
}

export function createPlacesService(config: PlacesConfig = {}): PlacesService {
  const provider: 'offline' | 'google' = config.provider === 'google' && config.apiKey ? 'google' : 'offline';
  const now = config.now ?? (() => Date.now());
  const fetchImpl: typeof fetch = config.fetch ?? ((input, init) => globalThis.fetch(input, init));

  return {
    provider,

    async search(query) {
      const center = geocode(query.near);
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
        } catch {
          // fall through to the snapshot; never log the query (it is plan data)
        }
        googleFailed = true;
      }

      const dataset = config.dataset ?? loadDataset();
      const options = searchOffline(query, center, { dataset, now: now() });
      if (options.length === 0 && !hasCoverage(center, { dataset })) return { options, source: 'no-coverage' };
      return { options, source: googleFailed ? 'fallback' : 'osm' };
    },

    async weather(near, at) {
      const center = geocode(near);
      if (!center) return null;
      return getWeather(center.lat, center.lon, at, { fetch: fetchImpl, now: now(), timeoutMs: config.timeoutMs ?? 3000 });
    },
  };
}

export { geocode, haversineMeters, walkMinutes, mapsUrl, knownNeighborhoods, NEIGHBORHOODS } from './geo.js';
export type { GeoPoint, Neighborhood } from './geo.js';
export { openAt } from './hours.js';
export { searchOffline, loadDataset } from './fallback.js';
export { OSM_ATTRIBUTION, OSM_CREDIT, GOOGLE_CREDIT } from './types.js';
export type { PlaceCandidate, Dataset, DatasetPlace } from './types.js';
export type { WeatherResult } from './weather.js';
