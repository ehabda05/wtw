// Payments: the simulated escrow ledger, the fail-closed real-provider slot, and the runner handler that turns a
// payment action into a payment_result follow-up.

import { test } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { CAPS } from '../../src/channels/types.js';
import type { Action, EngineEvent, GroupState } from '../../src/engine/types.js';
import { createPaymentProvider, SimulatedPaymentProvider, StripeConnectProvider } from '../../src/payments/index.js';
import type { PaymentRequest } from '../../src/payments/types.js';
import { Executor, type ExecContext } from '../../src/runner/executor.js';
import { createExtHandlers } from '../../src/runner/handlers/index.js';
import { createPaymentsHandler } from '../../src/runner/handlers/payments.js';
import { RecordingAdapter, makeEnv, makePlan } from './helpers.js';

const tmp = mkdtempSync(join(tmpdir(), 'homi-pay-'));

const req = (over: Partial<PaymentRequest>): PaymentRequest => ({
  op: 'hold', ref: 'r1', space: 's1', planId: 'p1', member: 'm1', amountCents: 1000, currency: 'USD', memo: 'test', ...over,
});

test('simulated provider: hold, forfeit to the pool, refunds from the hold then the pool, idempotent refs', async () => {
  const sim = new SimulatedPaymentProvider({ strict: true });
  assert.deepEqual(await sim.execute(req({})), { ok: true, simulated: true });
  assert.equal(sim.held('p1', 'm1'), 1000);
  assert.deepEqual(await sim.execute(req({ ref: 'r2' })), { ok: false, simulated: true, error: 'already_held' });
  assert.deepEqual(await sim.execute(req({ ref: 'r1' })), { ok: true, simulated: true }, 'same ref: same outcome, no second hold');
  await sim.execute(req({ ref: 'h2', member: 'm2' }));
  assert.equal((await sim.execute(req({ ref: 'f1', op: 'forfeit', member: 'm2' }))).ok, true);
  assert.equal(sim.held('p1', 'm2'), 0);
  assert.equal(sim.pool('s1'), 1000);
  // A split share: m1 gets their own $10 back plus $5 from the pool.
  assert.equal((await sim.execute(req({ ref: 'x1', op: 'refund', amountCents: 1500 }))).ok, true);
  assert.equal(sim.held('p1', 'm1'), 0);
  assert.equal(sim.pool('s1'), 500);
  assert.deepEqual(await sim.execute(req({ ref: 'x2', op: 'refund', amountCents: 600 })), { ok: false, simulated: true, error: 'insufficient_funds' });
  assert.deepEqual(await sim.execute(req({ ref: 'f2', op: 'forfeit', member: 'm3' })), { ok: false, simulated: true, error: 'nothing_held' });
  assert.equal((await sim.execute(req({ ref: 'bad', amountCents: 10.5 }))).error, 'invalid_amount');
  assert.equal(sim.log.length, 8);
  // Default (lenient): after a restart the in-memory ledger is empty, and a refund still goes through.
  const fresh = new SimulatedPaymentProvider();
  assert.deepEqual(await fresh.execute(req({ op: 'refund' })), { ok: true, simulated: true });
});

test('provider selection: simulated by default; a real provider id fails closed until integrated', async () => {
  assert.equal(createPaymentProvider(undefined).id, 'simulated');
  assert.equal(createPaymentProvider('simulated').simulated, true);
  const stripe = createPaymentProvider('stripe');
  assert.ok(stripe instanceof StripeConnectProvider);
  const r = await stripe.execute(req({}));
  assert.equal(r.ok, false);
  assert.equal(r.simulated, false);
  assert.match(r.error ?? '', /^not_configured/);
  assert.equal((await createPaymentProvider('acme').execute(req({}))).ok, false);
});

function setup(handlers = [createPaymentsHandler({ dataDir: tmp, now: () => 1 }, new SimulatedPaymentProvider({ strict: true }))]) {
  const env = makeEnv({ caps: CAPS.sim });
  const adapter = new RecordingAdapter(CAPS.sim);
  const exec = new Executor({ repo: env.repo, logger: env.logger, handlers });
  const spaceKey = env.ids.space('sim', 'chat');
  const state: GroupState = { space: { spaceKey, introSent: true, tone: 'normal', tz: 'UTC', notice: false, muted: false }, plan: makePlan('plan-1') };
  const ctx: ExecContext = { spaceKey, surface: 'sim', spaceId: 'chat', adapter, state, now: 1234 };
  return { exec, ctx, adapter };
}

const hold: Action = { type: 'payment', op: 'hold', ref: 'ref-1', planId: 'plan-1', member: 'a'.repeat(64), amountCents: 1000, currency: 'USD', memo: 'pledge: hold' };

test('handler: payment action -> payment_result follow-up (simulated: true), nothing sent to the chat', async () => {
  const { exec, ctx, adapter } = setup();
  const out = await exec.execute([hold, { ...hold, ref: 'ref-2', op: 'forfeit' }, { ...hold, ref: 'ref-3', op: 'refund', amountCents: 2000 }], ctx);
  const want = (ref: string, op: string, amountCents: number, ok: boolean, error?: string): EngineEvent =>
    ({ kind: 'payment_result', ref, planId: 'plan-1', member: 'a'.repeat(64), op, amountCents, ok, simulated: true, ...(error ? { error } : {}) }) as EngineEvent;
  assert.deepEqual(out.followUps, [want('ref-1', 'hold', 1000, true), want('ref-2', 'forfeit', 1000, true), want('ref-3', 'refund', 2000, false, 'insufficient_funds')]);
  assert.deepEqual(adapter.methods(), []);
});

test('createExtHandlers registers the payments handler (simulated by default)', () => {
  const { handlers } = createExtHandlers({ dataDir: tmp, now: () => 1 });
  assert.ok(handlers.some((h) => h.types.includes('payment')));
});

test('handler: a throwing or unconfigured provider becomes ok: false', async () => {
  const boom = { id: 'boom', simulated: false, execute: async () => { throw new Error('network down'); } };
  const { exec, ctx } = setup([createPaymentsHandler({ dataDir: tmp, now: () => 1 }, boom)]);
  const out = await exec.execute([hold], ctx);
  assert.deepEqual(out.followUps, [{ kind: 'payment_result', ref: 'ref-1', planId: 'plan-1', member: 'a'.repeat(64), op: 'hold', amountCents: 1000, ok: false, simulated: false, error: 'network down' }]);
  const real = setup([createPaymentsHandler({ dataDir: tmp, paymentsProvider: 'stripe', now: () => 1 })]);
  const r = (await real.exec.execute([hold], real.ctx)).followUps[0] as Extract<EngineEvent, { kind: 'payment_result' }>;
  assert.equal(r.ok, false);
  assert.equal(r.simulated, false);
});
