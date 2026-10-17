// Bills money math: cents parsing, half-up percentages, largest-remainder allocation, the three split shapes,
// and settle-up. DEMO.md Act 3 numbers are golden; a seeded property test checks thousands of random bills.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocate, fmtPct, pctOf, toCents, toPct } from '../../src/engine/ext/bills/money.js';
import { computeExtras, customSplit, equalSplit, itemizedSplit, type ExtraSpec } from '../../src/engine/ext/bills/split.js';
import { type BillTab, balances, settle, tabTotal } from '../../src/engine/ext/bills/ledger.js';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

test('toCents / toPct / fmtPct / pctOf (half-up to the cent)', () => {
  assert.equal(toCents('16.50'), 1650);
  assert.equal(toCents('16.5'), 1650);
  assert.equal(toCents('$1,234.56'), 123456);
  assert.equal(toCents('142,50'), 14250);
  assert.equal(toCents('8'), 800);
  assert.equal(toCents('100001'), null); // over $100,000
  assert.equal(toPct('7'), 7000);
  assert.equal(toPct('8.875'), 8875);
  assert.equal(toPct('101'), null);
  assert.equal(fmtPct(18000), '18%');
  assert.equal(fmtPct(7250), '7.25%');
  assert.equal(pctOf(11150, 7000), 781); // $7.805 rounds half-up
  assert.equal(pctOf(11150, 20000), 2230);
  assert.equal(pctOf(8640, 18000), 1555); // $15.552
  assert.equal(pctOf(1, 50000), 1); // half a cent rounds up
  assert.equal(pctOf(1, 49999), 0);
});

test('allocate: largest remainder, ties by larger weight then name', () => {
  assert.deepEqual(allocate(10195, [1n, 1n, 1n, 1n], ['', '', '', '']), [2549, 2549, 2549, 2548]);
  assert.deepEqual(allocate(10000, [1n, 1n, 1n], ['Jo', 'Ana', 'Ben']), [3333, 3334, 3333]); // name order wins the tie
  assert.deepEqual(allocate(101, [2n, 1n, 1n], ['Zed', 'Ana', 'Ben']), [51, 25, 25]); // largest remainder beats name order
  assert.deepEqual(allocate(3, [1n, 2n], ['Ana', 'Ben']), [1, 2]);
  assert.deepEqual(allocate(5, [0n, 0n], ['Ana', 'Ben']), [3, 2]); // all-zero weights split evenly
  assert.deepEqual(allocate(0, [1n, 1n], ['Ana', 'Ben']), [0, 0]);
});

test('DEMO step 11 golden numbers: itemized dinner, tax 7% + tip 20% on the pre-tax subtotal', () => {
  const names = ['Ana', 'Ben', 'Jo', 'Maya', 'You'];
  const own = [1650, 1750 + 800, 2100, 1600, 1650];
  const s = itemizedSplit(names, own, [{ cents: 600 }, { cents: 1000 }], [{ kind: 'tax', pct: 7000 }, { kind: 'tip', pct: 20000 }]);
  assert.equal(s.base, 11150);
  assert.deepEqual(s.extras.map((e) => e.amount), [781, 2230]);
  assert.equal(s.total, 14161);
  assert.deepEqual(s.shares, [2502, 3645, 3074, 2438, 2502]);
  assert.equal(sum(s.shares), 14161);
  // Share of tax + tip column: 5.32, 7.75, 6.54, 5.18, 5.32 (own + 3.20 shared each).
  assert.deepEqual(s.shares.map((c, i) => c - own[i] - 320), [532, 775, 654, 518, 532]);
});

