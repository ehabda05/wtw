// Step 1: start a pledge and agree where no-show money goes. Nothing is held until every member who voted picked
// the same option (at least two of them); a split vote says the counts and waits, and votes can change.

import type { EngineEvent, MessageEvent } from '../../types.js';
import { type Step, P, availabilityOpen, member, planOf, react, say } from '../../plan/core.js';
import { emojiVote } from '../../parse.js';
import { HOUR, atLocal } from '../../util.js';
import { scheduleExt } from '../util.js';
import { C, viewOf } from './copy.js';
import {
  type Pledge, CHECKIN_BEFORE, DESTS, MAX_CENTS, MIN_CENTS, checkinClosesAt, ensureRetention, pledgeOf, readFund, setPledge, settleAt,
} from './model.js';
import { type CommitCmd, deadlineDay, destChoice } from './parse.js';

type Start = Extract<CommitCmd, { kind: 'start' }>;

export function startPledge(st: Step, ev: MessageEvent, cmd: Start): void {
  const p = planOf(st);
  const now = st.ctx.now;
  const tz = st.s.space.tz;
  let at: number;
  if (cmd.goal === undefined) {
    if (!p || p.eventAt === undefined) return say(st, C.needDate());
    if (p.eventAt - CHECKIN_BEFORE <= now) return say(st, C.tooSoon());
    at = p.eventAt;
  } else {
    if (!p) return say(st, C.needPlan());
    const d = cmd.by ? deadlineDay(cmd.by, now, tz) : null;
    if (!d || !cmd.goal) return say(st, C.goalWhen());
    at = atLocal(d, '23:59', tz);
    if (at <= now + HOUR) return say(st, C.goalPast());
  }
  const cur = pledgeOf(st);
  if (cur && cur.phase !== 'closed') return say(st, C.already());
  if (cmd.cents < MIN_CENTS || cmd.cents > MAX_CENTS) return say(st, C.range());
  const c: Pledge = {
    kind: cmd.goal === undefined ? 'showup' : 'goal',
    amountCents: cmd.cents,
    at,
    startedBy: ev.from.key,
    startedAt: now,
    phase: 'vote',
    refs: { dest: {} },
    votes: {},
    agreed: [],
    parts: {},
    attendees: [],
    forfeits: [],
    disputes: [],
    sim: !readFund(st.s.space)?.live,
  };
  if (cmd.goal !== undefined) c.goal = cmd.goal;
  setPledge(st, c);
  const v = viewOf(st, c);
  say(st, C.header(v), 'prompted', 'commit:header');
  for (let i = 1; i <= DESTS.length; i++) say(st, C.option(v, i), 'prompted', `commit:dest:${i}`);
  say(st, C.rules(v), 'prompted', 'commit:rules');
  if (c.kind === 'showup') scheduleExt(st, 'commit', 'close', checkinClosesAt(c));
  scheduleExt(st, 'commit', 'settle', settleAt(c));
  ensureRetention(st, c);
}

function counts(c: Pledge): number[] {
  const out = DESTS.map(() => 0);
  for (const n of Object.values(c.votes)) out[n - 1]++;
  return out;
}

/**
 * The agreement rule. Opens when >= 2 voted and all picked the same option, once everyone in the plan voted,
 * a split was already shown, or someone asked (`explicit`). A split is announced when everyone voted (or asked).
 */
export function evaluate(st: Step, c: Pledge, explicit: boolean): 'open' | 'split' | 'waiting' {
  const p = P(st);
  const picks = [...new Set(Object.values(c.votes))];
  const voters = Object.keys(c.votes);
  const active = Object.values(p.members).filter((m) => m.status !== 'out').map((m) => m.key);
  const allVoted = active.length > 0 && active.every((k) => c.votes[k] !== undefined);
  if (voters.length >= 2 && picks.length === 1) {
    if (!(allVoted || c.splitShown || explicit)) return 'waiting';
    c.phase = 'open';
    c.dest = DESTS[picks[0] - 1];
    c.agreed = voters;
    say(st, C.opened(viewOf(st, c)));
    return 'open';
  }
  if (picks.length > 1 && (explicit || (allVoted && !c.splitShown))) {
    c.splitShown = true;
    say(st, C.split(viewOf(st, c), counts(c)));
    return 'split';
  }
  if (explicit) say(st, C.waiting(viewOf(st, c)));
  return 'waiting';
}

export function ownRef(c: Pledge, ref?: string): boolean {
  return !!ref && (ref === c.refs.header || ref === c.refs.rules || Object.values(c.refs.dest).includes(ref));
}

/** A typed vote ("1", "group fund"). Bare numbers only count when no other flow is waiting for numbers. */
export function voteMessage(st: Step, c: Pledge, ev: MessageEvent, body: string): boolean {
  const ch = destChoice(body);
  if (!ch) return false;
  const p = P(st);
  const busy = p.state === 'collecting_place' || availabilityOpen(p);
  if (ch.numeric && busy && !ownRef(c, ev.replyTo)) return false;
  member(st, ev.from);
  c.votes[ev.from.key] = ch.n;
  react(st, ev.msgRef);
  evaluate(st, c, false);
  return true;
}

/** ❤️/👍 on a destination bubble votes for it; removing it takes the vote back. Other emoji are ignored. */
export function voteReaction(st: Step, c: Pledge, ev: Extract<EngineEvent, { kind: 'reaction' }>): boolean {
  const hit = Object.entries(c.refs.dest).find(([, ref]) => ref === ev.target);
  if (!hit) return false;
  if (c.phase !== 'vote') return true;
  const n = Number(hit[0]);
  const key = ev.from.key;
  if (ev.removed) {
    if (c.votes[key] !== n) return true;
    delete c.votes[key];
  } else {
    if (emojiVote(ev.emoji) !== 'yes') return true;
    member(st, ev.from);
    c.votes[key] = n;
  }
  evaluate(st, c, false);
  return true;
}

export function captureRef(st: Step, tag: string, msgRef: string): void {
  const c = pledgeOf(st);
  if (!c) return;
  const m = tag.match(/^commit:dest:(\d)$/);
  if (m) c.refs.dest[Number(m[1])] = msgRef;
  else if (tag === 'commit:header') c.refs.header = msgRef;
  else if (tag === 'commit:rules') c.refs.rules = msgRef;
}
