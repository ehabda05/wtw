// Pseudonymous identifiers (PRIVACY.md §4).
// spaceKey  = HMAC-SHA256(ID_SALT, `${surface}:${spaceId}`)
// memberKey = HMAC-SHA256(ID_SALT, `${surface}:${spaceId}:${handle}`)
// Because the space id is inside the member hash, one person gets a different key in every group.

import { createHash, createHmac } from 'node:crypto';
import type { MemberKey, SpaceKey } from '../engine/types.js';

export function spaceKeyOf(salt: Buffer | string, surface: string, spaceId: string): SpaceKey {
  return createHmac('sha256', salt).update(`${surface}:${spaceId}`, 'utf8').digest('hex');
}

export function memberKeyOf(salt: Buffer | string, surface: string, spaceId: string, handle: string): MemberKey {
  return createHmac('sha256', salt).update(`${surface}:${spaceId}:${handle}`, 'utf8').digest('hex');
}

/** Inbound dedupe hash: SHA-256 over surface, space id and platform message id. */
export function msgHashOf(surface: string, spaceId: string, msgId: string): string {
  return createHash('sha256').update(`${surface}\u0000${spaceId}\u0000${msgId}`, 'utf8').digest('hex');
}

/** Salt-bound helper so callers never handle the raw salt. */
export class Ids {
  readonly #salt: Buffer;
  constructor(salt: Buffer | string) {
    this.#salt = Buffer.isBuffer(salt) ? Buffer.from(salt) : Buffer.from(salt, 'utf8');
  }
  space(surface: string, spaceId: string): SpaceKey {
    return spaceKeyOf(this.#salt, surface, spaceId);
  }
  member(surface: string, spaceId: string, handle: string): MemberKey {
    return memberKeyOf(this.#salt, surface, spaceId, handle);
  }
  msgHash(surface: string, spaceId: string, msgId: string): string {
    return msgHashOf(surface, spaceId, msgId);
  }
}

/** Short, non-reversible prefix for log correlation (6 hex chars, so redact() never mistakes it for a number). */
export function shortKey(key: string | undefined): string | undefined {
  return key ? key.slice(0, 6) : undefined;
}
