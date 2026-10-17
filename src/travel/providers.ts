// Live travel providers (interfaces + not-configured stubs). Nothing here calls a network API in this build:
// every stub throws NotConfiguredError, and TravelService falls back to labeled estimates. To go live, implement
// the matching class against the provider's API and set TRAVEL_PROVIDER (docs/TRAVEL.md lists the credentials).
//
// Airbnb has no open public API (partner-only), so it is not a provider here: Homi only builds verifiable Airbnb
// SEARCH deep links (./links.ts) for bookable dates.

import type { TravelListing, TravelQuery } from '../engine/types.js';

export interface TripDates {
  checkin: string;   // ISO date
  checkout: string;  // ISO date
}

/** Thrown by a provider that has no credentials or no client in this build. The service falls back to estimates. */
export class NotConfiguredError extends Error {
  readonly provider: string;
  readonly missing: string[];
  constructor(provider: string, missing: string[]) {
    super(
      missing.length
        ? `${provider} is not configured (missing ${missing.join(', ')}); see docs/TRAVEL.md`
        : `${provider} client is not implemented in this build; see docs/TRAVEL.md`,
    );
    this.name = 'NotConfiguredError';
    this.provider = provider;
    this.missing = missing;
  }
}

/** Flights for one tier. Prices per person, whole trip, rounded to dollars; `url` must be a verifiable offer link. */
export interface FlightSearchProvider {
  readonly id: string;
  searchFlights(q: TravelQuery, dates: TripDates): Promise<TravelListing[]>;
}

/** Stays for one tier (whole trip, per person). Real listings carry `example: false` and their listing URL. */
export interface StaySearchProvider {
  readonly id: string;
  searchStays(q: TravelQuery, dates: TripDates): Promise<TravelListing[]>;
}

/** Last-minute fares / price drops for the route (short human-readable lines, each with its own link). */
export interface FareAlertProvider {
  readonly id: string;
  lastMinute(q: TravelQuery, dates: TripDates): Promise<string[]>;
}

export interface LiveProviders {
  flights: FlightSearchProvider;
  stays: StaySearchProvider;
  alerts: FareAlertProvider;
}

type Env = Record<string, string | undefined>;

abstract class Stub {
  abstract readonly id: string;
  protected abstract readonly needs: string[];
  constructor(protected readonly env: Env) {}
  protected notConfigured(): never {
    throw new NotConfiguredError(this.id, this.needs.filter((k) => !this.env[k]));
  }
}

/** Duffel Flights API (https://duffel.com/docs): offer requests with slices for open-jaw routes. Needs an access token. */
export class DuffelFlights extends Stub implements FlightSearchProvider {
  readonly id = 'duffel';
  protected readonly needs = ['DUFFEL_ACCESS_TOKEN'];
  async searchFlights(_q: TravelQuery, _dates: TripDates): Promise<TravelListing[]> {
    return this.notConfigured();
  }
}

/** Amadeus Self-Service Flight Offers Search (developers.amadeus.com). Needs an API key + secret (OAuth2 client credentials). */
export class AmadeusFlights extends Stub implements FlightSearchProvider {
  readonly id = 'amadeus';
  protected readonly needs = ['AMADEUS_CLIENT_ID', 'AMADEUS_CLIENT_SECRET'];
  async searchFlights(_q: TravelQuery, _dates: TripDates): Promise<TravelListing[]> {
    return this.notConfigured();
  }
}

/** Booking.com Demand API (affiliate partners only; approval required). */
export class BookingStays extends Stub implements StaySearchProvider {
  readonly id = 'booking';
  protected readonly needs = ['BOOKING_AFFILIATE_ID', 'BOOKING_API_TOKEN'];
  async searchStays(_q: TravelQuery, _dates: TripDates): Promise<TravelListing[]> {
    return this.notConfigured();
  }
}

/** Expedia Group Rapid API (partner approval required). */
export class ExpediaRapidStays extends Stub implements StaySearchProvider {
  readonly id = 'expedia';
  protected readonly needs = ['EXPEDIA_RAPID_API_KEY', 'EXPEDIA_RAPID_SHARED_SECRET'];
  async searchStays(_q: TravelQuery, _dates: TripDates): Promise<TravelListing[]> {
    return this.notConfigured();
  }
}

/** Fare alerts / price-drop feed for last-minute deals (e.g. an Amadeus or Duffel price watch, or a fare-alert vendor). */
export class FareAlertsStub extends Stub implements FareAlertProvider {
  readonly id = 'fare-alerts';
  protected readonly needs = ['FARE_ALERTS_API_KEY'];
  async lastMinute(_q: TravelQuery, _dates: TripDates): Promise<string[]> {
    return this.notConfigured();
  }
}

export const PROVIDER_IDS = ['estimates', 'live', 'duffel', 'amadeus'] as const;

/**
 * TRAVEL_PROVIDER: "estimates" (default, no network), "live" or "duffel" (Duffel flights), "amadeus" (Amadeus
 * flights). Stays come from TRAVEL_STAYS ("booking" default, or "expedia").
 */
export function createLiveProviders(id: string, env: Env = process.env): LiveProviders {
  const flights = id === 'amadeus' || env.TRAVEL_FLIGHTS === 'amadeus' ? new AmadeusFlights(env) : new DuffelFlights(env);
  const stays = env.TRAVEL_STAYS === 'expedia' ? new ExpediaRapidStays(env) : new BookingStays(env);
  return { flights, stays, alerts: new FareAlertsStub(env) };
}
