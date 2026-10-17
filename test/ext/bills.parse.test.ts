// Bills parsing: equal / custom / payer-first / itemized grammar, extras, and the edge cases that must not
// become bills.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBills } from '../../src/engine/ext/bills/parse.js';
import { parseExtras } from '../../src/engine/ext/bills/extras.js';
import { itemsTotal } from '../../src/engine/ext/bills/itemize.js';

const kind = (s: string) => parseBills(s)?.kind ?? null;
const why = (s: string) => {
  const c = parseBills(s);
  return c?.kind === 'help' ? c.why : null;
};

test('equal splits: ways, names, extras, labels, payers', () => {
  assert.deepEqual(parseBills('split 86.40 4 ways'), { kind: 'equal', base: 8640, extras: [], ways: 4, names: [], payer: undefined, label: undefined });
  assert.deepEqual(parseBills('split 86.40 + 18% tip 4 ways'), { kind: 'equal', base: 8640, extras: [{ kind: 'tip', pct: 18000 }], ways: 4, names: [], payer: undefined, label: undefined });
  assert.deepEqual(parseBills('Split 120 between Ana, Ben & Jo'), { kind: 'equal', base: 12000, extras: [], ways: 3, names: ['ana', 'ben', 'jo'], payer: undefined, label: undefined });
  assert.deepEqual(parseBills('jo paid 23.40 for the uber, split ana jo you'), { kind: 'equal', base: 2340, extras: [], ways: 3, names: ['ana', 'jo', 'you'], payer: 'jo', label: 'uber' });
  assert.deepEqual(parseBills('i paid $40 for gas, split me ana'), { kind: 'equal', base: 4000, extras: [], ways: 2, names: ['me', 'ana'], payer: 'i', label: 'gas' });
  const p = parseBills('split 120 for dinner between ana ben jo, paid by ben');
  assert.ok(p?.kind === 'equal' && p.label === 'dinner' && p.payer === 'ben' && p.names.length === 3);
  const q = parseBills('split 120 for ana ben jo');
  assert.ok(q?.kind === 'equal' && q.names.join() === 'ana,ben,jo' && q.label === undefined);
  const u = parseBills('split uber 23.40 ana jo you');
  assert.ok(u?.kind === 'equal' && u.label === 'uber' && u.ways === 3);
  for (const s of ['split 142.50 5', 'split 142.50 / 5', 'split the bill 142.50 5 ways', 'split 142.50 for 5 people', '/split 142.50 by 5']) {
    const c = parseBills(s);
    assert.ok(c?.kind === 'equal' && c.base === 14250 && c.ways === 5, s);
  }
  const d = parseBills('split $142.50');
  assert.ok(d?.kind === 'equal' && d.ways === undefined && !d.names.length);
  const t = parseBills('split 1,234.56 between ana ben');
  assert.ok(t?.kind === 'equal' && t.base === 123456);
  const c = parseBills('split 142,50 2 ways');
  assert.ok(c?.kind === 'equal' && c.base === 14250);
});

test('extras: tip / tax / service / fees, percent or fixed, tip on total', () => {
  assert.deepEqual(parseExtras('86.40 + 18% tip 4 ways').extras, [{ kind: 'tip', pct: 18000 }]);
  assert.deepEqual(parseExtras('tax 7%; tip 20%').extras, [{ kind: 'tax', pct: 7000 }, { kind: 'tip', pct: 20000 }]);
  assert.deepEqual(parseExtras('tip 20% on total').extras, [{ kind: 'tip', pct: 20000, onTotal: true }]);
  assert.deepEqual(parseExtras('service charge 18%').extras, [{ kind: 'service', pct: 18000 }]);
  assert.deepEqual(parseExtras('fee 3.50 delivery', true).extras, [{ kind: 'fee', cents: 350, label: 'delivery' }]);
  assert.deepEqual(parseExtras('60 + 3.50 delivery fee 3 ways').extras, [{ kind: 'fee', cents: 350, label: 'delivery' }]);
  assert.deepEqual(parseExtras('tax 7.81 tip 22').extras, [{ kind: 'tax', cents: 781 }, { kind: 'tip', cents: 2200 }]);
  assert.deepEqual(parseExtras('tax 8.875%').extras, [{ kind: 'tax', pct: 8875 }]);
  assert.equal(parseExtras('tip 140%').bad, true);
  const all = parseBills('split 60 + 18% service + fee 3.50 delivery between ana ben jo');
  assert.ok(all?.kind === 'equal' && all.extras.length === 2 && all.names.length === 3);
});

