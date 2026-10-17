// Commitment deposits: payment action -> provider -> payment_result follow-up (simulated by default).
// Fails closed: a provider error or exception becomes ok: false, so the engine never counts money that did not move.

import type { Action } from '../../engine/types.js';
import { createPaymentProvider } from '../../payments/index.js';
import type { PaymentProvider } from '../../payments/types.js';
import type { ActionHandler, ExtHandlerDeps } from './types.js';

export function createPaymentsHandler(deps: ExtHandlerDeps, provider?: PaymentProvider): ActionHandler {
  const pp = provider ?? createPaymentProvider(deps.paymentsProvider, { now: deps.now });
  return {
    types: ['payment'],
    async run(action: Action, ctx, out) {
      if (action.type !== 'payment') return;
      const req = {
        op: action.op, ref: action.ref, space: ctx.spaceKey, planId: action.planId, member: action.member,
        amountCents: action.amountCents, currency: action.currency, memo: action.memo,
      };
      let r: { ok: boolean; simulated: boolean; error?: string };
      try {
        r = await pp.execute(req);
      } catch (err) {
        r = { ok: false, simulated: pp.simulated, error: err instanceof Error ? err.message : 'provider_error' };
      }
      out.followUps.push({
        kind: 'payment_result', ref: action.ref, planId: action.planId, member: action.member, op: action.op,
        amountCents: action.amountCents, ok: r.ok, simulated: r.simulated, ...(r.error ? { error: r.error } : {}),
      });
    },
  };
}
