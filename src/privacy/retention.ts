// Retention sweep (PRIVACY.md §5): runs at startup and every 10 minutes.
// - plans with purge_at <= now are deleted with their delivery lookup and jobs (one transaction)
// - dedupe hashes older than 24h are deleted
// - VACUUM after any purge so deleted pages do not linger in the file

import type { Repo } from '../store/repo.js';
import { SEEN_TTL_MS } from '../store/repo.js';
import { silentLogger, type Logger } from './logger.js';

export interface SweepResult {
  plans: number;
  delivery: number;
  jobs: number;
  seen: number;
  vacuumed: boolean;
}

export class Retention {
  constructor(
    private readonly repo: Repo,
    private readonly logger: Logger = silentLogger,
  ) {}

  sweep(now: number): SweepResult {
    const purged = this.repo.purgeExpired(now);
    const seen = this.repo.seen.purgeOlderThan(now - SEEN_TTL_MS);
    const any = purged.plans + purged.delivery + purged.jobs + seen > 0;
    if (any) this.repo.vacuum();
    const result: SweepResult = { ...purged, seen, vacuumed: any };
    if (any) this.logger.info('retention sweep', { ...result });
    return result;
  }
}

export function sweep(repo: Repo, now: number, logger?: Logger): SweepResult {
  return new Retention(repo, logger).sweep(now);
}
