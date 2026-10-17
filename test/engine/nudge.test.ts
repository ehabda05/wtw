import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gateUnprompted, nudgeTime } from '../../src/engine/index.js';
import { countSentences } from '../../src/engine/templates.js';
import { DAY, HOUR, Harness, MIN, TZ, ofType } from './helpers.js';

const QH: [number, number] = [23, 9];
const t = (iso: string) => Date.parse(iso);

test('budget: allowed when now - last >= 12h (exactly 12h is fine); blocked messages defer or drop', () => {
  const now = t('2026-10-17T12:00:00-04:00');
  assert.deepEqual(gateUnprompted({ now, tz: TZ, quietHours: QH }), { kind: 'send' });
  assert.deepEqual(gateUnprompted({ now, tz: TZ, quietHours: QH, lastUnpromptedAt: now - 12 * HOUR }), { kind: 'send' });
  assert.deepEqual(gateUnprompted({ now, tz: TZ, quietHours: QH, lastUnpromptedAt: now - 11 * HOUR }), { kind: 'defer', at: now + HOUR, reason: 'budget' });
  assert.deepEqual(gateUnprompted({ now, tz: TZ, quietHours: QH, lastUnpromptedAt: now - 11 * HOUR, expiresAt: now + 30 * MIN }), { kind: 'drop', reason: 'budget' });
});

test('quiet hours 23:00-09:00 group-local defer to 09:00; must-send never drops', () => {
  const late = t('2026-10-17T23:30:00-04:00');
  assert.deepEqual(gateUnprompted({ now: late, tz: TZ, quietHours: QH }), { kind: 'defer', at: t('2026-10-18T09:00:00-04:00'), reason: 'quiet' });
  const early = t('2026-10-18T05:46:00-04:00');
  assert.equal((gateUnprompted({ now: early, tz: TZ, quietHours: QH }) as { at: number }).at, t('2026-10-18T09:00:00-04:00'));
  assert.deepEqual(gateUnprompted({ now: early, tz: TZ, quietHours: QH, expiresAt: early + HOUR }), { kind: 'drop', reason: 'quiet' });
  assert.equal(gateUnprompted({ now: early, tz: TZ, quietHours: QH, expiresAt: early + HOUR, must: true }).kind, 'defer');
  // Chicago: 23:30 New York is 22:30 Chicago, not quiet there.
  assert.equal(gateUnprompted({ now: late, tz: 'America/Chicago', quietHours: QH }).kind, 'send');
});

test('50% nudge: only when it lands >= 12h before the deadline, moved out of quiet hours', () => {
  const posted = t('2026-10-17T10:00:00-04:00');
  assert.equal(nudgeTime(posted, posted + 24 * HOUR, TZ, QH), posted + 12 * HOUR);
  assert.equal(nudgeTime(posted, posted + 14 * HOUR, TZ, QH), null);
  const p2 = t('2026-10-19T19:03:00-04:00');
  assert.equal(nudgeTime(p2, t('2026-10-20T19:30:00-04:00'), TZ, QH), t('2026-10-19T22:30:00-04:00'));
});

/** Plan with five members who answered and Sam silent (opted in to calls). */
function silentSam(): Harness {
  const h = new Harness({ start: '2026-10-17T10:00:00-04:00' });
  h.say('ana', '@homi dinner next week?');
  h.say('sam', "homi I'm Sam");
  h.say('sam', 'homi you can call me');
  h.say('ana', 'fri works');
  h.say('ben', 'fri or sat works');
  h.say('jo', 'either works');
  return h;
}

test('escalation is folded into the 50% nudge: one announced group message + the call, same result', () => {
  const h = silentSam();
  const out = h.advanceTo(t('2026-10-17T22:00:00-04:00'));
  const sends = ofType(out, 'send');
  const calls = ofType(out, 'call');
  assert.equal(calls.length, 1);
  assert.equal(sends.length, 1);
  assert.equal(sends[0].prompting, 'unprompted');
  assert.match(sends[0].text, /Still need Sam, so I'm giving them a quick call \(they said that's ok\)\./);
  assert.ok(out.indexOf(sends[0]) < out.indexOf(calls[0]), 'announced before the call');
  assert.equal(calls[0].planId, h.plan!.id);
});

test('PRIVACY §10: the call carries only the open question and the times', () => {
  const h = silentSam();
  const call = ofType(h.advanceTo(t('2026-10-17T22:00:00-04:00')), 'call')[0];
  assert.equal(call.question, "Hi, this is Homi calling about your group's plan. Does Thursday at 7, Friday at 7, or Saturday at 7 work for you?");
  for (const bad of ['Sam', 'Ana', 'Ben', 'Jo', 'dinner', 'Thai']) assert.ok(!call.question.includes(bad) && !call.options.join(' ').includes(bad), bad);
  assert.ok(call.options.length <= 3);
});

test('every dm/call action is paired with a group send in the same result (DM opt-in)', () => {
  const h = new Harness({ start: '2026-10-17T10:00:00-04:00' });
  h.say('ana', '@homi drinks next week?');
  h.say('jo', 'homi you can DM me');
  h.say('ana', 'thu works');
  h.say('ben', 'sat works');
  for (const { a } of h.log) void a;
  const out = h.advance(DAY);
  const results: number[] = [];
  out.forEach((a, i) => (a.type === 'dm' || a.type === 'call') && results.push(i));
  assert.ok(results.length >= 1);
  assert.ok(out.some((a) => a.type === 'send' && /quick DM/.test(a.text)));
});

