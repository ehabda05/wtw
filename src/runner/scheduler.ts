// Persisted jobs, at-most-once (docs/ARCHITECTURE.md "Exactly-once-ish"):
//   1. claim (pending -> firing, atomic)  2. timer event through the group's mutex  3. mark done.
// A crash between 1 and 3 leaves the job 'firing'; at startup those older than 2 minutes become 'failed' and are
// never re-sent. Also runs the retention sweep at start and every 10 minutes.

import type { EngineEvent } from '../engine/types.js';
import { silentLogger, type Logger } from '../privacy/logger.js';
import type { Retention } from '../privacy/retention.js';
import type { JobRow, Repo } from '../store/repo.js';
import { isFakeClock, type Clock, type Tickable } from './clock.js';

export interface TimerDispatcher {
  dispatch(spaceKey: string, event: EngineEvent): Promise<boolean>;
}

export interface SchedulerDeps {
  repo: Repo;
  runner: TimerDispatcher;
  clock: Clock;
  retention?: Retention;
  logger?: Logger;
  /** Real-time polling interval (SystemClock only). Default 1000 ms. */
  tickMs?: number;
  /** Retention sweep interval. Default 10 minutes. */
  sweepEveryMs?: number;
}

export class Scheduler implements Tickable {
  readonly #repo: Repo;
  readonly #runner: TimerDispatcher;
  readonly #clock: Clock;
  readonly #retention?: Retention;
  readonly #log: Logger;
  readonly #tickMs: number;
  readonly #sweepEveryMs: number;
  #interval?: ReturnType<typeof setInterval>;
  #running = false;
  #lastSweep = -Infinity;
  #started = false;

  constructor(deps: SchedulerDeps) {
    this.#repo = deps.repo;
    this.#runner = deps.runner;
    this.#clock = deps.clock;
    this.#retention = deps.retention;
    this.#log = deps.logger ?? silentLogger;
    this.#tickMs = deps.tickMs ?? 1000;
    this.#sweepEveryMs = deps.sweepEveryMs ?? 10 * 60_000;
  }

  /** Recover stale jobs, sweep once, then start ticking (real interval, or driven by a FakeClock). */
  start(): void {
    if (this.#started) return;
    this.#started = true;
    const now = this.#clock.now();
    const stale = this.#repo.jobs.recoverStale(now);
    if (stale > 0) this.#log.warn('scheduler: stale firing jobs marked failed (not re-sent)', { count: stale });
    this.#sweep(now);
    if (isFakeClock(this.#clock)) {
      this.#clock.attach(this);
    } else {
      this.#interval = setInterval(() => void this.tick(), this.#tickMs);
      this.#interval.unref?.();
    }
  }

  stop(): void {
    if (this.#interval) clearInterval(this.#interval);
    this.#interval = undefined;
    if (isFakeClock(this.#clock)) this.#clock.detach(this);
    this.#started = false;
  }

  nextDueAt(): number | undefined {
    return this.#repo.jobs.nextDueAt();
  }

  #sweep(now: number): void {
    if (!this.#retention) return;
    try {
      this.#retention.sweep(now);
    } catch (err) {
      this.#log.error('scheduler: retention sweep failed', { err });
    }
    this.#lastSweep = now;
  }

  async #fire(job: JobRow): Promise<void> {
    const spaceKey = this.#repo.spaceForPlan(job.planId);
    if (!spaceKey) {
      this.#repo.jobs.markFailed(job);
      this.#log.debug('scheduler: job for missing plan marked failed', { kind: job.kind });
      return;
    }
    const ev: EngineEvent = { kind: 'timer', job: job.kind, planId: job.planId };
    if (job.payload) ev.payload = job.payload;
    try {
      await this.#runner.dispatch(spaceKey, ev);
      this.#repo.jobs.markDone(job);
    } catch (err) {
      this.#repo.jobs.markFailed(job);
      this.#log.error('scheduler: job failed (not retried)', { kind: job.kind, err });
    }
  }

  /** Claim and fire every due job once. Overlapping ticks are skipped. */
  async tick(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    try {
      const now = this.#clock.now();
      for (let round = 0; round < 50; round++) {
        const due = this.#repo.jobs.claimDue(this.#clock.now());
        if (due.length === 0) break;
        for (const job of due) await this.#fire(job);
      }
      if (now - this.#lastSweep >= this.#sweepEveryMs) this.#sweep(now);
    } catch (err) {
      this.#log.error('scheduler: tick failed', { err });
    } finally {
      this.#running = false;
    }
  }
}
