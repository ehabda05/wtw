import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ics, icsText } from '../../src/engine/index.js';
import { HOUR, Harness, MIN, joined, ofType } from './helpers.js';

/** Fri Oct 23 7pm, place given as text -> confirmed. */
function confirmed(caps = {}): Harness {
  const h = new Harness({ start: '2026-10-17T10:00:00-04:00', caps });
  h.say('ana', '@otto dinner next week?');
  h.say('ben', 'fri works');
  h.say('ana', 'fri works');
  const card = h.say('ana', "otto we're going to Tasty Thai");
  assert.equal(joined(card), 'Locked: Fri Oct 23, 7pm · Tasty Thai · 2 in. I\'ll remind you the day before; say "otto add to calendar" for an invite.');
  assert.equal(h.plan!.state, 'confirmed');
  return h;
}

test('"no place needed" confirms without a place', () => {
  const h = new Harness({ start: '2026-10-17T10:00:00-04:00' });
  h.say('ana', '@otto dinner next week?');
  h.say('ben', 'fri works');
  h.say('ana', 'fri works');
  assert.equal(joined(h.say('ben', "otto no place needed, we'll figure it out lol")), 'Locked: Fri Oct 23, 7pm · 2 in. I\'ll remind you the day before; say "otto add to calendar" for an invite.');
  assert.equal(h.plan!.state, 'confirmed');
});

test('calendar: .ics file where files work (no attendees), text block otherwise', () => {
  const h = confirmed();
  const file = ofType(h.say('ben', 'otto add to calendar'), 'file')[0];
  assert.equal(file.mime, 'text/calendar');
  assert.match(file.content, /BEGIN:VEVENT\r\n/);
  assert.match(file.content, /DTSTART:20261023T230000Z\r\n/);
  assert.match(file.content, /SUMMARY:Dinner · Tasty Thai\r\n/);
  assert.match(file.content, /LOCATION:Tasty Thai\r\n/);
  assert.doesNotMatch(file.content, /ATTENDEE|ORGANIZER|MAILTO/i);
  const t = confirmed({ files: false });
  assert.match(joined(t.say('ben', 'otto add to calendar')), /^Copy this into your calendar:\nDinner · Tasty Thai\nFri Oct 23, 7pm to 9pm \(America\/New_York\)/);
});

test('ics(): RFC 5545 escaping, TZID option, line folding', () => {
  const h = confirmed();
  const p = { ...h.plan!, place: { name: 'Tasty Thai; Bar, & Grill', address: '1234 Mass Ave, Cambridge, MA 02138, a very long street address that keeps going', source: 'user' } };
  const out = ics(p, { tz: 'America/New_York' });
  assert.match(out, /DTSTART;TZID=America\/New_York:20261023T190000/);
  assert.match(out, /SUMMARY:Dinner · Tasty Thai\\; Bar\\, & Grill/);
  for (const line of out.split('\r\n')) assert.ok(Buffer.byteLength(line, 'utf8') <= 75, line);
  assert.equal(icsText({ ...p, eventAt: undefined }, 'America/New_York'), '');
});

test('reminder ladder: day-before (unprompted, -> reminded) and hour-before with split hint, each once', () => {
  const h = confirmed();
  const day = h.advanceTo(Date.parse('2026-10-22T19:00:00-04:00'));
  assert.deepEqual(ofType(day, 'send').map((s) => [s.text, s.prompting]), [['Tomorrow 7pm: Tasty Thai', 'unprompted']]);
  assert.equal(h.plan!.state, 'reminded');
  const hour = h.advanceTo(Date.parse('2026-10-23T18:00:00-04:00'));
  assert.equal(joined(hour), '1 hour to go: Tasty Thai 🍜 After, "otto split 120" splits the bill.');
  assert.deepEqual(h.advanceTo(Date.parse('2026-10-23T22:00:00-04:00')), []);
  assert.equal(h.plan!.state, 'completed', 'complete at event + 3h is silent');
  const purge = h.advanceTo(Date.parse('2026-10-24T19:00:00-04:00'));
  assert.ok(purge.some((a) => a.type === 'purge'));
  assert.equal(ofType(purge, 'send').length, 0, 'automatic purge is silent');
  assert.equal(h.plan, null);
});

