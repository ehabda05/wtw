import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOUR, Harness, joined, ofType, texts } from './helpers.js';

const START = '2026-10-17T10:00:00-04:00';

function started(caps = {}): Harness {
  const h = new Harness({ start: START, caps });
  h.say('ana', '@homi dinner next week?');
  return h;
}

test('plan start: header + 3 tagged bubbles right away, deterministic job keys', () => {
  const h = new Harness({ start: START });
  const out = h.say('ana', '@homi dinner next week?');
  const sends = ofType(out, 'send');
  assert.equal(sends[1].text, 'Dinner, next week. Tap ❤️ on every time that works (or reply like "fri or sat"); I\'ll lock it in tomorrow 10am.');
  assert.equal(sends[1].tag, 'header');
  assert.deepEqual(sends.slice(2).map((s) => [s.tag, s.text]), [
    ['option:1', '1 · Thu Oct 22 · 7pm'], ['option:2', '2 · Fri Oct 23 · 7pm'], ['option:3', '3 · Sat Oct 24 · 7pm'],
  ]);
  const id = h.plan!.id;
  const keys = ofType(out, 'schedule').map((s) => s.key).sort();
  assert.deepEqual(keys, [`${id}:availability_deadline`, `${id}:availability_nudge`]);
  const dl = ofType(out, 'schedule').find((s) => s.job === 'availability_deadline')!;
  assert.equal(dl.at, Date.parse('2026-10-18T10:00:00-04:00'));
  assert.equal(h.plan!.state, 'collecting_availability');
});

