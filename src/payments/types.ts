// Payment provider contract for commitment deposits (docs/COMMITMENTS.md). The engine only emits
// { type: 'payment', op: 'hold' | 'refund' | 'forfeit' } actions; a provider executes them and the runner feeds
// the outcome back as a payment_result event. Amounts are integer cents. No card details ever pass through chat.

import type { MemberKey, PaymentOp, SpaceKey } from '../engine/types.js';

export interface PaymentRequest {
  op: PaymentOp;
  /** Idempotency key from the engine: the same ref never moves money twice. */
  ref: string;
  /** Hashed group id: pools (forfeited money) are per group. */
  space: SpaceKey;
  planId: string;
  /** Hashed member key. A real provider maps it to that member's own authorized payment (never a raw handle). */
  member: MemberKey;
  amountCents: number;
  currency: 'USD';
  memo: string;
}

export interface PaymentOutcome {
  ok: boolean;
  /** True when no real money moved (the simulated provider). Shown as "SIMULATED" in every money message. */
  simulated: boolean;
  error?: string;
}

export interface PaymentProvider {
  readonly id: string;
  readonly simulated: boolean;
  execute(req: PaymentRequest): Promise<PaymentOutcome>;
}
