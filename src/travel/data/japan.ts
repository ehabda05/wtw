// Japan guide data (estimates in today's prices, rough and deterministic). Tuned so the canonical demo
// (Boston, late March, 10 nights, 5 people) comes out at docs/DEMO.md step 21-23 numbers exactly:
// flights ~$1,300, stays $45 pp/night budget ($450) or 4★ $110 pp/night + ryokan $310 ($1,300),
// trains + transit $150 + $7/day ($220), food + activities $70/day ($700) or $80/day ($800).

import type { TravelListing } from '../../engine/types.js';
import type { OriginRegion } from '../../engine/ext/travel/geo.js';
import { usdWhole } from '../../engine/ext/util.js';
import { type EstimateInput, type EstimateParts, type FlightTable, EXAMPLE_LABEL, bedrooms, days, est, occupancy, roundTo } from './shared.js';

/** Economy, open-jaw into Tokyo and home from Osaka, peak season (late March), per person. */
const FLIGHTS: FlightTable = { us_east: 1300, us_central: 1200, us_west: 1000, canada_east: 1300, canada_west: 1000, europe: 1150, other: 1300 };
const STOPS: Record<OriginRegion, string> = {
  us_east: '1 stop', us_central: '1 stop', us_west: 'nonstop', canada_east: '1 stop', canada_west: 'nonstop', europe: 'nonstop or 1 stop', other: 'rough average',
};
/** Price level by month (flights and stays), late March = 1.0. */
const SEASON = [0.8, 0.8, 1.0, 1.0, 0.9, 0.85, 0.95, 1.0, 0.85, 0.95, 0.95, 0.95];
const SEASON_TIP: Record<number, string> = {
  3: 'Late March is peak bloom; early April or mid-May is usually cheaper',
  4: 'Early April is peak bloom; mid-May is usually cheaper',
  5: 'Golden Week (about Apr 29–May 5) is pricey; mid-May is usually cheaper',
  8: 'Obon week in mid-August is pricey; late September is usually cheaper',
  11: 'Autumn leaves peak in late November; early November is usually cheaper',
  12: 'New Year week is pricey; mid-January is usually cheaper',
};

const STAY_BUDGET = 45;      // pp/night, apartment shared by 4-6
const HOTEL_COMFORT = 110;   // pp/night, 4★ hotel rooms shared
const RYOKAN = 310;          // pp, one night with kaiseki dinner
const FOOD = { budget: 70, comfort: 80 };   // food + activities per day
const LOCAL_TRANSIT = 7;     // metro / buses per day
const JR_PASS_7_DAY = 335;   // nationwide 7-day pass (¥50,000)

interface Route {
  tokyo: number;
  hakone: number;
  kyoto: number;
  osaka: number;
}

/** Nights per stop: up to 4 nights stays in Tokyo; from 6 nights one Hakone onsen night; the rest ~4:3:2. */
export function route(nights: number): Route {
  if (nights <= 4) return { tokyo: nights, hakone: 0, kyoto: 0, osaka: 0 };
  const hakone = nights >= 6 ? 1 : 0;
  const rest = nights - hakone;
  const tokyo = Math.round((rest * 4) / 9);
  const kyoto = Math.round((rest * 3) / 9);
  return { tokyo, hakone, kyoto, osaka: rest - tokyo - kyoto };
}

function itinerary(r: Route): string[] {
  const out: string[] = [];
  let d = 1;
  out.push(`${days(d, d + r.tokyo - 1)} · Tokyo (Asakusa base)${r.osaka ? '' : ', fly home from Tokyo'}`);
  d += r.tokyo;
  if (r.hakone) out.push(`${days(d, d)} · Hakone onsen night`);
  d += r.hakone;
  if (r.kyoto) out.push(`${days(d, d + r.kyoto - 1)} · Kyoto${r.kyoto >= 3 ? ' (+ Nara day trip)' : ''}`);
  d += r.kyoto;
  if (r.osaka) out.push(`${days(d, d + r.osaka - 1)} · Osaka, fly home from Kansai`);
  return out;
}

/** Airport trains plus the intercity legs of the route (individual tickets). */
function intercity(r: Route): number {
  if (!r.osaka) return 20 + 20;
  const middle = r.hakone ? 25 + 80 : 95; // Tokyo→Hakone→Kyoto, or Tokyo→Kyoto direct
  return 20 + middle + (r.kyoto >= 3 ? 10 : 0) + 5 + 10;
}

export function japanEstimate(x: EstimateInput): EstimateParts {
  const n = x.nights;
  const r = route(n);
  const season = x.month ? SEASON[x.month - 1] : 0.95;
  const occ = occupancy(x.travelers);
  const code = x.origin.code;
  const openJaw = r.osaka > 0;

  const flight = est({
    kind: 'flight',
    title: openJaw ? `Flights ${code}→Tokyo, Osaka→${code}` : `Flights ${code}→Tokyo round trip`,
    detail: `${openJaw ? 'open-jaw, ' : ''}${STOPS[x.origin.region]}`,
    pricePerPersonUsd: roundTo(FLIGHTS[x.origin.region] * season, 50),
  });

  let stay: TravelListing;
  if (x.tier === 'budget') {
    const rate = Math.round(STAY_BUDGET * occ * season);
    const what =
      x.travelers <= 1
        ? `private room in an Asakusa guesthouse, ~${usdWhole(rate)}/night`
        : `${x.travelers > 8 ? 'two Airbnb-style apartments' : `${bedrooms(x.travelers)} Airbnb-style apartment`} in Asakusa, ~${usdWhole(roundTo(rate * x.travelers, 10))}/night for ${x.travelers}`;
    stay = est({ kind: 'stay', title: `${EXAMPLE_LABEL}: ${what}`, detail: `~${usdWhole(rate)} per person/night`, pricePerPersonUsd: rate * n });
    if (x.staysSearchUrl) stay.url = x.staysSearchUrl;
  } else {
    const hotel = Math.round(HOTEL_COMFORT * occ * season);
    const ryokan = Math.round(RYOKAN * season);
    stay = est({
      kind: 'stay',
      title: r.hakone ? '4★ hotels plus one ryokan night with dinner' : '4★ hotels',
      detail: `${EXAMPLE_LABEL}: ${r.hakone ? `Hakone ryokan with kaiseki dinner ~${usdWhole(ryokan)} per person, ` : ''}4★ hotel near Tokyo Station ~${usdWhole(hotel)} per person/night`,
      pricePerPersonUsd: hotel * (n - r.hakone) + ryokan * r.hakone,
    });
  }

  const legs = intercity(r);
  const transport = est({
    kind: 'transport',
    title: 'Trains + transit',
    detail: openJaw
      ? legs < JR_PASS_7_DAY
        ? 'individual Shinkansen tickets beat a nationwide JR Pass on this route'
        : 'a 7-day JR Pass pays off on this route'
      : 'IC card for the metro, airport trains both ways',
    pricePerPersonUsd: legs + LOCAL_TRANSIT * n,
  });

  const food = est({ kind: 'food', title: 'Food + activities', pricePerPersonUsd: FOOD[x.tier] * n });

  const savings: string[] = [];
  if (openJaw) savings.push('Fly into Tokyo and home from Osaka: no backtracking');
  if (r.hakone) savings.push('Book the ryokan on a weeknight');
  if (x.month && SEASON_TIP[x.month]) savings.push(SEASON_TIP[x.month]);
  savings.push('Convenience-store breakfasts');

  return { basis: "estimates in today's prices", itinerary: itinerary(r), listings: [flight, stay, transport, food], savings };
}
