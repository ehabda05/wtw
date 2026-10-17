// Step 2: "homi I'm in" -> a hold, acknowledged with 👍 once the provider confirms it; one summary line when
// every member who agreed has pledged. Also cancellation (>= 24h before) and every payment_result.

import type { EngineEvent, MessageEvent, MsgRef } from '../../types.js';
import { type Step, P, planOf, react, replyTo, say } from '../../plan/core.js';
import { C, viewOf } from './copy.js';
import { evaluate } from './vote.js';
import { type Part, type Pledge, cancelBy, checkinOpensAt, fundOf, joinUntil, pay, pledgeOf, partsIn } from './model.js';

type PaymentResult = Extract<EngineEvent, { kind: 'payment_result' }>;

function answer(st: Step, to: MsgRef | undefined, text: string): void {
  if (to) replyTo(st, to, text);
  else say(st, text);
}

export function join(st: Step, c: Pledge, ev: MessageEvent): void {
  const key = ev.from.key;
  if (c.phase === 'vote') {
    if (c.votes[key] === undefined) return say(st, C.pickFirst(viewOf(st, c)));
    if (evaluate(st, c, true) !== 'open') return;
  }
  if (c.phase !== 'open') return say(st, C.settledAlready());
  if (st.ctx.now >= joinUntil(c)) return say(st, C.joinClosed(viewOf(st, c)));
  const cur = c.parts[key];
  if (cur && ['holding', 'held', 'cancelling'].includes(cur.status)) return say(st, C.alreadyIn());
  const ref = pay(st, c, key, 'hold', c.amountCents, 'hold');
  c.parts[key] = { key, status: 'holding', holdRef: ref, msgRef: ev.msgRef };
}

/** "N of M pledged: $X held (SIMULATED). See you Friday at 7." once everyone who agreed has pledged (or asked). */
export function summary(st: Step, c: Pledge, asked: boolean): void {
  const out = new Set(Object.values(c.parts).filter((x) => x.status === 'cancelled' || x.status === 'cancelling').map((x) => x.key));
  const pool = new Set([...c.agreed, ...Object.keys(c.parts)].filter((k) => !out.has(k)));
  const held = [...pool].filter((k) => c.parts[k]?.status === 'held').length;
  const waiting = held < pool.size;
  if (!asked && (c.summaryPosted || waiting || !held)) return;
  if (!asked) c.summaryPosted = true;
  say(st, C.summary(viewOf(st, c), held, pool.size));
}

export function cancel(st: Step, c: Pledge | undefined, ev: MessageEvent): void {
  const part = c?.parts[ev.from.key];
  if (!c || !part || !['holding', 'held'].includes(part.status)) return say(st, C.noPledge());
  if (part.status === 'holding') return say(st, C.stillHolding());
  if (c.phase !== 'open' || st.ctx.now > cancelBy(c)) return say(st, C.tooLate());
  part.status = 'cancelling';
  part.msgRef = ev.msgRef;
  part.cancelRef = pay(st, c, part.key, 'refund', c.amountCents, 'refund (cancelled)');
}

/** "homi pledges": the vote, the pledge count, the check-in count or the settlement, whichever applies. */
export function status(st: Step, c: Pledge | undefined): void {
  if (!c || c.phase === 'closed') return say(st, C.howto());
  if (c.phase === 'vote') return void evaluate(st, c, true);
  const v = viewOf(st, c);
  const p = P(st);
  if (c.phase === 'settled') return say(st, C.settledStatus(v, partsIn(p, c, 'refunded').length, c.forfeits.filter((f) => !f.refunded).length));
  const held = partsIn(p, c, 'held');
  const started = c.kind === 'showup' ? st.ctx.now >= checkinOpensAt(c) : held.some((x) => x.inAt !== undefined);
  if (started) return say(st, C.progress(v, held.filter((x) => x.inAt !== undefined).length, held.length));
  summary(st, c, true);
}

/** A hold that succeeded after its pledge went away (forgotten, date changed, settled): give it straight back. */
function orphan(st: Step, ev: PaymentResult): void {
  if (!ev.ok) return;
  st.acts.push({ type: 'payment', op: 'refund', ref: st.ctx.newId(), planId: ev.planId, member: ev.member, amountCents: ev.amountCents, currency: 'USD', memo: 'Whats the Word pledge: refund (pledge no longer active)' });
}

export function onPayment(st: Step, ev: PaymentResult): void {
  const p = planOf(st);
  const c = p && p.id === ev.planId ? pledgeOf(st) : undefined;
  if (ev.ok && !ev.simulated) fundOf(st).live = true;
  if (c) c.sim = ev.simulated;
  const find = (f: (x: Part) => boolean) => (c ? Object.values(c.parts).find(f) : undefined);
  if (ev.op === 'hold') {
    const part = find((x) => x.holdRef === ev.ref);
    if (!c || !part || part.status !== 'holding') return orphan(st, ev);
    if (!ev.ok) {
      delete c.parts[part.key];
      return answer(st, part.msgRef, C.holdFailed(viewOf(st, c)));
    }
    if (c.phase !== 'open') {
      part.status = 'refunded';
      return orphan(st, ev);
    }
    part.status = 'held';
    if (st.ctx.caps.reactionsOut && part.msgRef) react(st, part.msgRef);
    else answer(st, part.msgRef, C.heldAck(viewOf(st, c)));
    return summary(st, c, false);
  }
  const part = find((x) => x.cancelRef === ev.ref);
  if (c && part && part.status === 'cancelling') {
    part.status = ev.ok ? 'cancelled' : 'held';
    return answer(st, part.msgRef, ev.ok ? C.cancelled(viewOf(st, c)) : C.cancelFailed(viewOf(st, c)));
  }
  if (c && !ev.ok) c.failures = (c.failures ?? 0) + 1;
}
