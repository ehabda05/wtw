// Parses tax, tip, service charge and fees out of a bill command: "+ 18% tip", "tip 20% on total", "tax 7%",
// "service 18%", "+ 3.50 delivery fee", "fee 3.50 delivery", "tax 7.81". Matches are cut out of the text so
// the rest can be read as names and ways. Pure.

import type { ExtraKind, ExtraSpec } from './split.js';
import { AMT, PCT, toCents, toPct } from './money.js';

const KW = String.raw`sales tax|tax|vat|gst|hst|tips?|gratuity|grat|service charge|service fee|service|svc|delivery fee|delivery|booking fee|card fee|fees?|surcharge`;
const LEAD = String.raw`(?:^|\s*(?:\+|\bplus\b|\band\b|\bwith\b|,)?\s*)`;
const ON_TOTAL = String.raw`(\s+(?:on (?:the )?total|on top of tax|after tax|incl(?:uding|\.)? tax|on the full bill))?`;
/** Fee labels allowed after an inline fixed fee ("fee 3.50 delivery"); a whole itemized segment may use any words. */
const FEE_WORDS = String.raw`delivery|booking|card|cleaning|corkage|cake|parking|convenience|processing|app|platform|bag|bottle|cover|entry|venue`;
/** "3 ways" is a head count, never an amount. */
export const NOT_WAYS = String.raw`(?!\s*(?:ways?|people|ppl|persons|of us)\b)`;

function kindOf(kw: string): { kind: ExtraKind; label?: string } {
  if (/tax|vat|gst|hst/.test(kw)) return { kind: 'tax' };
  if (/tip|grat/.test(kw)) return { kind: 'tip' };
  if (/service|svc/.test(kw)) return { kind: 'service' };
  const label = kw.match(/^(delivery|booking|card)/)?.[1];
  return label ? { kind: 'fee', label } : { kind: 'fee' };
}

export interface ExtrasParse {
  extras: ExtraSpec[];
  /** The text with every matched extra replaced by " ; ". */
  rest: string;
  /** A keyword appeared without a usable amount ("tip 140%"). */
  bad: boolean;
}

/** Lowercase input. `segment`: the whole text is one itemized segment ("fee 3.50 delivery charge"). */
export function parseExtras(text: string, segment = false): ExtrasParse {
  const found: Array<{ at: number; spec: ExtraSpec }> = [];
  let bad = false;
  let t = ` ${text} `;
  const cut = (re: RegExp, make: (m: RegExpExecArray) => ExtraSpec | null) => {
    t = t.replace(re, (...args) => {
      const m = args.slice(0, -2) as unknown as RegExpExecArray;
      const at = args[args.length - 2] as number;
      const spec = make(m);
      if (!spec) {
        bad = true;
        return m[0];
      }
      found.push({ at, spec });
      return ' ; ';
    });
  };
  const pctSpec = (kw: string, pct: string, onTotal?: string): ExtraSpec | null => {
    const p = toPct(pct);
    if (p === null) return null;
    const k = kindOf(kw);
    return { ...k, pct: p, ...(k.kind === 'tip' && onTotal ? { onTotal: true } : {}) };
  };
  const centsSpec = (kw: string, amt: string, label?: string): ExtraSpec | null => {
    const c = toCents(amt);
    if (c === null) return null;
    const k = kindOf(kw);
    const l = k.kind === 'fee' ? (label?.trim() || k.label) : undefined;
    return l ? { ...k, cents: c, label: l } : { kind: k.kind, cents: c };
  };
  // "18% tip", "+ 7% tax", "20% tip on total"
  cut(new RegExp(`${LEAD}${PCT}\\s*(?:of\\s+)?(${KW})\\b${ON_TOTAL}`, 'g'), (m) => pctSpec(m[2], m[1], m[3]));
  // "tip 20%", "tax: 7.25%", "tip of 18% on total"
  cut(new RegExp(`${LEAD}\\b(${KW})\\s*(?:of\\s+|at\\s+|:\\s*|=\\s*)?${PCT}${ON_TOTAL}`, 'g'), (m) => pctSpec(m[1], m[2], m[3]));
  // "fee 3.50 delivery", "tip 22", "tax 7.81", "delivery fee $3.50"
  const tail = segment ? String.raw`(?:\s+([a-z][a-z ]{0,30}))?` : String.raw`(?:\s+(${FEE_WORDS})\b)?`;
  cut(new RegExp(`${LEAD}\\b(${KW})\\s*(?:of\\s+|:\\s*|=\\s*)?(${AMT})${NOT_WAYS}${tail}`, 'g'), (m) => centsSpec(m[1], m[2], m[3]));
  // "+ 3.50 delivery fee", "+ 15 tip"
  cut(new RegExp(`${LEAD}(${AMT})\\s+(?:(${FEE_WORDS})\\s+)?(${KW})\\b`, 'g'), (m) => centsSpec(m[3], m[1], m[2]));
  found.sort((a, b) => a.at - b.at);
  return { extras: found.map((f) => f.spec), rest: t.replace(/\s+/g, ' ').trim(), bad };
}
