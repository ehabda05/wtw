// Cuisine and diet vocabulary shared by the OSM build script (scripts/build-places.ts),
// the offline search (fallback.ts) and the Google mapper (google.ts).
//
// Tags are OSM-style: lowercase, ASCII, underscores ("coffee_shop", "middle_eastern").
// A raw value can expand to several tags so that broad requests still match specific
// places: a "ramen" place is also "japanese" and "noodle"; a "greek" place is also
// "mediterranean". We only ever widen from specific to general, never the other way.

/** raw (already lowercased, ASCII, underscored) -> engine tags. Anything not listed maps to itself. */
const SYNONYMS: Record<string, string[]> = {
  // East / Southeast Asian
  sushi: ['sushi', 'japanese'],
  ramen: ['ramen', 'japanese', 'noodle'],
  udon: ['japanese', 'noodle'],
  izakaya: ['japanese'],
  japanese: ['japanese'],
  pho: ['vietnamese', 'noodle'],
  banh_mi: ['vietnamese', 'sandwich'],
  sichuan: ['sichuan', 'chinese'],
  szechuan: ['sichuan', 'chinese'],
  szechwan: ['sichuan', 'chinese'],
  cantonese: ['cantonese', 'chinese'],
  hunan: ['hunan', 'chinese'],
  shanghainese: ['shanghainese', 'chinese'],
  taiwanese: ['taiwanese', 'chinese'],
  dim_sum: ['dim_sum', 'chinese', 'dumpling'],
  dumplings: ['dumpling'],
  dumpling: ['dumpling'],
  noodles: ['noodle'],
  noodle: ['noodle'],
  hot_pot: ['hotpot'],
  hotpot: ['hotpot'],
  shabu_shabu: ['hotpot', 'japanese'],
  korean_bbq: ['korean', 'bbq'],
  korean_barbecue: ['korean', 'bbq'],
  pan_asian: ['asian'],
  boba: ['bubble_tea'],
  bubble_tea: ['bubble_tea'],
  milk_tea: ['bubble_tea'],
  poke: ['poke', 'hawaiian'],

  // Americas
  tex_mex: ['mexican'],
  texmex: ['mexican'],
  taco: ['mexican'],
  tacos: ['mexican'],
  burrito: ['mexican'],
  burritos: ['mexican'],
  latin: ['latin_american'],
  latin_american: ['latin_american'],
  brazilian: ['brazilian', 'latin_american'],
  peruvian: ['peruvian', 'latin_american'],
  colombian: ['colombian', 'latin_american'],
  venezuelan: ['venezuelan', 'latin_american'],
  salvadoran: ['salvadoran', 'latin_american'],
  argentinian: ['argentinian', 'latin_american'],
  jamaican: ['jamaican', 'caribbean'],
  haitian: ['haitian', 'caribbean'],
  cuban: ['cuban', 'caribbean'],
  puerto_rican: ['puerto_rican', 'caribbean'],
  dominican: ['dominican', 'caribbean'],
  diner: ['diner', 'american'],
  barbecue: ['bbq'],
  bbq: ['bbq'],
  hamburger: ['burger'],
  burgers: ['burger'],
  burger: ['burger'],
  fried_chicken: ['chicken'],
  wings: ['chicken'],
  chicken: ['chicken'],
  creole: ['cajun'],

  // Europe / Mediterranean / Middle East / Africa / South Asia
  greek: ['greek', 'mediterranean'],
  gyro: ['greek', 'kebab'],
  lebanese: ['lebanese', 'middle_eastern', 'mediterranean'],
  middle_east: ['middle_eastern'],
  middle_eastern: ['middle_eastern'],
  turkish: ['turkish', 'middle_eastern'],
  persian: ['persian', 'middle_eastern'],
  egyptian: ['egyptian', 'middle_eastern'],
  israeli: ['israeli', 'middle_eastern'],
  syrian: ['syrian', 'middle_eastern'],
  falafel: ['falafel', 'middle_eastern'],
  shawarma: ['kebab', 'middle_eastern'],
  doner: ['kebab'],
  kebap: ['kebab'],
  kebab: ['kebab'],
  tapas: ['spanish'],
  pasta: ['italian'],
  nepali: ['nepalese'],
  himalayan: ['nepalese'],
  nepalese: ['nepalese'],
  ethiopian: ['ethiopian'],
  eritrean: ['ethiopian'],

  // Cafe / sweets
  coffee: ['coffee_shop'],
  cafe: ['coffee_shop'],
  espresso: ['coffee_shop'],
  coffee_shop: ['coffee_shop'],
  gelato: ['ice_cream', 'dessert'],
  ice_cream: ['ice_cream', 'dessert'],
  frozen_yogurt: ['frozen_yogurt', 'ice_cream', 'dessert'],
  froyo: ['frozen_yogurt', 'ice_cream', 'dessert'],
  waffle: ['waffle', 'dessert'],
  crepe: ['crepe', 'dessert'],
  crepes: ['crepe', 'dessert'],
  cake: ['dessert'],
  pastry: ['bakery', 'dessert'],
  dessert: ['dessert'],
  desserts: ['dessert'],
  doughnut: ['donut'],
  donuts: ['donut'],
  donut: ['donut'],
  bagels: ['bagel', 'breakfast'],
  bagel: ['bagel', 'breakfast'],

  // Misc
  deli: ['sandwich'],
  sub: ['sandwich'],
  subs: ['sandwich'],
  sandwiches: ['sandwich'],
  sandwich: ['sandwich'],
  salads: ['salad'],
  fish: ['seafood'],
  fish_and_chips: ['seafood'],
  oyster: ['seafood'],
  oysters: ['seafood'],
  lobster: ['seafood'],
  steak: ['steak_house'],
  steakhouse: ['steak_house'],
  steak_house: ['steak_house'],
  veggie: ['vegetarian'],
};

