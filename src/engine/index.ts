// Public API of the pure engine. Runner, sim and eval import only from here.

export { applyEvent } from './plan/apply.js';
export { newGroupState } from './plan/core.js';
export { detectAddressed, stripAddress, parseAvailability, parseCommand, parseWindow, emojiVote, cityZone, placeIn, preferredTime } from './parse.js';
export { classify, type Classification, type ClassifyOpts, type Intent } from './classify.js';
export { generateOptions, chooseOption, computeDeadline, effectiveVote, tallyLine } from './schedule.js';
export { rankPlaces, foodScore, parseTaste, placesQuery, nearOf } from './hungry.js';
export { pFood, predict, FOOD_THRESHOLD } from './classifier.js';
export { gateUnprompted, nudgeTime, BUDGET_MS } from './nudge.js';
export { dump } from './dump.js';
export { ics, icsText } from './ics.js';
export { TEMPLATES, TEMPLATE_SAMPLES, countSentences } from './templates.js';
export type { EnginePlan, EngineHungry, ParsedAvailability, Command, WindowSpec } from './model.js';
export type * from './types.js';
