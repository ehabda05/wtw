// Google result mapping and NWS forecast logic, with injected fetch (no network).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { periodsOpenAt, searchGoogle, textQueryFor, textQueryForCategory, buildGoogleRequest } from '../../src/places/google.js';
import { geocodeGoogle } from '../../src/places/geocoding.js';
import { classifyPeriod, findPeriod, getWeather, pointsUrl } from '../../src/places/weather.js';
import { geocode } from '../../src/places/geo.js';

const ny = (iso: string) => DateTime.fromISO(iso, { zone: 'America/New_York' }).toMillis();
const HSQ = geocode('Harvard Square')!;
const daily = (oh: number, ch: number) =>
  [0, 1, 2, 3, 4, 5, 6].map((d) => ({ open: { day: d, hour: oh, minute: 0 }, close: { day: d, hour: ch, minute: 0 } }));

test('Google periods evaluated at New York plan time (0 = Sunday, overnight, week wrap)', () => {
  assert.equal(periodsOpenAt(daily(11, 22), ny('2026-10-16T19:00')), true);
  assert.equal(periodsOpenAt(daily(11, 22), ny('2026-10-16T23:00')), false);
  const lateFri = [{ open: { day: 5, hour: 18, minute: 0 }, close: { day: 6, hour: 2, minute: 0 } }];
  assert.equal(periodsOpenAt(lateFri, ny('2026-10-17T01:00')), true);
  assert.equal(periodsOpenAt(lateFri, ny('2026-10-17T03:00')), false);
  const satNight = [{ open: { day: 6, hour: 20, minute: 0 }, close: { day: 0, hour: 2, minute: 0 } }];
  assert.equal(periodsOpenAt(satNight, ny('2026-10-18T01:00')), true, 'Sat->Sun wraps the week');
  assert.equal(periodsOpenAt([{ open: { day: 0, hour: 0, minute: 0 } }], ny('2026-10-16T04:00')), true, '24/7');
  assert.equal(periodsOpenAt([], ny('2026-10-16T19:00')), null);
  assert.equal(periodsOpenAt(undefined, ny('2026-10-16T19:00')), null);
});

test('Google rows: price/closed filters, cuisine from types, Google Maps link, ids', async () => {
  const at = ny('2026-10-16T19:00');
  const near = (dLat: number) => ({ latitude: HSQ.lat + dLat, longitude: HSQ.lon });
  const payload = {
    places: [
      { id: 'a', displayName: { text: 'Far Thai' }, primaryType: 'thai_restaurant', priceLevel: 'PRICE_LEVEL_INEXPENSIVE', regularOpeningHours: { periods: daily(11, 22) }, location: near(0.004) },
      { id: 'b', displayName: { text: 'Near Thai' }, primaryType: 'thai_restaurant', priceLevel: 'PRICE_LEVEL_MODERATE', regularOpeningHours: { periods: daily(11, 22) }, location: near(0.001), shortFormattedAddress: '2 Test St' },
      { id: 'c', displayName: { text: 'Fancy Thai' }, primaryType: 'thai_restaurant', priceLevel: 'PRICE_LEVEL_EXPENSIVE', location: near(0.001) },
      { id: 'd', displayName: { text: 'Lunch Thai' }, primaryType: 'thai_restaurant', regularOpeningHours: { periods: daily(11, 15) }, location: near(0.001) },
      { id: 'e', displayName: { text: 'Generic Spot' }, primaryType: 'restaurant', location: near(0.002) },
      { id: 'f', displayName: { text: 'Burger Joint' }, primaryType: 'hamburger_restaurant', location: near(0.0005) },
      { id: 'g', displayName: { text: 'Way Too Far' }, primaryType: 'thai_restaurant', location: near(0.05) },
      { id: 'b', displayName: { text: 'Near Thai' }, primaryType: 'thai_restaurant', location: near(0.001) },
    ],
  };
  const fakeFetch = (async () => new Response(JSON.stringify(payload), { status: 200 })) as typeof fetch;
  const rows = await searchGoogle({ cuisines: ['thai'], priceMax: 2, diet: ['vegan'], near: 'x', at }, HSQ, { apiKey: 'k', fetch: fakeFetch, now: at - 3_600_000 });
  assert.deepEqual(rows.map((r) => r.name), ['Near Thai', 'Generic Spot', 'Far Thai', 'Burger Joint']);
  rows.forEach((r, i) => assert.equal(r.id, i + 1));
  const near1 = rows[0];
  assert.equal(near1.source, 'google');
  assert.equal(near1.priceBand, 2);
  assert.equal(near1.priceEstimated, false);
  assert.equal(near1.openAtPlanTime, true);
  assert.equal(near1.cuisine, 'thai');
  assert.equal(near1.address, '2 Test St');
  assert.equal(near1.googlePlaceId, 'b');
  assert.deepEqual(near1.dietCheck, ['vegan']);
  assert.equal(near1.mapsUrl, 'https://www.google.com/maps/search/?api=1&query=Near%20Thai&query_place_id=b');
  assert.equal(rows[1].openAtPlanTime, null);
  assert.deepEqual(rows[1].matchedCuisines, ['thai'], 'generic restaurant trusted from the query');
  assert.deepEqual(rows[3].matchedCuisines, []);
  assert.equal(rows[3].cuisine, 'burger');
});

