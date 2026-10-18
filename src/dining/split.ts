// The one deterministic tool behind "split the bill": the model reads the receipt and decides who had what, this
// does the arithmetic so every share is exact and the shares always add up to the total. Reuses the engine's
// integer-cent math (largest-remainder rounding, extras in proportion to each person's subtotal).

import { equalSplit, itemizedSplit, type ExtraSpec, type SharedItem } from '../engine/ext/bills/split.js';

export interface SplitItem {
  name: string;
  /** Price of the line as printed (already multiplied by quantity if the receipt shows a line total). */
  price: number;
  /** Who had it. Empty or omitted = shared by everyone on the bill. */
  shared_by?: string[];
}

export interface SplitExtra {
  percent?: number;
  amount?: number;
}

export interface SplitInput {
  people: string[];
  items?: SplitItem[];
  /** Equal split of a plain total when there are no items. */
  total?: number;
  tax?: SplitExtra;
  tip?: SplitExtra;
  service?: SplitExtra;
  fee?: SplitExtra;
  paid_by?: string;
}

export interface SplitResult {
  subtotal: string;
  extras: { kind: string; amount: string }[];
  total: string;
  shares: Record<string, string>;
  /** "X pays Y $12.34" lines when paid_by is known. */
  transfers: string[];
  warnings: string[];
}

const cents = (n: number) => Math.round(n * 100);
const money = (c: number) => `$${(c / 100).toFixed(2)}`;

function extra(kind: ExtraSpec['kind'], e: SplitExtra | undefined): ExtraSpec | undefined {
  if (!e) return undefined;
  if (typeof e.percent === 'number' && e.percent > 0) return { kind, pct: Math.round(e.percent * 1000) };
  if (typeof e.amount === 'number' && e.amount > 0) return { kind, cents: cents(e.amount) };
  return undefined;
}

export function splitBill(input: SplitInput): SplitResult {
  const warnings: string[] = [];
  const people = [...new Set((input.people ?? []).map((p) => p.trim()).filter(Boolean))];
  if (!people.length) throw new Error('people is required');
  const lower = people.map((p) => p.toLowerCase());
  const indexOf = (name: string) => {
    const i = lower.indexOf(name.trim().toLowerCase());
    if (i < 0) warnings.push(`"${name}" is not on the bill; treated as shared by everyone`);
    return i;
  };
  const specs = [extra('tax', input.tax), extra('tip', input.tip), extra('service', input.service), extra('fee', input.fee)].filter((s): s is ExtraSpec => !!s);

  let split;
  if (input.items?.length) {
    const own = people.map(() => 0);
    const shared: SharedItem[] = [];
    for (const it of input.items) {
      const c = cents(it.price);
      if (!(c >= 0)) continue;
      const by = (it.shared_by ?? []).map(indexOf).filter((i) => i >= 0);
      if (by.length === 1) own[by[0]] += c;
      else shared.push({ cents: c, by: by.length ? by : undefined });
    }
    split = itemizedSplit(people, own, shared, specs);
  } else {
    if (typeof input.total !== 'number') throw new Error('either items or total is required');
    split = equalSplit(cents(input.total), specs, people);
  }

  const shares: Record<string, string> = {};
  split.names.forEach((n, i) => (shares[n] = money(split.shares[i])));
  const transfers: string[] = [];
  if (input.paid_by) {
    const payer = people.find((p) => p.toLowerCase() === input.paid_by!.trim().toLowerCase());
    if (!payer) warnings.push(`payer "${input.paid_by}" is not on the bill`);
    else split.names.forEach((n, i) => n !== payer && split.shares[i] > 0 && transfers.push(`${n} pays ${payer} ${money(split.shares[i])}`));
  }
  return {
    subtotal: money(split.base),
    extras: split.extras.map((e) => ({ kind: e.kind, amount: money(e.amount) })),
    total: money(split.total),
    shares,
    transfers,
    warnings,
  };
}
