// The group's trip (state.space.ext.travel): only the details members handed Homi plus the estimate.
// Lives with the space settings, so it outlasts any dinner plan; deleted by "homi forget the trip" or "homi stop".

import type { GroupState, TravelQuery, TravelResult } from '../../types.js';
import type { Step } from '../../plan/core.js';
import { DAY } from '../../util.js';
import type { Part, Season, Tier, TripDetails } from './parse.js';
import type { DestKey } from './geo.js';

export type TripPhase = 'collecting' | 'ready' | 'searching' | 'offered' | 'saved';

export interface TripState {
  id: string;
  phase: TripPhase;
  destination?: string;
  destKey?: DestKey;
  origin?: string;
  year?: number;
  month?: number;
  part?: Part;
  season?: Season;
  nights?: number;
  travelers?: number;
  budgetPerPersonUsd?: number;
  budgetTotalUsd?: number;
  interests: string[];
  createdAt: number;
  updatedAt: number;
  /** Pending lookup ids, one per tier. */
  requests?: Record<Tier, string>;
  results?: Partial<Record<Tier, TravelResult>>;
  offerAt?: number;
  chosen?: Tier;
  /** The current estimate was made while the dates were too far ahead to book ("homi trip" re-prices later). */
  pricedFar?: boolean;
}

/** Unaddressed answers count only this long after the last trip activity (then Homi needs to be addressed). */
export const ANSWER_WINDOW_MS = 2 * DAY;
/** Airlines open schedules roughly 11 months (about 330 days) before departure. */
export const BOOKABLE_MS = 330 * DAY;

export function tripOf(s: GroupState): TripState | undefined {
  return s.space.ext?.travel as TripState | undefined;
}

export function getTrip(st: Step): TripState | undefined {
  return tripOf(st.s);
}

export function setTrip(st: Step, trip: TripState | undefined): void {
  const ext = { ...(st.s.space.ext ?? {}) };
  if (trip) ext.travel = trip;
  else delete ext.travel;
  st.s.space.ext = ext;
}

/** Copies the new details onto the trip. Returns true when anything changed. */
export function merge(trip: TripState, d: TripDetails, now: number): boolean {
  let changed = false;
  const set = <K extends keyof TripState>(k: K, v: TripState[K] | undefined) => {
    if (v !== undefined && trip[k] !== v) {
      trip[k] = v;
      changed = true;
    }
  };
  set('origin', d.origin);
  if (d.month !== undefined) {
    if (trip.month !== d.month || trip.part !== d.part || trip.season !== d.season) changed = true;
    trip.month = d.month;
    if (d.part) trip.part = d.part;
    else delete trip.part;
    if (d.season) trip.season = d.season;
    else delete trip.season;
  }
  set('year', d.year);
  set('nights', d.nights);
  set('travelers', d.travelers);
  if (d.budgetPerPersonUsd !== undefined) {
    set('budgetPerPersonUsd', d.budgetPerPersonUsd);
    delete trip.budgetTotalUsd;
  }
  if (d.budgetTotalUsd !== undefined) {
    set('budgetTotalUsd', d.budgetTotalUsd);
    delete trip.budgetPerPersonUsd;
  }
  for (const i of d.interests) {
    if (!trip.interests.includes(i)) {
      trip.interests.push(i);
      changed = true;
    }
  }
  // A month without a year means its next occurrence.
  if (trip.month !== undefined && trip.year === undefined) {
    const n = new Date(now);
    trip.year = trip.month > n.getUTCMonth() + 1 ? n.getUTCFullYear() : n.getUTCFullYear() + 1;
    changed = true;
  }
  if (changed) trip.updatedAt = now;
  return changed;
}

export type Need = 'destination' | 'origin' | 'timing' | 'nights' | 'travelers' | 'budget';

/** What the trip still needs, in question order. Budget is asked for but never blocks the search. */
export function missing(trip: TripState): Need[] {
  const out: Need[] = [];
  if (!trip.destination) out.push('destination');
  if (!trip.origin) out.push('origin');
  if (trip.month === undefined || trip.year === undefined) out.push('timing');
  if (trip.nights === undefined) out.push('nights');
  if (trip.travelers === undefined) out.push('travelers');
  if (budgetPP(trip) === undefined) out.push('budget');
  return out;
}

export function essentialsKnown(trip: TripState): boolean {
  return missing(trip).every((n) => n === 'budget');
}

export function budgetPP(trip: TripState): number | undefined {
  if (trip.budgetPerPersonUsd !== undefined) return trip.budgetPerPersonUsd;
  if (trip.budgetTotalUsd !== undefined && trip.travelers) return Math.round(trip.budgetTotalUsd / trip.travelers);
  return undefined;
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "late Mar 2030", "Mar 2030", "spring 2030", "2030". */
export function timingLabel(trip: TripState): string {
  const y = trip.year !== undefined ? String(trip.year) : '';
  if (trip.season) return `${trip.season} ${y}`.trim();
  if (trip.month === undefined) return y;
  return `${trip.part ? `${trip.part} ` : ''}${MON[trip.month - 1]} ${y}`.trim();
}

/** Approximate departure (UTC midnight) for the far-ahead check. */
export function departureAt(trip: TripState): number | undefined {
  if (trip.year === undefined || trip.month === undefined) return undefined;
  const day = trip.part === 'early' ? 5 : trip.part === 'late' ? 22 : 15;
  return Date.UTC(trip.year, trip.month - 1, day);
}

/** True when the dates are beyond what airlines and stays sell today. */
export function farAhead(trip: TripState, now: number): boolean {
  const at = departureAt(trip);
  return at !== undefined && at - now > BOOKABLE_MS;
}

/** The provider query: trip details only. No names, member keys or message text ever go in here. */
export function queryOf(trip: TripState, tier: Tier): TravelQuery {
  const q: TravelQuery = {
    destination: trip.destination as string,
    origin: trip.origin as string,
    year: trip.year as number,
    nights: trip.nights as number,
    travelers: trip.travelers as number,
    tier,
    interests: [...trip.interests],
  };
  if (trip.month !== undefined) q.month = trip.month;
  const b = budgetPP(trip);
  if (b !== undefined) q.budgetPerPersonUsd = b;
  return q;
}
