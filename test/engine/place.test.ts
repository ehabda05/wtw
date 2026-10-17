import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOUR, Harness, MIN, fakePlaces, joined, ofType } from './helpers.js';

/** Plan locked on Fri Oct 23 7pm, in collecting_details. */
function locked(): Harness {
  const h = new Harness({ start: '2026-10-17T10:00:00-04:00' });
  h.say('ana', '@homi dinner next week?');
  h.say('ben', 'fri works');
  h.say('ana', 'fri works');
  assert.equal(h.plan!.state, 'collecting_details');
  return h;
}

test('unaddressed strong food talk in a plan pushes collecting_place and asks once', () => {
  const h = locked();
  const out = h.say('maya', "ok I'm starving where are we eating");
  assert.equal(joined(out), 'What are we feeling? Cuisine, budget, and roughly where?');
  assert.equal(h.plan!.state, 'collecting_place');
  assert.deepEqual(h.plan!.stack, ['collecting_details']);
  assert.ok(out.some((a) => a.type === 'schedule' && a.key === `${h.plan!.id}:hungry_deadline`));
  assert.deepEqual(h.say('jo', 'where are we eating lol'), [], 'never re-triggers');
});

test('lookup query, 3 bubbles with (est.) prices and "hours unknown", votes, address once, pop to confirmed', () => {
  const h = locked();
  h.say('maya', 'homi find food');
  h.say('ana', 'thai sounds amazing');
  h.say('ben', 'something cheap pls');
  const look = ofType(h.say('jo', 'homi go, harvard square'), 'lookup_places')[0];
  assert.deepEqual(look.query, { cuisines: ['thai'], diet: [], near: 'Harvard Square', at: h.plan!.eventAt, priceMax: 1 });
  const res = h.places(fakePlaces());
  const sends = ofType(res, 'send');
  assert.equal(sends[0].text, 'Thai, keeping it cheap, Harvard Sq: here are 3. Tap ❤️ on your pick (or reply 1, 2 or 3).');
  assert.equal(sends[1].text, '1 · Tasty Thai · Thai · ~$ (est.) · 4 min walk · open at 7pm');
  assert.ok(sends.some((s) => /hours unknown/.test(s.text)));
  assert.deepEqual(sends.slice(1).map((s) => s.tag), ['place:1', 'place:2', 'place:3']);
  h.react('ana', '❤️', 'place:1');
  const close = h.say('ben', '1 looks good');
  const msgs = ofType(close, 'send').map((s) => s.text);
  assert.equal(msgs[0], 'Tasty Thai it is: 1234 Mass Ave https://maps.example/tasty 🍜 Want a reminder 30 min before (say "homi remind me")?');
  assert.equal(msgs[1], 'Locked: Fri Oct 23, 7pm · Tasty Thai · 2 in. I\'ll remind you the day before; say "homi add to calendar" for an invite.');
  assert.equal(msgs.filter((m) => m.includes('1234 Mass Ave')).length, 1, 'address posted once');
  assert.equal(h.plan!.state, 'confirmed');
  assert.equal(h.plan!.place?.name, 'Tasty Thai');
});

test('hungry_deadline: after 10 minutes Homi searches with what it has, then closes with "#1 since nobody objected"', () => {
  const h = locked();
  h.say('maya', 'homi find food, thai near harvard sq');
  h.advance(10 * MIN);
  h.places(fakePlaces());
  const out = h.advance(10 * MIN);
  assert.match(joined(out), /^Going with #1 since nobody objected: Tasty Thai/);
  assert.equal(ofType(out, 'send')[0].prompting, 'prompted');
});

test('instant plan from idle: today, no date options, no reminder offer, confirmed ~now', () => {
  const h = new Harness({ start: '2026-10-17T18:30:00-04:00' });
  assert.deepEqual(h.say('aiden', "ok i'm starving, where are we eating").filter((a) => a.type === 'send').length, 1, 'intro only');
  const ask = h.say('bea', '@homi where should we eat');
  assert.equal(joined(ask), 'What are we feeling? Cuisine, budget, and roughly where?');
  assert.equal(h.plan!.options.length, 0);
  assert.match(joined(h.say('chidi', 'somewhere near here, $$ is fine')), /Which neighborhood\? I never use your location\./);
  h.say('devi', "we're in harvard sq rn");
  h.say('emre', 'fatima and i are in allston tho');
  const look = ofType(h.say('bea', 'ok homi go'), 'lookup_places')[0];
  assert.equal(look.query.near, 'Harvard Square + Allston');
  assert.match(joined(h.places(fakePlaces())), /halfway between Harvard Sq and Allston/);
  h.say('devi', '2');
  const close = h.react('emre', '❤️', 'place:2');
  assert.match(joined(close), /^Pho Basil it is/);
  assert.doesNotMatch(joined(close), /remind/);
  assert.equal(h.plan!.state, 'confirmed');
  assert.equal(h.plan!.eventAt, h.now);
  const purge = h.advance(25 * HOUR);
  assert.ok(purge.some((a) => a.type === 'purge'));
  assert.equal(h.plan, null);
});

test('food detour while the date is open pops back to collecting_availability; the lock then confirms', () => {
  const h = new Harness({ start: '2026-10-19T18:30:00-04:00' });
  h.say('amara', '@homi dinner thu, fri or sat?');
  h.say('amara', 'homi lock it when 2 say yes');
  h.say('theo', 'ok but where are we eating?? i refuse to do the dhall again');
  assert.equal(h.plan!.state, 'collecting_place');
  h.say('amara', 'indian, allston');
  h.say('theo', 'indian 🙏');
  h.places([{ id: 1, name: 'Tabla Express', cuisine: 'indian', priceBand: 2, priceEstimated: true, source: 'osm', walkMinutes: 2, openAtPlanTime: true }]);
  h.react('amara', '❤️', 'place:1');
  h.react('theo', '❤️', 'place:1');
  assert.equal(h.plan!.state, 'collecting_availability');
  h.say('lucas', 'fri works');
  const lock = h.say('ines', 'fri works');
  assert.match(joined(lock), /^Locked: Fri Oct 23, 7pm · Tabla Express/);
  assert.equal(h.plan!.state, 'confirmed');
});
