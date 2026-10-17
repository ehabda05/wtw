// Money math for bills. Integer cents everywhere; percentages are integer thousandths of a percent (7.25% -> 7250).
// Fair shares are exact rationals (BigInt numerators over a common denominator), rounded once at the end with
// the largest-remainder method so the shares always add up to the bill total. Pure.

/** Bills above this are refused (keeps every intermediate product far inside exact integer range). */
export const MAX_CENTS = 10_000_000; // $100,000

/** A dollar amount as typed: "16.50", "$1,234.5", "8", "142,50" (comma decimal). Never part of a longer number. */
export const AMT = String.raw`(?<![\w.,$])\$?(?:\d{1,3}(?:,\d{3})+|\d+)(?:[.,]\d{1,2})?(?![\d%]|[.,]\d|\s*(?:%|percent\b|pct\b))`;
/** A percentage as typed: "7%", "7.25 %", "18 percent". Group 1 is the number. */
export const PCT = String.raw`(?<![\w.,$])(\d{1,3}(?:\.\d{1,3})?)\s*(?:%|percent\b|pct\b)`;

/** "$1,234.56" -> 123456; null for anything else (or above MAX_CENTS). */
export function toCents(s: string): number | null {
  const m = s.trim().match(/^\$?((?:\d{1,3}(?:,\d{3})+)|\d+)(?:[.,](\d{1,2}))?$/);
  if (!m) return null;
  const whole = Number(m[1].replace(/,/g, ''));
  const frac = m[2] ? Number(m[2].padEnd(2, '0')) : 0;
  const cents = whole * 100 + frac;
  return Number.isSafeInteger(cents) && cents <= MAX_CENTS ? cents : null;
}

/** "7.25" -> 7250 (thousandths of a percent); null above 100%. */
export function toPct(s: string): number | null {
  const m = s.trim().match(/^(\d{1,3})(?:\.(\d{1,3}))?$/);
  if (!m) return null;
  const p = Number(m[1]) * 1000 + (m[2] ? Number(m[2].padEnd(3, '0')) : 0);
  return p <= 100_000 ? p : null;
}

/** 7250 -> "7.25%". */
export function fmtPct(p: number): string {
  const whole = Math.floor(p / 1000);
  const frac = String(p % 1000).padStart(3, '0').replace(/0+$/, '');
  return `${whole}${frac ? `.${frac}` : ''}%`;
}

/** Exact floor division for non-negative safe integers. */
function floorDiv(n: number, d: number): number {
  return (n - (n % d)) / d;
}

/** pct (thousandths of a percent) of base cents, rounded half-up to the cent: 7% of $111.50 = $7.805 -> $7.81. */
export function pctOf(baseCents: number, pct: number): number {
  return floorDiv(baseCents * pct + 50_000, 100_000);
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

export function lcm(a: number, b: number): number {
  return (a / gcd(a, b)) * b;
}

/**
 * Splits `total` cents in proportion to `weights` (exact, non-negative), rounding with the largest remainder:
 * everyone gets the floor of their exact share, then the leftover cents go one each to the largest remainders.
 * Ties go to the larger weight (the larger subtotal), then to the name that sorts first. All-zero weights
 * split evenly. The result always sums to `total` exactly.
 */
export function allocate(total: number, weights: bigint[], names: string[]): number[] {
  const n = weights.length;
  if (!n) return [];
  const w = weights.some((x) => x > 0n) ? weights : weights.map(() => 1n);
  const W = w.reduce((a, b) => a + b, 0n);
  const T = BigInt(total);
  const base = w.map((x) => (T * x) / W);
  const rem = w.map((x) => (T * x) % W);
  let left = total - Number(base.reduce((a, b) => a + b, 0n));
  const order = [...Array(n).keys()].sort((a, b) => {
    if (rem[a] !== rem[b]) return rem[a] > rem[b] ? -1 : 1;
    if (w[a] !== w[b]) return w[a] > w[b] ? -1 : 1;
    const na = (names[a] ?? '').toLowerCase();
    const nb = (names[b] ?? '').toLowerCase();
    return na < nb ? -1 : na > nb ? 1 : a - b;
  });
  const out = base.map(Number);
  for (const i of order) {
    if (left <= 0) break;
    out[i] += 1;
    left -= 1;
  }
  return out;
}
