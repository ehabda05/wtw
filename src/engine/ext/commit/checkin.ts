// Step 3: verification. Show-up: "homi I'm here" inside [event - 15 min, event + 30 min]; a check-in counts once
// a second participant has checked in (mutual presence) or someone else 👍s it. Goal: "homi done", confirmed by
// another participant's 👍 or "homi confirm <name>". Each one gets a 👍; one milestone reply when exactly one
// participant is left, and one when everyone is in.

import type { EngineEvent, MessageEvent } from '../../types.js';
import { type Step, P, react, replyTo, say } from '../../plan/core.js';
import { emojiVote } from '../../parse.js';
import { C, viewOf } from './copy.js';
import { type Pledge, ack, checkinClosesAt, checkinOpensAt, nameOf, partByName, partsIn } from './model.js';

function milestone(st: Step, c: Pledge, at: string): boolean {
  const held = partsIn(P(st), c, 'held');
  const left = held.filter((x) => x.inAt === undefined);
  const v = viewOf(st, c);
  if (left.length === 1 && held.length >= 2 && !c.oneLeftPosted) {
    c.oneLeftPosted = true;
    replyTo(st, at, C.oneLeft(v, held.length - 1, held.length, nameOf(P(st), left[0].key)));
    return true;
  }
  if (left.length === 0 && held.length && !c.allInPosted) {
    c.allInPosted = true;
    replyTo(st, at, C.allIn(v, held.length));
    return true;
  }
  return false;
}

/** "homi I'm here" (show-up) or "homi done" (goal). */
export function checkIn(st: Step, c: Pledge, ev: MessageEvent): void {
  const part = c.parts[ev.from.key];
  if (!part || part.status !== 'held') return say(st, C.notIn());
  const now = st.ctx.now;
  const v = viewOf(st, c);
  if (c.phase !== 'open') return say(st, C.windowShut(v));
  if (c.kind === 'showup') {
    if (now < checkinOpensAt(c)) return say(st, C.tooEarly(v));
    if (now > checkinClosesAt(c) || c.windowClosed) return say(st, C.windowShut(v));
  } else if (now > c.at) return say(st, C.windowShut(v));
  const done = c.kind === 'showup' ? 'Checked in ✓' : 'Noted ✓';
  if (part.inAt !== undefined) return ack(st, ev.msgRef, done);
  part.inAt = now;
  part.inRef = ev.msgRef;
  if (c.kind === 'showup') {
    const here = partsIn(P(st), c, 'held').filter((x) => x.inAt !== undefined);
    if (here.length >= 2) for (const x of here) x.confirmed = true;
  }
  if (st.ctx.caps.reactionsOut) react(st, ev.msgRef);
  if (!milestone(st, c, ev.msgRef) && !st.ctx.caps.reactionsOut) replyTo(st, ev.msgRef, done);
}

/** Goal: "homi confirm sam" from another participant. */
export function confirmByName(st: Step, c: Pledge, ev: MessageEvent, name: string): void {
  const p = P(st);
  const me = c.parts[ev.from.key];
  if (!me || !['held', 'refunded', 'forfeited'].includes(me.status)) return say(st, C.confirmNotIn());
  const target = partByName(p, partsIn(p, c, 'held').filter((x) => x.inAt !== undefined), name);
  if (!target) return say(st, C.confirmWho());
  if (target.key === ev.from.key) return say(st, C.selfConfirm());
  target.confirmed = true;
  ack(st, ev.msgRef, 'Confirmed ✓');
}

/** A 👍 on someone's check-in / "done" message from someone else confirms it (goal: another participant). */
export function confirmReaction(st: Step, c: Pledge, ev: Extract<EngineEvent, { kind: 'reaction' }>): boolean {
  const target = Object.values(c.parts).find((x) => x.inRef === ev.target);
  if (!target) return false;
  if (ev.removed || emojiVote(ev.emoji) !== 'yes' || ev.from.key === target.key || c.phase !== 'open') return true;
  if (c.kind === 'goal' && c.parts[ev.from.key]?.status !== 'held') return true;
  target.confirmed = true;
  return true;
}
