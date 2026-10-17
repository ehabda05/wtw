// Bills through the real engine (applyEvent via the test harness): DEMO.md Act 3 copy exactly, the tab
// lifecycle (undo, clear, forget keeps it, stop deletes it), "me" resolution, silence when not addressed,
// the dump line, and the two-sentence rule on every message.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness, joined } from '../engine/helpers.js';
import { countSentences } from '../../src/engine/templates.js';
import type { BillTab } from '../../src/engine/ext/bills/ledger.js';

const DINNER = 'homi itemize dinner, paid by ben: ana shio ramen 16.50; ben spicy miso ramen 17.50 + gyoza 8; jo toroniku ramen 21; maya veggie ramen 16; you shoyu ramen 16.50; shared edamame 6 + karaage 10; tax 7%; tip 20%';

function harness(): Harness {
  const h = new Harness({ start: '2026-10-23T19:30:00-04:00' });
  h.state.space.introSent = true;
  return h;
}

const tab = (h: Harness) => h.state.space.ext?.bills as BillTab | undefined;

test('DEMO Act 3 steps 11-13: itemized dinner card, a second payer, settle up', () => {
  const h = harness();
  assert.equal(
    joined(h.say('ben', DINNER)),
    'Dinner $141.61 (tax $7.81 + 20% tip $22.30), paid by Ben:\nAna $25.02 · Ben $36.45 · Jo $30.74 · Maya $24.38 · You $25.02\nAdds up to $141.61 exactly.',
  );
  assert.equal(joined(h.say('jo', 'homi jo paid 23.40 for the uber, split ana jo you')), 'Uber $23.40 paid by Jo: $7.80 each for Ana, Jo and You.');
  assert.equal(
    joined(h.say('ana', 'homi settle up')),
    "Here's who pays whom (2 expenses, $165.01):\nAna → Ben $32.82\nYou → Ben $32.82\nMaya → Ben $24.38\nJo → Ben $15.14\nThen everyone's even.",
  );
  assert.equal(joined(h.say('maya', 'homi who owes who')), joined(h.say('ana', 'homi settle up')));
  // The tab keeps amounts, names and labels members gave Homi; never item names or message text.
  const t = tab(h);
  assert.equal(t?.expenses.length, 2);
  assert.deepEqual(t?.expenses[0].shares.map((s) => s.cents), [2502, 3645, 3074, 2438, 2502]);
  assert.deepEqual(t?.expenses.map((e) => [e.label, e.payer, e.total, e.kind, e.createdAt]), [
    ['Dinner', 'Ben', 14161, 'itemized', h.now],
    ['Uber', 'Jo', 2340, 'equal', h.now],
  ]);
  const json = JSON.stringify(h.state);
  for (const word of ['ramen', 'gyoza', 'edamame', 'karaage', 'shio', 'shoyu', 'veggie', 'split ana', 'tip 20%']) assert.ok(!json.includes(word), word);
});

test('dump line, tab card, undo, clear', () => {
  const h = harness();
  h.say('ben', DINNER);
  h.say('jo', 'homi jo paid 23.40 for the uber, split ana jo you');
  const dump = joined(h.say('jo', 'homi what do you know'));
  assert.match(dump, /bill tab: 2 expenses, \$165\.01 \(Dinner paid by Ben, Uber paid by Jo\), Ben is owed \$105\.16/);
  assert.ok(countSentences(dump) <= 2, dump);
  assert.equal(
    joined(h.say('ana', 'homi tab')),
    'The tab (2 expenses, $165.01):\nDinner $141.61 · paid by Ben · 5 people\nUber $23.40 · paid by Jo · 3 people\nSay "homi settle up" to see who pays whom.',
  );
  assert.equal(joined(h.say('ana', 'homi undo')), 'Removed Uber $23.40 (paid by Jo) from the tab; 1 expense left, $141.61.');
  assert.match(joined(h.say('ana', 'homi what do you know')), /bill tab: 1 expense, \$141\.61 \(Dinner paid by Ben\), Ben is owed \$105\.16/);
  assert.equal(joined(h.say('ana', 'homi clear the tab')), 'Done: I deleted the tab (1 expense, $141.61).');
  assert.equal(tab(h), undefined);
  assert.equal(joined(h.say('ana', 'homi clear the tab')), 'The tab is already empty.');
  assert.match(joined(h.say('ana', 'homi settle up')), /^The tab is empty; log a bill with/);
  assert.equal(joined(h.say('ana', 'homi undo the last expense')), "The tab is empty, so there's nothing to undo.");
  assert.doesNotMatch(joined(h.say('ana', 'homi undo')), /tab/); // a bare undo with no tab is not ours
  assert.doesNotMatch(joined(h.say('ana', 'homi what do you know')), /bill tab/);
});

test('"homi forget" keeps the tab; "homi stop" deletes it', () => {
  const h = harness();
  h.say('ben', DINNER);
  h.say('ana', 'homi forget');
  assert.equal(tab(h)?.expenses.length, 1);
  h.say('ana', 'homi stop');
  assert.equal(tab(h), undefined);
  assert.equal(h.state.space.ext?.bills, undefined);
});

test('unaddressed messages are ignored, even bill-shaped ones', () => {
  const h = harness();
  for (const t of ['split 86.40 4 ways', 'settle up', 'ben paid 40 for gas, split ana ben', 'itemize: ana 10; ben 12', 'who owes who']) {
    assert.deepEqual(h.say('ana', t, { addressed: false }), [], t);
  }
  assert.equal(tab(h), undefined);
});