test('DEMO step 12 + 13: uber 7.80 x3, then settle-up is 4 transfers to Ben', () => {
  const uber = equalSplit(2340, [], ['Ana', 'Jo', 'You']);
  assert.deepEqual(uber.shares, [780, 780, 780]);
  const dinner = { Ana: 2502, Ben: 3645, Jo: 3074, Maya: 2438, You: 2502 };
  const tab: BillTab = {
    expenses: [
      { kind: 'itemized', label: 'Dinner', payer: 'Ben', total: 14161, shares: Object.entries(dinner).map(([name, cents]) => ({ name, cents })), createdAt: 0 },
      { kind: 'equal', label: 'Uber', payer: 'Jo', total: 2340, shares: uber.names.map((name, i) => ({ name, cents: uber.shares[i] })), createdAt: 1 },
    ],
  };
  assert.equal(tabTotal(tab), 16501);
  assert.deepEqual(settle(tab), [
    { from: 'Ana', to: 'Ben', cents: 3282 },
    { from: 'You', to: 'Ben', cents: 3282 },
    { from: 'Maya', to: 'Ben', cents: 2438 },
    { from: 'Jo', to: 'Ben', cents: 1514 },
  ]);
  assert.equal(balances(tab).find((b) => b.name === 'Ben')?.net, 10516);
});

test('equal split with tip: $86.40 + 18% tip / 4 = 25.49 x3 + 25.48', () => {
  const s = equalSplit(8640, [{ kind: 'tip', pct: 18000 }], ['', '', '', '']);
  assert.equal(s.total, 10195);
  assert.deepEqual(s.shares, [2549, 2549, 2549, 2548]);
});

test('custom: fixed amounts with "rest", percentages, and extras shared by part', () => {
  const a = customSplit(6000, [], [{ name: 'Ana', cents: 2500 }, { name: 'Ben', cents: 2000 }, { name: 'Jo', rest: true }]);
  assert.ok(a.ok);
  assert.deepEqual(a.ok && a.split.shares, [2500, 2000, 1500]);
  const b = customSplit(10000, [], [{ name: 'Ana', pct: 50000 }, { name: 'Ben', pct: 30000 }, { name: 'Jo', rest: true }]);
  assert.deepEqual(b.ok && b.split.shares, [5000, 3000, 2000]);
  const c = customSplit(6000, [{ kind: 'tip', pct: 20000 }], [{ name: 'Ana', cents: 2500 }, { name: 'Ben', cents: 2000 }, { name: 'Jo', rest: true }]);
  assert.deepEqual(c.ok && [c.split.total, ...c.split.shares], [7200, 3000, 2400, 1800]);
  const d = customSplit(1000, [], [{ name: 'Ana', cents: 100 }, { name: 'Ben', rest: true }, { name: 'Jo', rest: true }]);
  assert.deepEqual(d.ok && d.split.shares, [100, 450, 450]);
  assert.deepEqual(customSplit(6000, [], [{ name: 'Ana', cents: 5000 }, { name: 'Ben', cents: 2000 }]), { ok: false, error: 'over', sum: 7000 });
  assert.deepEqual(customSplit(6000, [], [{ name: 'Ana', cents: 2500 }, { name: 'Ben', cents: 2000 }]), { ok: false, error: 'under', sum: 4500 });
  assert.equal(customSplit(6000, [], [{ name: 'Ana', cents: 6000 }, { name: 'Jo', rest: true }]).ok, false);
  assert.equal(customSplit(6000, [], [{ name: 'Ana', pct: 70000 }, { name: 'Jo', pct: 40000 }]).ok, false);
});

test('service charge + fixed fee, and tip on total (subtotal + tax)', () => {
  const ex = computeExtras(6000, [{ kind: 'service', pct: 18000 }, { kind: 'fee', cents: 350, label: 'delivery' }]);
  assert.deepEqual(ex.map((e) => e.amount), [1080, 350]);
  const s = equalSplit(6000, [{ kind: 'service', pct: 18000 }, { kind: 'fee', cents: 350, label: 'delivery' }], ['Ana', 'Ben', 'Jo']);
  assert.equal(s.total, 7430);
  assert.deepEqual(s.shares, [2477, 2477, 2476]);
  const pre = computeExtras(10000, [{ kind: 'tax', pct: 10000 }, { kind: 'tip', pct: 20000 }]);
  const tot = computeExtras(10000, [{ kind: 'tip', pct: 20000, onTotal: true }, { kind: 'tax', pct: 10000 }]);
  assert.deepEqual(pre.map((e) => e.amount), [1000, 2000]);
  assert.deepEqual(tot.map((e) => e.amount), [2200, 1000]); // order of mention does not matter
});

