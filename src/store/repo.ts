// Repository: GroupState <-> sealed rows, jobs (at-most-once), delivery (sealed handles), seen (dedupe).
// Plaintext columns are routing / retention metadata only. See schema.sql.

import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { GroupState, JobKind, Plan, PlanState, SpaceKey, SpaceSettings, Surface } from '../engine/types.js';
import type { Sealer } from '../privacy/crypto.js';
import { silentLogger, type Logger } from '../privacy/logger.js';
import { transaction } from './db.js';

export interface Routing {
  surface: Surface;
  /** Raw platform chat id (sealed at rest). */
  spaceId: string;
}

export type JobStatus = 'pending' | 'firing' | 'done' | 'failed';

export interface JobRow {
  jobKey: string;
  planId: string;
  kind: JobKind;
  dueAt: number;
  status: JobStatus;
  payload?: Record<string, unknown>;
  claimedAt?: number;
}

export interface JobInput {
  key: string;
  planId: string;
  kind: JobKind;
  dueAt: number;
  payload?: Record<string, unknown>;
}

export type TableCounts = Record<'spaces' | 'plans' | 'delivery' | 'jobs' | 'seen', number>;

interface SettingsBlob {
  v: 1;
  space: SpaceSettings;
  lastUnpromptedAt?: number;
  planId: string | null;
}

export const STALE_FIRING_MS = 2 * 60_000;
export const SEEN_TTL_MS = 24 * 3_600_000;

export function platformOf(surface: Surface): string {
  switch (surface) {
    case 'imessage-shared':
    case 'imessage-dedicated':
      return 'imessage';
    case 'imessage-local':
      return 'local_imessage';
    default:
      return surface;
  }
}

const aad = {
  settings: (k: string) => `spaces:${k}`,
  route: (k: string) => `route:${k}`,
  plan: (id: string) => `plans:${id}`,
  delivery: (m: string, p: string) => `delivery:${m}:${p}`,
  job: (k: string) => `jobs:${k}`,
};

export interface RepoOptions {
  now?: () => number;
  logger?: Logger;
}

export class Repo {
  readonly db: DatabaseSync;
  readonly #sealer: Sealer;
  readonly #now: () => number;
  readonly #log: Logger;

  readonly jobs: JobsRepo;
  readonly delivery: DeliveryRepo;
  readonly seen: SeenRepo;

