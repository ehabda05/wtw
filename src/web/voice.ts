// The web demo's phone calls: MockVoice on the fake clock, plus an "incoming call" the browser can answer.
// A call to a persona with a scripted answer (/api/answer before the call, or the demo script's /answer line)
// is delivered 2 s later on the fake clock, so it resolves inside the fast-forward that placed it. Without a
// scripted answer the call rings until someone types what the persona says (or declines) in the browser.
// Everything here is SIMULATED: no audio, no phone network.

import { personaFromHandle } from '../channels/sim.js';
import type { FakeClock } from '../runner/clock.js';
import { MockVoice } from '../runner/mocks.js';
import type { CallRequest, CallResult, VoiceService } from '../runner/services.js';
import type { RealCallBridge } from './realcall.js';

export type CallState = 'ringing' | 'answered' | 'missed';

export interface CallView {
  id: number;
  persona: string;
  question: string;
  state: CallState;
  /** true when the answer was set before the call (the script); the browser just shows it. */
  scripted: boolean;
  answer?: string;
  at: number;
  /** A REAL phone call (WEB_REAL_CALLS): the browser shows it as live, not simulated. */
  real?: boolean;
}

export class DemoVoice implements VoiceService {
  readonly delayMs: number;
  readonly #mock: MockVoice;
  readonly #clock: FakeClock;
  readonly #scripted = new Map<string, string | null>();
  readonly #ringing = new Map<string, CallRequest>();
  readonly #views = new Map<string, CallView>();
  #seq = 0;
  current: CallView | null = null;
  /** Called on every call state change (ringing, answered, missed). */
  onCall?: (c: CallView) => void;

  readonly #real?: RealCallBridge;
  readonly #listeners: ((r: CallResult) => void | Promise<void>)[] = [];
  #pendingReal = 0;
  #realWaiters: (() => void)[] = [];

  constructor(clock: FakeClock, delayMs = 2000, real?: RealCallBridge) {
    this.#clock = clock;
    this.delayMs = delayMs;
    this.#mock = new MockVoice({ clock, delayMs });
    // Registered first, so the call view is updated before the runner handles the result.
    this.#mock.onResult((r) => this.#settled(r));
    this.#real = real;
    real?.service.onResult((r) => void this.#realDone(r));
  }

  onResult(cb: (r: CallResult) => void): void {
    this.#listeners.push(cb);
    this.#mock.onResult(cb);
  }

  /** Real calls still waiting for an answer (the scripted demo pauses on them). */
  get pendingReal(): number {
    return this.#pendingReal;
  }

  whenRealSettled(): Promise<void> {
    if (this.#pendingReal === 0) return Promise.resolve();
    return new Promise((resolve) => this.#realWaiters.push(resolve));
  }

  async #realDone(r: CallResult): Promise<void> {
    try {
      this.#settled(r);
      for (const l of this.#listeners) await Promise.resolve(l(r));
    } finally {
      this.#pendingReal = Math.max(0, this.#pendingReal - 1);
      if (this.#pendingReal === 0) for (const w of this.#realWaiters.splice(0)) w();
    }
  }

  async placeCall(req: CallRequest): Promise<void> {
    const persona = personaFromHandle(req.to) ?? 'member';
    const number = this.#real?.numbers.get(persona);
    if (this.#real && number) {
      const view: CallView = { id: ++this.#seq, persona, question: req.question, state: 'ringing', scripted: false, at: this.#clock.now(), real: true };
      this.#views.set(req.member, view);
      this.current = view;
      this.onCall?.(view);
      this.#pendingReal++;
      try {
        await this.#real.service.placeCall({ ...req, to: number });
      } catch {
        await this.#realDone({ planId: req.planId, member: req.member, ok: false, simulated: false });
      }
      return;
    }
    const scripted = this.#scripted.has(persona);
    const view: CallView = { id: ++this.#seq, persona, question: req.question, state: 'ringing', scripted, at: this.#clock.now() };
    if (scripted) {
      const a = this.#scripted.get(persona);
      if (a) view.answer = a;
    }
    this.#views.set(req.member, view);
    this.current = view;
    this.onCall?.(view);
    if (scripted) {
      this.#mock.setAnswer(req.to, this.#scripted.get(persona) ?? null);
      await this.#mock.placeCall(req);
      return;
    }
    this.#ringing.set(persona, req);
  }

  /** A call to this persona is ringing and waits for the browser. */
  isRinging(persona?: string): boolean {
    return persona ? this.#ringing.has(persona) : this.#ringing.size > 0;
  }

  /**
   * What the persona says. If their call is ringing, it is answered now (the result arrives after delayMs on the
   * fake clock; the caller advances it). Otherwise it is remembered for the next call. null = does not pick up.
   */
  async answer(persona: string, text: string | null): Promise<boolean> {
    const req = this.#ringing.get(persona);
    if (!req) {
      this.#scripted.set(persona, text);
      return false;
    }
    this.#ringing.delete(persona);
    const view = this.#views.get(req.member);
    if (view && text) view.answer = text;
    this.#mock.setAnswer(req.to, text);
    await this.#mock.placeCall(req);
    return true;
  }

  #settled(r: CallResult): void {
    const view = this.#views.get(r.member);
    if (!view) return;
    this.#views.delete(r.member);
    view.state = r.ok ? 'answered' : 'missed';
    if (r.ok && r.answerText) view.answer = r.answerText;
    if (!r.ok) delete view.answer;
    this.onCall?.(view);
  }
}
