import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { CAPS } from '../../src/channels/types.js';

test('toolchain works', () => {
  assert.equal(CAPS.telegram.groups, true);
  assert.equal(DateTime.fromISO('2026-10-23T19:00', { zone: 'America/New_York' }).weekdayShort, 'Fri');
});
