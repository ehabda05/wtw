// Trip planning (docs/TRAVEL.md, DEMO Act 5). Group-level state in state.space.ext.travel; the runner turns
// lookup_travel into travel_result (labeled estimates unless a live provider is configured).
import type { Extension } from './types.js';
import { onTravelEvent, onTravelMessage } from './travel/flow.js';
import { setTrip, tripOf } from './travel/state.js';
import { dumpLine } from './travel/render.js';

export const travel: Extension = {
  name: 'travel',
  onMessage: (st, ev, body, addressed) => onTravelMessage(st, ev, body, addressed),
  onEvent: (st, ev) => onTravelEvent(st, ev),
  onStop: (st) => setTrip(st, undefined),
  dump: (state) => {
    const trip = tripOf(state);
    return trip ? [dumpLine(trip)] : [];
  },
};
