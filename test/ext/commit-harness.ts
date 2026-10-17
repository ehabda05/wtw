// Pledge test fixtures: the engine Harness plus an instant simulated payment runner, and the DEMO plan
// (Fri Oct 23 7pm, Hokkaido Ramen Santouka, the crew of six) built through the real Act 1 flow.

import assert from 'node:assert/strict';
import type { Action, EngineEvent } from '../../src/engine/types.js';
import type { Pledge, Fund } from '../../src/engine/ext/commit/model.js';
import { Harness } from '../engine/helpers.js';

export const CREW = ['ana', 'ben', 'sam', 'jo', 'maya', 'you'];
export const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
export type Payment = Extract<Action, { type: 'payment' }>;

/** Answers every payment action at once with a payment_result (ok unless the member is in `fail`). */
export class PledgeHarness extends Harness {
  autoPay = true;
  fail = new Set<string>();
  payments: Payment[] = [];

  override apply(ev: EngineEvent): Action[] {
    const acts = super.apply(ev);
    const out = [...acts];
    for (const a of acts) {
      if (a.type !== 'payment') continue;
      this.payments.push(a);
      if (!this.autoPay) continue;
      const ok = !this.fail.has(a.member);
      out.push(...this.apply({ kind: 'payment_result', ref: a.ref, planId: a.planId, member: a.member, op: a.op, amountCents: a.amountCents, ok, simulated: true }));
    }
    return out;
  }

  get pledge(): Pledge | undefined {
    return this.plan?.ext?.commit as Pledge | undefined;
  }

  get fund(): Fund | undefined {
    return this.state.space.ext?.commit as Fund | undefined;
  }

  ops(op?: Payment['op']): Array<[string, string, number]> {
    return this.payments.filter((p) => !op || p.op === op).map((p) => [p.op, p.member.replace(/^k-/, ''), p.amountCents]);
  }
}

/** DEMO Act 1, compressed: dinner locked Fri Oct 23 · 7pm at Hokkaido Ramen Santouka, six named members. */
export function demoPlan(caps = {}, crew = CREW): PledgeHarness {
  const h = new PledgeHarness({ start: '2026-10-17T10:00:00-04:00', caps });
  h.say(crew.includes('maya') ? 'maya' : crew[0], 'guys we never hang out anymore');
  h.say(crew.includes('you') ? 'you' : crew[0], '@homi dinner next week?');
  h.apply({ kind: 'members_snapshot', members: crew.map((n) => ({ key: `k-${n}`, platformName: cap(n) })) });
  for (const n of crew) h.say(n, 'fri works');
  h.say('ana', "homi we're going to Hokkaido Ramen Santouka");
  assert.equal(h.plan?.state, 'confirmed');
  assert.equal(h.plan?.eventAt, Date.parse('2026-10-23T19:00:00-04:00'));
  h.advance(30 * 60_000);
  return h;
}

/** Starts a $10 show-up pledge and has `voters` pick option `n` by replying with the number. */
export function openPledge(h: PledgeHarness, voters = CREW, n = 1): void {
  h.say('maya', "homi let's do a $10 show-up pledge");
  for (const v of voters) h.say(v, String(n));
  assert.equal(h.pledge?.phase, 'open');
}

export const at = (iso: string) => Date.parse(iso);
