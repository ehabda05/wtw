// Picks the payment provider from PAYMENTS_PROVIDER. 'simulated' (the default) is the only working one; any
// other id gets a provider that fails closed until a real integration exists (docs/COMMITMENTS.md).

import { SimulatedPaymentProvider } from './simulated.js';
import { NotConfiguredPaymentProvider, StripeConnectProvider } from './stripe.js';
import type { PaymentProvider } from './types.js';

export function createPaymentProvider(id: string | undefined, opts: { now?: () => number } = {}): PaymentProvider {
  const name = (id ?? 'simulated').trim().toLowerCase() || 'simulated';
  if (name === 'simulated' || name === 'sim') return new SimulatedPaymentProvider(opts);
  if (name === 'stripe') return new StripeConnectProvider();
  return new NotConfiguredPaymentProvider(name);
}

export { SimulatedPaymentProvider } from './simulated.js';
export { NotConfiguredPaymentProvider, StripeConnectProvider } from './stripe.js';
export type { PaymentOutcome, PaymentProvider, PaymentRequest } from './types.js';
