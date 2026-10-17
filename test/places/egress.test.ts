// PRIVACY.md §9 / HUNGRY_FLOW.md §6: what leaves the server for places and weather.
// globalThis.fetch is stubbed; every request is recorded and inspected byte for byte.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { createPlacesService, placesConfigFromEnv } from '../../src/places/index.js';
import { GOOGLE_FIELD_MASK, GOOGLE_TEXT_SEARCH_URL } from '../../src/places/google.js';
import { NWS_USER_AGENT } from '../../src/places/weather.js';
import { geocode } from '../../src/places/geo.js';
import type { PlacesQuery } from '../../src/engine/types.js';

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(respond: (r: Recorded) => Response | Promise<Response>): Recorded[] {
  const calls: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    const rec: Recorded = {
      url: String(input instanceof Request ? input.url : input),
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : init?.body == null ? null : '<non-string body>',
    };
    calls.push(rec);
    return respond(rec);
  }) as typeof fetch;
  return calls;
}

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

const AT = DateTime.fromISO('2026-10-16T19:00', { zone: 'America/New_York' }).toMillis();
const NOW = AT - 30 * 60_000;
const HSQ = geocode('Harvard Square')!;

const googlePlaces = {
  places: [
    {
      id: 'ChIJ-test-1',
      displayName: { text: 'Test Thai Kitchen', languageCode: 'en' },
      primaryType: 'thai_restaurant',
      types: ['thai_restaurant', 'restaurant', 'food'],
      priceLevel: 'PRICE_LEVEL_MODERATE',
      regularOpeningHours: { openNow: true, periods: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ open: { day: d, hour: 11, minute: 0 }, close: { day: d, hour: 22, minute: 0 } })) },
      location: { latitude: HSQ.lat + 0.002, longitude: HSQ.lon },
      shortFormattedAddress: '1 Test St, Cambridge',
    },
  ],
};

const SENSITIVE = [/harvard/i, /square/i, /\bsq\b/i, /hsq/i, /cambridge/i, /allston/i, /vegetarian/i, /nut/i, /\bben\b/i, /\+1\d{10}/, /maya/i];

function assertNoSensitive(rec: Recorded) {
  // The NWS User-Agent is a fixed app identifier ("otto-hackharvard/...", required by NWS);
  // it is asserted to equal the constant separately, so it is left out of this scan.
  const { 'user-agent': _ua, ...headers } = rec.headers;
  const blob = [rec.url, JSON.stringify(headers), rec.body ?? ''].join('\n');
  for (const re of SENSITIVE) assert.doesNotMatch(blob, re, `request leaked ${re}`);
}

function decimals(x: number): number {
  const s = String(x);
  return s.includes('.') ? s.split('.')[1].length : 0;
}

test('Google request carries only cuisine text, rounded coordinates and price levels', async () => {
  const calls = stubFetch(() => json(googlePlaces));
  const svc = createPlacesService({ provider: 'google', apiKey: 'test-key-not-real', now: () => NOW });
  const query: PlacesQuery = { cuisines: ['thai', 'sushi'], priceMax: 2, diet: ['vegetarian', 'nut_allergy'], near: 'Harvard Square', at: AT };
  const res = await svc.search(query);

  assert.equal(res.source, 'google');
  assert.equal(calls.length, 2, 'one call per top cuisine');
  for (const rec of calls) {
    assert.equal(rec.url, GOOGLE_TEXT_SEARCH_URL);
    assert.ok(!rec.url.includes('?'), 'no query string');
    assert.equal(rec.method, 'POST');
    assert.deepEqual(Object.keys(rec.headers).sort(), ['content-type', 'x-goog-api-key', 'x-goog-fieldmask']);
    assert.equal(rec.headers['x-goog-fieldmask'], GOOGLE_FIELD_MASK);
    assert.equal(rec.headers['content-type'], 'application/json');

    const body = JSON.parse(rec.body!) as Record<string, any>;
    assert.deepEqual(Object.keys(body).sort(), ['locationBias', 'pageSize', 'priceLevels', 'textQuery']);
    assert.ok(['thai restaurant', 'sushi restaurant'].includes(body.textQuery), body.textQuery);
    assert.deepEqual(body.priceLevels, ['PRICE_LEVEL_INEXPENSIVE', 'PRICE_LEVEL_MODERATE']);
    assert.equal(body.pageSize, 20);
    assert.deepEqual(Object.keys(body.locationBias), ['circle']);
    assert.deepEqual(Object.keys(body.locationBias.circle).sort(), ['center', 'radius']);
    assert.equal(body.locationBias.circle.radius, 1200);
    const { latitude, longitude } = body.locationBias.circle.center;
    assert.deepEqual(Object.keys(body.locationBias.circle.center).sort(), ['latitude', 'longitude']);
    assert.ok(decimals(latitude) <= 3 && decimals(longitude) <= 3, `${latitude},${longitude} not rounded`);
    assert.equal(latitude, Math.round(HSQ.lat * 1000) / 1000);
    assert.equal(longitude, Math.round(HSQ.lon * 1000) / 1000);
    assertNoSensitive(rec);
  }
  assert.deepEqual(calls.map((c) => JSON.parse(c.body!).textQuery).sort(), ['sushi restaurant', 'thai restaurant']);
  assert.equal(res.options[0].source, 'google');
  assert.match(res.options[0].mapsUrl!, /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);
});

