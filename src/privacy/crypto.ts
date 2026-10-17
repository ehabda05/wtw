// AES-256-GCM sealing for every personal field at rest (PRIVACY.md §7).
//
// Sealed format (version 1), one Buffer:
//   [0]      0x01 version
//   [1..12]  12-byte random nonce
//   [13..28] 16-byte GCM auth tag
//   [29..]   ciphertext
// Optional AAD binds a blob to its row (e.g. "plans:<planId>") so blobs cannot be swapped between rows.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export const SEAL_VERSION = 1;
const NONCE_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = 1 + NONCE_LEN + TAG_LEN;

export class SealError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'SealError';
  }
}

function checkKey(key: Buffer): void {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new SealError('seal key must be 32 bytes');
}

export function seal(key: Buffer, plaintext: Buffer | string, aad?: string): Buffer {
  checkKey(key);
  const nonce = randomBytes(NONCE_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_LEN });
  if (aad !== undefined) cipher.setAAD(Buffer.from(aad, 'utf8'));
  const data = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext;
  const ct = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([SEAL_VERSION]), nonce, tag, ct]);
}

export function open(key: Buffer, sealed: Uint8Array, aad?: string): Buffer {
  checkKey(key);
  const buf = Buffer.isBuffer(sealed) ? sealed : Buffer.from(sealed);
  if (buf.length < HEADER_LEN) throw new SealError('sealed blob too short');
  const version = buf[0];
  if (version !== SEAL_VERSION) throw new SealError(`unsupported seal version ${version}`);
  const nonce = buf.subarray(1, 1 + NONCE_LEN);
  const tag = buf.subarray(1 + NONCE_LEN, HEADER_LEN);
  const ct = buf.subarray(HEADER_LEN);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_LEN });
  if (aad !== undefined) decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  } catch {
    throw new SealError('sealed blob failed authentication (tampered, wrong key or wrong context)');
  }
}

export const sealString = (key: Buffer, s: string, aad?: string): Buffer => seal(key, s, aad);
export const openString = (key: Buffer, b: Uint8Array, aad?: string): string => open(key, b, aad).toString('utf8');
export const sealJson = (key: Buffer, v: unknown, aad?: string): Buffer => seal(key, JSON.stringify(v), aad);
export const openJson = <T = unknown>(key: Buffer, b: Uint8Array, aad?: string): T =>
  JSON.parse(open(key, b, aad).toString('utf8')) as T;

/** Key-bound sealer so the raw key is not passed around. */
export class Sealer {
  readonly #key: Buffer;
  constructor(key: Buffer) {
    checkKey(key);
    this.#key = Buffer.from(key);
  }
  seal(plaintext: Buffer | string, aad?: string): Buffer {
    return seal(this.#key, plaintext, aad);
  }
  open(sealed: Uint8Array, aad?: string): Buffer {
    return open(this.#key, sealed, aad);
  }
  sealString(s: string, aad?: string): Buffer {
    return seal(this.#key, s, aad);
  }
  openString(b: Uint8Array, aad?: string): string {
    return openString(this.#key, b, aad);
  }
  sealJson(v: unknown, aad?: string): Buffer {
    return sealJson(this.#key, v, aad);
  }
  openJson<T = unknown>(b: Uint8Array, aad?: string): T {
    return openJson<T>(this.#key, b, aad);
  }
}