test('Google request builder', () => {
  assert.equal(textQueryFor('thai'), 'thai restaurant');
  assert.equal(textQueryFor('coffee_shop'), 'coffee shop');
  assert.equal(textQueryFor('bubble_tea'), 'bubble tea');
  assert.equal(textQueryFor(undefined), 'restaurant');
  const r = buildGoogleRequest('thai', { lat: 42.3734734, lon: -71.1189431 }, 4, 1600);
  assert.deepEqual(r.body, {
    textQuery: 'thai restaurant',
    locationBias: { circle: { center: { latitude: 42.373, longitude: -71.119 }, radius: 1600 } },
    pageSize: 20,
  });
  assert.deepEqual(buildGoogleRequest('thai', HSQ, 1, 1200).body.priceLevels, ['PRICE_LEVEL_INEXPENSIVE']);
  assert.equal(textQueryForCategory('bowling'), 'bowling alley');
});

test('Google category search uses the requested activity category', async () => {
  let body: Record<string, unknown> | undefined;
  const fakeFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ places: [] }), { status: 200 });
  }) as typeof fetch;
  await searchGoogle({ cuisines: [], category: 'museum', diet: [], near: 'x' }, HSQ, { apiKey: 'k', fetch: fakeFetch });
  assert.equal(body?.textQuery, 'museum');
});

test('Google geocoding resolves explicit city text and reports ambiguous results', async () => {
  let request = '';
  const cityFetch = (async (input: string | URL | Request) => {
    request = String(input);
    return new Response(JSON.stringify({
      status: 'OK',
      results: [{
        formatted_address: 'Malden, MA, USA',
        types: ['locality', 'political'],
        geometry: { location: { lat: 42.4251, lng: -71.0662 } },
      }],
    }), { status: 200 });
  }) as typeof fetch;
  const result = await geocodeGoogle('Malden, Massachusetts', { apiKey: 'k', fetch: cityFetch, timeoutMs: 1000 });
  assert.equal(result.kind, 'resolved');
  if (result.kind === 'resolved') {
    assert.equal(result.point.label, 'Malden, MA, USA');
    assert.equal(result.point.radiusMeters, 5000);
  }
  assert.equal(new URL(request).searchParams.get('address'), 'Malden, Massachusetts');

  const ambiguousFetch = (async () => new Response(JSON.stringify({
    status: 'OK',
    results: [{
      formatted_address: 'Malden, MA, USA',
      partial_match: true,
      types: ['locality'],
      geometry: { location: { lat: 42.4251, lng: -71.0662 } },
    }],
  }), { status: 200 })) as typeof fetch;
  assert.deepEqual(await geocodeGoogle('Malden', { apiKey: 'k', fetch: ambiguousFetch, timeoutMs: 1000 }), { kind: 'ambiguous' });
});

