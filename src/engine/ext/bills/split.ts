// Turns a parsed bill into a total and per-person cents. Three shapes (equal, custom, itemized) reduce to the
// same thing: an exact pre-extras subtotal per person (a BigInt weight over a common denominator), the extras
// (tax, tip, service, fees) computed on the subtotal, and one largest-remainder allocation of the final total
// in proportion to those subtotals. Pure.

import { allocate, lcm, pctOf } from './money.js';

export type ExtraKind = 'tax' | 'tip' | 'service' | 'fee';

export interface ExtraSpec {
  kind: ExtraKind;
  /** Thousandths of a percent (20% -> 20000), or a fixed amount in cents. */
  pct?: number;
  cents?: number;
  /** Tip only: "tip 20% on total" uses subtotal + tax instead of the pre-tax subtotal. */
  onTotal?: boolean;
  /** Fee label ("delivery"). */
  label?: string;
}

export interface ExtraLine extends ExtraSpec {
  amount: number;
}

export interface Split {
  /** Pre-extras subtotal (the bill as typed, before tax/tip/fees). */
  base: number;
  extras: ExtraLine[];
  total: number;
  /** Display names, in the order they were given. */
  names: string[];
  /** Cents per name, same order; sums to `total` exactly. */
  shares: number[];
}

/** Tax, service and fees on the pre-tax subtotal; tips on the subtotal (or subtotal + tax when "on total"). */
export function computeExtras(subtotal: number, specs: ExtraSpec[]): ExtraLine[] {
  const fixedOrPct = (s: ExtraSpec, base: number) => (s.pct !== undefined ? pctOf(base, s.pct) : s.cents ?? 0);
  const amounts = specs.map((s) => (s.kind === 'tip' ? 0 : fixedOrPct(s, subtotal)));
  const tax = specs.reduce((sum, s, i) => sum + (s.kind === 'tax' ? amounts[i] : 0), 0);
  specs.forEach((s, i) => {
    if (s.kind === 'tip') amounts[i] = fixedOrPct(s, s.onTotal ? subtotal + tax : subtotal);
  });
  return specs.map((s, i) => ({ ...s, amount: amounts[i] }));
}

function finish(base: number, specs: ExtraSpec[], names: string[], weights: bigint[]): Split {
  const extras = computeExtras(base, specs);
  const total = base + extras.reduce((a, e) => a + e.amount, 0);
  return { base, extras, total, names, shares: allocate(total, weights, names) };
}

/** Everyone pays the same, to the cent where possible ($101.95 / 4 -> 25.49, 25.49, 25.49, 25.48). */
export function equalSplit(base: number, specs: ExtraSpec[], names: string[]): Split {
  return finish(base, specs, names, names.map(() => 1n));
}

export interface CustomPart {
  name: string;
  cents?: number;
  pct?: number;
  rest?: boolean;
}

export type CustomResult = { ok: true; split: Split } | { ok: false; error: 'over' | 'under' | 'pctOver' | 'restEmpty'; sum: number };

/**
 * "ana 25, ben 20, jo rest" or "ana 50%, ben 30%, jo rest": fixed parts and percentages of the base; whoever says
 * "rest" shares what is left equally. Extras are then shared in proportion to each part.
 */
export function customSplit(base: number, specs: ExtraSpec[], parts: CustomPart[]): CustomResult {
  const rest = parts.filter((p) => p.rest).length;
  const pctSum = parts.reduce((a, p) => a + (p.pct ?? 0), 0);
  if (pctSum > 100_000) return { ok: false, error: 'pctOver', sum: 0 };
  // Common denominator: 100000 (thousandths of a percent) times the number of "rest" people.
  const D = BigInt(100_000 * Math.max(rest, 1));
  const B = BigInt(base);
  const fixed = parts.map((p) => (p.cents !== undefined ? BigInt(p.cents) * D : p.pct !== undefined ? B * BigInt(p.pct) * BigInt(Math.max(rest, 1)) : 0n));
  const used = fixed.reduce((a, b) => a + b, 0n);
  const sumCents = Number(used / D);
  if (used > B * D) return { ok: false, error: 'over', sum: sumCents };
  const left = B * D - used;
  if (!rest && left !== 0n) return { ok: false, error: 'under', sum: sumCents };
  if (rest && left === 0n) return { ok: false, error: 'restEmpty', sum: sumCents };
  const each = rest ? left / BigInt(rest) : 0n;
  const weights = parts.map((p, i) => (p.rest ? each : fixed[i]));
  const names = parts.map((p) => p.name);
  return { ok: true, split: finish(base, specs, names, weights) };
}

export interface SharedItem {
  cents: number;
  /** Indexes into the people list; undefined = everyone on the bill. */
  by?: number[];
}

/**
 * Itemized: own items plus an equal part of each shared item, as exact fractions over lcm(sharer counts);
 * extras follow each person's subtotal; one largest-remainder rounding of the total.
 */
export function itemizedSplit(names: string[], own: number[], shared: SharedItem[], specs: ExtraSpec[]): Split {
  const n = names.length;
  const groups = shared.map((s) => (s.by && s.by.length ? s.by : [...Array(n).keys()]));
  const D = groups.reduce((d, g) => lcm(d, g.length), 1);
  const BD = BigInt(D);
  const weights = own.map((c) => BigInt(c) * BD);
  shared.forEach((s, j) => {
    const part = BigInt(s.cents) * BigInt(D / groups[j].length);
    for (const i of groups[j]) weights[i] += part;
  });
  const base = own.reduce((a, b) => a + b, 0) + shared.reduce((a, s) => a + s.cents, 0);
  return finish(base, specs, names, weights);
}