test('custom splits: amounts, percentages, rest, colon form', () => {
  assert.deepEqual(parseBills('split 60 custom: ana 25, ben 20, jo rest'), {
    kind: 'custom', base: 6000, extras: [], payer: undefined, label: undefined,
    parts: [{ name: 'ana', cents: 2500 }, { name: 'ben', cents: 2000 }, { name: 'jo', rest: true }],
  });
  const p = parseBills('split 100 custom: ana 50%, ben 30% and jo the rest, paid by ana');
  assert.ok(p?.kind === 'custom' && p.payer === 'ana' && p.parts[0].pct === 50000 && p.parts[2].rest);
  const c = parseBills('split 60 between ana ben jo: ana 25, ben 20, jo rest');
  assert.ok(c?.kind === 'custom' && c.parts.length === 3);
  const x = parseBills('split 60 + 20% tip custom: ana 25, ben 20, jo rest');
  assert.ok(x?.kind === 'custom' && x.extras.length === 1);
  assert.equal(why('split 60 custom: ana lots, ben 20'), 'custom');
  assert.equal(why('split 60 custom: ana 25, ana 20'), 'custom');
});

test('itemized: DEMO step 11 syntax, shared-by forms, quantities, extras segments', () => {
  const demo = parseBills('itemize dinner, paid by ben: ana shio ramen 16.50; ben spicy miso ramen 17.50 + gyoza 8; jo toroniku ramen 21; maya veggie ramen 16; you shoyu ramen 16.50; shared edamame 6 + karaage 10; tax 7%; tip 20%');
  assert.deepEqual(demo, {
    kind: 'itemized', label: 'dinner', payer: 'ben',
    people: [{ name: 'ana', cents: 1650 }, { name: 'ben', cents: 2550 }, { name: 'jo', cents: 2100 }, { name: 'maya', cents: 1600 }, { name: 'you', cents: 1650 }],
    shared: [{ cents: 1600 }],
    extras: [{ kind: 'tax', pct: 7000 }, { kind: 'tip', pct: 20000 }],
  });
  const forms = [
    'itemize: ana 10; ben 12; shared by ana ben: nachos 12',
    'itemize: ana 10; ben 12; shared nachos 12 by ana and ben',
    'itemize: ana 10; ben 12; shared by ana and ben nachos 12',
  ];
  for (const f of forms) {
    const c = parseBills(f);
    assert.ok(c?.kind === 'itemized', f);
    assert.deepEqual(c.kind === 'itemized' && c.shared, [{ cents: 1200, by: ['ana', 'ben'] }], f);
  }
  const nl = parseBills('itemize lunch: ana ramen 8 x2\nben tea 3, cake 4.5\nservice 10%; fee 2 cleaning\npaid by ana');
  assert.deepEqual(nl, {
    kind: 'itemized', label: 'lunch', payer: 'ana',
    people: [{ name: 'ana', cents: 1600 }, { name: 'ben', cents: 750 }],
    shared: [],
    extras: [{ kind: 'service', pct: 10000 }, { kind: 'fee', cents: 200, label: 'cleaning' }],
  });
  const hdr = parseBills('itemize ben paid for dinner: ana 10; ben 12');
  assert.ok(hdr?.kind === 'itemized' && hdr.payer === 'ben' && hdr.label === 'dinner');
  assert.equal(itemsTotal('spicy miso ramen 17.50 + gyoza 8'), 2550);
  assert.equal(itemsTotal('2 tacos 9'), 900);
  assert.equal(why('itemize dinner: ana ramen; ben 12'), 'noPrice');
  assert.equal(why('itemize dinner: tip lots'), 'itemize');
});

test('tab commands', () => {
  for (const s of ['settle up', 'Settle', "let's settle up", 'who owes who', 'who owes whom?', '/settle']) assert.equal(kind(s), 'settle', s);
  for (const s of ['tab', 'the tab', 'show the tab', 'show me the tab', "what's on the tab"]) assert.equal(kind(s), 'tab', s);
  for (const s of ['clear the tab', 'clear tab', 'delete the tab', 'reset the bill tab']) assert.equal(kind(s), 'clear', s);
  assert.deepEqual(parseBills('undo'), { kind: 'undo', explicit: false });
  assert.deepEqual(parseBills('undo the last expense'), { kind: 'undo', explicit: true });
});

test('help for malformed bills, null for everything else', () => {
  assert.equal(why('split'), 'split');
  assert.equal(why('split the bill'), 'split');
  assert.equal(why('split it 3 ways'), 'split');
  assert.equal(why('split 60 between ana'), 'oneName');
  assert.equal(why('split 60 4 ways between ana ben jo'), 'mismatch');
  assert.equal(why('split 86.40 + 150% tip 4 ways'), 'badPct');
  assert.equal(why('split 250000 4 ways'), 'tooBig');
  assert.equal(why('split 60 between ana 12b'), 'split');
  for (const s of ['what do you know', 'dinner next week?', 'we paid 40 for gas', 'ben got 2 tickets', 'splitting headache lol', 'tip: arrive early', "i'm in"]) {
    assert.equal(parseBills(s), null, s);
  }
});
