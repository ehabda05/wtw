// Optional financial accountability: the show-up pledge (and a goal variant). Flow and rules: docs/COMMITMENTS.md.
// 1. destination vote (nothing is held until every voter agrees), 2. pledges ("homi I'm in" -> hold),
// 3. check-in window [event - 15 min, event + 30 min], 4. settlement at close + 60 min, then a 24h dispute
// window. Pledge updates are opted-in transactional messages, so they are prompted (STATE_MACHINE.md rule 2).
// Payments are actions ('payment' -> payment_result) and SIMULATED unless a real provider is configured.

import type { Extension } from './types.js';
import { type Pledge, pledgeOf } from './commit/model.js';
import { parseCommit } from './commit/parse.js';
import { captureRef, ownRef, startPledge, voteMessage, voteReaction } from './commit/vote.js';
import { cancel, join, onPayment, status } from './commit/pledge.js';
import { checkIn, confirmByName, confirmReaction } from './commit/checkin.js';
import { callOff, finalize, settle, staleCheck } from './commit/settle.js';
import { onDisputeTimer, raise, verdict } from './commit/dispute.js';
import { dumpLines } from './commit/dump.js';

const live = (c: Pledge | undefined): c is Pledge => !!c && c.phase !== 'closed';

export const commit: Extension = {
  name: 'commit',

  onMessage(st, ev, body, addressed) {
    staleCheck(st);
    const c = pledgeOf(st);
    const addr = addressed || (!!c && ownRef(c, ev.replyTo));
    const cmd = addr ? parseCommit(body) : null;
    if (cmd) {
      switch (cmd.kind) {
        case 'start': startPledge(st, ev, cmd); return true;
        case 'cancel': cancel(st, c, ev); return true;
        case 'dispute': raise(st, c, ev); return true;
        case 'status': status(st, c); return true;
        case 'in':
          if (!c || (c.phase !== 'vote' && c.phase !== 'open')) break;
          join(st, c, ev);
          return true;
        case 'here':
        case 'done':
          if (!live(c) || c.phase === 'vote' || (c.kind === 'showup') !== (cmd.kind === 'here')) break;
          checkIn(st, c, ev);
          return true;
        case 'confirm':
          if (!c || c.kind !== 'goal' || c.phase !== 'open') break;
          confirmByName(st, c, ev, cmd.name);
          return true;
        case 'verdict':
          if (c && verdict(st, c, ev, cmd.choice, cmd.name)) return true;
          break;
      }
    }
    return c?.phase === 'vote' ? voteMessage(st, c, ev, body) : false;
  },

  onEvent(st, ev) {
    if (ev.kind === 'payment_result') {
      onPayment(st, ev);
      return true;
    }
    if (ev.kind !== 'reaction') return false;
    const c = pledgeOf(st);
    if (!c) return false;
    return voteReaction(st, c, ev) || confirmReaction(st, c, ev);
  },

  onTimer(st, ev) {
    staleCheck(st);
    const c = pledgeOf(st);
    if (!c) return;
    const name = String(ev.payload?.name ?? '');
    if (name === 'close') c.windowClosed = true;
    else if (name === 'settle') settle(st, c);
    else if (name === 'final') finalize(st, c);
    else if (name.startsWith('dispute:')) onDisputeTimer(st, c, name.slice('dispute:'.length));
  },

  onSent(st, tag, msgRef) {
    captureRef(st, tag, msgRef);
    return true;
  },

  onForget(st) {
    callOff(st);
  },

  onStop(st) {
    callOff(st);
  },

  dump(state) {
    return dumpLines(state);
  },
};
