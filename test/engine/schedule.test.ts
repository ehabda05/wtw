import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseOption, computeDeadline, generateOptions, parseWindow } from '../../src/engine/index.js';
import { detectDayConflict, detectStranded, detectTimeShift, everyoneAnswered } from '../../src/engine/schedule.js';
import type { Member, Plan, Vote } from '../../src/engine/types.js';
import { atLocal, optionLabel } from '../../src/engine/util.js';
import { TZ } from './helpers.js';

const SAT = Date.parse('2026-10-17T10:00:00-04:00');
const labels = (os: { label: string }[]) => os.map((o) => o.label);

test('§1: "dinner next week?" -> Thu, Fri, Sat at 7pm (top three by score, chronological)', () => {
  const w = parseWindow('dinner next week?', SAT, TZ)!;
  const os = generateOptions({ activity: 'dinner', window: w, now: SAT, tz: TZ });
  assert.deepEqual(labels(os), ['Thu Oct 22 · 7pm', 'Fri Oct 23 · 7pm', 'Sat Oct 24 · 7pm']);
  assert.deepEqual(os.map((o) => o.id), [1, 2, 3]);
});

test('§1: activity times, weekend preference and "hang out" weekday/weekend defaults', () => {
  const w = parseWindow('next week', SAT, TZ)!;
  assert.deepEqual(labels(generateOptions({ activity: 'drinks', window: w, now: SAT, tz: TZ })), ['Thu Oct 22 · 8pm', 'Fri Oct 23 · 8pm', 'Sat Oct 24 · 8pm']);
  assert.deepEqual(labels(generateOptions({ activity: 'brunch', window: w, now: SAT, tz: TZ, weekendPref: true })), ['Fri Oct 23 · 11am', 'Sat Oct 24 · 11am', 'Sun Oct 25 · 11am']);
  assert.deepEqual(labels(generateOptions({ activity: 'hang out', window: w, now: SAT, tz: TZ })), ['Thu Oct 22 · 6:30pm', 'Fri Oct 23 · 6:30pm', 'Sat Oct 24 · 2pm']);
});

test('§1: single-day windows get three times; slots under 3h away are dropped', () => {
  const w = parseWindow('dinner tomorrow?', SAT, TZ)!;
  assert.deepEqual(labels(generateOptions({ activity: 'dinner', window: w, now: SAT, tz: TZ })), ['Sun Oct 18 · 6pm', 'Sun Oct 18 · 7pm', 'Sun Oct 18 · 8:30pm']);
  const five = Date.parse('2026-10-17T16:30:00-04:00');
  const t = generateOptions({ activity: 'dinner', window: parseWindow('tonight', five, TZ)!, now: five, tz: TZ });
  assert.ok(t.every((o) => o.startsAt >= five + 3 * 3600_000));
  assert.equal(t[0].label, 'Sat Oct 17 · 8:30pm');
});

test('§1: explicit days override generation; ruled-out days are removed', () => {
  const ex = generateOptions({ activity: 'dinner', window: parseWindow('thu, fri or sat?', SAT, TZ)!, now: SAT, tz: TZ });
  assert.deepEqual(labels(ex), ['Thu Oct 22 · 7pm', 'Fri Oct 23 · 7pm', 'Sat Oct 24 · 7pm']);
  const noFri = generateOptions({ activity: 'dinner', window: parseWindow('next week', SAT, TZ)!, now: SAT, tz: TZ, excludeWeekdays: [5] });
  assert.deepEqual(labels(noFri), ['Thu Oct 22 · 7pm', 'Sat Oct 24 · 7pm', 'Sun Oct 25 · 7pm']);
});

test('§1 step 4: deadline = min(now+24h, first-6h), >= now+2h, quiet hours -> 9:30am', () => {
  const qh: [number, number] = [23, 9];
  assert.equal(computeDeadline(atLocal('2026-10-22', '19:00', TZ), SAT, TZ, qh), Date.parse('2026-10-18T10:00:00-04:00'));
  const thu = Date.parse('2026-10-22T09:27:00-04:00');
  assert.equal(computeDeadline(atLocal('2026-10-22', '19:00', TZ), thu, TZ, qh), Date.parse('2026-10-22T13:00:00-04:00'));
  const late = Date.parse('2026-10-19T23:40:00-04:00');
  assert.equal(computeDeadline(atLocal('2026-10-23', '19:00', TZ), late, TZ, qh), Date.parse('2026-10-21T09:30:00-04:00'));
});

