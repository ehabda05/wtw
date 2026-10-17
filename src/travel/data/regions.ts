// Rough regional averages for destinations without a guide (today's prices, per person). Every line says
// "rough regional average"; nothing here pretends to be a real listing or a real route.

import type { DestKey } from '../../engine/ext/travel/geo.js';
import { usdWhole } from '../../engine/ext/util.js';
import { type EstimateInput, type EstimateParts, type FlightTable, EXAMPLE_LABEL, bedrooms, days, est, occupancy, roundTo } from './shared.js';

interface Region {
  flights: FlightTable;      // economy round trip
  stay: number;              // budget pp/night (shared apartment)
  hotel: number;             // comfort pp/night (4★, shared rooms)
  food: { budget: number; comfort: number };   // food + activities per day
  transit: number;           // local transport per day
}

const R = (flights: number[], stay: number, hotel: number, food: [number, number], transit: number): Region => {
  const [us_east, us_central, us_west, canada_east, canada_west, europe, other] = flights;
  return { flights: { us_east, us_central, us_west, canada_east, canada_west, europe, other }, stay, hotel, food: { budget: food[0], comfort: food[1] }, transit };
};

export const REGIONS: Record<Exclude<DestKey, 'japan'>, Region> = {
  //                 us_e  us_c  us_w  ca_e  ca_w   eu  other
  europe: R([850, 1000, 1100, 900, 1100, 250, 1000], 55, 140, [60, 90], 20),
  asia: R([1400, 1300, 1100, 1400, 1100, 1000, 1200], 30, 90, [35, 60], 12),
  latam: R([650, 600, 650, 700, 750, 1000, 800], 35, 100, [40, 65], 15),
  caribbean: R([450, 550, 650, 500, 700, 900, 700], 70, 170, [60, 90], 20),
  hawaii: R([750, 700, 450, 800, 550, 1400, 900], 80, 180, [70, 100], 35),
  us: R([350, 350, 350, 450, 450, 800, 500], 70, 160, [65, 95], 30),
  world: R([1200, 1200, 1200, 1200, 1200, 1200, 1200], 55, 140, [60, 90], 20),
};

const AVG = 'rough regional average';

export function regionalEstimate(key: Exclude<DestKey, 'japan'>, x: EstimateInput): EstimateParts {
  const g = REGIONS[key];
  const n = x.nights;
  const occ = occupancy(x.travelers);

  const flight = est({
    kind: 'flight',
    title: `Flights ${x.origin.code}→${x.destination} round trip`,
    detail: AVG,
    pricePerPersonUsd: roundTo(g.flights[x.origin.region], 50),
  });

  const rate = Math.round((x.tier === 'budget' ? g.stay : g.hotel) * occ);
  const stay =
    x.tier === 'budget'
      ? est({
          kind: 'stay',
          title: `${EXAMPLE_LABEL}: ${
            x.travelers <= 1 ? `private room, ~${usdWhole(rate)}/night` : `${bedrooms(x.travelers)} apartment for ${x.travelers}, ~${usdWhole(roundTo(rate * x.travelers, 10))}/night`
          } (${AVG})`,
          detail: `~${usdWhole(rate)} per person/night`,
          pricePerPersonUsd: rate * n,
        })
      : est({
          kind: 'stay',
          title: 'A 4★ hotel stay',
          detail: `${EXAMPLE_LABEL}: 4★ hotel, ~${usdWhole(rate)} per person/night (${AVG})`,
          pricePerPersonUsd: rate * n,
        });
  if (x.tier === 'budget' && x.staysSearchUrl) stay.url = x.staysSearchUrl;

  const transport = est({ kind: 'transport', title: 'Local transport', detail: AVG, pricePerPersonUsd: g.transit * n });
  const food = est({ kind: 'food', title: 'Food + activities', detail: AVG, pricePerPersonUsd: g.food[x.tier] * n });

  const half = Math.ceil(n / 2);
  const itinerary =
    n <= 4
      ? [`${days(1, n)} · ${x.destination}, one base (rough plan)`]
      : [`${days(1, half)} · ${x.destination}, first base (rough plan)`, `${days(half + 1, n)} · ${x.destination}, second base`];

  return {
    basis: 'rough regional averages in today\'s prices, not real listings',
    itinerary,
    listings: [flight, stay, transport, food],
    savings: [
      'Fly midweek: Tuesday and Wednesday departures are usually cheaper',
      'Shoulder season (just before or after peak) is usually cheaper',
      'Stays with a kitchen cut food costs',
      'Book refundable, then re-check prices closer in',
    ],
  };
}
