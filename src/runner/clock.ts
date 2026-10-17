// System clock and a fast-forwardable fake clock (sim `/ff 12h`, tests).
// FakeClock.advance() walks time forward in order: it stops at every due timer and every due job reported by
// attached tickers (the scheduler), so ctx.now equals the job's due time when it fires.

export interface TimerHandle {
  cancel(): void;
}

export interface Clock {
  now(): number;
  /** Clock-aware timer: real setTimeout on SystemClock, virtual on FakeClock. */
  setTimeout(fn: () => void | Promise<void>, ms: number): TimerHandle;
}

/** Something the fake clock drives as time moves (the scheduler). */
export interface Tickable {
  tick(): Promise<void>;
  nextDueAt?(): number | undefined;
}

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
  setTimeout(fn: () => void | Promise<void>, ms: number): TimerHandle {
    const h = setTimeout(() => {
      void Promise.resolve()
        .then(fn)
        .catch(() => undefined);
    }, ms);
    h.unref?.();
    return { cancel: () => clearTimeout(h) };
  }
}

/**
 * Live-demo clock (DEMO_MODE=true only): real time plus an offset that `otto demo ff 22h` moves forward, so a
 * 24-hour nudge can be shown in a 2-minute demo. The chat is always told when this happens.
 */
export class OffsetClock extends SystemClock {
  #offset = 0;
  override now(): number {
    return Date.now() + this.#offset;
  }
  shift(ms: number): void {
    if (ms > 0) this.#offset += ms;
  }
  get offsetMs(): number {
    return this.#offset;
  }
}

interface FakeTimer {
  at: number;
  seq: number;
  fn: () => void | Promise<void>;
  cancelled: boolean;
}

export class FakeClock implements Clock {
  #t: number;
  #seq = 0;
  #timers: FakeTimer[] = [];
  #tickers = new Set<Tickable>();

  constructor(start: number = Date.now()) {
    this.#t = start;
  }

  now(): number {
    return this.#t;
  }

  /** Jump without firing anything (setup only). */
  set(t: number): void {
    this.#t = t;
  }

  setTimeout(fn: () => void | Promise<void>, ms: number): TimerHandle {
    const timer: FakeTimer = { at: this.#t + Math.max(0, ms), seq: ++this.#seq, fn, cancelled: false };
    this.#timers.push(timer);
    return { cancel: () => (timer.cancelled = true) };
  }

  attach(t: Tickable): void {
    this.#tickers.add(t);
  }

  detach(t: Tickable): void {
    this.#tickers.delete(t);
  }

  pendingTimers(): number {
    return this.#timers.filter((t) => !t.cancelled).length;
  }

  #nextTimerAt(): number | undefined {
    let min: number | undefined;
    for (const t of this.#timers) if (!t.cancelled && (min === undefined || t.at < min)) min = t.at;
    return min;
  }

  #nextJobAt(): number | undefined {
    let min: number | undefined;
    for (const t of this.#tickers) {
      const d = t.nextDueAt?.();
      if (d !== undefined && (min === undefined || d < min)) min = d;
    }
    return min;
  }

  async #fireTimersUpTo(t: number): Promise<number> {
    let fired = 0;
    for (;;) {
      const due = this.#timers.filter((x) => !x.cancelled && x.at <= t).sort((a, b) => a.at - b.at || a.seq - b.seq)[0];
      if (!due) break;
      due.cancelled = true;
      fired++;
      try {
        await due.fn();
      } catch {
        /* timer callbacks own their errors */
      }
    }
    this.#timers = this.#timers.filter((x) => !x.cancelled);
    return fired;
  }

  async #tickAll(): Promise<void> {
    for (const t of [...this.#tickers]) await t.tick();
  }

  /** Move time forward by ms, firing timers and ticking the scheduler at each due point in order. */
  async advance(ms: number): Promise<void> {
    await this.advanceTo(this.#t + Math.max(0, ms));
  }

  async advanceTo(target: number): Promise<void> {
    let stuck = 0;
    let lastNext: number | undefined;
    for (let guard = 0; guard < 100_000; guard++) {
      const a = this.#nextTimerAt();
      const b = this.#nextJobAt();
      const next = a === undefined ? b : b === undefined ? a : Math.min(a, b);
      if (next === undefined || next > target) break;
      if (next > this.#t) this.#t = next;
      const fired = await this.#fireTimersUpTo(this.#t);
      await this.#tickAll();
      // Guard against a ticker that cannot make progress (e.g. a job that never leaves 'pending').
      if (fired === 0 && lastNext !== undefined && next <= lastNext) {
        if (++stuck >= 3) break;
      } else {
        stuck = 0;
      }
      lastNext = next;
    }
    if (target > this.#t) this.#t = target;
    await this.#fireTimersUpTo(this.#t);
    await this.#tickAll();
  }
}

export function isFakeClock(c: Clock): c is FakeClock {
  return c instanceof FakeClock;
}

/** Parse "90s", "15m", "12h", "2d", "1h30m" into milliseconds. */
export function parseDuration(s: string): number {
  const re = /(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w)/gi;
  const unit: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };
  let total = 0;
  let matched = '';
  for (const m of s.matchAll(re)) {
    total += Number(m[1]) * unit[m[2].toLowerCase()];
    matched += m[0];
  }
  if (!matched || matched.replace(/\s+/g, '').length !== s.replace(/\s+/g, '').length) {
    throw new Error(`bad duration "${s}" (try 30m, 12h, 2d)`);
  }
  return Math.round(total);
}
