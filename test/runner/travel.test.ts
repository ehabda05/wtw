// Runner side of travel: lookup_travel -> TravelService -> travel_result follow-up, provider fallback to labeled
// estimates, no external call for far-future trips, and the whole DEMO Act 5 loop through the real runner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAPS, type ChannelAdapter } from '../../src/channels/types.js';
import type { Action, TravelListing, TravelQuery } from '../../src/engine/types.js';
import { Executor, type ExecContext, type ExecOutcome } from '../../src/runner/executor.js';
import { createTravelHandler } from '../../src/runner/handlers/travel.js';
import { createExtHandlers } from '../../src/runner/handlers/index.js';
import type { Repo } from '../../src/store/repo.js';
import { TravelService } from '../../src/travel/service.js';
import {
  AmadeusFlights, BookingStays, DuffelFlights, ExpediaRapidStays, FareAlertsStub, NotConfiguredError, type LiveProviders, type TripDates,
} from '../../src/travel/providers.js';

const NOW = Date.parse('2026-10-24T14:00:00Z');
const Q = (over: Partial<TravelQuery> = {}): TravelQuery => ({
  destination: 'Japan', origin: 'Boston', year: 2030, month: 3, nights: 10, travelers: 5, budgetPerPersonUsd: 3000, tier: 'budget', interests: ['food'], ...over,
});
const deps = { dataDir: '.', now: () => NOW };
const ctxOf = (): ExecContext => ({
  spaceKey: 'space', surface: 'sim', spaceId: 'chat', adapter: { caps: CAPS.sim } as unknown as ChannelAdapter, state: { space: { spaceKey: 'space', introSent: true, tone: 'normal', tz: 'UTC', notice: false, muted: false }, plan: null }, now: NOW,
});

test('handler: lookup_travel -> travel_result follow-up with labeled estimates', async () => {
  const h = createTravelHandler(deps);
  assert.deepEqual(h.types, ['lookup_travel']);
  const out: ExecOutcome = { followUps: [], left: false };
  await h.run({ type: 'lookup_travel', requestId: 'r1', query: Q() }, ctxOf(), out);
  assert.equal(out.followUps.length, 1);
  const ev = out.followUps[0];
  assert.ok(ev.kind === 'travel_result');
  assert.equal(ev.requestId, 'r1');
  assert.equal(ev.result.estimates, true);
  assert.equal(ev.result.totalPerPersonUsd, 2670);
});

test('executor routes lookup_travel to the travel handler (registered by createExtHandlers)', async () => {
  const { handlers } = createExtHandlers(deps);
  assert.ok(handlers.some((h) => h.types.includes('lookup_travel')));
  const exec = new Executor({ repo: {} as Repo, handlers });
  const acts: Action[] = [{ type: 'lookup_travel', requestId: 'a', query: Q() }, { type: 'lookup_travel', requestId: 'b', query: Q({ tier: 'comfort' }) }];
  const out = await exec.execute(acts, ctxOf());
  assert.deepEqual(out.followUps.map((e) => (e.kind === 'travel_result' ? [e.requestId, e.result.totalPerPersonUsd] : e.kind)), [['a', 2670], ['b', 3620]]);
});

test('stubs throw a typed NotConfiguredError naming the missing credentials', async () => {
  const dates: TripDates = { checkin: '2027-03-15', checkout: '2027-03-25' };
  const cases: Array<[() => Promise<unknown>, string[]]> = [
    [() => new DuffelFlights({}).searchFlights(Q(), dates), ['DUFFEL_ACCESS_TOKEN']],
    [() => new AmadeusFlights({}).searchFlights(Q(), dates), ['AMADEUS_CLIENT_ID', 'AMADEUS_CLIENT_SECRET']],
    [() => new BookingStays({}).searchStays(Q(), dates), ['BOOKING_AFFILIATE_ID', 'BOOKING_API_TOKEN']],
    [() => new ExpediaRapidStays({}).searchStays(Q(), dates), ['EXPEDIA_RAPID_API_KEY', 'EXPEDIA_RAPID_SHARED_SECRET']],
    [() => new FareAlertsStub({}).lastMinute(Q(), dates), ['FARE_ALERTS_API_KEY']],
    [() => new DuffelFlights({ DUFFEL_ACCESS_TOKEN: 'x' }).searchFlights(Q(), dates), []],
  ];
  for (const [call, missing] of cases) {
    await assert.rejects(call, (e: unknown) => e instanceof NotConfiguredError && JSON.stringify(e.missing) === JSON.stringify(missing));
  }
});

test('a live provider that is not configured falls back to labeled estimates', async () => {
  const reasons: string[] = [];
  const svc = new TravelService({ provider: 'duffel', env: {}, onFallback: (r) => reasons.push(r) });
  const r = await svc.search(Q({ year: 2027, month: 3 }), NOW);
  assert.equal(r.source, 'estimates');
  assert.equal(r.estimates, true);
  assert.ok(r.listings.every((l) => l.example && l.estimate));
  assert.match(reasons[0], /DUFFEL_ACCESS_TOKEN/);
});

function spyProviders(listing?: (kind: 'flight' | 'stay') => TravelListing): { live: LiveProviders; calls: TravelQuery[] } {
  const calls: TravelQuery[] = [];
  const make = (kind: 'flight' | 'stay') => async (q: TravelQuery) => {
    calls.push(q);
    if (!listing) throw new Error('should not be called');
    return [listing(kind)];
  };
  return {
    calls,
    live: {
      flights: { id: 'fakeflights', searchFlights: make('flight') },
      stays: { id: 'fakestays', searchStays: make('stay') },
      alerts: { id: 'fakealerts', lastMinute: async () => ['BOS→NRT $890 round trip this week (link)'] },
    },
  };
}

test('far-future trips never reach a live provider (estimates, no external call)', async () => {
  const { live, calls } = spyProviders();
  const r = await new TravelService({ provider: 'live', live }).search(Q(), NOW);
  assert.equal(calls.length, 0);
  assert.equal(r.estimates, true);
});

test('free-text destinations never reach a live provider', async () => {
  const { live, calls } = spyProviders();
  const r = await new TravelService({ provider: 'live', live }).search(Q({ destination: 'Fooland', year: 2027, month: 3 }), NOW);
  assert.equal(calls.length, 0);
  assert.equal(r.estimates, true);
  assert.match(r.basis, /rough regional averages/);
});

test('a configured live provider (fake) replaces flights + stays; trains and food stay labeled estimates', async () => {
  const { live, calls } = spyProviders((kind) => ({
    kind, title: kind === 'flight' ? 'Flights BOS→Tokyo, Osaka→BOS' : 'Hotel Gracery Asakusa', pricePerPersonUsd: kind === 'flight' ? 1100 : 600, example: false, estimate: false, url: `https://provider.example/${kind}`,
  }));
  const r = await new TravelService({ provider: 'live', live }).search(Q({ year: 2027, month: 3 }), NOW);
  assert.equal(calls.length, 2);
  assert.equal(r.estimates, false);
  assert.equal(r.source, 'fakeflights+fakestays');
  assert.deepEqual(r.lastMinute, ['BOS→NRT $890 round trip this week (link)']);
  assert.deepEqual(r.listings.map((l) => [l.kind, l.example, l.estimate]), [['flight', false, false], ['stay', false, false], ['transport', true, true], ['food', true, true]]);
  assert.equal(r.totalPerPersonUsd, 1100 + 600 + r.listings[2].pricePerPersonUsd + r.listings[3].pricePerPersonUsd);
});