test('the neighborhood text never reaches Google: different spellings, identical bytes', async () => {
  const bodies: string[] = [];
  for (const near of ['Harvard Square', 'hsq', 'near the square pls']) {
    const calls = stubFetch(() => json(googlePlaces));
    const svc = createPlacesService({ provider: 'google', apiKey: 'k', now: () => NOW });
    await svc.search({ cuisines: ['thai'], diet: [], near, at: AT });
    assert.equal(calls.length, 1);
    bodies.push(calls[0].body!);
  }
  assert.equal(new Set(bodies).size, 1);
});

test('NWS request carries only a 2-decimal coordinate and the app User-Agent', async () => {
  const hourly = 'https://api.weather.gov/gridpoints/BOX/69,101/forecast/hourly';
  const calls = stubFetch((rec) => {
    if (rec.url.includes('/points/')) {
      return json({ properties: { forecast: 'https://api.weather.gov/gridpoints/BOX/69,101/forecast', forecastHourly: hourly } });
    }
    return json({
      properties: {
        periods: [
          {
            startTime: '2026-10-16T19:00:00-04:00',
            endTime: '2026-10-16T20:00:00-04:00',
            shortForecast: 'Chance Rain Showers',
            temperature: 54,
            temperatureUnit: 'F',
            probabilityOfPrecipitation: { unitCode: 'wmoUnit:percent', value: 60 },
          },
        ],
      },
    });
  });
  const svc = createPlacesService({ now: () => NOW });
  const w = await svc.weather('Harvard Square', AT);
  assert.deepEqual(w, { rainLikely: true, summary: 'Chance Rain Showers, 54°F, 60% chance of precipitation' });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://api.weather.gov/points/42.37,-71.12');
  assert.equal(calls[1].url, hourly, 'second call is the URL NWS itself returned');
  for (const rec of calls) {
    assert.equal(rec.method, 'GET');
    assert.equal(rec.body, null);
    assert.deepEqual(Object.keys(rec.headers).sort(), ['accept', 'user-agent']);
    assert.equal(rec.headers['user-agent'], NWS_USER_AGENT);
    assertNoSensitive(rec);
  }
  const m = /points\/(-?[\d.]+),(-?[\d.]+)$/.exec(calls[0].url)!;
  assert.ok(decimals(Number(m[1])) <= 2 && decimals(Number(m[2])) <= 2);
});

test('offline search makes ZERO network calls', async () => {
  const calls = stubFetch(() => {
    throw new Error('network must not be touched');
  });
  const svc = createPlacesService();
  assert.equal(svc.provider, 'offline');
  const res = await svc.search({ cuisines: ['korean'], priceMax: 2, diet: ['vegetarian'], near: 'Allston', at: AT });
  assert.equal(res.source, 'osm');
  assert.ok(res.options.length > 0);
  await svc.search({ cuisines: ['thai'], diet: [], near: 'harvard sq + allston', at: AT });
  await svc.search({ cuisines: ['thai'], diet: [], near: 'Kendall', at: AT });
  await svc.search({ cuisines: ['thai'], diet: [], near: 'near me', at: AT });

  // google selected but no key -> still offline
  const noKey = createPlacesService(placesConfigFromEnv({ PLACES_PROVIDER: 'google', PLACES_API_KEY: '' }));
  assert.equal(noKey.provider, 'offline');
  await noKey.search({ cuisines: ['pizza'], diet: [], near: 'Harvard Square', at: AT });
  assert.equal(calls.length, 0);
});

test('Google failure, timeout or empty answer falls back to the snapshot', async () => {
  const query: PlacesQuery = { cuisines: ['pizza'], diet: [], near: 'Harvard Square', at: AT };

  stubFetch(() => json({ error: { code: 403 } }, 403));
  let res = await createPlacesService({ provider: 'google', apiKey: 'k', now: () => NOW }).search(query);
  assert.equal(res.source, 'fallback');
  assert.ok(res.options.length > 0 && res.options.every((o) => o.source === 'osm'));

  stubFetch(() => json({}));
  res = await createPlacesService({ provider: 'google', apiKey: 'k', now: () => NOW }).search(query);
  assert.equal(res.source, 'fallback');

  // A server that never answers; like real fetch, the stub rejects when the signal aborts.
  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
    })) as typeof fetch;
  const t0 = Date.now();
  res = await createPlacesService({ provider: 'google', apiKey: 'k', now: () => NOW, timeoutMs: 50 }).search(query);
  assert.equal(res.source, 'fallback');
  assert.ok(Date.now() - t0 < 2000);
});

test('unknown neighborhood: no lookup at all', async () => {
  const calls = stubFetch(() => json(googlePlaces));
  const svc = createPlacesService({ provider: 'google', apiKey: 'k' });
  assert.deepEqual(await svc.search({ cuisines: ['thai'], diet: [], near: 'my place', at: AT }), { options: [], source: 'unknown-neighborhood' });
  assert.equal(await svc.weather('my place', AT), null);
  assert.equal(calls.length, 0);
});