test('noise budget + quiet hours hold across a whole plan (fake clock over several days)', () => {
  const h = new Harness({ start: '2026-10-19T22:33:00-04:00' });
  h.say('sasha', '@homi dinner tomorrow, wed or thu?');
  h.say('ren', 'wed works, thu maybe');
  h.say('uma', "tomorrow's bad, wed or thu");
  h.advance(3 * DAY);
  const un = h.groupMessages().filter((m) => m.prompting === 'unprompted');
  for (const m of un) {
    const hour = new Date(m.at).toLocaleString('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' });
    assert.ok(Number(hour) >= 9 && Number(hour) < 23, `unprompted at ${hour}h: ${m.text}`);
  }
  for (let i = 1; i < un.length; i++) assert.ok(un[i].at - un[i - 1].at >= 12 * HOUR, `${un[i - 1].text} / ${un[i].text}`);
  for (const m of h.groupMessages()) assert.ok(countSentences(m.text) <= 2, m.text);
});

/** Short window (4h, no 50% nudge): Thu 09:27 plan for "tonight, fri or sat"; Sam opted in to calls. */
function shortWindow(): Harness {
  const h = new Harness({ start: '2026-10-22T09:27:00-04:00' });
  h.say('rina', '@homi dinner tonight, fri or sat?');
  h.say('sam', "homi i'm sam");
  h.say('sam', 'homi you can call me, i never check this chat lol');
  h.say('omar', "tonight's bad for me, fri or sat works");
  h.say('gabe', 'down 🫡');
  h.say('rina', "fri or sat works, tonight i can't");
  assert.ok(![...h.jobs.values()].some((j) => j.job === 'availability_nudge'), 'no 50% nudge in a short window');
  return h;
}

test('short window: escalation at the deadline, one unprompted message + call, lock follows the call result (prompted)', () => {
  const h = shortWindow();
  const out = h.advanceTo(t('2026-10-22T13:00:00-04:00'));
  const sends = ofType(out, 'send');
  assert.deepEqual(sends.map((s) => [s.text, s.prompting]), [["Still need Sam before I lock it in, so I'm giving them a quick call (they said that's ok).", 'unprompted']]);
  assert.equal(ofType(out, 'call').length, 1);
  assert.equal(h.plan!.state, 'collecting_availability', 'the lock waits for the call');
  const res = h.apply({ kind: 'call_result', planId: h.plan!.id, member: 'k-sam', answerText: "uh yeah friday works, saturday i'm busy", ok: true, simulated: true });
  const lines = ofType(res, 'send');
  assert.match(lines[0].text, /^Sam's in for Fri \(by phone\)\./);
  assert.match(lines[1].text, /^Fri Oct 23 · 7pm it is: 4 in/);
  assert.ok(lines.every((s) => s.prompting === 'prompted'));
  assert.equal(h.plan!.lockedBy, 'everyone');
  assert.deepEqual(h.advance(HOUR).filter((a) => a.type === 'send'), [], 'the 10-minute fallback was cancelled');
});

test('short window: no call result within 10 minutes -> "Couldn\'t reach Sam; going with Fri." and a prompted lock', () => {
  const h = shortWindow();
  h.advanceTo(t('2026-10-22T13:00:00-04:00'));
  const out = h.advance(10 * MIN);
  const sends = ofType(out, 'send');
  assert.equal(sends[0].text, "Couldn't reach Sam; going with Fri.");
  assert.match(sends[1].text, /^Fri Oct 23 · 7pm it is: 3 in/);
  assert.ok(sends.every((s) => s.prompting === 'prompted'));
  assert.equal(h.plan!.lockedBy, 'deadline');
});

test('short window: a failed call (ok:false) concludes the same way, without changing votes', () => {
  const h = shortWindow();
  h.advanceTo(t('2026-10-22T13:00:00-04:00'));
  const res = h.apply({ kind: 'call_result', planId: h.plan!.id, member: 'k-sam', ok: false });
  assert.equal(ofType(res, 'send')[0].text, "Couldn't reach Sam; going with Fri.");
  assert.equal(h.plan!.members['k-sam'].status, 'pending');
  assert.equal(h.plan!.state, 'collecting_details');
});

test('ruthless tone: inline-reply nudge to the only pending member; at most 2 nudges per member', () => {
  const h = new Harness({ start: '2026-10-19T21:01:00-04:00' });
  h.say('nora', '@homi drinks thu, fri or sat?');
  h.say('raf', 'homi tone ruthless');
  h.say('yuki', 'the last fri at the pub was insane 💀');
  h.say('kai', 'fri!!');
  h.say('nora', 'not thu, fri works');
  h.say('raf', 'fri works');
  const out = h.advance(13 * HOUR);
  const r = ofType(out, 'reply');
  assert.equal(r.length, 1);
  assert.equal(r[0].text, 'Still waiting on you. Thu, Fri or Sat; choose wisely.');
  assert.ok(r[0].to.startsWith('msg-yuki'));
  assert.ok(Object.values(h.plan!.members).every((m) => m.nudgeCount <= 2));
});
