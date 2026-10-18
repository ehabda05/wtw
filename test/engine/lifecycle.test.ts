// The demo story end to end, on the sim surface, with a fake clock. Prints nothing; asserts key messages and
// the hard rules (two sentences, noise budget, quiet hours, group-visible private actions) across the run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES as T, countSentences } from '../../src/engine/index.js';
import { HOUR, Harness, TZ, fakePlaces, joined, ofType } from './helpers.js';

const at = (iso: string) => Date.parse(iso);

test('demo story: intro -> options -> bridge -> call -> lock Fri -> food -> card -> reminders -> split -> dump -> forget', () => {
  const h = new Harness({ start: '2026-10-17T10:00:00-04:00' });

  // Consent at the door.
  assert.deepEqual(ofType(h.say('maya', 'guys we never hang out anymore'), 'send').map((s) => s.text), [T.intro({ hours: 24 })]);

  // Plan start: options right away.
  const start = h.say('lee', '@homi dinner next week?');
  assert.deepEqual(ofType(start, 'send').map((s) => s.text).slice(1), ['1. Thu Oct 22, 7pm', '2. Fri Oct 23, 7pm', '3. Sat Oct 24, 7pm']);

  for (const [who, name] of [['ana', 'Ana'], ['ben', 'Ben'], ['sam', 'Sam'], ['jo', 'Jo'], ['maya', 'Maya']]) h.say(who, `homi I'm ${name}`);
  assert.match(joined(h.say('sam', 'homi you can call me')), /I'll call you once and tell the group first/);

  // Words and reactions, with one conflict bridge.
  h.say('ana', "fri works, i'm busy thu and sat");
  assert.equal(joined(h.say('ben', "sat works. thu and fri i can't")).split('\n').find((t) => /can only do/.test(t)),
    "Ana can only do Fri and Ben only Sat. Could either of you do Fri late or Sat brunch (I'll add it)?");
  assert.match(joined(h.say('ana', 'sat brunch works actually!')), /4. Sat Oct 24, 11am/);
  h.react('jo', '❤️', 'option:2');
  h.react('jo', '😂', 'option:1');
  h.say('maya', 'anything but thu');
  h.say('lee', 'fri works');
  assert.deepEqual(h.say('ben', 'lol fri was wild'), []);
  assert.equal(h.plan!.state, 'collecting_availability');

  // Sam is silent and opted in to calls: the 50% nudge announces the call in the same result.
  const nudge = h.advanceTo(at('2026-10-17T22:00:00-04:00'));
  const ann = ofType(nudge, 'send')[0];
  assert.equal(ann.text, "5 of 6 have picked, and I'm locking it in tomorrow 10am. Still need Sam, so I'm giving them a quick call (they said that's ok).");
  const call = ofType(nudge, 'call')[0];
  assert.equal(call.member, 'k-sam');
  assert.ok(!/Sam|Ana|Ben|dinner/.test(call.question));

  // The call answer goes through the same grammar and completes "everyone answered" -> lock Fri (prompted).
  const res = h.apply({ kind: 'call_result', planId: h.plan!.id, member: 'k-sam', answerText: 'Friday works', ok: true, simulated: true });
  const lines = ofType(res, 'send').map((s) => s.text);
  assert.equal(lines[0], "Sam's in for Fri (by phone). 5 for 6 🎉 (simulated call)");
  assert.match(lines[1], /^Fri Oct 23, 7pm it is: 5 in\. Where to: say "homi find food"/);
  assert.ok(ofType(res, 'send').every((s) => s.prompting === 'prompted'));
  assert.equal(h.plan!.lockedBy, 'everyone');

  // Food: unaddressed strong signal while a plan is active.
  h.advance(HOUR);
  assert.match(joined(h.say('maya', "ok I'm starving where are we eating")), /All are optional/);
  const look = ofType(h.say('ana', 'thai, something cheap, harvard square'), 'lookup_places')[0];
  assert.deepEqual(look.query.cuisines, ['thai']);
  assert.equal(look.query.priceMax, 1);
  assert.equal(look.query.near, 'Harvard Square');
  assert.match(joined(h.places(fakePlaces())), /^Thai, keeping it cheap, Harvard Sq: here are 3\./);
  h.react('ana', '❤️', 'place:1');
  h.say('jo', '1');
  h.say('ben', '1');
  const close = h.say('maya', '1');
  assert.match(joined(close), /^Tasty Thai it is: 1234 Mass Ave https:\/\/maps\.example\/tasty 🍜 Want a reminder 30 min before/);
  assert.match(joined(close), /Locked: Fri Oct 23, 7pm · Tasty Thai · 5 in\./);
  assert.equal(h.plan!.state, 'confirmed');
  assert.equal(ofType(h.say('lee', 'homi add to calendar'), 'file').length, 1);

  // Reminder ladder.
  assert.equal(joined(h.advanceTo(at('2026-10-22T19:00:00-04:00'))), 'Tomorrow 7pm: Tasty Thai, 1234 Mass Ave · https://maps.example/tasty');
  assert.match(joined(h.advanceTo(at('2026-10-23T18:00:00-04:00'))), /^1 hour to go: Tasty Thai, 1234 Mass Ave 🍜/);
  h.advanceTo(at('2026-10-23T23:00:00-04:00'));
  assert.equal(h.plan!.state, 'completed');

  // After dinner.
  assert.equal(joined(h.say('ana', 'homi split 142.50 5 ways')), '$142.50 split 5 ways: $28.50 each.');
  const dump = joined(h.say('jo', 'homi what do you know'));
  assert.match(dump, /chosen Fri Oct 23, 7pm \(5 yes\)/);
  assert.match(dump, /place Tasty Thai, 1234 Mass Ave/);
  assert.match(dump, /names I know: Lee|names I know: .*Sam/);
  assert.equal(joined(h.say('ana', 'homi forget')), "Done: I've deleted this plan.");
  assert.equal(h.plan, null);
  assert.equal(h.jobs.size, 0);

  // Hard rules across the whole run.
  const msgs = h.groupMessages();
  for (const m of msgs) assert.ok(countSentences(m.text) <= 2, m.text);
  const un = msgs.filter((m) => m.prompting === 'unprompted');
  for (let i = 1; i < un.length; i++) assert.ok(un[i].at - un[i - 1].at >= 12 * HOUR, `${un[i - 1].text} / ${un[i].text}`);
  for (const m of un) {
    const hr = Number(new Date(m.at).toLocaleString('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }));
    assert.ok(hr >= 9 && hr < 23, m.text);
  }
  const privateAt = h.log.filter((l) => l.a.type === 'dm' || l.a.type === 'call').map((l) => l.at);
  for (const t of privateAt) assert.ok(h.log.some((l) => l.at === t && l.a.type === 'send'), 'every dm/call is announced in the group');
});