test('"otto remind me" -> remind_30 (prompted); refused when < 45 min away', () => {
  const h = confirmed();
  assert.equal(joined(h.say('jo', 'otto remind me')), "Will do: I'll ping 30 minutes before.");
  const out = h.advanceTo(Date.parse('2026-10-23T18:30:00-04:00'));
  const r30 = ofType(out, 'send').find((s) => /^30 minutes to go/.test(s.text))!;
  assert.equal(r30.prompting, 'prompted');
  h.now = Date.parse('2026-10-23T18:40:00-04:00');
  assert.match(joined(h.say('jo', 'otto remind me')), /less than 45 minutes away/);
});

test('reminders respect quiet hours: an 8am event gets its hour reminder dropped, its day reminder at 9am', () => {
  const h = new Harness({ start: '2026-10-17T10:00:00-04:00' });
  h.say('ana', '@otto breakfast next week at 8am?');
  h.say('ben', 'fri works');
  h.say('ana', 'fri works');
  h.say('ana', 'otto no place needed');
  const jobs = [...h.jobs.values()].map((j) => [j.job, new Date(j.at).toISOString()]);
  assert.ok(jobs.some(([j, at]) => j === 'remind_day' && at === '2026-10-22T13:00:00.000Z'), JSON.stringify(jobs));
  assert.ok(!jobs.some(([j]) => j === 'remind_hour'));
});

test('weather glance for outdoor plans: lookup before the day reminder, one rain line', () => {
  const h = new Harness({ start: '2026-10-17T10:00:00-04:00' });
  h.say('ana', '@otto picnic next week?');
  h.say('ben', 'sat works');
  h.say('ana', 'sat works');
  h.say('ana', 'otto place: the Common');
  const look = ofType(h.advanceTo(Date.parse('2026-10-23T10:45:00-04:00')), 'lookup_weather')[0];
  assert.ok(look);
  h.apply({ kind: 'weather_result', requestId: look.requestId, rainLikely: true });
  const rem = h.advanceTo(Date.parse('2026-10-23T11:00:00-04:00'));
  assert.equal(joined(rem), 'Tomorrow 11am: the Common ☔ Rain looks likely, so bring an umbrella.');
});

test('veto & swap: a yes voter\'s "can\'t do friday anymore" reopens only the date, keeps place and notes', () => {
  const h = confirmed();
  h.say('ben', 'otto note dress code: all black');
  assert.deepEqual(h.say('maya', 'cannot wait for friday'), [], 'not a veto');
  const out = h.say('ben', "guys i can't do friday anymore 😭");
  const texts = ofType(out, 'send').map((s) => s.text);
  assert.equal(texts[0], 'No problem: reopening just the date (Tasty Thai stays).');
  const bubbles = ofType(out, 'send').filter((s) => s.tag?.startsWith('option:')).map((s) => s.text);
  assert.equal(bubbles.length, 3);
  assert.ok(!bubbles.some((b) => /Fri Oct 23/.test(b)));
  assert.equal(h.plan!.state, 'collecting_availability');
  assert.equal(h.plan!.place?.name, 'Tasty Thai');
  assert.equal(h.plan!.notes['dress code'], 'all black');
  assert.ok(Object.values(h.plan!.members).every((m) => Object.keys(m.optionVotes).length === 0));
  assert.ok(out.some((a) => a.type === 'cancel' && a.keyPrefix.endsWith(':remind_day')));
});

test('veto from someone who did not say yes does not reopen', () => {
  const h = confirmed();
  h.say('jo', 'hi');
  assert.equal(h.say('jo', "can't do friday anymore").length, 0);
  assert.equal(h.plan!.state, 'confirmed');
});

test('late addressed votes after the lock are recorded; unaddressed ones are ignored', () => {
  const h = confirmed();
  h.say('yuki', 'lol fri works'); // unaddressed after lock
  assert.equal(h.plan!.members['k-yuki'].status, 'pending');
  h.say('yuki', 'otto sorry!! fri works for me 🫡');
  assert.equal(h.plan!.members['k-yuki'].status, 'answered');
  void MIN;
  void HOUR;
});
