// PRIVACY.md §3: no digit run of 7+, @handle or email survives redaction.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { containsPii, redact } from '../../src/privacy/redact.js';

const PHONES = [
  '+1 (617) 555-0134',
  '(617) 555-0134',
  '617-555-0134',
  '617.555.0134',
  '617 555 0134',
  '+1 617 555 0134',
  '+1-617-555-0134',
  '+16175550134',
  '6175550134',
  '+44 20 7946 0958',
  '555-0134',
];

test('phone numbers in common written forms are scrubbed', () => {
  for (const p of PHONES) {
    const out = redact(`call me at ${p} tonight`);
    assert.ok(!/\d{3}/.test(out.replace(/\[\w+\]/g, '')), `${p} -> ${out}`);
    assert.ok(out.startsWith('call me at [') && out.endsWith('] tonight'), `${p} -> ${out}`);
  }
});

test('emails, @handles and long digit runs are scrubbed', () => {
  assert.equal(redact('ana.b+x@example.co.uk said hi'), '[email] said hi');
  assert.equal(redact('ping @ana_b and @Homi_Bot'), 'ping @[handle] and @[handle]');
  assert.equal(redact('order 123456789'), 'order [number]');
  const out = redact('id 1234567 / 12345678901234 / tg -1001234567890');
  assert.ok(!/\d{7,}/.test(out), out);
});

test('dates, times, prices and short numbers survive', () => {
  for (const s of ['Fri Oct 23, 7pm', '2026-10-23 19:00', '2026-10-16T21:52:00.000Z', 'split 142.50 3 ways', 'we are 6', 'lock it when 4 say yes', '7:30pm']) {
    assert.equal(redact(s), s);
  }
});

test('nothing redactable survives a second pass', () => {
  const nasty = 'Sam (+1 617-555-0134, sam@x.io, @sammy) said 9876543 is fine at 2026-10-23';
  const once = redact(nasty);
  assert.equal(redact(once), once);
  assert.equal(containsPii(once), false);
  assert.equal(containsPii(nasty), true);
  assert.ok(!/\d{7,}|@\w|[\w.]+@[\w.]+\.\w+/.test(once.replace(/@\[handle\]/g, '')), once);
});
