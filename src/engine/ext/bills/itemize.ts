// "itemize dinner, paid by ben: ana shio ramen 16.50; ben spicy miso ramen 17.50 + gyoza 8; shared edamame 6
// + karaage 10; tax 7%; tip 20%". Segments are separated by ";" (or new lines). Each is a person and their
// items, a shared line ("shared ...", optionally "shared by ana ben: ..." or "... by ana ben"), an extra
// (tax, tip, service, fee) or "paid by X". Item names are read for the price only and never kept. Pure.

import type { ExtraSpec } from './split.js';
import { type BillCmd, ARTICLE, LABEL_RE, NOT_PAYERS, help } from './cmd.js';
import { AMT, MAX_CENTS, toCents } from './money.js';
import { parseExtras } from './extras.js';
import { NAME, SELF, isName, nameList } from './names.js';

const EXTRA_START = /^\+?\s*(?:\$?\d|(?:sales tax|tax|vat|gst|hst|tips?|gratuity|grat|service|svc|delivery|booking|card fee|fees?|surcharge)\b)/;
const SHARED_START = /^(?:shared|share|for the table|table|split)\b\s*:?\s*/;
const BY = /^(?:by|between|among|with)\s+/;

/** One item's cents: the last amount in it, times "x2" if given. Null when it has no price. */
function itemCents(item: string): number | null {
  const q = item.match(/\s(?:x\s*(\d{1,2})|(\d{1,2})\s*x)$/);
  const qty = q ? Number(q[1] ?? q[2]) : 1;
  const text = q ? item.slice(0, q.index) : item;
  const amts = [...text.matchAll(new RegExp(AMT, 'g'))];
  if (!amts.length) return null;
  const c = toCents(amts[amts.length - 1][0]);
  return c === null ? null : c * qty;
}

/** "spicy miso ramen 17.50 + gyoza 8" -> 2550. Null when an item has no price. */
export function itemsTotal(s: string): number | null {
  let sum = 0;
  let any = false;
  for (const raw of s.split(/\s*(?:\+|,|\bplus\b)\s*/)) {
    const item = raw.trim();
    if (!item) continue;
    const c = itemCents(item);
    if (c === null) return null;
    sum += c;
    any = true;
  }
  return any && sum <= MAX_CENTS ? sum : null;
}

function headerOf(header: string): { payer?: string; label?: string } | null {
  let h = ` ${header} `;
  let payer: string | undefined;
  const pm = h.match(new RegExp(`\\b(?:paid (?:for )?by|covered by)\\s+(${NAME})\\b`));
  if (pm) {
    payer = pm[1];
    h = h.replace(pm[0], ' ');
  }
  const pm2 = h.match(new RegExp(`^\\s*(${NAME}) (?:paid|covered)(?: for)?\\b`));
  if (!payer && pm2 && !NOT_PAYERS.has(pm2[1])) {
    payer = pm2[1];
    h = h.slice(pm2[0].length);
  }
  const label = h.replace(/[,;]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^for /, '').replace(ARTICLE, '').trim();
  if (label && !LABEL_RE.test(label)) return null;
  return { payer, label: label || undefined };
}

/** Body after the "itemize" keyword. */
export function parseItemized(s: string): BillCmd {
  const colon = s.indexOf(':');
  const head = headerOf(colon >= 0 ? s.slice(0, colon) : '');
  if (!head) return help('itemize');
  let payer = head.payer;
  const body = colon >= 0 ? s.slice(colon + 1) : s;
  const people: Array<{ name: string; cents: number }> = [];
  const sharedRaw: string[] = [];
  const extras: ExtraSpec[] = [];
  for (const raw of body.split(';')) {
    const seg = raw.replace(/^[\s,]+|[\s,]+$/g, '');
    if (!seg) continue;
    const pb = seg.match(new RegExp(`^(?:paid (?:for )?by|covered by)\\s+(${NAME})$`));
    if (pb) {
      payer = pb[1];
      continue;
    }
    if (SHARED_START.test(seg)) {
      sharedRaw.push(seg.replace(SHARED_START, ''));
      continue;
    }
    if (EXTRA_START.test(seg)) {
      const ex = parseExtras(seg, true);
      if (ex.bad || !ex.extras.length || ex.rest.replace(/[;,+\s]/g, '') !== '') return help('itemize');
      extras.push(...ex.extras);
      continue;
    }
    const m = seg.match(new RegExp(`^(${NAME})\\s*:?\\s*(.*)$`));
    if (!m || (!isName(m[1]) && !SELF.has(m[1]))) return help('itemize');
    const cents = itemsTotal(m[2]);
    if (cents === null) return help('noPrice', { detail: m[1] });
    const p = people.find((x) => x.name === m[1]);
    if (p) p.cents += cents;
    else people.push({ name: m[1], cents });
  }

  const known = people.map((p) => p.name);
  const shared: Array<{ cents: number; by?: string[] }> = [];
  for (const seg of sharedRaw) {
    let t = seg;
    let by: string[] | null | undefined;
    const lead = t.match(/^(?:by|between|among|with)\s+([^:]+):\s*(.*)$/);
    const tail = t.match(/^(.*\d.*?)\s+(?:by|between|among|with)\s+([a-z' ,\-]+)$/);
    if (lead) {
      by = nameList(lead[1]);
      t = lead[2];
    } else if (BY.test(t)) {
      // "shared by ana and ben nachos 12": names run while they match people on this bill.
      const words = t.replace(BY, '').split(/\s+/);
      const names: string[] = [];
      let i = 0;
      for (; i < words.length; i++) {
        const w = words[i].replace(/,$/, '');
        if (w === 'and') continue;
        if (!known.includes(w)) break;
        if (!names.includes(w)) names.push(w);
      }
      by = names;
      t = words.slice(i).join(' ');
    } else if (tail) {
      by = nameList(tail[2]);
      t = tail[1];
    }
    if (by === null || (by && by.length === 0)) return help('itemize');
    const cents = itemsTotal(t);
    if (cents === null) return help('noPrice');
    shared.push(by ? { cents, by } : { cents });
  }
  if (!people.length && !shared.some((x) => x.by)) return help('itemize');
  return { kind: 'itemized', label: head.label, payer, people, shared, extras };
}
