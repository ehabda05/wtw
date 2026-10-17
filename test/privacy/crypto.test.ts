import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { SEAL_VERSION, SealError, Sealer, open, openJson, seal, sealJson } from '../../src/privacy/crypto.js';

const key = randomBytes(32);

test('seal/open roundtrip for strings, buffers and JSON', () => {
  assert.equal(open(key, seal(key, 'héllo +1 617 555 0134')).toString('utf8'), 'héllo +1 617 555 0134');
  const buf = randomBytes(100);
  assert.deepEqual(open(key, seal(key, buf)), buf);
  const v = { a: 1, b: ['x', { c: null }], d: 'Fri Oct 23 · 7pm' };
  assert.deepEqual(openJson(key, sealJson(key, v)), v);
  const s = new Sealer(key);
  assert.equal(s.openString(s.sealString('ok', 'ctx'), 'ctx'), 'ok');
});

test('versioned format with a random 12-byte nonce', () => {
  const a = seal(key, 'same');
  const b = seal(key, 'same');
  assert.equal(a[0], SEAL_VERSION);
  assert.equal(a.length, 1 + 12 + 16 + 4);
  assert.notDeepEqual(a.subarray(1, 13), b.subarray(1, 13), 'nonces differ');
  assert.notDeepEqual(a, b, 'ciphertexts differ');
  assert.ok(!a.toString('latin1').includes('same'));
});

test('tamper detection: any flipped byte fails authentication', () => {
  const sealed = seal(key, 'the plan');
  for (const i of [0, 1, 12, 13, 28, 29, sealed.length - 1]) {
    const t = Buffer.from(sealed);
    t[i] ^= 0x01;
    assert.throws(() => open(key, t), SealError, `byte ${i}`);
  }
  assert.throws(() => open(key, sealed.subarray(0, 10)), SealError);
});

test('wrong key or wrong context (AAD) is rejected', () => {
  const sealed = seal(key, 'x', 'plans:p1');
  assert.throws(() => open(randomBytes(32), sealed, 'plans:p1'), SealError);
  assert.throws(() => open(key, sealed, 'plans:p2'), SealError);
  assert.throws(() => open(key, sealed), SealError);
  assert.equal(open(key, sealed, 'plans:p1').toString(), 'x');
});

test('keys must be 32 bytes', () => {
  assert.throws(() => seal(randomBytes(16), 'x'), SealError);
  assert.throws(() => new Sealer(Buffer.alloc(31)), SealError);
});
