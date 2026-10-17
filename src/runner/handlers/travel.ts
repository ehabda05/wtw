// Travel handler: lookup_travel -> TravelService -> follow-up travel_result. Labeled estimates unless a live
// provider is configured (TRAVEL_PROVIDER, docs/TRAVEL.md); the service never throws and far-future trips never
// leave the process. The query carries trip details only (no names, numbers or member keys).
import type { ActionHandler, ExtHandlerDeps } from './types.js';
import { TravelService } from '../../travel/service.js';
import { estimateTrip } from '../../travel/estimates.js';

export function createTravelHandler(deps: ExtHandlerDeps, service?: TravelService): ActionHandler {
  const svc = service ?? new TravelService({ provider: deps.travelProvider ?? 'estimates' });
  return {
    types: ['lookup_travel'],
    async run(action, ctx, out) {
      if (action.type !== 'lookup_travel') return;
      const now = ctx.now ?? deps.now();
      let result;
      try {
        result = await svc.search(action.query, now);
      } catch {
        result = estimateTrip(action.query, now);
      }
      out.followUps.push({ kind: 'travel_result', requestId: action.requestId, result });
    },
  };
}
