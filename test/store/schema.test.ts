// PRIVACY.md §2: "There is no column anywhere that can hold message text."

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeSchema, openDatabase, proveNoTextColumns, schemaSql } from '../../src/store/db.js';

const EXPECTED_TABLES = ['delivery', 'jobs', 'plans', 'seen', 'spaces'];

test('schema has exactly the documented tables', () => {
  const db = openDatabase(':memory:');
  assert.deepEqual(Object.keys(describeSchema(db)).sort(), EXPECTED_TABLES);
});

test('no column is named like message text', () => {
  const db = openDatabase(':memory:');
  const bad = /(^|_)(text|body|content|message|msg|chat|transcript|note|caption|question|answer)(_|$)/i;
  for (const [table, cols] of Object.entries(describeSchema(db))) {
    for (const col of cols) {
      if (col.name === 'msg_hash') continue; // SHA-256 of the platform message id, hex-checked
      assert.ok(!bad.test(col.name), `${table}.${col.name} looks like a text column`);
    }
  }
});

test('grep schema.sql: every TEXT column is CHECK-constrained, personal fields are sealed BLOBs', () => {
  const sql = schemaSql();
  const db = openDatabase(':memory:');
  for (const [table, cols] of Object.entries(describeSchema(db))) {
    const create = new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\) STRICT;`).exec(sql);
    assert.ok(create, `${table} must be a STRICT table`);
    for (const col of cols) {
      if (col.type.toUpperCase() === 'TEXT') {
        const decl = new RegExp(`\\b${col.name}\\b[^,]*?CHECK \\(`, 's');
        assert.ok(decl.test(create[1]), `${table}.${col.name} is TEXT without a CHECK constraint`);
      }
      if (/blob|sealed|payload/.test(col.name)) assert.equal(col.type.toUpperCase(), 'BLOB', `${table}.${col.name} must be BLOB`);
    }
  }
});

test('live proof: a chat message cannot be stored in ANY column', () => {
  const db = openDatabase(':memory:');
  const proof = proveNoTextColumns(db);
  assert.ok(proof.length >= 25, 'covers every column');
  const accepted = proof.filter((p) => !p.rejected).map((p) => `${p.table}.${p.column}`);
  assert.deepEqual(accepted, []);
  // and nothing was left behind by the probes
  for (const t of EXPECTED_TABLES) {
    assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n, 0);
  }
});

test('database is WAL with secure_delete on a file path', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'otto-schema-'));
  const db = openDatabase(join(dir, 'otto.db'));
  assert.equal((db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode, 'wal');
  assert.equal((db.prepare('PRAGMA secure_delete').get() as { secure_delete: number }).secure_delete, 1);
  assert.equal((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 1);
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
