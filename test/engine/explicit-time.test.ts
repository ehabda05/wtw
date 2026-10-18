// Live iMessage findings (2026-10-17): "Hommi plan a dinner tonight at 8pm at halal guys" was not seen as addressed,
// got 9pm/10pm options because the 3h lead rule dropped 8pm, lost the place, and "I said 8 pm" only got a 👍.
// "I was thinking Wednesday" (unaddressed, a day nobody proposed) was ignored.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectAddressed, parseCommand, placeIn, preferredTime, stripAddress } from '../../src/engine/index.js';
import { Harness, fakePlaces, joined, ofType } from './helpers.js';

const EVENING = '2026-10-17T17:44:00-04:00'; // Saturday, 5:44pm
const MORNING = '2026-10-17T10:00:00-04:00';

test('typos still address Homi: hommi, homii; "homie" does not', () => {
  for (const t of ['Hommi plan a dinner tonight', 'homii dinner?', 'hey hommii, where are we at', 'ok Hommi split 84 3 ways']) assert.ok(detectAddressed(t), t);
  assert.equal(stripAddress('Hommi plan a dinner tonight at 8pm'), 'plan a dinner tonight at 8pm');
  assert.equal(detectAddressed('my homie is late again'), false);
});

test('parsers: a bare clock time, a trailing place, and time-change phrasings', () => {
  assert.equal(preferredTime('dinner friday 7pm'), '19:00');
  assert.equal(preferredTime('dinner tonight at 8'), '20:00');
  assert.equal(preferredTime('lunch tomorrow at 12:30'), '12:30');
  assert.equal(placeIn('plan a dinner tonight at 8pm at halal guys'), 'halal guys');
  assert.equal(placeIn('dinner friday at 7pm'), undefined);
  assert.equal(placeIn('dinner at least once this week'), undefined);
  assert.equal(placeIn('brunch tomorrow at Tatte?'), 'Tatte');
  for (const t of ['make it 8pm', 'I said 8 pm why are u telling me 9 or 10', '8pm instead', 'can we do 7:30 instead', 'change the time to 8']) {
    assert.deepEqual(parseCommand(t), { kind: 'set_time', time: t.includes('7:30') ? '19:30' : '20:00' }, t);
  }
  assert.equal(parseCommand('split 84 3 ways')?.kind, 'split');
  assert.equal(parseCommand('1 3'), null);
});

test('"dinner tonight at 8pm at halal guys" at 5:44pm: one option at 8pm, the place noted, a deadline before 8', () => {
  const h = new Harness({ start: EVENING });
  const out = h.say('riad', 'Hommi plan a dinner tonight at 8pm at halal guys');
  const sends = ofType(out, 'send');
  assert.deepEqual(sends.filter((s) => s.tag?.startsWith('option:')).map((s) => s.text), ['1. Sat Oct 17, 8pm']);
  assert.match(joined(out), /Noted: halal guys/);
  assert.equal(h.plan!.place?.name, 'halal guys');
  const dl = ofType(out, 'schedule').find((s) => s.job === 'availability_deadline')!;
  assert.ok(dl.at < Date.parse('2026-10-17T20:00:00-04:00'), 'deadline must come before the dinner');
  assert.ok(dl.at >= Date.parse('2026-10-17T18:00:00-04:00'));
});

test('"dinner friday 7pm": the named time is the option, not three generated ones', () => {
  const h = new Harness({ start: MORNING });
  const out = h.say('riad', 'homi dinner friday 7pm');
  assert.deepEqual(ofType(out, 'send').filter((s) => s.tag?.startsWith('option:')).map((s) => s.text), ['1. Fri Oct 23, 7pm']);
});

test('"homi I said 8 pm": the open poll is re-proposed at 8pm; an existing time is a vote, not a change', () => {
  const h = new Harness({ start: EVENING });
  const first = h.say('riad', 'homi dinner tonight');
  assert.deepEqual(ofType(first, 'send').filter((s) => s.tag?.startsWith('option:')).map((s) => s.text), ['1. Sat Oct 17, 9pm', '2. Sat Oct 17, 10pm']);
  const out = h.say('riad', 'Homi I said 8 pm why are u telling me 9 or 10');
  const sends = ofType(out, 'send');
  assert.equal(sends[0].text, 'Changed the time to 8pm:');
  assert.deepEqual(sends.filter((s) => s.tag?.startsWith('option:')).map((s) => s.text), ['3. Sat Oct 17, 8pm']);
  assert.deepEqual(h.plan!.options.filter((o) => !o.removed).map((o) => o.id), [3]);
  // "homi 8pm" now names the only option: that is a yes, not another change.
  const vote = h.say('ana', 'homi 8pm works');
  assert.equal(ofType(vote, 'send').some((s) => s.text.startsWith('Changed the time')), false);
  assert.equal(h.plan!.members['k-ana']?.optionVotes[3], 'yes');
});

test('"plan something for 8 pm to eat out": a plan for tonight at 8pm, not an instant restaurant search', () => {
  const h = new Harness({ start: EVENING });
  const out = h.say('riad', 'Homi plan something for 8 pm to eat out');
  assert.equal(h.plan!.state, 'collecting_availability');
  assert.deepEqual(ofType(out, 'send').filter((s) => s.tag?.startsWith('option:')).map((s) => s.text), ['1. Sat Oct 17, 8pm']);
  assert.ok(!joined(out).includes('What are we feeling'));
});

