// HUNGRY_FLOW.md: trigger lexicon (§1), taste merge (§3), ranking to exactly three (§4), copy helpers (§5).
// Pure. The places lookup receives only cuisine tags, a price band, diet tags and the neighborhood string,
// which the runner turns into a coordinate with the bundled gazetteer (PRIVACY §9).

import type { HungryState, MemberKey, PlaceOption, PlacesQuery, PriceBand } from './types.js';
import type { EngineHungry, Taste } from './model.js';
import { capitalize, fmtTimeMs, normText, numberWord } from './util.js';
import { TEMPLATES } from './templates.js';

// ───────────────────────── §1 trigger lexicon ─────────────────────────

/** Strong signals: 2 points each. */
const STRONG: RegExp[] = [
  /\bwhere (?:should|do|can|could|shall) we (?:eat|get food|grab food|go (?:to )?eat|get dinner|get lunch|go for (?:dinner|lunch))\b/,
  /\bwhere (?:are|r) we (?:eating|getting food|going to eat|gonna eat|getting dinner|getting lunch)\b/,
  /\bwhat (?:should|do|shall) we (?:eat|get to eat)\b/,
  /\bwhat are we eating\b/,
  /\b(?:i'?m|im|i am)\s+(?:so |actually |literally |lowkey |kinda |sooo+ |really )*(?:starving|famished|hungry)\b/,
  /\bso hungry\b/,
  /\bstarving\b/,
  /\bgrab (?:some )?food\b/,
  /\bgrab a bite\b/,
  /\bget (?:some )?food\b/,
  /\blet'?s (?:eat|get food|grab food)\b/,
  /\bwanna (?:eat|get food|grab food)\b/,
  /\b(?:who'?s|anyone|anybody) hungry\b/,
  /\bfood run\b/,
  /\bwhat'?s for (?:dinner|lunch)\b/,
];
/** A whole message of "food?" / "dinner?" / "lunch?" is strong too. */
const STRONG_WHOLE = /^(?:food|dinner|lunch)\s*\?+$/;

const CUISINE_WORDS =
  /\b(thai|mexican|tacos?|burritos?|japanese|sushi|ramen|chinese|korean|vietnamese|pho|indian|curry|pizza|italian|pasta|burgers?|mediterranean|greek|gyros?|shawarma|kebabs?|falafel|bbq|barbecue|seafood|sandwich(?:es)?|salads?|dumplings?|noodles?|momos?|ethiopian|tapas|halal|boba|dessert|ice cream)\b/g;
const WEAK = /\b(hungry|food|eat|eating|dinner|lunch|brunch|restaurants?|takeout|take out|order in|delivery)\b/g;

/** Idioms cancel outright. */
const IDIOMS: RegExp[] = [
  /\bfood for thought\b/,
  /\beat(?:ing)? my words\b/,
  /\beat(?:ing|s)? (?:me|him|her|you|us|them) (?:up|alive)\b/,
  /\beating (?:my|his|her|your|our) (?:soul|brain|time|life|lunch)\b/,
  /\bwhat'?s eating\b/,
  /\bfood coma\b/,
  /\bbrain food\b/,
  /\bfood poisoning\b/,
  /\bdog food\b/,
  /\beat (?:my )?dust\b/,
  /\beat your heart out\b/,
];
/**
 * Money talk is a bill, not a meal ("how much does everyone owe for dinner", "we spent 84 on pizza"): it cancels
 * food intent outright. Budget phrases ("under $20", "$15 max") are tastes, not money talk.
 */
const MONEY =
  /\b(?:owe[sd]?|owing|venmo|paypal|zelle|cash ?app|costs?|paid|pay(?:ing|s)?|spent|spend|reimburse|split(?:ting)? (?:it|this|that|the (?:bill|check|tab|cost|total)|\$?\d+|\w+ ways|between|among|evenly|equally)|(?:the|our|this|that|a) (?:bill|check|tab))\b|(?<!\b(?:under|below|max|than|within|to|around|about|have|got|only|like)\s?)(?<!~\s?)\$\s?\d(?![\d.,]*\s*(?:max|or less|or under|tops)\b)/;

/** Negatives: cancel unless a strong signal is also present ("already ate", "ate so much"). */
const NEGATIVES: RegExp[] = [/\bate so much\b/, /\balready ate\b/, /\bjust ate\b/, /\bso full\b/, /\bnot hungry\b/, /\bi ate\b/];

export interface FoodScore {
  /** Points after cancellation (0 when an idiom, money talk or an un-overridden negative is present). */
  score: number;
  raw: number;
  strong: boolean;
  idiom: boolean;
  negative: boolean;
  /** Money words ("owe", "paid", "split it", "$84"): a bill, never a food trigger. */
  money: boolean;
}

export function foodScore(text: string): FoodScore {
  let t = normText(text);
  const idiom = IDIOMS.some((r) => r.test(t));
  const negative = NEGATIVES.some((r) => r.test(t));
  const money = MONEY.test(t);
  let raw = 0;
  let strong = false;
  if (STRONG_WHOLE.test(t)) {
    raw += 2;
    strong = true;
    t = '';
  }
  for (const r of STRONG) {
    const m = t.match(r);
    if (m) {
      raw += 2;
      strong = true;
      t = t.replace(m[0], ' ');
    }
  }
  const weak = new Set<string>();
  for (const m of t.matchAll(WEAK)) weak.add(m[1]);
  for (const m of t.matchAll(CUISINE_WORDS)) weak.add(m[1]);
  raw += weak.size;
  const cancelled = idiom || money || (negative && !strong);
  return { score: cancelled ? 0 : raw, raw, strong, idiom, negative, money };
}

// ───────────────────────── §3 taste ─────────────────────────

const CUISINES: Array<[string, RegExp]> = [
  ['korean', /\bkorean\b|\bk-?bbq\b|\bbibimbap\b|\btteokbokki\b/],
  ['thai', /\bthai\b|\bpad thai\b|\bpad see ew\b|\bkhao soi\b/],
  ['mexican', /\bmexican\b|\btacos?\b|\bburritos?\b|\bquesadillas?\b|\btex[- ]?mex\b|\bnachos\b|\benchiladas?\b/],
  ['sushi', /\bsushi\b|\bsashimi\b|\bomakase\b/],
  ['ramen', /\bramen\b/],
  ['japanese', /\bjapanese\b|\bizakaya\b|\bteriyaki\b|\budon\b/],
  ['chinese', /\bchinese\b|\bszechuan\b|\bsichuan\b|\bhot ?pot\b|\bcantonese\b|\bdim sum\b/],
  ['vietnamese', /\bvietnamese\b|\bpho\b|\bbanh mi\b/],
  ['indian', /\bindian\b|\bcurry\b|\btikka\b|\bmasala\b|\bbiryani\b|\bdosa\b|\btandoori\b/],
  ['pizza', /\bpizzas?\b/],
  ['italian', /\bitalian\b|\bpasta\b|\brisotto\b/],
  ['burger', /\bburgers?\b|\bcheeseburgers?\b/],
  ['american', /\bamerican\b|\bdiner\b|\bwings\b|\bfried chicken\b/],
  ['mediterranean', /\bmediterranean\b/],
  ['greek', /\bgreek\b|\bgyros?\b|\bsouvlaki\b/],
  ['middle_eastern', /\bmiddle eastern\b|\blebanese\b|\bshawarma\b|\bhummus\b|\bpersian\b|\bturkish\b/],
  ['kebab', /\bkebabs?\b|\bkabobs?\b|\bdoner\b/],
  ['falafel', /\bfalafel\b/],
  ['bbq', /(?<!korean )\b(?:bbq|barbecue|barbeque|brisket)\b/],
  ['seafood', /\bseafood\b|\boysters?\b|\blobster\b|\bclam chowder\b|\bfish and chips\b/],
  ['sandwich', /\bsandwich(?:es)?\b|\bsubs\b|\bdeli\b|\bhoagies?\b/],
  ['salad', /\bsalads?\b/],
  ['vegan', /\bvegan (?:place|spot|restaurant|food)\b/],
  ['vegetarian', /\bvegetarian (?:place|spot|restaurant|food)\b/],
  ['coffee_shop', /\bcoffee\b|\bcafe\b|\bcafé\b/],
  ['dessert', /\bdesserts?\b|\bcake\b|\bsweets\b|\bpastr(?:y|ies)\b|\bbakery\b/],
  ['ice_cream', /\bice cream\b|\bgelato\b|\bfroyo\b/],
  ['bubble_tea', /\bboba\b|\bbubble tea\b|\bmilk tea\b/],
  ['dumpling', /\bdumplings?\b|\bxiao ?long ?bao\b|\bpotstickers?\b|\bgyoza\b/],
  ['noodle', /\bnoodles?\b|\blo mein\b|\blaksa\b/],
  ['nepalese', /\bnepal(?:ese|i)\b|\bmomos?\b/],
  ['ethiopian', /\bethiopian\b|\binjera\b/],
  ['french', /\bfrench\b(?! fries)|\bbistro\b|\bcrepes?\b/],
  ['spanish', /\bspanish\b|\btapas\b|\bpaella\b/],
  ['spanish', /\bspanish\b|\btapas\b|\bpaella\b/],
  ['caribbean', /\bcaribbean\b|\bjamaican\b|\bjerk chicken\b/],
  ['peruvian', /\bperuvian\b|\bceviche\b/],
  ['halal', /\bhalal\b/],
  ['steak_house', /\bsteak(?:house)?s?\b/],
];

export const CUISINE_TAGS = CUISINES.map(([t]) => t);

/** Cuisine tags mentioned in a text (synonyms -> OSM-style tags), in first-mention order. */
export function cuisinesIn(text: string): string[] {
  const t = normText(text);
  const found: Array<[number, string]> = [];
  for (const [tag, re] of CUISINES) {
    const m = re.exec(t);
    if (m) found.push([m.index, tag]);
  }
  return found.sort((a, b) => a[0] - b[0]).map(([, tag]) => tag);
}

/** Normalizes a place's cuisine field ("Thai;vietnamese", "japanese") to tags. */
export function placeCuisines(cuisine?: string): string[] {
  if (!cuisine) return [];
  const out: string[] = [];
  for (const part of cuisine.split(/[;,/]/)) {
    const p = part.trim().toLowerCase().replace(/\s+/g, '_');
    if (!p) continue;
    if (CUISINE_TAGS.includes(p)) out.push(p);
    else out.push(...cuisinesIn(part.replace(/_/g, ' ')));
  }
  return [...new Set(out)];
}

const DIETS: Array<[string, RegExp]> = [
  ['vegetarian', /\bvegetarians?\b|\bveggie\b/],
  ['vegan', /\bvegan\b/],
  ['halal', /\bhalal\b/],
  ['kosher', /\bkosher\b/],
  ['gluten_free', /\bgluten[- ]?free\b|\bceliac\b|\bno gluten\b|\bgf\b/],
  ['nut_allergy', /\bnut allergy\b|\bnut[- ]free\b|\bpeanut allergy\b|\ballergic to (?:pea)?nuts\b|\bno nuts\b/],
  ['dairy_free', /\bdairy[- ]free\b|\blactose\b|\bno dairy\b/],
  ['pescatarian', /\bpescatarian\b|\bpescetarian\b/],
  ['shellfish_allergy', /\bshellfish allergy\b|\ballergic to shellfish\b|\bno shellfish\b/],
];
const SNACKS = new Set(['coffee_shop', 'dessert', 'ice_cream', 'bubble_tea', 'donut', 'bakery', 'cafe', 'bagel', 'tea', 'juice']);

/** Coffee, dessert and the like are not a meal unless somebody asked for them (also name-only cafés). */
function isSnack(c: PlaceOption, tags: string[], h: HungryState): boolean {
  const raw = (c.cuisine ?? '').toLowerCase().split(/[;,]/).map((x) => x.trim()).filter(Boolean);
  const all = [...new Set([...tags, ...raw])];
  if (all.some((t) => (h.cuisineVotes[t] ?? 0) > 0)) return false;
  if (all.length) return all.every((t) => SNACKS.has(t));
  return /\b(caf[eé]|coffee|bakery|donuts?|bagels?|tea|creamery|juice)\b/i.test(c.name);
}

const HOODS: Array<[string, RegExp, string]> = [
  ['Harvard Square', /\bharvard(?: sq(?:uare)?| yard)?\b/, 'Harvard Sq'],
  ['Allston', /\ballston\b/, 'Allston'],
  ['Central Square', /\bcentral sq(?:uare)?\b|\b(?:in|near|around|by) central\b/, 'Central Sq'],
  ['Porter Square', /\bporter(?: sq(?:uare)?)?\b/, 'Porter Sq'],
  ['Kendall Square', /\bkendall(?: sq(?:uare)?)?\b|\bmit\b/, 'Kendall Sq'],
  ['Inman Square', /\binman(?: sq(?:uare)?)?\b/, 'Inman Sq'],
  ['Davis Square', /\bdavis(?: sq(?:uare)?)?\b/, 'Davis Sq'],
  ['Union Square', /\bunion sq(?:uare)?\b/, 'Union Sq'],
  ['Brighton', /\bbrighton\b/, 'Brighton'],
  ['Back Bay', /\bback bay\b/, 'Back Bay'],
  ['Fenway', /\bfenway\b/, 'Fenway'],
  ['Beacon Hill', /\bbeacon hill\b/, 'Beacon Hill'],
  ['North End', /\bnorth end\b/, 'North End'],
  ['South End', /\bsouth end\b/, 'South End'],
  ['Chinatown', /\bchinatown\b/, 'Chinatown'],
  ['Seaport', /\bseaport\b/, 'Seaport'],
  ['Jamaica Plain', /\bjamaica plain\b|\bjp\b/, 'JP'],
  ['Coolidge Corner', /\bcoolidge(?: corner)?\b/, 'Coolidge Corner'],
  ['Downtown Crossing', /\bdowntown(?: crossing)?\b/, 'Downtown'],
  ['Somerville', /\bsomerville\b/, 'Somerville'],
  ['Brookline', /\bbrookline\b/, 'Brookline'],
  ['Cambridge', /\bcambridge\b/, 'Cambridge'],
];

/** Gazetteer neighborhoods named in a text, in mention order. */
export function neighborhoodsIn(text: string): string[] {
  const t = normText(text);
  const found: Array<[number, string]> = [];
  for (const [name, re] of HOODS) {
    const m = re.exec(t);
    if (m) found.push([m.index, name]);
  }
  return found.sort((a, b) => a[0] - b[0]).map(([, n]) => n);
}

export function shortHood(name: string): string {
  return HOODS.find(([n]) => n === name)?.[2] ?? name;
}

function priceIn(t: string): PriceBand | undefined {
  const bands: PriceBand[] = [];
  if (/\$\$\$\$/.test(t)) bands.push(4);
  else if (/\$\$\$/.test(t)) bands.push(3);
  else if (/\$\$/.test(t)) bands.push(2);
  else if (/(?:^|[^$\d])\$(?![$\d])/.test(t)) bands.push(1);
  if (/\bcheap\b|\bcheapest\b|\bbroke\b|\bbudget\b|\binexpensive\b|\bnothing fancy\b|\baffordable\b/.test(t)) bands.push(1);
  for (const m of t.matchAll(/\b(?:under|less than|max|below|no more than)\s+\$?(\d{1,3})\b|\$?(\d{1,3})\s*(?:or less|max|tops)\b/g)) {
    const n = Number(m[1] ?? m[2]);
    bands.push(n <= 15 ? 1 : n <= 30 ? 2 : n <= 60 ? 3 : 4);
  }
  if (/\bmoderate\b|\bmid[- ]?range\b|\breasonable\b|\bnormal price/.test(t)) bands.push(2);
  if (/\bnot (?:too |that |very |super |crazy |overly )?(?:expensive|pricey|pricy)\b|\bwon'?t break the bank\b/.test(t)) bands.push(2);
  if (/\bcheap(?:er)?ish\b|\bon the cheap(?:er)? side\b/.test(t)) bands.push(1);
  if (/\btreat (?:ourselves|yourselves|myself)\b|\bfancy\b|\bsplurge\b|\bnice place\b|\bupscale\b|\bbougie\b/.test(t)) bands.push(3);
  return bands.length ? (Math.min(...bands) as PriceBand) : undefined;
}

/** Reads one food answer. Vetoes ("no sushi", "anything but pizza") are removed from the positive cuisines. */
export function parseTaste(text: string): Taste {
  let t = normText(text);
  const vetoes: string[] = [];
  const vetoRe = /\b(?:no|not|nothing|anything but|anything except|except|no more|not feeling|not in the mood for|hate|can'?t do|cant do|without|skip(?: the)?)\s+((?:[\w'-]+\s?){1,4})/g;
  for (const m of t.matchAll(vetoRe)) {
    const vs = cuisinesIn(m[1]);
    for (const v of vs) if (!vetoes.includes(v)) vetoes.push(v);
    if (vs.length) t = t.replace(m[0], ' ');
  }
  const cuisines = cuisinesIn(t).filter((c) => !vetoes.includes(c));
  // A flavor with no named cuisine ("something spicy") stands for the cuisines that usually deliver it.
  if (!cuisines.length && /(?<!\b(?:not|no|nothing)\s(?:too\s|that\s|very\s|super\s|overly\s)?)\bspicy\b|\bsome heat\b/.test(t)) for (const c of ['thai', 'indian', 'korean']) if (!vetoes.includes(c)) cuisines.push(c);
  const diet: string[] = [];
  for (const [tag, re] of DIETS) if (re.test(t)) diet.push(tag);
  const neighborhoods = neighborhoodsIn(t);
  const price = priceIn(t);
  const vague = neighborhoods.length === 0 && /\bnear (?:me|here|us)\b|\bnearby\b|\bclose by\b|\baround here\b|\bwhere we are\b|\bnear here\b|\bclose to here\b|\bwalking distance\b/.test(t);
  const wildcard = /\banything\b(?!\s+(?:but|except))|\bidc\b|\bi don'?t care\b|\bwhatever\b|\bno preference\b|\bup to you\b|\bdon'?t mind\b|\banywhere\b|\beither is fine\b/.test(t);
  const go = /\bjust pick\b|\byou pick\b|\bwhatever you think\b|\bdealer'?s choice\b|\bpick for us\b|\bsurprise us\b/.test(t);
  return { cuisines, vetoes, price, diet, neighborhoods, wildcard, vague, go };
}

export function hasTaste(t: Taste): boolean {
  return t.cuisines.length > 0 || t.vetoes.length > 0 || t.price !== undefined || t.diet.length > 0 || t.neighborhoods.length > 0 || t.wildcard || t.vague;
}

export function newHungry(now: number, instant: boolean): EngineHungry {
  return {
    phase: 'asking', askedAt: now, cuisineVotes: {}, vetoes: [], diet: [], neighborhoods: {}, answeredBy: [], options: [], votes: {},
    deadlineAt: now + 10 * 60_000, instant, memberCuisines: {}, memberPlaces: {},
  };
}

/** Merge rules: +1 per member per cuisine; vetoes always win; tightest budget wins; diets union; mentions per member. */
export function mergeTaste(h: EngineHungry, member: MemberKey, t: Taste): void {
  const mc = (h.memberCuisines ??= {});
  const mine = (mc[member] ??= []);
  for (const c of t.cuisines) {
    if (mine.includes(c)) continue;
    mine.push(c);
    h.cuisineVotes[c] = (h.cuisineVotes[c] ?? 0) + 1;
  }
  for (const v of t.vetoes) if (!h.vetoes.includes(v)) h.vetoes.push(v);
  if (t.price !== undefined) h.priceMax = h.priceMax === undefined ? t.price : (Math.min(h.priceMax, t.price) as PriceBand);
  for (const d of t.diet) if (!h.diet.includes(d)) h.diet.push(d);
  const mp = (h.memberPlaces ??= {});
  const places = (mp[member] ??= []);
  for (const n of t.neighborhoods) {
    if (places.includes(n)) continue;
    places.push(n);
    h.neighborhoods[n] = (h.neighborhoods[n] ?? 0) + 1;
  }
  if (hasTaste(t) && !h.answeredBy.includes(member)) h.answeredBy.push(member);
}

/** Cuisines ordered by votes (ties: first mentioned), minus vetoes. */
export function rankedCuisines(h: HungryState): Array<[string, number]> {
  const order = Object.keys(h.cuisineVotes);
  return Object.entries(h.cuisineVotes)
    .filter(([c, n]) => n > 0 && !h.vetoes.includes(c))
    .sort((a, b) => b[1] - a[1] || order.indexOf(a[0]) - order.indexOf(b[0]));
}

/** One neighborhood string per plan: the most mentioned, or "A + B" (meet in the middle) for two places. */
export function nearOf(h: HungryState, planNeighborhood?: string): string {
  const order = Object.keys(h.neighborhoods);
  const hoods = Object.entries(h.neighborhoods).sort((a, b) => b[1] - a[1] || order.indexOf(a[0]) - order.indexOf(b[0]));
  if (hoods.length >= 2) return `${hoods[0][0]} + ${hoods[1][0]}`;
  if (hoods.length === 1) return hoods[0][0];
  return planNeighborhood ?? '';
}

/** Close relatives of a cuisine tag, used as a second tier when the exact tag is scarce nearby. */
export const RELATED: Record<string, string[]> = {
  dumpling: ['chinese'], ramen: ['japanese', 'noodle'], sushi: ['japanese'], noodle: ['chinese', 'japanese', 'vietnamese'],
  kebab: ['middle_eastern', 'mediterranean'], falafel: ['middle_eastern', 'mediterranean'], greek: ['mediterranean'],
  burger: ['american'], bbq: ['american'], pizza: ['italian'], bubble_tea: ['dessert'], ice_cream: ['dessert'],
};

/** Cuisines ordered by votes minus vetoes, then the top cuisine's close relatives (never a vetoed one). */
export function queryCuisines(h: HungryState): string[] {
  const base = rankedCuisines(h).map(([c]) => c);
  const rel = base.length ? (RELATED[base[0]] ?? []).filter((r) => !base.includes(r) && !h.vetoes.includes(r)) : [];
  return [...base, ...rel];
}

export function placesQuery(h: HungryState, near: string, at: number): PlacesQuery {
  const q: PlacesQuery = { cuisines: queryCuisines(h), diet: [...h.diet], near, at };
  if (h.priceMax !== undefined) q.priceMax = h.priceMax;
  return q;
}

/** Split compromise: the runner-up has at least half the votes of the top cuisine. */
export function compromise(h: HungryState): { top: [string, number]; second: [string, number] } | null {
  const r = rankedCuisines(h);
  if (r.length >= 2 && r[1][1] * 2 >= r[0][1]) return { top: r[0], second: r[1] };
  return null;
}

// ───────────────────────── §4 ranking ─────────────────────────

function brand(name: string): string {
  return normText(name)
    .replace(/\s*[-–@(|].*$/, '')
    .replace(/\b(the|restaurant|cafe|kitchen|bar|grill)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Ranks candidates and returns at most three, ids 1..3.
 * score = 3·cuisineShare + 2·priceFit + 2·openAtTime + dietFit − 0.15·walkMinutes. Places known to be closed
 * at plan time, over budget, or of a vetoed cuisine are excluded. Ties go to the shorter walk. No two options
 * share a brand. Split groups get 2 from the top cuisine and 1 from the runner-up; otherwise the top
 * cuisine's places come first.
 */
export function rankPlaces(candidates: PlaceOption[], hungry: HungryState, eventAt?: number): PlaceOption[] {
  const ranked = rankedCuisines(hungry);
  const total = ranked.reduce((s, [, n]) => s + n, 0);
  const share = (tags: string[]) => (total ? Math.max(0, ...tags.map((t) => (hungry.cuisineVotes[t] ?? 0) / total)) : 0);
  const max = hungry.priceMax;
  // Over budget is excluded. OSM has no prices, so an estimated band gets one band of slack (penalized below).
  const overBudget = (c: PlaceOption) =>
    max !== undefined && c.priceBand !== undefined && c.priceBand > (c.priceEstimated ? max + 1 : max);
  let pool = candidates.filter((c) => c.openAtPlanTime !== false && !overBudget(c));
  pool = pool.filter((c) => !placeCuisines(c.cuisine).some((t) => hungry.vetoes.includes(t)));

  // Diet: OSM carries only positive diet:* tags, so an untagged place is "unknown", not "no". Tagged places
  // score higher (dietFit); untagged ones stay eligible and their bubble says "check: vegetarian".
  const reqs = hungry.diet;
  const scored = pool.map((c) => {
    const tags = placeCuisines(c.cuisine);
    const priceFit = max === undefined ? 1 : c.priceBand === undefined ? 0.5 : c.priceBand <= max ? 1 : 0.5;
    const stretch = max !== undefined && c.priceBand !== undefined && c.priceBand > max ? 1 : 0;
    const open = c.openAtPlanTime === true ? 1 : 0.5;
    const dietFit = reqs.length ? reqs.filter((r) => c.diet?.includes(r)).length / reqs.length : 0;
    const walk = c.walkMinutes ?? 15;
    const snack = isSnack(c, tags, hungry) ? 2 : 0;
    return { c, tags, score: 3 * share(tags) + 2 * priceFit + 2 * open + dietFit - 0.15 * walk - snack - stretch, walk };
  });
  scored.sort((a, b) => b.score - a.score || a.walk - b.walk || (a.c.name < b.c.name ? -1 : 1));

  const picked: typeof scored = [];
  const seen = new Set<string>();
  const take = (pred: (s: (typeof scored)[number]) => boolean, max: number) => {
    for (const s of scored) {
      if (picked.length >= 3 || max <= 0) return;
      const b = brand(s.c.name);
      if (seen.has(b) || picked.includes(s) || !pred(s)) continue;
      picked.push(s);
      seen.add(b);
      max--;
    }
  };
  const comp = compromise(hungry);
  if (comp) {
    take((s) => s.tags.includes(comp.top[0]), 2);
    take((s) => s.tags.includes(comp.second[0]), 1);
  } else if (ranked.length) {
    const top = ranked[0][0];
    take((s) => s.tags.includes(top), 3);
    take((s) => s.tags.some((t) => (RELATED[top] ?? []).includes(t)), 3);
    take((s) => s.tags.some((t) => (hungry.cuisineVotes[t] ?? 0) > 0), 3);
  }
  take(() => true, 3);

  return picked.map((s, i) => ({ ...s.c, id: i + 1, why: whyLine(s.c, s.tags, hungry, eventAt) }));
}

function whyLine(c: PlaceOption, tags: string[], h: HungryState, eventAt?: number): string {
  const bits: string[] = [];
  if (tags.length) bits.push(tags.map(cuisineLabel).join('/'));
  if (h.priceMax !== undefined && c.priceBand !== undefined) bits.push('fits the budget');
  if (c.openAtPlanTime === true) bits.push(eventAt ? 'open at plan time' : 'open now');
  if (c.walkMinutes !== undefined) bits.push(`${c.walkMinutes} min walk`);
  return bits.join(', ');
}

// ───────────────────────── copy helpers ─────────────────────────

const PROPER = new Set(['thai', 'mexican', 'japanese', 'chinese', 'korean', 'vietnamese', 'indian', 'italian', 'american', 'mediterranean', 'greek', 'nepalese', 'ethiopian', 'french', 'spanish', 'caribbean', 'peruvian']);
const LABELS: Record<string, string> = {
  middle_eastern: 'Middle Eastern', bbq: 'BBQ', coffee_shop: 'coffee', ice_cream: 'ice cream', bubble_tea: 'bubble tea',
  steak_house: 'steakhouse', dumpling: 'dumpling', noodle: 'noodle', sandwich: 'sandwich', burger: 'burger',
};

export function cuisineLabel(tag: string): string {
  if (LABELS[tag]) return LABELS[tag];
  return PROPER.has(tag) ? capitalize(tag) : tag.replace(/_/g, ' ');
}

export function priceLabel(band?: PriceBand, estimated?: boolean): string | undefined {
  if (!band) return undefined;
  const d = '$'.repeat(band);
  return estimated ? `~${d} (est.)` : d;
}

const DIET_LABEL: Record<string, string> = {
  gluten_free: 'gluten-free', nut_allergy: 'nut allergy', dairy_free: 'dairy-free', shellfish_allergy: 'shellfish allergy',
};

/** "1 · Tasty Thai · Thai · ~$ (est.) · 4 min walk · open at 7pm" (+ "check: nut allergy"). */
export function placeBubbleParts(p: PlaceOption, h: HungryState, eventAt: number | undefined, tz: string) {
  const tags = placeCuisines(p.cuisine);
  const missing = h.diet.filter((d) => !p.diet?.includes(d));
  return {
    id: p.id,
    name: p.name,
    cuisine: tags.length ? tags.map(cuisineLabel).join('/') : undefined,
    price: priceLabel(p.priceBand, p.priceEstimated),
    walk: p.walkMinutes !== undefined ? `${p.walkMinutes} min walk` : undefined,
    open: p.openAtPlanTime === true ? (eventAt ? `open at ${fmtTimeMs(eventAt, tz)}` : 'open now') : 'hours unknown',
    check: missing.length ? missing.map((d) => DIET_LABEL[d] ?? d.replace(/_/g, ' ')).join(', ') : undefined,
  };
}

function whereLabel(near: string): string {
  if (near.includes(' + ')) return `halfway between ${near.split(' + ').map(shortHood).join(' and ')}`;
  return near ? shortHood(near) : '';
}

function priceWord(h: HungryState): string {
  return h.priceMax === 1 ? 'keeping it cheap' : h.priceMax === 2 ? 'mid-range' : h.priceMax !== undefined ? 'treating ourselves' : '';
}

/**
 * The recommendation header (two sentences). Sentence 1 summarizes: "Thai, keeping it cheap, Harvard Sq",
 * the 2+1 compromise line, or, when nothing matches the favorite cuisine, says so honestly. Never names who
 * set the budget.
 */
export function placesHeader(h: HungryState, near: string, options: PlaceOption[], how: 'tap' | 'reply'): string {
  const where = whereLabel(near);
  const n = options.length;
  const comp = compromise(h);
  // The 2+1 line describes the list, so it is used only when the list really is two of one and one of the other.
  const serves = (c: string) => options.filter((o) => placeCuisines(o.cuisine).some((t) => [c, ...(RELATED[c] ?? [])].includes(t))).length;
  if (comp && n === 3 && serves(comp.top[0]) >= 2 && serves(comp.second[0]) >= 1) {
    const [c1, n1] = comp.top;
    const [c2, n2] = comp.second;
    const l2 = cuisineLabel(c2);
    const tail = `two ${cuisineLabel(c1)} spots and ${/^[aeiou]/i.test(l2) ? 'an' : 'a'} ${l2} place`;
    // One vote each may be one person naming both ("thai or indian"), so don't claim two people said them.
    const line = n1 === 1 && n2 === 1
      ? `${capitalize(cuisineLabel(c1))} or ${l2}: ${tail}`
      : `${numberWord(n1, true)} said ${cuisineLabel(c1)}, ${numberWord(n2)} said ${l2}: ${tail}`;
    return TEMPLATES.foodHeader({ summary: where ? `${line}, ${where}` : line, n, how });
  }
  const top = rankedCuisines(h)[0]?.[0];
  const related = top ? [top, ...(RELATED[top] ?? [])] : [];
  if (top && !options.some((o) => placeCuisines(o.cuisine).some((t) => related.includes(t)))) {
    return TEMPLATES.foodHeaderNoMatch({ cuisine: cuisineLabel(top), where: where.replace(/^halfway between /, '') || undefined, n, price: priceWord(h) || undefined, how });
  }
  const cuisine = top ? capitalize(cuisineLabel(top)) : 'Good food';
  return TEMPLATES.foodHeader({ summary: [cuisine, priceWord(h), where].filter(Boolean).join(', '), n, how });
}

/** Emoji for the place-lock line, by cuisine. */
export function placeEmoji(cuisine?: string): string {
  const tags = placeCuisines(cuisine);
  if (tags.some((t) => ['ramen', 'noodle', 'vietnamese', 'thai'].includes(t))) return '🍜';
  if (tags.includes('pizza')) return '🍕';
  if (tags.includes('mexican')) return '🌮';
  if (tags.some((t) => ['sushi', 'japanese'].includes(t))) return '🍣';
  if (tags.includes('dumpling')) return '🥟';
  if (tags.includes('coffee_shop')) return '☕';
  return '🍽️';
}
