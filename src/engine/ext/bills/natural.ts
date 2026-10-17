// Conversational bill phrasings, rewritten into the split grammar parse.ts already reads (docs/BILLS.md):
//
//   we spent 84 on pizza, split it between ana ben and me   -> "84 for pizza ; between ana ben and me"
//   how much does everyone owe for dinner, it was 120 with tip -> "for dinner, 120" + everyone
//   it was 96.50, split it four ways · ben paid for dinner, it came to 84, split it 3 ways
//
// Pure; text is only read here, never stored. Word numbers ("four ways", "in half") are handled by wordNumbers().

import { NAME, isName } from './names.js';
import { AMT } from './money.js';
import { NOT_PAYERS } from './cmd.js';

const NUMS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

/** "four ways" -> "4 ways", "in half" -> "2 ways", "the five of us" -> "the 5 of us". */
export function wordNumbers(s: string): string {
  return s
    .replace(/\b(?:in half|in two|down the middle|50 ?\/ ?50|fifty[- ]fifty)\b/g, '2 ways')
    .replace(/\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/g, (w) => String(NUMS[w]));
}

/** Dividing words. Without one, "we paid 40 for gas" stays a non-bill. */
const STRONG = /\b(?:split|divide|divvy|owe[sd]?|owing|venmo)\b/;
const WEAK = /\b(?:each|apiece|per (?:person|head)|\d{1,2} ways|evenly|equally|chip in)\b/;
const MONEY_CTX = /\b(?:spent|paid|cost|costs|came to|comes to|bill|check|tab|total)\b|\$\d/;

const OWE_Q = new RegExp(
  String.raw`\b(?:how much|what) (?:does|do|should|will|would|did) (?:everyone|everybody|each (?:person|of us)|we(?: each| all)?|each|people|y'?all|i) (?:owe|pay|chip in|put in|send|venmo)(?: (${NAME}))?(?: each)?\b` +
    String.raw`|\bhow much (?:is (?:it|that) )?(?:each|per person|a head|apiece)\b|\bwhat'?s everyone'?s (?:share|part|cut)\b`,
);
const SUBJECT = new RegExp(String.raw`^(?:(${NAME}) )?(?:just |already |had )?(?:spent|paid|dropped|put down|fronted|covered)(?: for)?\b`);
const MID_PAYER = new RegExp(String.raw`(?:^|[,;]\s*|\band\s+)(${NAME}) (?:paid|covered(?: it)?|got (?:it|the (?:bill|check|tab)))(?=\s*(?:[,;]|$))`);
const INCLUDED =
  /\b(?:with|including|incl\.?|after|w\/|plus|and)\s+(?:the\s+)?(?:tax\s+and\s+)?tips?(?:\s+and\s+tax)?(?:\s+included)?\b(?!\s*(?:of\s+)?\$?\d)|\b(?:tax\s+and\s+)?tips?\s+(?:included|incl\.?)\b|\b(?:all in|in total|total)\s*$/g;
const AMOUNT_LEAD = new RegExp(
  String.raw`\b(?:(?:it|that|this|which|the (?:bill|check|total|tab|damage)|the whole thing|total|bill|check)\s+)?(?:was|were|is|came (?:out )?to|comes (?:out )?to|cost(?:s|ed)?(?: us| me)?|totaled|totalled|ran(?: us)?)(?:\s+like|\s+about)?(?=\s*\$?\d)|\b(?:it'?s|that'?s)(?=\s*\$?\d)`,
  'g',
);
const SPLIT_VERB = /\b(?:can you |could you |pls |please |just |let'?s )?(?:split|divide|divvy)(?: it| this| that| (?:the|our) (?:bill|check|cost|total|tab)| everything)?(?: up)?\b/g;
const CHATTER = /\b(?:homi|lol|lmao|haha|tbh|honestly|ngl|thanks|thx|ty|pls|please|plz|so|ok|okay|guys|hey|real quick|quick|can you|could you)\b/g;
const WAYS = /\b(?:the )?(\d{1,2})\s*(?:ways?|people|ppl|persons|of us|guys|friends)\b/;
/** "between us", "everyone", "the group": the people on the plan ("the 5 of us" is a head count instead). */
export const EVERYONE = /\b(?:all of us|us all|the (?:group|table|crew|whole group)|everyone|everybody|y'?all)\b|(?<!\bof )\bus\b/g;
const NAMES_SEG = /\b(?:between|among|amongst|with)\s+[^,;.]+/;

export interface Natural {
  /** Text for parseSplit (amount, "for <label>", ways and names). */
  rest: string;
  payer?: string;
  /** "everyone" / "us" / an owe question with no names or count: the people on the plan. */
  everyone: boolean;
}

/** Rewrites a conversational bill message, or null when it is not one (no amount, or nothing about dividing it). */
export function naturalBill(s: string): Natural | null {
  if (!new RegExp(AMT).test(s)) return null;
  if (!STRONG.test(s) && !(WEAK.test(s) && MONEY_CTX.test(s))) return null;
  let everyone = false;
  let payer: string | undefined;
  const asPayer = (n: string | undefined) => {
    if (n && !payer && (n === 'i' || (isName(n) && !NOT_PAYERS.has(n) && !['on', 'me', 'at'].includes(n)))) payer = n;
  };
  let r = ` ${s.replace(CHATTER, ' ').replace(/\s+/g, ' ').trim()} `;
  r = r.replace(OWE_Q, (_m, who: string | undefined) => {
    everyone = true;
    asPayer(who);
    return ' ; ';
  });
  r = r.replace(INCLUDED, ' ');
  const sub = r.trim().match(SUBJECT);
  if (sub) {
    asPayer(sub[1] ?? 'i');
    r = ` ${r.trim().slice(sub[0].length)} `;
  }
  const mid = r.match(MID_PAYER);
  if (mid) {
    asPayer(mid[1]);
    r = r.replace(mid[0], ' ; ');
  }
  r = r.replace(AMOUNT_LEAD, ' ').replace(/(\d)\s+(?:on|at)\s+/g, '$1 for ').replace(SPLIT_VERB, ' ; ');
  r = r.replace(EVERYONE, () => {
    everyone = true;
    return ' ';
  });
  // Head count and names go last, so the amount and its label read first ("split it 4 ways, it was 96.50").
  let tail = '';
  const w = r.match(WAYS);
  if (w) {
    r = r.replace(w[0], ' ; ');
    tail += ` ; ${w[1]} ways`;
  }
  const n = r.match(NAMES_SEG);
  if (n) {
    r = r.replace(n[0], ' ; ');
    // "i spent 40 on gas, split it with ana": "with" includes whoever paid (else the sender).
    const self = /^with\b/.test(n[0]) ? ` ${payer && payer !== 'i' ? payer : 'me'}` : '';
    tail += ` ; ${n[0]}${self}`;
  }
  const rest = `${r}${tail}`.replace(/\s+/g, ' ').replace(/^[\s,;]+/, '').trim();
  return { rest, payer, everyone };
}