test('equal splits: tip, uneven names with a payer hint, unnamed with the yes count fallback, tip on total', () => {
  const h = harness();
  assert.equal(joined(h.say('ana', 'homi split 86.40 + 18% tip 4 ways')), '$101.95 split 4 ways ($86.40 + 18% tip $15.55): 3 pay $25.49, 1 pays $25.48.');
  assert.equal(
    joined(h.say('ana', 'homi split 120 between ana ben jo')),
    '$120.00 split between Ana, Ben and Jo: $40.00 each. Say who paid ("paid by ana") to put it on the tab.',
  );
  assert.equal(
    joined(h.say('ana', 'homi split 40 for gas between ana ben jo')),
    'Gas $40.00:\nAna $13.34 · Ben $13.33 · Jo $13.33\nAdds up to $40.00 exactly. Say who paid ("paid by ana") to put it on the tab.',
  );
  assert.equal(tab(h), undefined); // nothing goes on the tab without a payer
  assert.equal(
    joined(h.say('ana', 'homi split 100 + tax 10% + tip 20% on total between ana ben, paid by ben')),
    '$132.00 ($100.00 + tax $10.00 + 20% tip on total $22.00) paid by Ben: $66.00 each for Ana and Ben.',
  );
  assert.equal(
    joined(h.say('ana', 'homi split 60 + 18% service + fee 3.50 delivery between ana ben jo, paid by ana')),
    '$74.30 ($60.00 + 18% service $10.80 + delivery fee $3.50), paid by Ana:\nAna $24.77 · Ben $24.77 · Jo $24.76\nAdds up to $74.30 exactly.',
  );
  assert.equal(tab(h)?.expenses.length, 2);
  assert.match(joined(h.say('ana', 'homi split 120')), /^How many ways\?/); // no plan, no head count
  assert.match(joined(h.say('ana', 'homi split 60 3 ways, paid by ana')), /: \$20\.00 each\. Name everyone/);
});

test('custom splits: rest, percentages, errors; on the tab with a payer', () => {
  const h = harness();
  assert.equal(
    joined(h.say('ana', 'homi split 60 custom: ana 25, ben 20, jo rest, paid by ana')),
    '$60.00, paid by Ana:\nAna $25.00 · Ben $20.00 · Jo $15.00\nAdds up to $60.00 exactly.',
  );
  assert.equal(
    joined(h.say('ana', 'homi split 80 for rent custom: ana 50%, ben 30%, jo rest')),
    'Rent $80.00:\nAna $40.00 · Ben $24.00 · Jo $16.00\nAdds up to $80.00 exactly. Say who paid ("paid by ana") to put it on the tab.',
  );
  assert.equal(joined(h.say('ana', 'homi split 60 custom: ana 25, ben 20')), 'Those parts add up to $45.00, not $60.00; fix an amount or give someone "rest".');
  assert.equal(joined(h.say('ana', 'homi split 60 custom: ana 50, ben 20, jo rest')), 'Those parts add up to $70.00, more than the $60.00 bill.');
  assert.equal(
    joined(h.say('ben', 'homi settle up')),
    "Here's who pays whom (1 expense, $60.00):\nBen → Ana $20.00\nJo → Ana $15.00\nThen everyone's even.",
  );
});

test('"me" and "I" mean the sender when Homi knows their name, otherwise Homi asks', () => {
  const h = harness();
  assert.equal(joined(h.say('ana', 'homi i paid 40 for gas, split me ben', { platformName: 'Ana' })), 'Gas $40.00 paid by Ana: $20.00 each for Ana and Ben.');
  assert.equal(joined(h.say('zed', 'homi split 40 between me ben')), `I don't know your name yet, so use names instead of "me" (like "paid by ana").`);
  const it = joined(h.say('maya', 'homi itemize: me ramen 12; ana 10; maya tea 3', { platformName: 'Maya Lee' }));
  assert.equal(it, '$25.00 split:\nMaya $15.00 · Ana $10.00\nAdds up to $25.00 exactly. Say who paid ("paid by maya") to put it on the tab.');
  assert.equal(joined(h.say('ana', 'homi SPLIT 30 between ANA and Ben, paid by BEN')), '$30.00 paid by Ben: $15.00 each for Ana and Ben.');
  assert.deepEqual(tab(h)?.expenses.map((e) => e.payer), ['Ana', 'Ben']);
});

test('every bills message is at most two sentences', () => {
  const h = harness();
  const inputs = [
    DINNER, 'homi jo paid 23.40 for the uber, split ana jo you', 'homi settle up', 'homi tab', 'homi split', 'homi itemize',
    'homi split 60 between ana', 'homi split 60 4 ways between ana ben jo', 'homi split 86.40 + 150% tip 4 ways', 'homi split 250000 4 ways',
    'homi split 60 custom: ana lots', 'homi itemize dinner: ana ramen; ben 12', 'homi split 100 3 ways', 'homi split 40 between ana ben jo',
    'homi split 60 custom: ana 25, ben 20, jo rest', 'homi split 60 custom: ana 60, jo rest', 'homi split 60 custom: ana 70%, ben 40%',
    'homi split 120 between me ana', 'homi undo', 'homi clear the tab', 'homi undo the last one', 'homi settle up', 'homi tab',
  ];
  for (const t of inputs) {
    const out = joined(h.say('ana', t));
    assert.ok(out, t);
    assert.ok(countSentences(out) <= 2, `${t}\n${out}`);
    for (const line of out.split('\n')) assert.ok(line.length <= 160, line);
  }
});