test('no window -> "Roughly when..." then options once a window is named', () => {
  const h = new Harness({ start: START });
  assert.match(joined(h.say('ana', 'homi lets plan dinner')), /I'm in\. Roughly when: this week, this weekend, or next week\?/);
  assert.equal(h.plan!.state, 'collecting_dates');
  assert.match(joined(h.say('ben', 'next week')), /1 · Thu Oct 22 · 7pm/);
});

test('abandonment: collecting_dates nudges once at 12h, purges silently at 36h; no votes by deadline + 24h purges', () => {
  const h = new Harness({ start: START });
  h.say('ana', 'homi lets plan dinner');
  const nudge = h.advance(12 * HOUR);
  assert.equal(joined(nudge), 'Still up for dinner? Just tell me when-ish.');
  assert.equal(ofType(nudge, 'send')[0].prompting, 'unprompted');
  const gone = h.advance(24 * HOUR);
  assert.ok(gone.some((a) => a.type === 'purge'));
  assert.equal(ofType(gone, 'send').length, 0);
  assert.equal(h.plan, null);

  const q = started();
  q.advance(24 * HOUR); // deadline with zero answers: silent
  assert.equal(q.plan!.state, 'collecting_availability');
  const later = q.advance(25 * HOUR);
  assert.ok(later.some((a) => a.type === 'purge'));
  assert.equal(q.plan, null);
});

test('capabilities: polls where available; "reply with numbers" when reactions do not arrive', () => {
  const p = started({ polls: true });
  const poll = ofType(p.log.map((l) => l.a), 'poll')[0];
  assert.deepEqual(poll.options, ['1 · Thu Oct 22 · 7pm', '2 · Fri Oct 23 · 7pm', '3 · Sat Oct 24 · 7pm']);
  const r = started({ reactionsIn: false });
  assert.match(texts(r.log.map((l) => l.a)).join('\n'), /Reply with the numbers that work \(like "1 3"\)/);
});

test('reactions on option bubbles: ❤️ yes, 👎 no, ❓ maybe, 😂 ignored, removal ignored; living tally edits', () => {
  const h = started();
  const out = h.react('jo', '❤️', 'option:2');
  assert.ok(out.some((a) => a.type === 'edit' && /✓ Thu 0 · Fri 1 · Sat 0/.test(a.text)));
  h.react('jo', '👎', 'option:1');
  h.react('jo', '❓', 'option:3');
  h.react('jo', '😂', 'option:2');
  h.apply({ kind: 'reaction', from: { key: 'k-jo' }, emoji: '❤️', target: h.refs.get('option:1')!, removed: true });
  assert.deepEqual(h.plan!.members['k-jo'].optionVotes, { 1: 'no', 2: 'yes', 3: 'maybe' });
});

test('inline reply to a bubble is a yes; later messages override only what they mention; day prefs apply', () => {
  const h = started();
  h.say('ben', 'works for me', { replyTo: h.refs.get('option:3') });
  assert.deepEqual(h.plan!.members['k-ben'].optionVotes, { 3: 'yes' });
  h.say('ben', 'fri works too');
  assert.equal(h.plan!.members['k-ben'].dayPrefs['2026-10-23'].vote, 'yes');
  h.say('ben', "actually can't do sat");
  assert.deepEqual(h.plan!.members['k-ben'].optionVotes, {});
  assert.equal(h.plan!.members['k-ben'].dayPrefs['2026-10-24'].vote, 'no');
  assert.equal(h.plan!.members['k-ben'].dayPrefs['2026-10-23'].vote, 'yes');
});

test('unaddressed "lol fri was wild" is ignored; unparseable addressed reply asks once which ones', () => {
  const h = started();
  assert.deepEqual(h.say('ben', 'lol fri was wild'), []);
  assert.equal(h.plan!.members['k-ben'].status, 'pending');
  assert.equal(joined(h.say('ben', '@homi idk depends on work')), 'Got it, which ones could work: 1, 2 or 3?');
});

test('llmVote pre-annotation is applied (low confidence) when the grammar fails', () => {
  const h = started();
  h.say('ben', '@homi depends on my boss honestly', { llmVote: { optionIds: [2], vote: 'yes' } });
  assert.equal(h.plan!.members['k-ben'].optionVotes[2], 'yes');
  assert.equal(h.plan!.members['k-ben'].lowConfidence, true);
});

test('early lock: everyone known answered (>= 2) -> date_chosen -> collecting_details, prompted', () => {
  const h = started();
  h.say('ben', 'fri or sat works');
  const out = h.say('ana', 'fri works');
  const lock = ofType(out, 'send').find((s) => /it is/.test(s.text))!;
  assert.equal(lock.text, 'Fri Oct 23 · 7pm it is: 2 in. Where to: say "homi find food" for 3 options, or tell me the spot ("homi we\'re going to …").');
  assert.equal(lock.prompting, 'prompted');
  assert.equal(h.plan!.state, 'collecting_details');
  assert.equal(h.plan!.lockedBy, 'everyone');
  const id = h.plan!.id;
  assert.ok(out.some((a) => a.type === 'cancel' && a.keyPrefix === `${id}:availability_deadline`));
  assert.ok(out.some((a) => a.type === 'schedule' && a.key === `${id}:remind_day`));
});

test('threshold mode and the maybe confirm-ping folded into the lock message', () => {
  const h = started();
  h.say('ana', 'homi lock it when 2 say yes');
  h.say('jo', 'fri maybe');
  h.say('ben', 'fri works');
  const out = h.say('maya', 'fri works');
  assert.match(joined(out), /^Fri Oct 23 · 7pm it is: 2 in, 1 maybe \(if you said maybe, still good\?\)\. Where to/);
  assert.equal(h.plan!.lockedBy, 'threshold');
});

test('"homi lock fri" force-locks against the tally and notes who asked', () => {
  const h = started();
  h.say('ben', 'sat works');
  h.say('jo', 'sat works');
  h.say('ana', "homi I'm Ana");
  const out = h.say('ana', 'homi lock fri');
  assert.match(joined(out), /^Fri Oct 23 · 7pm it is: 0 in/);
  assert.equal(h.plan!.lockedBy, 'forced');
  assert.match(joined(h.say('ben', 'homi why')), /Ana asked me to lock Fri/);
});

test('deadline: chooses by quorum (organizer veto) with the tone template, unprompted', () => {
  const h = started();
  h.say('ana', "homi we're 4");
  h.say('ana', 'not thu, sat works');
  h.say('ben', 'thu or sat');
  h.say('jo', 'thu works');
  h.say('ana', 'homi tone gentle');
  const out = h.advance(25 * HOUR);
  const lock = ofType(out, 'send').find((s) => /Going with/.test(s.text))!;
  assert.match(lock.text, /^Going with Sat Oct 24 · 7pm, 2 can make it 💛/);
  assert.equal(lock.prompting, 'unprompted');
  assert.equal(h.plan!.lockedBy, 'deadline');
});
