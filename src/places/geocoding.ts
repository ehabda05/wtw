import { fetchJson } from './http.js';
import type { GeoPoint } from './geo.js';

const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

interface GeocodeResult {
  formatted_address?: string;
  partial_match?: boolean;
  types?: string[];
  geometry?: { location?: { lat?: number; lng?: number } };
}

export type GeocodeOutcome =
  | { kind: 'resolved'; point: GeoPoint }
  | { kind: 'unresolved' }
  | { kind: 'ambiguous' };

export async function geocodeGoogle(
  query: string,
  opts: { apiKey: string; fetch: typeof fetch; timeoutMs: number },
): Promise<GeocodeOutcome> {
  const url = new URL(GEOCODE_URL);
  url.searchParams.set('address', query.slice(0, 200));
  url.searchParams.set('key', opts.apiKey);
  const json = (await fetchJson(opts.fetch, url.toString(), { method: 'GET' }, opts.timeoutMs)) as
    | { status?: string; results?: GeocodeResult[] }
    | null;
  if (json?.status === 'ZERO_RESULTS') return { kind: 'unresolved' };
  if (json?.status !== 'OK' || !Array.isArray(json.results) || !json.results.length) throw new Error('geocoding provider returned an invalid response');
  const result = json.results[0];
  const location = result.geometry?.location;
  if (typeof location?.lat !== 'number' || typeof location.lng !== 'number') throw new Error('geocoding result had no coordinates');
  const placeTypes = result.types ?? [];
  const precise = placeTypes.some((type) =>
    ['locality', 'postal_town', 'neighborhood', 'route', 'street_address', 'premise', 'subpremise', 'point_of_interest'].includes(type),
  );
  if (result.partial_match || !precise) return { kind: 'ambiguous' };
  const city = placeTypes.some((type) => ['locality', 'postal_town', 'administrative_area_level_2'].includes(type));
  return {
    kind: 'resolved',
    point: {
      lat: location.lat,
      lon: location.lng,
      label: result.formatted_address?.slice(0, 120) || query.slice(0, 120),
      midpoint: false,
      ids: [],
      radiusMeters: city ? 5000 : 1600,
    },
  };
}
