// Local stand-ins for the places and voice services: used by tests, by the sim, and as boot fallbacks when the
// real modules fail to load. The mock call is always labeled simulated (docs/ARCHITECTURE.md "Voice path").

import type { PlaceOption, PlacesQuery } from '../engine/types.js';
import type { Clock } from './clock.js';
import type { CallRequest, CallResult, PlacesService, VoiceService } from './services.js';

// ───────────── places ─────────────

/** Returns no options (the engine then asks the group to name a place). */
export function createStubPlaces(fixed: PlaceOption[] = []): PlacesService & { queries: PlacesQuery[] } {
  const queries: PlacesQuery[] = [];
  return {
    queries,
    async search(query: PlacesQuery) {
      queries.push(query);
      return { options: fixed.map((o) => ({ ...o })), source: 'stub' };
    },
    async weather() {
      return null;
    },
  };
}

/** Three canned Harvard Square options so the offline sim never dead-ends if src/places is unavailable. */
export function cannedPlaceOptions(): PlaceOption[] {
  return [
    { id: 1, name: 'Tasty Thai', cuisine: 'thai', priceBand: 2, priceEstimated: true, source: 'fallback', walkMinutes: 4, openAtPlanTime: null, why: 'canned demo option' },
    { id: 2, name: 'Noodle Corner', cuisine: 'noodles', priceBand: 1, priceEstimated: true, source: 'fallback', walkMinutes: 6, openAtPlanTime: null, why: 'canned demo option' },
    { id: 3, name: 'Green Garden', cuisine: 'vegetarian', priceBand: 2, priceEstimated: true, diet: ['vegetarian', 'vegan'], source: 'fallback', walkMinutes: 7, openAtPlanTime: null, why: 'canned demo option' },
  ];
}

// ───────────── voice ─────────────

export interface MockVoiceOptions {
  /** Delay before the simulated answer arrives (default 2000 ms). */
  delayMs?: number;
  /** Use this clock's timers (FakeClock-aware). Default: real setTimeout. */
  clock?: Clock;
  /** Answer used when no scripted answer exists for the callee. */
  defaultAnswer?: string;
}

export interface MockCallRecord {
  question: string;
  options: string[];
  callRef: string;
  planId: string;
  member: string;
  /** Callee handle, kept in memory only so the sim can say who was called. */
  to: string;
}

export class MockVoice implements VoiceService {
  readonly calls: MockCallRecord[] = [];
  readonly #answers = new Map<string, string | null>();
  readonly #listeners: ((r: CallResult) => void)[] = [];
  readonly #delayMs: number;
  readonly #clock?: Clock;
  readonly #defaultAnswer: string;
  #pending = 0;
  #waiters: (() => void)[] = [];
  /** Optional hook (the sim prints the call). */
  onPlace?: (rec: MockCallRecord) => void;

  constructor(opts: MockVoiceOptions = {}) {
    this.#delayMs = opts.delayMs ?? 2000;
    this.#clock = opts.clock;
    this.#defaultAnswer = opts.defaultAnswer ?? 'yes, that works for me';
  }

  /** Script what the callee "says". Key is the raw handle (sim: "persona:sam") or "*" for everyone; null = no answer. */
  setAnswer(to: string, answer: string | null): void {
    this.#answers.set(to, answer);
  }

  onResult(cb: (r: CallResult) => void): void {
    this.#listeners.push(cb);
  }

  async placeCall(req: CallRequest): Promise<void> {
    const rec: MockCallRecord = {
      question: req.question,
      options: [...req.options],
      callRef: req.callRef,
      planId: req.planId,
      member: req.member,
      to: req.to,
    };
    this.calls.push(rec);
    this.onPlace?.(rec);
    this.#pending++;
    const deliver = async () => {
      try {
        const scripted = this.#answers.has(req.to) ? this.#answers.get(req.to) : this.#answers.get('*');
        const answer = scripted === undefined ? this.#defaultAnswer : scripted;
        const result: CallResult =
          answer === null
            ? { planId: req.planId, member: req.member, ok: false, simulated: true }
            : { planId: req.planId, member: req.member, answerText: answer, ok: true, simulated: true };
        for (const l of this.#listeners) await Promise.resolve(l(result));
      } finally {
        this.#pending--;
        if (this.#pending === 0) for (const w of this.#waiters.splice(0)) w();
      }
    };
    if (this.#clock) this.#clock.setTimeout(deliver, this.#delayMs);
    else setTimeout(() => void deliver(), this.#delayMs);
  }

  pending(): number {
    return this.#pending;
  }

  /** Resolves when every placed call has delivered its result. */
  settled(): Promise<void> {
    if (this.#pending === 0) return Promise.resolve();
    return new Promise((r) => this.#waiters.push(r));
  }
}

export function createMockVoice(opts: MockVoiceOptions = {}): MockVoice {
  return new MockVoice(opts);
}