test('roster: one preference searches immediately, while place selection still waits for group votes', () => {
  const h = new Harness({ start: EVENING, surface: 'imessage-dedicated' });
  // iMessage dedicated lines report the roster at first sight, before any plan exists.
  h.apply({ kind: 'members_snapshot', members: [{ key: 'k-riad', platformName: 'Riad' }, { key: 'k-esc', platformName: 'Escander' }] });
  assert.equal(h.plan, null);
  h.say('riad', 'homi where should we eat');
  assert.deepEqual(Object.keys(h.plan!.members).sort(), ['k-esc', 'k-riad']);
  // One complete preference is enough to search.
  const first = h.say('riad', 'mexican in harvard square');
  assert.equal(ofType(first, 'lookup_places').length, 1);
  h.places(fakePlaces());
  assert.equal(h.plan!.hungry?.phase, 'voting');
  // One place vote out of two: not locked yet.
  const v1 = h.say('riad', '1');
  assert.equal(ofType(v1, 'send').some((s) => /it is:/.test(s.text)), false, 'locked after a single vote');
  const v2 = h.say('esc', '2');
  assert.equal(ofType(v2, 'send').some((s) => /it is:/.test(s.text)), true);
});

test('head count (Telegram): one preference searches immediately and the place vote uses the stated group size', () => {
  const h = new Harness({ start: EVENING, surface: 'telegram' });
  h.apply({ kind: 'headcount', n: 2 });
  assert.equal(h.plan, null);
  h.say('riad', 'homi where should we eat');
  assert.equal(h.plan!.expectedHeadcount, 2);
  // Only Riad is known by name, but the group size still informs the later vote.
  const first = h.say('riad', 'mexican in harvard square');
  assert.equal(ofType(first, 'lookup_places').length, 1);
  h.places(fakePlaces());
  assert.equal(h.plan!.hungry?.phase, 'voting');
  const v1 = h.say('riad', '1');
  assert.equal(ofType(v1, 'send').some((s) => /it is:/.test(s.text)), false, 'locked after a single vote');
  const v2 = h.say('charlie', '1');
  assert.equal(ofType(v2, 'send').some((s) => /it is:/.test(s.text)), true);
});

test('a day nobody proposed becomes a new option: addressed always, unaddressed only with a proposal phrase', () => {
  const h = new Harness({ start: MORNING });
  h.say('riad', 'homi dinner next week?');
  // Passing mention: ignored.
  assert.equal(h.say('ben', 'ugh wednesday was rough').length, 0);
  // A proposal phrase, unaddressed: add a fresh option without treating the suggestion as agreement.
  const out = h.say('ana', 'I was thinking Wednesday');
  assert.match(joined(out), /Added it as a new option/);
  assert.deepEqual(ofType(out, 'send').filter((s) => s.tag?.startsWith('option:')).map((s) => s.text), ['4. Wed Oct 21, 7pm']);
  assert.equal(h.plan!.members['k-ana']?.optionVotes[4], undefined);
  assert.equal(h.plan!.pendingProposal?.optionId, 4);
  h.react('ben', '❤️', 'option:4');
  assert.equal(h.plan!.pendingProposal, undefined);
  // Addressed: no phrase needed. Saturday Oct 17 -> next Monday is Oct 19.
  const out2 = h.say('ben', 'homi monday works');
  assert.deepEqual(ofType(out2, 'send').filter((s) => s.tag?.startsWith('option:')).map((s) => s.text), ['5. Mon Oct 19, 7pm']);
  // A day already on the ballot is a plain vote.
  const out3 = h.say('jo', 'homi friday works');
  assert.equal(ofType(out3, 'send').some((s) => s.tag?.startsWith('option:')), false);
  assert.equal(h.plan!.members['k-jo']?.dayPrefs['2026-10-23']?.vote, 'yes');
});

test('"saturday 7pm" said on a Saturday evening means next Saturday, not a time that already passed', () => {
  const h = new Harness({ start: '2026-10-17T19:05:00-04:00' }); // Saturday, 7:05pm
  const out = h.say('riad', 'homi dinner saturday 7pm');
  assert.deepEqual(ofType(out, 'send').filter((s) => s.tag?.startsWith('option:')).map((s) => s.text), ['1. Sat Oct 24, 7pm']);
  // "tonight at 6" when it is already 7: no roll, the generator falls back to what is left tonight.
  const g = new Harness({ start: '2026-10-17T19:05:00-04:00' });
  const late = g.say('riad', 'homi dinner tonight at 6pm');
  assert.ok(ofType(late, 'send').filter((s) => s.tag?.startsWith('option:')).every((s) => /Sat Oct 17/.test(s.text)));
});

test('"tonight" late in the evening stays tonight (30 min lead), and after the evening is over Homi offers tomorrow, never next week', () => {
  const h = new Harness({ start: '2026-10-17T19:56:00-04:00' }); // Saturday, 7:56pm
  const out = h.say('riad', 'homi plan something for dinner tonight');
  const opts = ofType(out, 'send').filter((s) => s.tag?.startsWith('option:')).map((s) => s.text);
  assert.ok(opts.length >= 2 && opts.every((t) => /Sat Oct 17/.test(t)), opts.join(' | '));
  assert.ok(opts.some((t) => /8:30pm/.test(t)), opts.join(' | '));

  const late = new Harness({ start: '2026-10-17T23:40:00-04:00' }); // Saturday, 11:40pm
  const out2 = late.say('riad', 'homi dinner tonight');
  const opts2 = ofType(out2, 'send').filter((s) => s.tag?.startsWith('option:')).map((s) => s.text);
  assert.ok(opts2.length >= 1 && opts2.every((t) => /Sun Oct 18/.test(t)), opts2.join(' | '));
  assert.ok(ofType(out2, 'send').some((s) => s.text === "Tonight's too late to pull off, so here's tomorrow:"));
  assert.ok(!opts2.some((t) => /Oct 2[0-9]/.test(t)), 'no next-week dates');
});
