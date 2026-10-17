// Placeholder for a real payment integration (Stripe Connect or similar). It is deliberately NOT implemented:
// moving real money for a group needs product, legal and compliance work first (docs/COMMITMENTS.md §"Real
// integration"). Until then every request fails closed with "not_configured" and simulated: false, so Homi says
// it couldn't take the pledge and nothing is held.
//
// What a real implementation needs, in order:
//  1. Per-participant authorization through the provider's own secure checkout (a hosted page or payment link
//     sent to that member), never card details in chat. 'hold' = a manual-capture PaymentIntent (or escrow)
//     the member approved; the engine contract would grow a checkout URL in payment_result for that link.
//  2. 'refund' = cancel the uncaptured hold (or refund the captured charge); 'forfeit' = capture the hold into a
//     platform/connected account that holds the group's pool; split shares and dispute refunds = transfers or
//     refunds from that pool. Holds expire (about 7 days for cards), so long lead times need capture + refund.
//  3. Payouts to members (connected accounts, KYC/identity checks), charity donations through a vetted partner.
//  4. Money-transmission / escrow licensing review, terms of service, receipts, tax and chargeback handling
//     (a disputed card charge can reverse a forfeit), webhooks for async results, idempotency keys (= ref).
//  5. Credentials only from the environment, e.g. STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_CONNECT_ACCOUNT,
//     with PAYMENTS_PROVIDER=stripe. Never log them; never put them in chat.

import type { PaymentOutcome, PaymentProvider, PaymentRequest } from './types.js';

export class NotConfiguredPaymentProvider implements PaymentProvider {
  readonly simulated = false;
  constructor(readonly id: string) {}

  async execute(_req: PaymentRequest): Promise<PaymentOutcome> {
    return { ok: false, simulated: false, error: `not_configured: payments provider "${this.id}" has no integration (docs/COMMITMENTS.md)` };
  }
}

/** Stripe Connect slot: not implemented, fails closed (see the checklist above). */
export class StripeConnectProvider extends NotConfiguredPaymentProvider {
  constructor() {
    super('stripe');
  }
}
