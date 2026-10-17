// Runner-side extension hooks: each feature (travel, payments, album) executes its own actions here, so the
// core executor never has to change again. Handlers push follow-up engine events into `out.followUps`.

import type { Action } from '../../engine/types.js';
import type { ExecContext, ExecOutcome } from '../executor.js';

export interface ActionHandler {
  /** Action types this handler executes. */
  types: Action['type'][];
  run(action: Action, ctx: ExecContext, out: ExecOutcome): Promise<void>;
}

/** Stores inbound photo bytes before the engine sees the event; returns an opaque id (never a user filename). */
export interface PhotoStore {
  put(bytes: Uint8Array, mime: string): Promise<string>;
}

export interface ExtHandlerDeps {
  /** Directory for persistent extension data (album photos). */
  dataDir: string;
  /** Public base URL for member-only links (album page). */
  publicBaseUrl?: string;
  /** 'simulated' (default) or a real provider id once configured (docs/COMMITMENTS.md). */
  paymentsProvider?: string;
  /** Travel provider: 'estimates' (default) or a real provider id once configured (docs/TRAVEL.md). */
  travelProvider?: string;
  now: () => number;
  /** DATA_KEY (32 bytes): the album encrypts every photo with it; without it the album store stays off. */
  dataKey?: Buffer;
}

export interface ExtHandlers {
  handlers: ActionHandler[];
  photoStore?: PhotoStore;
}