// ── choosing ──

function plan(votes: Record<string, Record<number, Vote>>, initiator = 'ana'): Plan {
  const days = ['2026-10-22', '2026-10-23', '2026-10-24'];
  const members: Record<string, Member> = {};
  for (const [k, vs] of Object.entries(votes)) {
    members[k] = { key: k, status: 'answered', dayPrefs: {}, optionVotes: vs, optInDm: false, optInCall: false, hasDelivery: false, nudgeCount: 0, joinedAt: 0 };
  }
  return {
    id: 'p', state: 'collecting_availability', stack: [], activity: 'dinner', outdoor: false, initiator, members, notes: {}, nudges: [],
    options: days.map((d, i) => ({ id: i + 1, day: d, time: '19:00', startsAt: atLocal(d, '19:00', TZ), label: optionLabel(d, '19:00') })),
    refs: { options: {}, placeOptions: {} }, createdAt: 0, updatedAt: 0,
  };
}

test('§4: score = yes + 0.5 maybe; ties -> more yes, fewer no, earlier', () => {
  assert.equal(chooseOption(plan({ a: { 1: 'yes', 2: 'yes' }, b: { 2: 'yes' }, c: { 3: 'yes' } }))!.optionId, 2);
  // 2 maybes (1.0) vs 1 yes (1.0): more hard yes wins
  assert.equal(chooseOption(plan({ a: { 1: 'maybe', 2: 'yes' }, b: { 1: 'maybe' } }))!.optionId, 2);
  // equal score and yes: fewer no wins
  assert.equal(chooseOption(plan({ a: { 1: 'yes', 2: 'yes' }, b: { 1: 'no' } }))!.optionId, 2);
  // full tie: earlier date
  assert.equal(chooseOption(plan({ a: { 2: 'yes', 3: 'yes' } }))!.optionId, 2);
});

test('§4: organizer veto skips an option the starter said no to, unless every option has that no', () => {
  assert.equal(chooseOption(plan({ ana: { 1: 'no', 2: 'yes' }, b: { 1: 'yes' }, c: { 1: 'yes' } }))!.optionId, 2);
  assert.equal(chooseOption(plan({ ana: { 1: 'no', 2: 'no', 3: 'no' }, b: { 1: 'yes' } }))!.optionId, 1);
});

test('everyone answered needs >= 2 and respects the stated headcount', () => {
  const p = plan({ a: { 1: 'yes' }, b: { 2: 'yes' } });
  assert.equal(everyoneAnswered(p), true);
  p.expectedHeadcount = 3;
  assert.equal(everyoneAnswered(p), false);
  assert.equal(everyoneAnswered(plan({ a: { 1: 'yes' } })), false);
});

test('§5: day conflict, time shift and stranded detection', () => {
  const c = plan({ ana: { 1: 'no', 2: 'yes', 3: 'no' }, ben: { 1: 'no', 2: 'no', 3: 'yes' } });
  assert.deepEqual(detectDayConflict(c), { a: 'ana', b: 'ben', dayA: '2026-10-23', dayB: '2026-10-24' });

  const t = plan({ kai: { 2: 'yes' }, wes: { 1: 'yes' } });
  t.members.sofia = { key: 'sofia', status: 'answered', dayPrefs: { '2026-10-23': { vote: 'yes', notBefore: '20:30' } }, optionVotes: {}, optInDm: false, optInCall: false, hasDelivery: false, nudgeCount: 0, joinedAt: 0 };
  assert.deepEqual(detectTimeShift(t, 'sofia'), { optionId: 2, time: '20:30', count: 2, everyone: false });

  const s = plan({ a: { 2: 'yes' }, b: { 2: 'yes' }, c: { 2: 'yes', 3: 'yes' }, ben: { 2: 'no', 3: 'yes' } });
  const st = detectStranded(s, 2)!;
  assert.deepEqual(st.stranded, ['ben']);
  assert.equal(st.altId, 3);
});
