import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeClock, parseDuration } from '../../src/runner/clock.js';
import { MockVoice } from '../../src/runner/mocks.js';

test('parseDuration', () => {
  assert.equal(parseDuration('12h'), 12 * 3_600_000);
  assert.equal(parseDuration('30m'), 30 * 60_000);
  assert.equal(parseDuration('1h30m'), 90 * 60_000);
  assert.equal(parseDuration('2d'), 2 * 86_400_000);
  assert.equal(parseDuration('45s'), 45_000);
  assert.throws(() => parseDuration('soon'));
  assert.throws(() => parseDuration('12x'));
});

test('FakeClock fires timers in time order as it advances', async () => {
  const c = new FakeClock(1000);
  const seen: [string, number][] = [];
  c.setTimeout(() => void seen.push(['b', c.now()]), 200);
  c.setTimeout(() => void seen.push(['a', c.now()]), 100);
  const h = c.setTimeout(() => void seen.push(['x', c.now()]), 150);
  h.cancel();
  await c.advance(50);
  assert.deepEqual(seen, []);
  await c.advance(500);
  assert.deepEqual(seen, [['a', 1100], ['b', 1200]]);
  assert.equal(c.now(), 1550);
});

test('MockVoice on a FakeClock answers only when time moves (clock-aware), labeled simulated', async () => {
  const c = new FakeClock(0);
  const v = new MockVoice({ clock: c, delayMs: 2000 });
  const results: unknown[] = [];
  v.onResult((r) => void results.push(r));
  v.setAnswer('persona:sam', 'friday works');
  await v.placeCall({ to: 'persona:sam', question: 'Fri or Sat?', options: ['Fri', 'Sat'], callRef: 'c', planId: 'p', member: 'm' });
  await c.advance(1999);
  assert.equal(results.length, 0);
  await c.advance(1);
  assert.deepEqual(results, [{ planId: 'p', member: 'm', answerText: 'friday works', ok: true, simulated: true }]);
  await v.settled();
});
