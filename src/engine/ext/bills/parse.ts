// Reads bill commands from the de-addressed body. Text is only read here, never stored: the parse keeps
// amounts, names and a short label, which members explicitly hand Homi for the tab. Pure.
//
//   split 86.40 4 ways · split 86.40 + 18% tip 4 ways · split 120 between ana ben jo, paid by ana
//   split 60 custom: ana 25, ben 20, jo rest · jo paid 23.40 for the uber, split ana jo you
//   itemize dinner, paid by ben: ana ramen 16.50; ...; tax 7%; tip 20%   (see itemize.ts)
//   settle up · who owes who · tab · clear the tab · undo

import type { CustomPart } from './split.js';
import { type BillCmd, ARTICLE, LABEL_RE, NOT_PAYERS, help } from './cmd.js';
import { AMT, PCT, toCents, toPct } from './money.js';
import { NOT_WAYS, parseExtras } from './extras.js';
import { NAME, SELF, isName, nameList } from './names.js';
import { parseItemized } from './itemize.js';
import { EVERYONE, naturalBill, wordNumbers } from './natural.js';

export type { BillCmd, HelpWhy } from './cmd.js';

const SETTLE =
  /^(?:let'?s )?(?:settle(?: up)?|square up|who owes (?:who|whom|what|me|us)(?: what)?|who pays (?:who|whom)|what do (?:we|i) owe|balances?|how much (?:do|does) (?:i|we|everyone|everybody)(?: each| all)? owe(?: anyone| anybody| now| so far)?|what does everyone owe)$/;
const TAB = /^(?:show (?:me )?|what'?s on )?(?:the |our )?(?:bill )?tab$|^(?:show (?:me )?)?(?:the )?bills$/;
const CLEAR = /^(?:clear|delete|reset|wipe|close)(?: out)?(?: the| our)? (?:bill )?(?:tab|bills)$/;
const UNDO = /^undo( that| the last (?:one|expense|bill)| last expense)?$|^remove the last (?:expense|bill)$/;
const ITEMIZE = /^(?:itemi[sz]e[ds]?|split (?:by|per) items?|itemi[sz]ed split)\b/;

/** Lowercase, straight quotes, newlines as ";" separators, single spaces, no trailing ?! or final period. */
export function norm(body: string): string {
  return body
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\r?\n+/g, ' ; ')
    .replace(/&/g, ' and ')
    .replace(/×/g, 'x')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/[\s!?]+$|(?<!\d)\.+$|(?<=\d)\.$/g, '')
    .trim();
}

/** A bills command, a help answer for a malformed one, or null when the body is not about bills. */
export function parseBills(body: string): BillCmd | null {
  const s = norm(body).replace(/^\//, '');
  if (!s) return null;
  if (SETTLE.test(s)) return { kind: 'settle' };
  if (TAB.test(s)) return { kind: 'tab' };
  if (CLEAR.test(s)) return { kind: 'clear' };
  const u = s.match(UNDO);
  if (u) return { kind: 'undo', explicit: Boolean(u[1]) || s.startsWith('remove') };
  if (ITEMIZE.test(s)) return parseItemized(s.replace(ITEMIZE, '').trim());
  // "split 96.50 four ways", "split it in half"; "between us" / "everyone" means the people on the plan.
  const w = wordNumbers(s);
  let everyone = false;
  const e = w.replace(EVERYONE, () => {
    everyone = true;
    return ' ';
  }).replace(/\s+/g, ' ').trim();
  const f1 = e.match(/^(?:let'?s |can you |could you |please |pls )?(?:split|divide|divvy)(?: up)?(?: (?:the|our) (?:bill|check|cheque|cost|total)| it| this| that)?(?![\w'])[\s,:]*(.*)$/);
  if (f1) {
    const c = parseSplit(f1[1]);
    if (c.kind !== 'help') return withEveryone(c, everyone);
    // "split it 4 ways, it was 96.50": the conversational reader puts the amount first.
    const n = natural(w);
    return n && n.kind !== 'help' ? n : c;
  }
  const f2 = e.match(new RegExp(`^(${NAME}) (?:just |already )?(?:paid|covered|picked up) (${AMT})(.*)$`));
  if (f2 && !NOT_PAYERS.has(f2[1])) {
    const base = toCents(f2[2]);
    return base === null ? help('tooBig') : withEveryone(parseSplit(f2[3], f2[1], base), everyone);
  }
  return natural(w);
}

/** "we spent 84 on pizza, split it between ana ben and me", "how much does everyone owe, it was 120 with tip". */
function natural(s: string): BillCmd | null {
  const n = naturalBill(s);
  if (!n) return null;
  const c = parseSplit(n.rest, n.payer);
  // "we each owe ben 20" is talk about money, not a bill with a label: show the split help instead.
  if ((c.kind === 'equal' || c.kind === 'custom') && c.label && NOT_LABEL.test(c.label)) return help('split');
  return withEveryone(c, n.everyone);
}

/** Words that never belong in a bill label (the rest of a sentence leaked in). */
const NOT_LABEL = /\b(?:we|i|me|my|owe[sd]?|owing|each|is|was|were|it|how|much|what|does|do|did|should|have|had|need|want|venmo|pay|paid|spent)\b/;

function withEveryone(c: BillCmd, everyone: boolean): BillCmd {
  return everyone && c.kind === 'equal' && !c.names.length && c.ways === undefined ? { ...c, everyone: true } : c;
}

