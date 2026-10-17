// Trip-detail grammar (pure): destination triggers, origin, timing, length, group size, budget, interests,
// tier choice and the trip commands. Text is only read; what comes back is the structured detail a member
// handed Homi (a city from the gazetteer, numbers, interests from a fixed vocabulary), never free text.

import { normText, titleCase } from '../../util.js';
import { type Destination, destinationAt, originIn } from './geo.js';

export type Part = 'early' | 'mid' | 'late';
export type Season = 'spring' | 'summer' | 'fall' | 'winter';
export type Tier = 'budget' | 'comfort';

export interface TripDetails {
  origin?: string;
  month?: number;
  part?: Part;
  season?: Season;
  year?: number;
  nights?: number;
  travelers?: number;
  budgetPerPersonUsd?: number;
  budgetTotalUsd?: number;
  interests: string[];
}

const WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, a: 1, an: 1,
};
const NUM = '(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)';
const num = (s: string): number => (/^\d+$/.test(s) ? Number(s) : WORDS[s] ?? NaN);

const MONTHS: Array<[RegExp, number, boolean]> = [
  // [pattern, month, ambiguous: also a name or an everyday word, so it needs a timing cue]
  [/\bjan(?:uary)?\b/g, 1, true], [/\bfeb(?:ruary)?\b/g, 2, false], [/\bmar(?:ch)?\b/g, 3, true], [/\bapr(?:il)?\b/g, 4, true],
  [/\bmay\b/g, 5, true], [/\bjune?\b/g, 6, true], [/\bjuly?\b/g, 7, false], [/\baug(?:ust)?\b/g, 8, true],
  [/\bsep(?:t(?:ember)?)?\b/g, 9, false], [/\boct(?:ober)?\b/g, 10, false], [/\bnov(?:ember)?\b/g, 11, false], [/\bdec(?:ember)?\b/g, 12, false],
];
const TIMING_BEFORE = /(?:\b(?:in|early|mid|late|end of|beginning of|start of|during|around|this|next|until|till|through|by)\s+|\bmid-)$/;
const SEASONS: Array<[RegExp, Season, number]> = [
  [/\bspring\b/, 'spring', 4], [/\bsummer\b/, 'summer', 7], [/\b(?:autumn|(?:in|this|next|the|early|late|during|around) fall)\b/, 'fall', 10], [/\bwinter\b/, 'winter', 1],
];

function timing(t: string, d: TripDetails): void {
  for (const [re, month, ambiguous] of MONTHS) {
    for (const m of t.matchAll(re)) {
      const i = m.index ?? 0;
      const before = t.slice(Math.max(0, i - 20), i);
      const after = t.slice(i + m[0].length, i + m[0].length + 8);
      if (ambiguous && !TIMING_BEFORE.test(before) && !/^\s*(?:20\d\d|\d{1,2}(?:st|nd|rd|th)?\b)/.test(after) && !/^[\s,]*for\b/.test(after)) continue;
      d.month = month;
      if (/\b(?:early|beginning of|start of)\s+(?:in\s+)?$/.test(before)) d.part = 'early';
      else if (/(?:\bmid-?|\bmiddle of\s+|\bmid\s+)$/.test(before)) d.part = 'mid';
      else if (/\b(?:late|end of)\s+$/.test(before)) d.part = 'late';
      return;
    }
  }
  for (const [re, season, month] of SEASONS) {
    if (re.test(t)) {
      d.season = season;
      d.month = month;
      return;
    }
  }
  if (/\b(?:cherry blossoms?|sakura)\b/.test(t)) {
    d.month = 3;
    d.part = 'late';
  }
}

function year(t: string, now: number): number | undefined {
  const m = t.match(/\b(20[2-9]\d)\b/);
  if (m) return Number(m[1]);
  const y = new Date(now).getUTCFullYear();
  if (/\bnext year\b/.test(t)) return y + 1;
  if (/\bthis year\b/.test(t)) return y;
  return undefined;
}

function nights(t: string): number | undefined {
  let m = t.match(new RegExp(`\\b${NUM}\\s*-?\\s*nights?\\b`));
  if (m && (/^\d/.test(m[1]) || num(m[1]) >= 2)) return num(m[1]);
  if (/\b(?:a|one) week and a half\b/.test(t)) return 10;
  m = t.match(new RegExp(`(?<!\\bin )\\b${NUM}\\s*-?\\s*(?:weeks?|wks?)\\b`));
  if (m && num(m[1]) <= 4) return num(m[1]) * 7;
  m = t.match(new RegExp(`(?<!\\bin )\\b${NUM}\\s*-?\\s*days?\\b`));
  if (m && num(m[1]) >= 2) return num(m[1]) - 1;
  if (/\blong weekend\b/.test(t)) return 3;
  return undefined;
}

