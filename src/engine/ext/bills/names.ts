// Names on a bill are free-text labels as typed ("you" is just a name). Matching is case-insensitive and the
// display form is capitalized. "me" / "I" mean the sender, resolved by the extension from the name the group
// already gave Homi. Pure.

/** One word: letters, apostrophes, hyphens. */
export const NAME = String.raw`[a-z][a-z'\-]{0,19}`;
const NAME_RE = new RegExp(`^${NAME}$`);

export const SELF = new Set(['me', 'i', 'myself']);

/** Words that can sit in a names list without being names ("split 120 between ana, ben and jo evenly"). */
const FILLER = new Set([
  'and', 'the', 'bill', 'check', 'cheque', 'tab', 'it', 'this', 'that', 'evenly', 'equally', 'even', 'ways', 'way',
  'people', 'ppl', 'persons', 'of', 'us', 'between', 'among', 'amongst', 'with', 'split', 'each', 'by', 'across',
  'all', 'everyone', 'everybody', 'please', 'pls', 'plz', 'ok', 'okay', 'guys', 'folks', 'to', 'in', 'up', 'just', 'for',
]);

/** Words that would make a bad name (keywords Homi uses for bills). */
const RESERVED = new Set(['tax', 'tip', 'tips', 'service', 'fee', 'fees', 'shared', 'share', 'rest', 'paid', 'total', 'custom']);

export function isName(w: string): boolean {
  return NAME_RE.test(w) && !FILLER.has(w) && !RESERVED.has(w);
}

/** "ana" -> "Ana", "mary-jane" -> "Mary-Jane", "YOU" -> "You". */
export function display(w: string): string {
  return w
    .toLowerCase()
    .split('-')
    .map((p) => (p ? p[0].toUpperCase() + p.slice(1) : p))
    .join('-');
}

/**
 * The names in a free-text list ("ana, ben and jo", "ana jo you"), lowercased, deduplicated, in order.
 * Returns null when a word is neither a name nor filler (a stray number, an unknown keyword).
 */
export function nameList(text: string): string[] | null {
  const out: string[] = [];
  for (const raw of text.toLowerCase().replace(/[,;:+&/]/g, ' ').split(/\s+/)) {
    const w = raw.replace(/^['"(]+|['")!?.]+$/g, '');
    if (!w || FILLER.has(w)) continue;
    if (!NAME_RE.test(w) || RESERVED.has(w)) return null;
    if (!out.includes(w)) out.push(w);
  }
  return out;
}

/** Display text for a list: "Ana, Jo and You". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