test('itemized: shared items by a subset use exact thirds (no cent drift)', () => {
  // A $10 appetizer split three ways is 333.33... cents each, kept exact until the final rounding.
  const s = itemizedSplit(['Ana', 'Ben', 'Jo', 'Maya'], [1000, 1000, 1000, 1000], [{ cents: 1000, by: [0, 1, 2] }], []);
  assert.equal(s.total, 5000);
  assert.deepEqual(s.shares, [1334, 1333, 1333, 1000]);
});

/** mulberry32: small seeded PRNG so the property test is reproducible. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('property: 3000 random bills — shares sum to the total, each within a cent of its exact share; settle nets to zero', () => {
  const rnd = prng(20261023);
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  for (let k = 0; k < 3000; k++) {
    const n = int(1, 9);
    const names = Array.from({ length: n }, (_, i) => `P${String.fromCharCode(65 + ((i * 7 + k) % 26))}${i}`);
    const own = names.map(() => (rnd() < 0.15 ? 0 : int(1, 9000)));
    const shared = Array.from({ length: int(0, 3) }, () => {
      const by = names.map((_, i) => i).filter(() => rnd() < 0.6);
      return by.length ? { cents: int(1, 5000), by } : { cents: int(1, 5000) };
    });
    const extras: ExtraSpec[] = [];
    if (rnd() < 0.7) extras.push({ kind: 'tax', pct: int(0, 12500) });
    if (rnd() < 0.7) extras.push({ kind: 'tip', pct: int(0, 30000), onTotal: rnd() < 0.3 });
    if (rnd() < 0.2) extras.push({ kind: 'service', pct: int(0, 20000) });
    if (rnd() < 0.2) extras.push({ kind: 'fee', cents: int(0, 900) });
    const s = itemizedSplit(names, own, shared, extras);
    assert.equal(sum(s.shares), s.total, `bill ${k}`);
    assert.equal(s.total, s.base + sum(s.extras.map((e) => e.amount)));
    // Exact share = subtotal_i * total / base (or total / n when nothing has a price).
    const sub = own.map((c) => c);
    for (const x of shared) {
      const g = x.by ?? names.map((_, i) => i);
      for (const i of g) sub[i] += x.cents / g.length;
    }
    for (let i = 0; i < n; i++) {
      const exact = s.base ? (sub[i] * s.total) / s.base : s.total / n;
      assert.ok(Math.abs(s.shares[i] - exact) < 1 + 1e-6, `bill ${k}: ${s.shares[i]} vs ${exact}`);
      assert.ok(s.shares[i] >= 0);
    }
    const eq = equalSplit(int(1, 500000), extras, names);
    assert.equal(sum(eq.shares), eq.total);
    assert.ok(Math.max(...eq.shares) - Math.min(...eq.shares) <= 1);
    // A random tab of up to 4 such bills with random payers settles to everyone even.
    if (k % 10 === 0) {
      const tab: BillTab = { expenses: [s, eq].map((x, j) => ({ kind: 'equal', payer: names[(k + j) % n], total: x.total, shares: x.names.map((name, i) => ({ name, cents: x.shares[i] })), createdAt: j })) };
      const net = new Map(balances(tab).map((b) => [b.name, b.net]));
      assert.equal(sum([...net.values()]), 0);
      const transfers = settle(tab);
      assert.ok(transfers.length <= Math.max(0, net.size - 1));
      for (const t of transfers) {
        assert.ok(t.cents > 0 && Number.isInteger(t.cents));
        net.set(t.from, (net.get(t.from) ?? 0) + t.cents);
        net.set(t.to, (net.get(t.to) ?? 0) - t.cents);
      }
      for (const v of net.values()) assert.equal(v, 0);
    }
  }
});