/** Values that say nothing useful about the food. Dropped. */
const DROP = new Set(['regional', 'local', 'yes', 'no', 'restaurant', 'food', 'other', 'various']);

/** Query-side broadening for umbrella words people actually use. Place-side tags never shrink. */
const QUERY_EXPANSION: Record<string, string[]> = {
  asian: ['asian', 'chinese', 'japanese', 'korean', 'thai', 'vietnamese', 'taiwanese', 'burmese', 'indonesian', 'malaysian', 'mongolian'],
  latin_american: ['latin_american', 'mexican', 'brazilian', 'peruvian', 'colombian', 'salvadoran', 'caribbean'],
};

/** Cafés, sweets and drinks: cheap by default and poor fallbacks for a meal. */
export const SNACK_CUISINES = new Set([
  'coffee_shop', 'bubble_tea', 'tea', 'ice_cream', 'frozen_yogurt', 'dessert', 'donut', 'bakery', 'waffle', 'crepe',
  'juice', 'acai', 'bagel',
]);

/** OSM `diet:*` keys we read, already normalized. */
export const OSM_DIET_TAGS = ['vegetarian', 'vegan', 'halal', 'kosher', 'gluten_free', 'lactose_free'] as const;

/** Lowercase, strip accents, collapse separators to "_". "Açaí" -> "acai", "Tex-Mex" -> "tex_mex". */
export function slug(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** One raw cuisine value -> engine tags (possibly several, possibly none). */
export function normalizeCuisineToken(raw: string): string[] {
  const s = slug(raw);
  if (!s || DROP.has(s)) return [];
  const mapped = SYNONYMS[s];
  if (mapped) return [...mapped];
  // Generic "<x>_restaurant" (e.g. from Google types) -> "<x>"
  const m = /^(.+)_restaurant$/.exec(s);
  if (m) return normalizeCuisineToken(m[1]);
  return /^[a-z][a-z0-9_]*$/.test(s) ? [s] : [];
}

/** An OSM `cuisine=*` value ("sandwich;coffee_shop") -> unique tags, original order first. */
export function normalizeCuisines(raw: string | undefined | null): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(/[;,]/)) {
    for (const t of normalizeCuisineToken(part)) if (!out.includes(t)) out.push(t);
  }
  return out;
}

/**
 * The engine's requested cuisines -> tags to match against places, in vote order.
 * Each requested cuisine keeps its own group so callers can tell which one matched.
 */
export function queryCuisineGroups(cuisines: readonly string[]): { tag: string; matches: string[] }[] {
  const groups: { tag: string; matches: string[] }[] = [];
  for (const c of cuisines) {
    const tags = normalizeCuisineToken(c);
    if (tags.length === 0) continue;
    const tag = tags[0];
    if (groups.some((g) => g.tag === tag)) continue;
    const matches = new Set<string>([tag]);
    for (const t of QUERY_EXPANSION[tag] ?? []) matches.add(t);
    groups.push({ tag, matches: [...matches] });
  }
  return groups;
}

/** Diet word from the engine or OSM -> normalized tag ("gluten-free" -> "gluten_free", "dairy free" -> "lactose_free"). */
export function normalizeDiet(raw: string): string {
  const s = slug(raw);
  switch (s) {
    case 'veggie':
    case 'veg':
      return 'vegetarian';
    case 'gluten_free':
    case 'gf':
    case 'celiac':
    case 'coeliac':
      return 'gluten_free';
    case 'dairy_free':
    case 'lactose_free':
    case 'no_dairy':
      return 'lactose_free';
    case 'pescetarian':
      return 'pescatarian';
    default:
      return s;
  }
}

/** Human label for a diet tag, for "check: nut allergy" notes. */
export function dietLabel(tag: string): string {
  if (tag === 'lactose_free') return 'dairy-free';
  if (tag === 'gluten_free') return 'gluten-free';
  return tag.replace(/_/g, ' ');
}