/** "ana 25, ben 20 and jo rest" / "ana 50%, ben 30%, jo rest" / "25 for ana". Null unless every part reads. */
export function parseParts(s: string): CustomPart[] | null {
  const out: CustomPart[] = [];
  const named = new RegExp(`^(${NAME})\\s*(?::|=|-)?\\s*(?:gets |pays |owes )?(?:(the rest|rest|remainder|the remainder|everything else|whatever'?s left)|(${AMT})|${PCT})$`);
  const amountFirst = new RegExp(`^(?:(${AMT})|${PCT})\\s+(?:for |from )?(${NAME})$`);
  for (const raw of s.split(/[,;]|\band\b/)) {
    const p = raw.trim();
    if (!p) continue;
    const m = p.match(named);
    const r = m ? null : p.match(amountFirst);
    const name = m?.[1] ?? r?.[3];
    if (!name || !isName(name) || out.some((o) => o.name === name)) return null;
    const amt = m?.[3] ?? r?.[1];
    const pct = m?.[4] ?? r?.[2];
    if (m?.[2]) out.push({ name, rest: true });
    else if (amt !== undefined) {
      const c = toCents(amt);
      if (c === null) return null;
      out.push({ name, cents: c });
    } else if (pct !== undefined) {
      const q = toPct(pct);
      if (q === null) return null;
      out.push({ name, pct: q });
    } else return null;
  }
  return out.length ? out : null;
}

const CONNECTOR = /\b(?:between|among|amongst|with|ways?|split|paid)\b/;

function parseSplit(rest: string, payer0?: string, base0?: number): BillCmd {
  let r = ` ${rest} `;
  let payer = payer0;
  const pm = r.match(new RegExp(`\\b(?:paid (?:for )?by|covered by|payer:?)\\s+(${NAME})\\b`));
  if (pm) {
    payer = pm[1];
    r = r.replace(pm[0], ' ; ');
  }
  if (payer && !isName(payer) && !SELF.has(payer)) return help('split');
  const ex = parseExtras(r.trim());
  if (ex.bad) return help('badPct');
  r = ` ${ex.rest} `;

  let partsStr: string | undefined;
  const cm = r.match(/\b(?:custom|uneven(?:ly)?|unequal(?:ly)?|as follows)\b\s*:?(.*)$/);
  if (cm) {
    partsStr = cm[1];
    r = r.slice(0, cm.index);
  } else {
    const colon = r.indexOf(':');
    if (colon >= 0 && (parseParts(r.slice(colon + 1))?.length ?? 0) >= 2) {
      partsStr = r.slice(colon + 1);
      r = r.slice(0, colon);
    }
  }

  let base = base0;
  let label: string | undefined;
  if (base === undefined) {
    const am = new RegExp(`${AMT}${NOT_WAYS}`).exec(r);
    if (!am) return help('split');
    const c = toCents(am[0]);
    if (c === null) return help('tooBig');
    base = c;
    const before = r.slice(0, am.index).replace(/[,;:]/g, ' ').trim();
    r = ` ${r.slice(am.index + am[0].length)} `;
    // "split the 84 three ways": a lone article is not a label.
    const l = before.replace(/^for /, '').replace(/^(?:the|our|a|an|my)(?:\s+|$)/, '').trim();
    if (l) {
      if (!LABEL_RE.test(l) || CONNECTOR.test(l)) return help('split');
      label = l;
    }
  }
  if (base <= 0) return help('split');

  let ways: number | undefined;
  const wm = r.match(/\b(\d{1,2})\s*(?:ways?|people|ppl|persons|of us|guys|friends)\b/) ?? r.match(/(?:\/|\bby\b|\bbetween\b|\bamong\b|\bacross\b|\bfor\b|\binto\b|\bin\b|\bx\b)\s*(\d{1,2})\b(?![.,]\d)/);
  if (wm) {
    ways = Number(wm[1]);
    r = r.replace(wm[0], ' ; ');
  }

  let forWords: string | undefined;
  let forFollowed = false;
  const fm = r.match(/\bfor\s+((?:the |our |a |an |my )?[a-z][a-z' \-]*?)\s*(?=[,;]|\b(?:between|among|amongst|with|split|paid)\b|$)/);
  if (fm && fm.index !== undefined) {
    forWords = fm[1].trim();
    forFollowed = /^\s*(?:[,;]\s*\S|(?:between|among|amongst|with|split|paid)\b)/.test(r.slice(fm.index + fm[0].length));
    r = `${r.slice(0, fm.index)} ; ${r.slice(fm.index + fm[0].length)}`;
  }

  // A bare small number left over is the number of ways ("split 142.50 5").
  const bare = r.match(/(?:^|[\s;,])(\d{1,2})(?=[\s;,]|$)/);
  if (bare && ways === undefined) {
    ways = Number(bare[1]);
    r = r.replace(bare[0], ' ; ');
  }
  let names = nameList(r);
  if (names === null) return help('split');
  if (forWords !== undefined) {
    const asNames = !ARTICLE.test(`${forWords} `) && !forFollowed && !names.length && ways === undefined ? nameList(forWords) : null;
    if (asNames && asNames.length >= 2) names = asNames;
    else {
      const l = forWords.replace(ARTICLE, '').trim();
      if (!LABEL_RE.test(l)) return help('split');
      label = label ?? l;
    }
  }

  if (partsStr !== undefined) {
    const parts = parseParts(partsStr);
    if (!parts) return help('custom');
    return { kind: 'custom', base, extras: ex.extras, parts, payer, label };
  }
  if (names.length === 1) return help('oneName');
  if (names.length >= 2) {
    if (ways !== undefined && ways !== names.length) return help('mismatch', { ways, names: names.length });
    ways = names.length;
  }
  if (ways !== undefined && (ways < 1 || ways > 50)) return help('split');
  return { kind: 'equal', base, extras: ex.extras, ways, names, payer, label };
}
