// Trip copy (pure). Every header is at most two sentences; card lines are fragments. Estimates are always
// labeled: a stay line that describes a listing carries "Example listing · estimated price" even if a provider
// forgot it, and the header says why the numbers are estimates.

import type { TravelListing, TravelResult } from '../../types.js';
import { usdWhole } from '../util.js';
import type { Tier } from './parse.js';
import { type Need, type TripState, budgetPP, farAhead, missing, timingLabel } from './state.js';

export const EXAMPLE_LABEL = 'Example listing · estimated price';

const ASK: Record<Need, string> = {
  destination: 'where to',
  origin: 'where are you flying from',
  timing: 'roughly when',
  nights: 'how many nights',
  travelers: 'how many of you',
  budget: 'a budget per person',
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "a, b, and c" (the question in DEMO step 19 uses the serial comma). */
function serial(items: string[]): string {
  if (items.length <= 2) return items.join(' and ');
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

/** "where are you flying from, roughly when and for how long, how many of you, and a budget per person". */
export function askList(needs: Need[]): string {
  const parts: string[] = [];
  for (const n of needs) {
    if (n === 'nights' && needs.includes('timing')) continue;
    parts.push(n === 'timing' && needs.includes('nights') ? 'roughly when and for how long' : ASK[n]);
  }
  return serial(parts);
}

export function tripLabel(trip: TripState): string {
  return [trip.destination ?? 'A trip', trip.year !== undefined && trip.month === undefined ? String(trip.year) : timingLabel(trip)]
    .filter(Boolean)
    .join(' ');
}

/** DEMO step 19: "Japan 2030, love it ✈️ Where are you flying from, ...?" */
export function startQuestion(trip: TripState, replacing?: string): string {
  const swap = replacing ? ` (this replaces the ${replacing} trip)` : '';
  return `${tripLabel(trip)}, love it ✈️${swap} ${cap(askList(missing(trip)))}?`;
}

export function reask(trip: TripState): string {
  return `Got it. ${cap(askList(missing(trip)))}?`;
}

function headline(trip: TripState): string {
  return `${trip.destination} · ${timingLabel(trip)} · ${plural(trip.nights ?? 0, 'night')} · ${trip.travelers} from ${trip.origin}`;
}

function hasLabel(l: TravelListing): boolean {
  return l.title.includes(EXAMPLE_LABEL) || !!l.detail?.includes(EXAMPLE_LABEL);
}

/** One budget line. Stays always show their tier; estimated stays always show the example label. */
export function listingLine(l: TravelListing, tier: Tier): string {
  const price = `~${usdWhole(l.pricePerPersonUsd)}`;
  const url = l.url ? ` · ${l.url}` : '';
  const paren = l.detail ? ` (${l.detail})` : '';
  switch (l.kind) {
    case 'flight':
      return `✈️ ${l.title}${paren}: ${price}${url}`;
    case 'stay': {
      const title = (l.example || l.estimate) && !hasLabel(l) ? `${EXAMPLE_LABEL}: ${l.title}` : l.title;
      const example = l.detail?.startsWith(EXAMPLE_LABEL) ? ` · ${l.detail}` : '';
      return `🏠 Stays, ${tier} tier: ${price} · ${title}${example}${url}`;
    }
    case 'transport':
      return `${/train|shinkansen|rail/i.test(l.title) ? '🚄' : '🚌'} ${l.title}: ${price}${paren}${url}`;
    case 'food':
      return `🍜 ${l.title}: ${price}${paren}${url}`;
    default:
      return `🎟️ ${l.title}: ${price}${paren}${url}`;
  }
}

function totalLine(trip: TripState, total: number): string {
  const n = trip.travelers ?? 1;
  const group = n > 1 ? ` (${usdWhole(total * n)} for ${n})` : '';
  const b = budgetPP(trip);
  const vs = b === undefined ? '' : total <= b ? `, under your ${usdWhole(b)}` : `, about ${usdWhole(total - b)} over your ${usdWhole(b)}`;
  return `Total ≈ ${usdWhole(total)} per person${group}${vs}.`;
}

function why(r: TravelResult, trip: TripState, now: number): string {
  if (!r.estimates) return `Live prices from ${r.source}, checked today:`;
  const reason = farAhead(trip, now) ? 'Too far ahead to book' : 'No live prices for these dates yet';
  return `${reason}, so these are ${r.basis}:`;
}

/** DEMO step 21: header, itinerary, budget lines per person, total. */
export function overviewCard(trip: TripState, r: TravelResult, now: number): string {
  return [`${headline(trip)}. ${why(r, trip, now)}`, ...r.itinerary, ...r.listings.map((l) => listingLine(l, r.query.tier)), totalLine(trip, r.totalPerPersonUsd)].join('\n');
}

const SHORT: Record<TravelListing['kind'], string> = { flight: 'flights', stay: 'stays', transport: 'transit', food: 'food', activity: 'activities' };

/** DEMO step 22: the comfort upgrade and where the difference comes from. Null when comfort isn't dearer. */
export function comfortOffer(budget: TravelResult, comfort: TravelResult): string | null {
  const diff = comfort.totalPerPersonUsd - budget.totalPerPersonUsd;
  if (diff <= 0) return null;
  const parts: string[] = [];
  for (const kind of ['flight', 'stay', 'transport', 'food', 'activity'] as const) {
    const b = budget.listings.filter((l) => l.kind === kind).reduce((s, l) => s + l.pricePerPersonUsd, 0);
    const c = comfort.listings.filter((l) => l.kind === kind).reduce((s, l) => s + l.pricePerPersonUsd, 0);
    if (b !== c) parts.push(`${SHORT[kind]} ~${usdWhole(c)} instead of ~${usdWhole(b)}`);
  }
  const stay = comfort.listings.find((l) => l.kind === 'stay');
  const desc = stay ? stay.title.replace(`${EXAMPLE_LABEL}: `, '') : 'The comfort tier';
  return `Want it more comfortable? ${cap(desc)} runs ≈ ${usdWhole(comfort.totalPerPersonUsd)} per person (+${usdWhole(diff)}${parts.length ? `: ${parts.join(', ')}` : ''}).`;
}

/** DEMO step 23: less obvious savings plus the last-minute line. */
export function savingsCard(trip: TripState, r: TravelResult, now: number): string {
  let footer: string;
  if (r.lastMinute.length) footer = `Last-minute deals: ${r.lastMinute.join('; ')}.`;
  else if (farAhead(trip, now)) footer = `Last-minute deals: none yet; I'll watch fares once ${trip.year} schedules open (about 11 months out).`;
  else if (r.estimates) footer = "Last-minute deals: none; live fare alerts aren't set up yet.";
  else footer = 'Last-minute deals: none right now.';
  if (!r.savings.length) return footer;
  return ['Less obvious savings:', ...r.savings.map((s) => `· ${s}`), footer].join('\n');
}

/** DEMO step 24. */
export function savedText(tier: Tier, r: TravelResult): string {
  const how = r.estimates ? 'all estimates' : "at today's live prices";
  return `${cap(tier)} plan saved: ≈ ${usdWhole(r.totalPerPersonUsd)} per person, ${how}. Say "homi trip" anytime to see it.`;
}

/** "homi trip" once there is an estimate: the chosen tier (or budget, with the comfort price). */
export function tripCard(trip: TripState): string | null {
  const tier: Tier = trip.chosen ?? 'budget';
  const r = trip.results?.[tier];
  if (!r) return null;
  const kind = r.estimates ? 'all estimates' : 'live prices';
  const head = `${headline(trip)}, ${trip.chosen ? `${tier} plan` : 'budget tier'} (${kind}):`;
  let foot = totalLine(trip, r.totalPerPersonUsd);
  const c = trip.results?.comfort;
  if (!trip.chosen && c && c.totalPerPersonUsd > r.totalPerPersonUsd) foot += ` Comfort is ≈ ${usdWhole(c.totalPerPersonUsd)}: say "homi comfortable please" to pick it.`;
  return [head, ...r.itinerary, ...r.listings.map((l) => listingLine(l, tier)), foot].join('\n');
}

function known(trip: TripState): string[] {
  const out: string[] = [];
  if (trip.origin) out.push(`from ${trip.origin}`);
  if (trip.month !== undefined) out.push(timingLabel(trip));
  if (trip.nights !== undefined) out.push(plural(trip.nights, 'night'));
  if (trip.travelers !== undefined) out.push(plural(trip.travelers, 'person', 'people'));
  const b = budgetPP(trip);
  if (b !== undefined) out.push(`${usdWhole(b)} per person`);
  else if (trip.budgetTotalUsd !== undefined) out.push(`${usdWhole(trip.budgetTotalUsd)} total`);
  if (trip.interests.length) out.push(trip.interests.join('/'));
  return out;
}

/** "homi trip" while details are still coming in. */
export function progressText(trip: TripState): string {
  const k = known(trip);
  const head = `Trip to ${tripLabel(trip)}${k.length ? `: ${k.join(', ')}` : ''}.`;
  if (trip.phase === 'searching') return `${head} Pricing it now.`;
  const need = missing(trip).filter((n) => n !== 'budget' || trip.phase === 'collecting');
  return need.length ? `${head} Still need ${askList(need)}.` : `${head} Say "homi go" and I'll price it.`;
}

/** One line for "homi what do you know". */
export function dumpLine(trip: TripState): string {
  const b = trip.results?.budget;
  const c = trip.results?.comfort;
  if (b && trip.nights !== undefined) {
    const est = b.estimates ? 'estimates' : 'live prices';
    const pick = trip.chosen
      ? `${trip.chosen} ≈ ${usdWhole(trip.results?.[trip.chosen]?.totalPerPersonUsd ?? 0)} pp`
      : `budget ≈ ${usdWhole(b.totalPerPersonUsd)} pp${c ? ` or comfort ≈ ${usdWhole(c.totalPerPersonUsd)} pp` : ''}`;
    const extra: string[] = [];
    const bp = budgetPP(trip);
    if (bp !== undefined) extra.push(`your budget ${usdWhole(bp)} pp`);
    if (trip.interests.length) extra.push(`interests ${trip.interests.join('/')}`);
    const tail = extra.length ? `, ${extra.join(', ')}` : '';
    return `trip: ${trip.destination}, ${timingLabel(trip)}, ${plural(trip.nights, 'night')}, ${trip.travelers} from ${trip.origin}, ${pick} (${est})${tail}`;
  }
  const k = known(trip);
  return `trip: ${tripLabel(trip)}, ${trip.phase === 'searching' ? 'pricing now' : 'still collecting details'}${k.length ? ` (${k.join(', ')})` : ''}`;
}