function travelers(t: string): number | undefined {
  let m = t.match(new RegExp(`\\b${NUM}\\s+of\\s+us\\b`));
  if (m && num(m[1]) >= 2) return num(m[1]);
  m = t.match(new RegExp(`\\b(?:party|group) of\\s+${NUM}\\b`));
  if (m) return num(m[1]);
  m = t.match(new RegExp(`\\bwe(?:'re| are)\\s+(?:a group of\\s+)?${NUM}\\b(?!\\s*(?:nights?|weeks?|days?|hours?|mins?|minutes?))`));
  if (m && num(m[1]) >= 2) return num(m[1]);
  m = t.match(new RegExp(`\\b${NUM}\\s+(?:people|persons|ppl|travell?ers|adults|guests|pax)\\b`));
  if (m && num(m[1]) >= 1) return num(m[1]);
  m = t.match(new RegExp(`\\bme (?:and|\\+) ${NUM} (?:friends|others|more)\\b`));
  if (m) return num(m[1]) + 1;
  if (/\b(?:just me|solo trip|going solo)\b/.test(t)) return 1;
  return undefined;
}

const AMT = '~?\\$?\\s?(\\d{1,3}(?:,\\d{3})+|\\d+(?:\\.\\d+)?)\\s*(k)?';
const amount = (n: string, k?: string): number => Math.round(Number(n.replace(/,/g, '')) * (k ? 1000 : 1));

function budget(t: string, d: TripDetails): void {
  let m = t.match(new RegExp(`${AMT}\\s*(?:total|in total|altogether|for (?:all of us|the group|everyone|the whole group))\\b`));
  if (m) {
    const v = amount(m[1], m[2]);
    if (v >= 200) d.budgetTotalUsd = v;
    return;
  }
  m = t.match(new RegExp(`${AMT}\\s*(?:each|pp|p\\.p\\.|per person|a person|per head|a head|apiece|per traveler)\\b`));
  if (!m) m = t.match(new RegExp(`\\bbudget(?:'s| is| of)?\\s*(?:around|about|of|is|:)?\\s*${AMT}`));
  if (!m) m = t.match(new RegExp(`\\b(?:under|max|up to|at most|no more than)\\s*~?\\$\\s?(\\d{1,3}(?:,\\d{3})+|\\d+(?:\\.\\d+)?)\\s*(k)?`));
  if (!m) m = t.match(/~?\$\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k)?/);
  if (!m) return;
  const v = amount(m[1], m[2]);
  if (v >= 200 && v <= 100_000) d.budgetPerPersonUsd = v;
}

const INTERESTS: Array<[string, RegExp]> = [
  // "cherry blossoms" is a timing cue (late March, see timing()), not an interest.
  ['food', /\b(?:food|foodie|street food|eating|restaurants?|ramen|sushi)\b/],
  ['temples', /\b(?:temples?|shrines?)\b/],
  ['onsen', /\b(?:onsens?|hot springs?|ryokans?)\b/],
  ['museums', /\b(?:museums?|galleries|art)\b/],
  ['hiking', /\b(?:hik(?:e|es|ing)|trails?|mountains?)\b/],
  ['beaches', /\bbeach(?:es)?\b/],
  ['nightlife', /\b(?:nightlife|bars|clubs|clubbing|karaoke)\b/],
  ['shopping', /\bshopping\b/],
  ['anime', /\b(?:anime|manga)\b/],
  ['skiing', /\b(?:ski|skiing|snowboard(?:ing)?)\b/],
  ['history', /\b(?:history|castles?|historic)\b/],
  ['wine', /\b(?:wine|vineyards?)\b/],
];

/** Every trip detail in one message. `destination` keeps the destination city from reading as the origin. */
export function parseDetails(text: string, now: number, destination?: string): TripDetails {
  const t = normText(text);
  const d: TripDetails = { interests: [] };
  const o = originIn(t, text, destination);
  if (o) d.origin = o.name;
  timing(t, d);
  const y = year(t, now);
  if (y !== undefined) d.year = y;
  const n = nights(t);
  if (n !== undefined && n >= 1 && n <= 60) d.nights = n;
  const p = travelers(t);
  if (p !== undefined && p >= 1 && p <= 30) d.travelers = p;
  budget(t, d);
  for (const [label, re] of INTERESTS) if (re.test(t)) d.interests.push(label);
  return d;
}

/**
 * How many usable details a message carries. Interests alone need two ("food, temples"), so a passing
 * "the food was great" never reads as a trip answer.
 */
export function detailCount(d: TripDetails): number {
  const hard = [d.origin, d.month, d.year, d.nights, d.travelers, d.budgetPerPersonUsd ?? d.budgetTotalUsd].filter((x) => x !== undefined).length;
  if (hard) return hard + d.interests.length;
  return d.interests.length >= 2 ? d.interests.length : 0;
}

