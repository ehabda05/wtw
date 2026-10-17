import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOUR, Harness, joined, ofType } from './helpers.js';

function plan(): Harness {
  const h = new Harness({ start: '2026-10-17T10:00:00-04:00' });
  h.say('ana', '@homi dinner next week?');
  return h;
}

test('status card in collecting_availability and after confirmation', () => {
  const h = plan();
  h.say('sam', "homi I'm Sam");
  h.say('ana', 'fri works');
  assert.equal(joined(h.say('jo', 'homi where are we at')), 'Dinner, next week: Fri leads with 1 yes (✓ Thu 0 · Fri 1 · Sat 0). Still need Sam and 1 more; I lock it in tomorrow 10am.');
  assert.equal(joined(h.say('ben', '/status')).startsWith('Dinner, next week'), true);
});

test('why: tally plus low-confidence reads and time constraints', () => {
  const h = plan();
  h.say('jo', "homi I'm Jo");
  h.say('jo', "I'm in");
  h.say('ben', "homi I'm Ben");
  h.say('ben', 'sat works but only after 9');
  const why = joined(h.say('ana', 'homi why'));
  assert.match(why, /^Thu had 1 yes; Fri had 1 yes; Sat had 1 yes \+ 1 maybe\./);
  assert.match(why, /I read Jo's reply as a yes to everything \(low confidence\)/);
  assert.match(why, /Ben can only do Sat after 9pm/);
});

test('name, I\'m out (no guilt), headcount, tone, threshold', () => {
  const h = plan();
  assert.equal(joined(h.say('sam', "homi I'm Sam")), 'Hi Sam 👋');
  assert.equal(h.plan!.members['k-sam'].name, 'Sam');
  assert.equal(joined(h.say('sam', "I'm out")), 'All good, next time 💛');
  assert.equal(h.plan!.members['k-sam'].status, 'out');
  assert.equal(joined(h.say('ana', "homi we're 6")), 'Got it, 6 of you.');
  assert.equal(h.plan!.expectedHeadcount, 6);
  assert.equal(joined(h.say('ana', 'homi tone ruthless')), 'Tone set to ruthless.');
  assert.equal(h.state.space.tone, 'ruthless');
  assert.equal(joined(h.say('ana', '/threshold 4')), "Got it: I'll lock the first time that gets 4 yes.");
});

test('opt-ins: DM / call set the flag and ask the runner to remember the handle', () => {
  const h = plan();
  const dm = h.say('jo', 'homi you can DM me');
  assert.ok(dm.some((a) => a.type === 'remember_handle' && a.member === 'k-jo' && a.planId === h.plan!.id));
  assert.equal(h.plan!.members['k-jo'].optInDm, true);
  h.say('sam', 'homi you can call me');
  assert.equal(h.plan!.members['k-sam'].optInCall, true);
  const t = new Harness({ start: '2026-10-17T10:00:00-04:00', surface: 'terminal' });
  t.say('ana', '@homi dinner next week?');
  assert.match(joined(t.say('jo', 'homi you can DM me')), /doesn't let me DM/);
  assert.match(joined(new Harness({ start: '2026-10-17T10:00:00-04:00' }).say('jo', 'homi you can call me')), /Opt-ins last for one plan/);
});

test('notes: save and recall only from notes', () => {
  const h = plan();
  assert.equal(joined(h.say('ben', 'homi note parking: behind the building')), 'Noted: parking.');
  assert.equal(joined(h.say('jo', 'homi what did we decide about parking')), 'Parking: behind the building.');
  assert.match(joined(h.say('jo', 'homi what did we decide about dessert')), /I don't have a note about dessert/);
});

test('split (bills extension): by n ways, or by the yes count; largest remainder to the cent', () => {
  const h = plan();
  assert.equal(joined(h.say('ana', 'homi split 142.50 5 ways')), '$142.50 split 5 ways: $28.50 each.');
  assert.equal(joined(h.say('ana', 'homi split 100 3 ways')), '$100.00 split 3 ways: 1 pays $33.34, 2 pay $33.33.');
  h.say('ben', 'fri works');
  h.say('ana', 'fri works');
  assert.equal(joined(h.say('ana', 'homi split 120')), '$120.00 split 2 ways: $60.00 each.');
});

test('time zone by city changes quiet hours', () => {
  const h = plan();
  assert.equal(joined(h.say('ana', "homi we're in Chicago")), 'Got it: quiet hours (11pm–9am) now follow Chicago time.');
  assert.equal(h.state.space.tz, 'America/Chicago');
  assert.match(joined(h.say('ana', "homi we're in Atlantis")), /I don't know that city yet/);
});

test('notice mode: opt-in, offers once per 24h on "we should hang out", gated like any unprompted message', () => {
  const h = new Harness({ start: '2026-10-17T12:00:00-04:00' });
  h.say('ana', 'homi notice on');
  const offer = h.say('ben', 'we should hang out this week!!');
  assert.equal(joined(offer), 'Want me to make that happen? Reply "homi yes" and I\'ll find a date.');
  assert.equal(ofType(offer, 'send')[0].prompting, 'unprompted');
  assert.deepEqual(h.say('jo', 'yes we should hang out'), []);
  assert.match(joined(h.say('ana', 'homi yes')), /What are we doing/);
  assert.match(joined(h.say('ana', 'dinner')), /Roughly when/);
  const off = new Harness({ start: '2026-10-17T12:00:00-04:00' });
  off.say('x', 'hey all');
  assert.deepEqual(off.say('ben', 'we should hang out this week!!'), []);
});

test('call_result: votes through the grammar, prompted group line; ok:false changes nothing', () => {
  const h = plan();
  h.say('sam', "homi I'm Sam");
  h.say('sam', 'homi you can call me');
  const id = h.plan!.id;
  const fail = h.apply({ kind: 'call_result', planId: id, member: 'k-sam', ok: false });
  assert.equal(joined(fail), "Couldn't reach Sam by phone; the vote still closes tomorrow 10am.");
  assert.equal(h.plan!.members['k-sam'].status, 'pending');
  const ok = h.apply({ kind: 'call_result', planId: id, member: 'k-sam', ok: true, answerText: "uh yeah friday works, saturday i'm busy", simulated: true });
  assert.equal(ofType(ok, 'send')[0].text, "Sam's in for Fri (by phone). 1 for 2 🎉 (simulated call)");
  assert.equal(ofType(ok, 'send')[0].prompting, 'prompted');
  assert.equal(h.plan!.members['k-sam'].dayPrefs['2026-10-24'].vote, 'no');
  assert.deepEqual(h.apply({ kind: 'call_result', planId: 'other', member: 'k-sam', ok: true, answerText: 'fri' }), []);
  void HOUR;
});

test('dump lists the plan, never ids, message ids or text, and offers forget', () => {
  const h = plan();
  h.say('jules', "homi i'm jules");
  h.say('nico', 'sat works, fri maybe');
  h.say('mei', 'fri or sat, if anyone wants to carpool my number is 617-555-0101');
  const d = joined(h.say('jules', 'wait homi what do you know'));
  assert.match(d, /^Here's everything I have for this chat: /);
  assert.match(d, /plan "dinner" \(next week\)/);
  assert.match(d, /options Thu Oct 22 7pm, Fri Oct 23 7pm, Sat Oct 24 7pm/);
  assert.match(d, /4 people: 2 answered, 2 pending/);
  assert.match(d, /names I know: Jules/);
  assert.match(d, /0 nudges sent/);
  assert.match(d, /Say "homi forget" to delete it now\.$/);
  assert.doesNotMatch(d, /617|k-|msg-|id\d|carpool/);
});
