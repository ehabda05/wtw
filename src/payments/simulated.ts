// The default provider: an in-memory ledger that behaves like escrow so the flow can be demoed and tested end to
// end. No money moves, nothing leaves the process, and every outcome says simulated: true.
//   hold     -> member deposit for the plan (one open hold per member and plan)
//   forfeit  -> moves that deposit into the group's pool (group fund / split / donation money)
//   refund   -> pays back from the member's deposit first, then from the group's pool (dispute refunds, split
//               shares)
// `strict` (tests) fails a forfeit/refund the ledger cannot cover ("nothing_held", "insufficient_funds"). The
// default is lenient: the ledger is in memory, so after a restart it cannot know earlier holds, and refusing a
// refund that moves no real money would only strand the flow. Requests are idempotent by ref.

import type { PaymentOutcome, PaymentProvider, PaymentRequest } from './types.js';

export interface LedgerEntry {
  at: number;
  req: PaymentRequest;
  outcome: PaymentOutcome;
}

export class SimulatedPaymentProvider implements PaymentProvider {
  readonly id = 'simulated';
  readonly simulated = true;
  readonly log: LedgerEntry[] = [];
  readonly #holds = new Map<string, number>();
  readonly #pools = new Map<string, number>();
  readonly #seen = new Map<string, PaymentOutcome>();
  readonly #now: () => number;
  readonly #strict: boolean;

  constructor(opts: { now?: () => number; strict?: boolean } = {}) {
    this.#now = opts.now ?? (() => 0);
    this.#strict = !!opts.strict;
  }

  /** Current deposit held for a member in a plan (cents). */
  held(planId: string, member: string): number {
    return this.#holds.get(`${planId}:${member}`) ?? 0;
  }

  /** Forfeited money waiting in a group's pool (cents). */
  pool(space: string): number {
    return this.#pools.get(space) ?? 0;
  }

  async execute(req: PaymentRequest): Promise<PaymentOutcome> {
    const prior = this.#seen.get(req.ref);
    if (prior) return prior;
    const outcome = this.#apply(req);
    this.#seen.set(req.ref, outcome);
    this.log.push({ at: this.#now(), req, outcome });
    return outcome;
  }

  #apply(req: PaymentRequest): PaymentOutcome {
    const fail = (error: string): PaymentOutcome => ({ ok: false, simulated: true, error });
    if (!Number.isInteger(req.amountCents) || req.amountCents <= 0) return fail('invalid_amount');
    if (req.currency !== 'USD') return fail('unsupported_currency');
    const hk = `${req.planId}:${req.member}`;
    const held = this.#holds.get(hk) ?? 0;
    const pool = this.#pools.get(req.space) ?? 0;
    switch (req.op) {
      case 'hold':
        if (held > 0) return fail('already_held');
        this.#holds.set(hk, req.amountCents);
        break;
      case 'forfeit':
        if (held < req.amountCents && this.#strict) return fail('nothing_held');
        this.#holds.set(hk, Math.max(0, held - req.amountCents));
        this.#pools.set(req.space, pool + req.amountCents);
        break;
      case 'refund': {
        if (held + pool < req.amountCents && this.#strict) return fail('insufficient_funds');
        const fromHold = Math.min(held, req.amountCents);
        this.#holds.set(hk, held - fromHold);
        this.#pools.set(req.space, Math.max(0, pool - (req.amountCents - fromHold)));
        break;
      }
      default:
        return fail('unknown_op');
    }
    return { ok: true, simulated: true };
  }
}
