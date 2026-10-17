// Extension contract: bills, travel, commitments and the shared album plug into the state machine through these
// hooks, so each feature lives in its own module (src/engine/ext/<name>.ts) and never edits the core files.
// Same rules as the core: pure (no I/O, time from ctx.now, ids from ctx.newId), no message text in state except
// data members explicitly hand to Homi (amounts, item names, trip details), every chat message <= 2 sentences
// (structured "card" lines are fragments and are allowed after a <= 2-sentence header).

import type { EngineEvent, ExtName, GroupState, MessageEvent } from '../types.js';
import type { Step } from '../plan/core.js';

export type TimerEvent = Extract<EngineEvent, { kind: 'timer' }>;

export interface Extension {
  name: ExtName;
  /**
   * Every message, BEFORE the built-in commands and state handlers (after the intro and head-counting).
   * `body` is the text with the "homi" address stripped. Return true when the message was handled.
   * Unaddressed messages must stay silent unless the extension has an open flow that is waiting for answers.
   */
  onMessage?(st: Step, ev: MessageEvent, body: string, addressed: boolean): boolean;
  /** Non-message events: photo, travel_result, payment_result, reactions on the extension's own bubbles. Return true when handled. */
  onEvent?(st: Step, ev: EngineEvent): boolean;
  /** Timer jobs with job 'ext' and payload.ext === name. Schedule them with scheduleExt() from ./util.js. */
  onTimer?(st: Step, ev: TimerEvent): void;
  /** Runner-reported ids of the extension's tagged sends (tags must start with `${name}:`). Return true when consumed. */
  onSent?(st: Step, tag: string, msgRef: string): boolean;
  /** Called by `homi forget` BEFORE the plan is deleted (e.g. refund open deposits). */
  onForget?(st: Step): void;
  /** Called by `homi stop` BEFORE everything is deleted (e.g. refund deposits, delete album photos). */
  onStop?(st: Step): void;
  /** Lines for "homi what do you know" (complete, human readable, no ids). */
  dump?(state: GroupState, now: number): string[];
}
