// node:sqlite (Node 22 built-in, no native build), WAL, schema migration.

import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const SCHEMA_VERSION = 2;

export function schemaSql(): string {
  return readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
}

export function openDatabase(path: string): DatabaseSync {
  const memory = path === ':memory:' || path === '';
  if (!memory) mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new DatabaseSync(memory ? ':memory:' : path);
  if (!memory) db.exec('PRAGMA journal_mode = WAL;');
  // secure_delete overwrites deleted content with zeros, so purged plans do not linger in free pages.
  db.exec('PRAGMA synchronous = NORMAL; PRAGMA secure_delete = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

export function migrate(db: DatabaseSync): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined;
  const current = row?.user_version ?? 0;
  if (current > SCHEMA_VERSION) throw new Error(`database schema v${current} is newer than this build (v${SCHEMA_VERSION})`);
  // v1 -> v2: the jobs.kind CHECK gains 'ext' (pledge timers). SQLite can't alter a CHECK, so rebuild the table.
  if (current === 1) {
    const hasJobs = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'jobs'").get();
    if (hasJobs) transaction(db, () => db.exec('ALTER TABLE jobs RENAME TO jobs_v1; DROP INDEX IF EXISTS jobs_by_due; DROP INDEX IF EXISTS jobs_by_plan;'));
  }
  db.exec(schemaSql());
  if (current === 1) {
    const old = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'jobs_v1'").get();
    if (old) transaction(db, () => db.exec('INSERT INTO jobs SELECT * FROM jobs_v1; DROP TABLE jobs_v1;'));
  }
  if (current < SCHEMA_VERSION) db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

let savepointSeq = 0;
const depth = new WeakMap<DatabaseSync, number>();

/** Run fn in a transaction (nested calls use savepoints). */
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  const d = depth.get(db) ?? 0;
  const sp = d === 0 ? null : `sp_${++savepointSeq}`;
  db.exec(sp ? `SAVEPOINT ${sp}` : 'BEGIN IMMEDIATE');
  depth.set(db, d + 1);
  try {
    const out = fn();
    db.exec(sp ? `RELEASE ${sp}` : 'COMMIT');
    return out;
  } catch (err) {
    try {
      db.exec(sp ? `ROLLBACK TO ${sp}; RELEASE ${sp}` : 'ROLLBACK');
    } catch {
      /* ignore rollback failure */
    }
    throw err;
  } finally {
    depth.set(db, d);
  }
}

export interface ColumnProof {
  table: string;
  column: string;
  type: string;
  rejected: boolean;
}

const SAMPLE_MESSAGE = 'hey ana, does friday at 7 work? call me +1 (617) 555-0134';

function dummyValue(column: string, type: string): unknown {
  if (/^(space_key|member_key|msg_hash)$/.test(column)) return 'a'.repeat(64);
  if (column === 'plan_id') return 'p-1';
  if (column === 'job_key') return 'p-1:remind:day';
  if (column === 'platform' || column === 'surface') return 'sim';
  if (column === 'state') return 'idle';
  if (column === 'kind') return 'purge';
  if (column === 'status') return 'pending';
  if (type.toUpperCase() === 'INTEGER') return 0;
  if (type.toUpperCase() === 'BLOB') return Buffer.from([1]);
  return 'x';
}

/**
 * Live proof that no column can hold message text: for every column of every table, try to INSERT a realistic
 * chat message into it (other columns valid) inside a transaction that is always rolled back. Every attempt must
 * fail (CHECK constraint on keys / ids / enums, STRICT typing on BLOB and INTEGER columns).
 */
export function proveNoTextColumns(db: DatabaseSync): ColumnProof[] {
  const schema = describeSchema(db);
  const out: ColumnProof[] = [];
  for (const [table, cols] of Object.entries(schema)) {
    for (const target of cols) {
      const names = cols.map((c) => c.name);
      const values = cols.map((c) => (c.name === target.name ? SAMPLE_MESSAGE : dummyValue(c.name, c.type)));
      let rejected = false;
      db.exec('SAVEPOINT prove_no_text');
      try {
        db.prepare(`INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(
          ...(values as (string | number | Buffer)[]),
        );
      } catch {
        rejected = true;
      } finally {
        db.exec('ROLLBACK TO prove_no_text; RELEASE prove_no_text');
      }
      out.push({ table, column: target.name, type: target.type, rejected });
    }
  }
  return out;
}

/** Table -> column descriptors, for tests and the sim's /db command. */
export function describeSchema(db: DatabaseSync): Record<string, { name: string; type: string; notnull: number; pk: number }[]> {
  const tables = db
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as { name: string }[];
  const out: Record<string, { name: string; type: string; notnull: number; pk: number }[]> = {};
  for (const t of tables) {
    out[t.name] = db.prepare(`PRAGMA table_info(${t.name})`).all() as { name: string; type: string; notnull: number; pk: number }[];
  }
  return out;
}
