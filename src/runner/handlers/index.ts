// Builds the runner-side handlers for every extension. index.ts, the sim and the eval harness all call this.
import type { ActionHandler, ExtHandlerDeps, ExtHandlers } from './types.js';
import { createAlbumHandler } from './album.js';
import { createPaymentsHandler } from './payments.js';
import { createTravelHandler } from './travel.js';

export function createExtHandlers(deps: ExtHandlerDeps): ExtHandlers {
  const album = createAlbumHandler(deps);
  const handlers = [createTravelHandler(deps), createPaymentsHandler(deps), album.handler].filter(
    (h): h is ActionHandler => h !== null,
  );
  return { handlers, photoStore: album.photoStore };
}
export type { ActionHandler, ExtHandlerDeps, ExtHandlers, PhotoStore } from './types.js';
