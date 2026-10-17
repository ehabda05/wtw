// TravelService: TravelQuery -> TravelResult. Labeled estimates unless a live provider is configured AND the
// dates are bookable; far-future trips never make an external call (docs/PRIVACY.md). Any live failure,
// including NotConfiguredError from the stubs, falls back to the estimates. search() never throws.

import type { TravelListing, TravelQuery, TravelResult } from '../engine/types.js';
import { destinationByName } from '../engine/ext/travel/geo.js';
import { estimateTrip } from './estimates.js';
import { isFarAhead, tripDates } from './links.js';
import { type LiveProviders, NotConfiguredError, createLiveProviders } from './providers.js';

export interface TravelServiceOptions {
  /** TRAVEL_PROVIDER: "estimates" (default) | "live" | "duffel" | "amadeus". */
  provider?: string;
  env?: Record<string, string | undefined>;
  /** Injected providers (tests, or a real implementation). */
  live?: LiveProviders;
  /** Called when a live search fails or is not configured (never with trip details). */
  onFallback?: (reason: string) => void;
}

export class TravelService {
  readonly provider: string;
  readonly #live?: LiveProviders;
  readonly #onFallback?: (reason: string) => void;

  constructor(opts: TravelServiceOptions = {}) {
    this.provider = (opts.provider ?? 'estimates').toLowerCase();
    this.#onFallback = opts.onFallback;
    if (this.provider !== 'estimates') this.#live = opts.live ?? createLiveProviders(this.provider, opts.env ?? process.env);
  }

  async search(q: TravelQuery, now: number): Promise<TravelResult> {
    const est = estimateTrip(q, now);
    const dates = tripDates(q);
    // Only gazetteer destinations ever leave the process: a free-text "trip to X" stays a local estimate.
    if (!this.#live || !dates || isFarAhead(q, now) || !destinationByName(q.destination)) return est;
    try {
      const [flights, stays] = await Promise.all([this.#live.flights.searchFlights(q, dates), this.#live.stays.searchStays(q, dates)]);
      let lastMinute: string[] = [];
      try {
        lastMinute = await this.#live.alerts.lastMinute(q, dates);
      } catch {
        lastMinute = [];
      }
      return combine(est, cheapest(flights), cheapest(stays), lastMinute, `${this.#live.flights.id}+${this.#live.stays.id}`);
    } catch (err) {
      this.#onFallback?.(err instanceof NotConfiguredError ? err.message : 'live travel search failed');
      return est;
    }
  }
}

function cheapest(ls: TravelListing[]): TravelListing | undefined {
  return [...ls].sort((a, b) => a.pricePerPersonUsd - b.pricePerPersonUsd)[0];
}

/** Live flights + stays, with the estimated trains and food kept (and still flagged estimate: true). */
function combine(est: TravelResult, flight: TravelListing | undefined, stay: TravelListing | undefined, lastMinute: string[], source: string): TravelResult {
  if (!flight || !stay) return est;
  const rest = est.listings.filter((l) => l.kind !== 'flight' && l.kind !== 'stay');
  // A live listing is only "real" when the provider says so and links to it; anything else stays an example.
  const real = (l: TravelListing): TravelListing => (l.url ? l : { ...l, example: true });
  const listings = [real(flight), real(stay), ...rest];
  return {
    ...est,
    estimates: flight.estimate || stay.estimate,
    basis: 'live prices checked today (trains and food are estimates)',
    listings,
    lastMinute,
    totalPerPersonUsd: listings.reduce((s, l) => s + l.pricePerPersonUsd, 0),
    source,
  };
}