/** Details that only make sense for a trip (so an addressed update after the estimate is clearly about it). */
export function tripOnly(d: TripDetails): boolean {
  return d.nights !== undefined || d.origin !== undefined || d.budgetPerPersonUsd !== undefined || d.budgetTotalUsd !== undefined;
}

// ───────────── triggers ─────────────

export interface TripTrigger {
  destination?: Destination;
}

const STOP = /\s+(?:in|for|from|next|this|on|with|during|around|over|by|at|and|or|so|because|leaving|flying|maybe|sometime)\b.*$|[,.?!;:].*$/;
const NOT_PLACES = new Set(['somewhere', 'anywhere', 'there', 'it', 'the', 'us', 'me', 'you', 'see', 'visit', 'go', 'the store', 'the airport', 'work']);

function destPhrase(rest: string): Destination | undefined {
  const known = destinationAt(rest);
  if (known) return known;
  const phrase = rest.replace(STOP, '').trim();
  if (!/^[a-z][a-z' -]{1,30}$/.test(phrase) || phrase.split(/\s+/).length > 3 || NOT_PLACES.has(phrase)) return undefined;
  // "somewhere warm", "the beach", "sam's place": not a place Homi can price (known places matched above).
  if (/^(?:some|any|no)(?:where|place)\b|^(?:the|a|an|my|our|your|his|her|their)\s|'/.test(phrase)) return undefined;
  return { name: titleCase(phrase), key: 'world' };
}

const TRIP_WORD = /\b(?:trip|vacation|holiday|getaway)\b/;

/** "let's plan Japan for 2030", "plan a trip to X", "trip to X in 2030", "go to Japan next year". Null when not a trip. */
export function parseTrigger(body: string): TripTrigger | null {
  const t = normText(body);
  let m = t.match(/\b(?:trip|vacation|holiday|getaway|travel(?:ing)?)\s+to\s+(.+)$/);
  if (m) return { destination: destPhrase(m[1]) };
  if (/\bplan(?:ning)?\s+(?:a\s+|an\s+|our\s+|the\s+|some\s+)?(?:big\s+|group\s+|real\s+)?(?:trip|vacation|holiday|getaway)\b/.test(t)) return { destination: undefined };
  m = t.match(/\bplan(?:ning)?\s+(?:a\s+|our\s+|the\s+)?(.+)$/);
  if (m) {
    const d = destinationAt(m[1]);
    if (d) return { destination: d };
  }
  m = t.match(/\b(?:go|going|fly|flying|head|heading|visit|visiting)\s+(?:to\s+)?(.+)$/);
  if (m) {
    const d = destinationAt(m[1]);
    if (d && (TRIP_WORD.test(t) || /\b20[2-9]\d\b|\bnext year\b/.test(t))) return { destination: d };
  }
  return null;
}

// ───────────── commands ─────────────

export type TripCommand = 'show' | 'forget' | 'go';

export function parseTripCommand(body: string): TripCommand | null {
  const t = normText(body).replace(/[!.?\s]+$/, '');
  if (/^(?:please\s+)?(?:forget|delete|cancel|drop|clear|remove|scrap)\s+(?:the\s+|our\s+|this\s+|that\s+)?(?:[a-z]+\s+)?trip(?:\s+plan)?(?:\s+please)?$/.test(t)) return 'forget';
  if (/^(?:the\s+|our\s+)?trip(?:\s+plan)?$|^(?:show|see|what'?s)\s+(?:me\s+|us\s+)?(?:the\s+|our\s+)?trip(?:\s+plan)?$|^(?:how'?s|where are we on)\s+the\s+trip$/.test(t)) return 'show';
  if (/^(?:go|go ahead|price it|price the trip|search|run the numbers|look it up)(?:\s+(?:now|please))?$/.test(t)) return 'go';
  return null;
}

const CHOICE =
  /^(?:(?:ok(?:ay)?|yes|yeah|yep|hmm|i (?:vote|think)|let'?s (?:go|do)|go(?: with)?|we'?ll take|take|pick|make it|i'?d say)[\s,]+)*(?:the\s+)?(comfort(?:able)?|comfy|nicer|nice one|budget|cheap(?:er)?|basic)(?:'s)?(?:[\s,]+(?:one|plan|tier|version|option|it is|is fine|is good|is great|works|sounds good|for me|for us|please|pls|plz|then|fine|is))*$/;

/** "comfortable please", "budget is fine", "let's do comfort". Null for anything else (amounts never count). */
export function parseChoice(body: string): Tier | null {
  const t = normText(body).replace(/[!.?\s]+$/, '');
  if (/\$|\d/.test(t)) return null;
  const m = t.match(CHOICE);
  if (!m) return null;
  return /^(?:comfort|comfy|nicer|nice)/.test(m[1]) ? 'comfort' : 'budget';
}