test('NWS: rain classification', () => {
  assert.equal(classifyPeriod({ shortForecast: 'Sunny', probabilityOfPrecipitation: { value: 60 } }).rainLikely, true);
  assert.equal(classifyPeriod({ shortForecast: 'Chance Rain Showers', probabilityOfPrecipitation: { value: 40 } }).rainLikely, true);
  assert.equal(classifyPeriod({ shortForecast: 'Patchy Drizzle', probabilityOfPrecipitation: { value: null } }).rainLikely, true);
  assert.equal(classifyPeriod({ shortForecast: 'Chance Showers And Thunderstorms' }).rainLikely, true);
  assert.equal(classifyPeriod({ shortForecast: 'Mostly Clear', probabilityOfPrecipitation: { value: 2 } }).rainLikely, false);
  assert.equal(classifyPeriod({ shortForecast: 'Slight Chance Rain Showers', probabilityOfPrecipitation: { value: 20 } }).rainLikely, false);
  assert.deepEqual(classifyPeriod({ shortForecast: 'Partly Cloudy', temperature: 51, temperatureUnit: 'F', probabilityOfPrecipitation: { value: 10 } }), {
    rainLikely: false,
    summary: 'Partly Cloudy, 51°F, 10% chance of precipitation',
  });
});

test('NWS: period lookup, coordinate rounding, out-of-range and failures -> null', async () => {
  const periods = [
    { startTime: '2026-10-16T18:00:00-04:00', endTime: '2026-10-16T19:00:00-04:00', shortForecast: 'A' },
    { startTime: '2026-10-16T19:00:00-04:00', endTime: '2026-10-16T20:00:00-04:00', shortForecast: 'B' },
  ];
  assert.equal(findPeriod(periods, ny('2026-10-16T19:30'))?.shortForecast, 'B');
  assert.equal(findPeriod(periods, ny('2026-10-17T19:30')), null);
  assert.equal(pointsUrl(42.3734734, -71.1189431), 'https://api.weather.gov/points/42.37,-71.12');
  assert.equal(pointsUrl(42.3, -71.0), 'https://api.weather.gov/points/42.3,-71');

  let calls = 0;
  const counting = (async () => {
    calls++;
    throw new Error('offline');
  }) as typeof fetch;
  const now = ny('2026-10-16T12:00');
  assert.equal(await getWeather(42.37, -71.12, now + 9 * 86_400_000, { fetch: counting, now }), null, 'beyond 7 days');
  assert.equal(calls, 0, 'no call for an out-of-range date');
  assert.equal(await getWeather(42.37, -71.12, now + 3_600_000, { fetch: counting, now }), null, 'network error');
  assert.equal(calls, 1);

  // forecast exists but does not cover `at`
  const shortFc = (async (u: string | URL | Request) =>
    new Response(
      JSON.stringify(
        String(u).includes('/points/')
          ? { properties: { forecastHourly: 'https://api.weather.gov/gridpoints/BOX/1,1/forecast/hourly', forecast: 'https://api.weather.gov/gridpoints/BOX/1,1/forecast' } }
          : { properties: { periods } },
      ),
    )) as typeof fetch;
  assert.equal(await getWeather(42.37, -71.12, ny('2026-10-18T19:30'), { fetch: shortFc, now }), null);

  // a forecast URL that is not on api.weather.gov is never followed
  let followed: string[] = [];
  const evil = (async (u: string | URL | Request) => {
    followed.push(String(u));
    return new Response(JSON.stringify({ properties: { forecastHourly: 'https://evil.example/f', forecast: 'http://api.weather.gov/x' } }));
  }) as typeof fetch;
  assert.equal(await getWeather(42.37, -71.12, now + 3_600_000, { fetch: evil, now }), null);
  assert.deepEqual(followed, ['https://api.weather.gov/points/42.37,-71.12']);
});