  constructor(db: DatabaseSync, sealer: Sealer, opts: RepoOptions = {}) {
    this.db = db;
    this.#sealer = sealer;
    this.#now = opts.now ?? Date.now;
    this.#log = opts.logger ?? silentLogger;
    this.jobs = new JobsRepo(db, sealer, this.#log);
    this.delivery = new DeliveryRepo(db, sealer);
    this.seen = new SeenRepo(db);
  }

  tx<T>(fn: () => T): T {
    return transaction(this.db, fn);
  }

  // ───────────── spaces / groups ─────────────

  hasSpace(spaceKey: SpaceKey): boolean {
    return !!this.db.prepare('SELECT 1 AS x FROM spaces WHERE space_key = ?').get(spaceKey);
  }

  isMuted(spaceKey: SpaceKey): boolean {
    const row = this.db.prepare('SELECT muted FROM spaces WHERE space_key = ?').get(spaceKey) as { muted: number } | undefined;
    return row?.muted === 1;
  }

  loadGroup(spaceKey: SpaceKey): GroupState | null {
    const row = this.db.prepare('SELECT settings_blob, muted FROM spaces WHERE space_key = ?').get(spaceKey) as
      | { settings_blob: Uint8Array | null; muted: number }
      | undefined;
    if (!row || !row.settings_blob) return null;
    let settings: SettingsBlob;
    try {
      settings = this.#sealer.openJson<SettingsBlob>(row.settings_blob, aad.settings(spaceKey));
    } catch (err) {
      this.#log.warn('repo: settings blob could not be opened; treating space as new', { err });
      return null;
    }
    let plan: Plan | null = null;
    if (settings.planId) {
      const p = this.db.prepare('SELECT blob FROM plans WHERE plan_id = ? AND space_key = ?').get(settings.planId, spaceKey) as
        | { blob: Uint8Array }
        | undefined;
      if (p) {
        try {
          plan = this.#sealer.openJson<Plan>(p.blob, aad.plan(settings.planId));
        } catch (err) {
          this.#log.warn('repo: plan blob could not be opened; dropping plan', { err });
          plan = null;
        }
      }
    }
    const space: SpaceSettings = { ...settings.space, spaceKey, muted: row.muted === 1 || settings.space.muted };
    const state: GroupState = { space, plan };
    if (settings.lastUnpromptedAt !== undefined) state.lastUnpromptedAt = settings.lastUnpromptedAt;
    return state;
  }

  /**
   * Persist a group. The plan is stored only while it is live (state !== 'purged').
   * Any other plan row of this space is unreachable from GroupState and is deleted with its delivery + jobs.
   */
  saveGroup(state: GroupState, routing: Routing): void {
    const spaceKey = state.space.spaceKey;
    const plan = state.plan && state.plan.state !== 'purged' ? state.plan : null;
    const now = this.#now();
    this.tx(() => {
      const settings: SettingsBlob = {
        v: 1,
        space: state.space,
        lastUnpromptedAt: state.lastUnpromptedAt,
        planId: plan?.id ?? null,
      };
      const settingsBlob = this.#sealer.sealJson(settings, aad.settings(spaceKey));
      const routeBlob = this.#sealer.sealString(routing.spaceId, aad.route(spaceKey));
      this.db
        .prepare(
          `INSERT INTO spaces (space_key, platform, surface, settings_blob, space_id_sealed, muted, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(space_key) DO UPDATE SET platform = excluded.platform, surface = excluded.surface,
             settings_blob = excluded.settings_blob, space_id_sealed = excluded.space_id_sealed,
             muted = excluded.muted, updated_at = excluded.updated_at`,
        )
        .run(spaceKey, platformOf(routing.surface), routing.surface, settingsBlob, routeBlob, state.space.muted ? 1 : 0, now);

      if (plan) {
        const blob = this.#sealer.sealJson(plan, aad.plan(plan.id));
        this.db
          .prepare(
            `INSERT INTO plans (plan_id, space_key, state, event_at, purge_at, blob) VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(plan_id) DO UPDATE SET state = excluded.state, event_at = excluded.event_at,
               purge_at = excluded.purge_at, blob = excluded.blob
             WHERE plans.space_key = excluded.space_key`,
          )
          .run(plan.id, spaceKey, plan.state as PlanState, plan.eventAt ?? null, plan.purgeAt ?? null, blob);
      }

      const others = this.db.prepare('SELECT plan_id FROM plans WHERE space_key = ?').all(spaceKey) as { plan_id: string }[];
      for (const o of others) if (!plan || o.plan_id !== plan.id) this.#deletePlanRows(o.plan_id);
    });
  }

  getRouting(spaceKey: SpaceKey): Routing | null {
    const row = this.db.prepare('SELECT surface, space_id_sealed FROM spaces WHERE space_key = ?').get(spaceKey) as
      | { surface: Surface; space_id_sealed: Uint8Array | null }
      | undefined;
    if (!row || !row.space_id_sealed) return null;
    try {
      return { surface: row.surface, spaceId: this.#sealer.openString(row.space_id_sealed, aad.route(spaceKey)) };
    } catch (err) {
      this.#log.warn('repo: routing blob could not be opened', { err });
      return null;
    }
  }

  spaceForPlan(planId: string): SpaceKey | null {
    const row = this.db.prepare('SELECT space_key FROM plans WHERE plan_id = ?').get(planId) as { space_key: string } | undefined;
    return row?.space_key ?? null;
  }

  #deletePlanRows(planId: string): void {
    this.db.prepare('DELETE FROM delivery WHERE plan_id = ?').run(planId);
    this.db.prepare('DELETE FROM jobs WHERE plan_id = ?').run(planId);
    this.db.prepare('DELETE FROM plans WHERE plan_id = ?').run(planId);
  }

  /** Delete a plan with its delivery lookup and scheduled jobs (one transaction). */
  deletePlan(planId: string): void {
    this.tx(() => this.#deletePlanRows(planId));
  }

  /** Delete every row for a space (after Homi left). */
  deleteSpace(spaceKey: SpaceKey): void {
    this.tx(() => {
      const plans = this.db.prepare('SELECT plan_id FROM plans WHERE space_key = ?').all(spaceKey) as { plan_id: string }[];
      for (const p of plans) this.#deletePlanRows(p.plan_id);
      this.db.prepare('DELETE FROM spaces WHERE space_key = ?').run(spaceKey);
    });
  }

  /**
   * Tombstone: purge everything for the space and keep only the hashed key + muted flag (PRIVACY.md §1).
   */
  tombstone(spaceKey: SpaceKey, surface: Surface): void {
    const now = this.#now();
    this.tx(() => {
      const plans = this.db.prepare('SELECT plan_id FROM plans WHERE space_key = ?').all(spaceKey) as { plan_id: string }[];
      for (const p of plans) this.#deletePlanRows(p.plan_id);
      this.db
        .prepare(
          `INSERT INTO spaces (space_key, platform, surface, settings_blob, space_id_sealed, muted, updated_at)
           VALUES (?, ?, ?, NULL, NULL, 1, ?)
           ON CONFLICT(space_key) DO UPDATE SET settings_blob = NULL, space_id_sealed = NULL, muted = 1, updated_at = excluded.updated_at`,
        )
        .run(spaceKey, platformOf(surface), surface, now);
    });
  }

  // ───────────── retention ─────────────

  /** Purge plans whose purge_at has passed, plus orphaned delivery / jobs rows. Returns rows deleted per table. */
  purgeExpired(now: number): { plans: number; delivery: number; jobs: number } {
    return this.tx(() => {
      const expired = this.db.prepare('SELECT plan_id FROM plans WHERE purge_at IS NOT NULL AND purge_at <= ?').all(now) as {
        plan_id: string;
      }[];
      let delivery = 0;
      let jobs = 0;
      for (const p of expired) {
        delivery += Number(this.db.prepare('DELETE FROM delivery WHERE plan_id = ?').run(p.plan_id).changes);
        jobs += Number(this.db.prepare('DELETE FROM jobs WHERE plan_id = ?').run(p.plan_id).changes);
        this.db.prepare('DELETE FROM plans WHERE plan_id = ?').run(p.plan_id);
      }
      delivery += Number(this.db.prepare('DELETE FROM delivery WHERE plan_id NOT IN (SELECT plan_id FROM plans)').run().changes);
      // A job can outlive nothing: orphans and finished jobs older than the dedupe TTL go too.
      jobs += Number(
        this.db
          .prepare(
            `DELETE FROM jobs WHERE plan_id NOT IN (SELECT plan_id FROM plans)
               OR (status IN ('done', 'failed') AND due_at <= ?)`,
          )
          .run(now - SEEN_TTL_MS).changes,
      );
      return { plans: expired.length, delivery, jobs };
    });
  }

  vacuum(): void {
    this.db.exec('VACUUM');
    try {
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch {
      /* not in WAL mode (memory db) */
    }
  }

  counts(): TableCounts {
    const c = (t: string) => Number((this.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n);
    return { spaces: c('spaces'), plans: c('plans'), delivery: c('delivery'), jobs: c('jobs'), seen: c('seen') };
  }
}

// ───────────── jobs ─────────────

interface JobDbRow {
  job_key: string;
  plan_id: string;
  kind: JobKind;
  due_at: number;
  status: JobStatus;
  payload: Uint8Array | null;
  claimed_at: number | null;
}

export class JobsRepo {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sealer: Sealer,
    private readonly log: Logger,
  ) {}

  #row(r: JobDbRow): JobRow {
    const out: JobRow = { jobKey: r.job_key, planId: r.plan_id, kind: r.kind, dueAt: Number(r.due_at), status: r.status };
    if (r.payload) {
      try {
        out.payload = this.sealer.openJson<Record<string, unknown>>(r.payload, aad.job(r.job_key));
      } catch (err) {
        this.log.warn('jobs: payload could not be opened', { err });
      }
    }
    if (r.claimed_at !== null && r.claimed_at !== undefined) out.claimedAt = Number(r.claimed_at);
    return out;
  }

  /** Insert or replace by job_key: rescheduling the same key replaces it (resets to pending). */
  upsert(job: JobInput): void {
    const payload = job.payload === undefined ? null : this.sealer.sealJson(job.payload, aad.job(job.key));
    this.db
      .prepare(
        `INSERT INTO jobs (job_key, plan_id, kind, due_at, status, payload, claimed_at) VALUES (?, ?, ?, ?, 'pending', ?, NULL)
         ON CONFLICT(job_key) DO UPDATE SET plan_id = excluded.plan_id, kind = excluded.kind, due_at = excluded.due_at,
           status = 'pending', payload = excluded.payload, claimed_at = NULL`,
      )
      .run(job.key, job.planId, job.kind, job.dueAt, payload);
  }

  /** Cancel (delete) pending jobs whose key starts with prefix. Firing jobs are left to finish. */
  cancelByPrefix(prefix: string): number {
    if (!prefix) return 0;
    return Number(
      this.db
        .prepare("DELETE FROM jobs WHERE status = 'pending' AND substr(job_key, 1, ?) = ?")
        .run(prefix.length, prefix).changes,
    );
  }

  /** Atomically move due pending jobs to firing and return them (oldest first). */
  claimDue(now: number, limit = 100): JobRow[] {
    const rows = this.db
      .prepare(
        `UPDATE jobs SET status = 'firing', claimed_at = ?
         WHERE status = 'pending' AND job_key IN (
           SELECT job_key FROM jobs WHERE status = 'pending' AND due_at <= ? ORDER BY due_at, job_key LIMIT ?)
         RETURNING job_key, plan_id, kind, due_at, status, payload, claimed_at`,
      )
      .all(now, now, limit) as unknown as JobDbRow[];
    return rows.map((r) => this.#row(r)).sort((a, b) => a.dueAt - b.dueAt || a.jobKey.localeCompare(b.jobKey));
  }

  #finish(job: Pick<JobRow, 'jobKey' | 'claimedAt'>, status: 'done' | 'failed'): boolean {
    const args: SQLInputValue[] = [status, job.jobKey];
    let sql = `UPDATE jobs SET status = ? WHERE job_key = ? AND status = 'firing'`;
    if (job.claimedAt !== undefined) {
      sql += ' AND claimed_at = ?';
      args.push(job.claimedAt);
    }
    return Number(this.db.prepare(sql).run(...args).changes) === 1;
  }

  markDone(job: Pick<JobRow, 'jobKey' | 'claimedAt'>): boolean {
    return this.#finish(job, 'done');
  }

  markFailed(job: Pick<JobRow, 'jobKey' | 'claimedAt'>): boolean {
    return this.#finish(job, 'failed');
  }

  /** Jobs stuck in 'firing' (crash between claim and done) become 'failed'. They are never re-fired. */
  recoverStale(now: number, staleMs = STALE_FIRING_MS): number {
    return Number(
      this.db
        .prepare(`UPDATE jobs SET status = 'failed' WHERE status = 'firing' AND (claimed_at IS NULL OR claimed_at <= ?)`)
        .run(now - staleMs).changes,
    );
  }

  nextDueAt(): number | undefined {
    const row = this.db.prepare("SELECT MIN(due_at) AS d FROM jobs WHERE status = 'pending'").get() as { d: number | null };
    return row.d === null ? undefined : Number(row.d);
  }

  get(jobKey: string): JobRow | undefined {
    const r = this.db.prepare('SELECT * FROM jobs WHERE job_key = ?').get(jobKey) as JobDbRow | undefined;
    return r ? this.#row(r) : undefined;
  }

  list(): JobRow[] {
    return (this.db.prepare('SELECT * FROM jobs ORDER BY due_at, job_key').all() as unknown as JobDbRow[]).map((r) => this.#row(r));
  }
}

// ───────────── delivery ─────────────

export class DeliveryRepo {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sealer: Sealer,
  ) {}

  put(memberKey: string, planId: string, handle: string): void {
    const sealed = this.sealer.sealString(handle, aad.delivery(memberKey, planId));
    this.db
      .prepare(
        `INSERT INTO delivery (member_key, plan_id, handle_sealed) VALUES (?, ?, ?)
         ON CONFLICT(member_key, plan_id) DO UPDATE SET handle_sealed = excluded.handle_sealed`,
      )
      .run(memberKey, planId, sealed);
  }

  get(memberKey: string, planId: string): string | undefined {
    const row = this.db.prepare('SELECT handle_sealed FROM delivery WHERE member_key = ? AND plan_id = ?').get(memberKey, planId) as
      | { handle_sealed: Uint8Array }
      | undefined;
    if (!row) return undefined;
    try {
      return this.sealer.openString(row.handle_sealed, aad.delivery(memberKey, planId));
    } catch {
      return undefined;
    }
  }

  deleteByPlan(planId: string): number {
    return Number(this.db.prepare('DELETE FROM delivery WHERE plan_id = ?').run(planId).changes);
  }

  /**
   * Reverse lookup for inbound calls: decrypts each (small, opt-in only) delivery row in memory and compares
   * normalized handles. Nothing is indexed by phone number at rest.
   */
  findByHandle(handle: string): { memberKey: string; planId: string }[] {
    const norm = (h: string) => (/^[+\d\s().-]+$/.test(h) ? h.replace(/[^\d+]/g, '') : h.trim().toLowerCase());
    const want = norm(handle);
    const rows = this.db.prepare('SELECT member_key, plan_id, handle_sealed FROM delivery').all() as {
      member_key: string;
      plan_id: string;
      handle_sealed: Uint8Array;
    }[];
    const out: { memberKey: string; planId: string }[] = [];
    for (const r of rows) {
      try {
        if (norm(this.sealer.openString(r.handle_sealed, aad.delivery(r.member_key, r.plan_id))) === want) {
          out.push({ memberKey: r.member_key, planId: r.plan_id });
        }
      } catch {
        /* unreadable row: skip */
      }
    }
    return out;
  }
}

// ───────────── seen (inbound dedupe) ─────────────

export class SeenRepo {
  constructor(private readonly db: DatabaseSync) {}

  /** Returns true if the hash is new (and records it), false if it was already seen. */
  checkAndMark(hash: string, now: number): boolean {
    return Number(this.db.prepare('INSERT OR IGNORE INTO seen (msg_hash, seen_at) VALUES (?, ?)').run(hash, now).changes) === 1;
  }

  purgeOlderThan(cutoff: number): number {
    return Number(this.db.prepare('DELETE FROM seen WHERE seen_at < ?').run(cutoff).changes);
  }
}
