// Memory for the dining agent: one small plaintext SQLite file. Everything is kept as-is so the model has full
// context: the whole transcript per chat, the last few images (receipts), a free-form notes scratchpad the model
// maintains itself (people, plan, bill, debts), and follow-up timers it sets.

import { DatabaseSync } from 'node:sqlite';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

export interface StoredMessage {
  id: number;
  spaceId: string;
  at: number;
  /** Display name of the sender, or 'Homi' for the bot. */
  sender: string;
  role: 'user' | 'homi' | 'system';
  text: string;
  /** Platform message id (so reactions to Homi's messages can be resolved). */
  msgId?: string;
  hasImage: boolean;
}

export interface LedgerEntry {
  kind: 'debt' | 'payment';
  from: string;
  to: string;
  amount: number;
}

export interface StoredImage {
  msgId: number;
  mime: string;
  bytes: Uint8Array;
  at: number;
}

export interface Chat {
  spaceId: string;
  surface: string;
  isGroup: boolean;
  notes: string;
  members?: number;
  roster?: string[];
  /** Id of the last message the agent has processed. */
  processedUpTo: number;
  followUpAt?: number;
  followUpNote?: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS chats (
  space_id TEXT PRIMARY KEY, surface TEXT NOT NULL, is_group INTEGER NOT NULL, notes TEXT NOT NULL DEFAULT '',
  members INTEGER, roster TEXT, processed_up_to INTEGER NOT NULL DEFAULT 0, follow_up_at INTEGER, follow_up_note TEXT, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, space_id TEXT NOT NULL, at INTEGER NOT NULL, sender TEXT NOT NULL, role TEXT NOT NULL,
  text TEXT NOT NULL, msg_id TEXT, has_image INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS messages_by_space ON messages (space_id, id);
CREATE TABLE IF NOT EXISTS images (msg_id INTEGER PRIMARY KEY, space_id TEXT NOT NULL, mime TEXT NOT NULL, bytes BLOB NOT NULL, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS seen (hash TEXT PRIMARY KEY, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS handles (handle TEXT PRIMARY KEY, name TEXT NOT NULL, space_id TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT, space_id TEXT NOT NULL, label TEXT NOT NULL, kind TEXT NOT NULL,
  from_name TEXT NOT NULL, to_name TEXT NOT NULL, cents INTEGER NOT NULL, at INTEGER NOT NULL
);
`;

export class DiningMemory {
  readonly db: DatabaseSync;

  constructor(path = ':memory:') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec(SCHEMA);
    try {
      this.db.exec('ALTER TABLE chats ADD COLUMN roster TEXT');
    } catch {
      /* column exists */
    }
  }

  close(): void {
    this.db.close();
  }

  /** True the first time this key is seen (dedupe). */
  firstTime(key: string, at: number): boolean {
    const r = this.db.prepare('INSERT OR IGNORE INTO seen (hash, at) VALUES (?, ?)').run(key, at);
    if (Math.random() < 0.01) this.db.prepare('DELETE FROM seen WHERE at < ?').run(at - 48 * 3_600_000);
    return r.changes === 1;
  }

  chat(spaceId: string, surface = 'sim', isGroup = true): Chat {
    const row = this.db.prepare('SELECT * FROM chats WHERE space_id = ?').get(spaceId) as
      | { space_id: string; surface: string; is_group: number; notes: string; members: number | null; roster: string | null; processed_up_to: number; follow_up_at: number | null; follow_up_note: string | null }
      | undefined;
    if (!row) {
      this.db.prepare('INSERT INTO chats (space_id, surface, is_group, updated_at) VALUES (?, ?, ?, ?)').run(spaceId, surface, isGroup ? 1 : 0, Date.now());
      return { spaceId, surface, isGroup, notes: '', processedUpTo: 0 };
    }
    return {
      spaceId,
      surface: row.surface,
      isGroup: row.is_group === 1,
      notes: row.notes,
      ...(row.members !== null ? { members: row.members } : {}),
      ...(row.roster ? { roster: JSON.parse(row.roster) as string[] } : {}),
      processedUpTo: row.processed_up_to,
      ...(row.follow_up_at !== null ? { followUpAt: row.follow_up_at } : {}),
      ...(row.follow_up_note !== null ? { followUpNote: row.follow_up_note } : {}),
    };
  }

  hasChat(spaceId: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM chats WHERE space_id = ?').get(spaceId);
  }

  setNotes(spaceId: string, notes: string): void {
    this.db.prepare('UPDATE chats SET notes = ?, updated_at = ? WHERE space_id = ?').run(notes, Date.now(), spaceId);
  }

  setMembers(spaceId: string, members: number): void {
    this.db.prepare('UPDATE chats SET members = ? WHERE space_id = ?').run(members, spaceId);
  }

  setRoster(spaceId: string, names: string[]): void {
    this.db.prepare('UPDATE chats SET roster = ?, members = ? WHERE space_id = ?').run(JSON.stringify(names), names.length, spaceId);
  }

  setProcessed(spaceId: string, upTo: number): void {
    this.db.prepare('UPDATE chats SET processed_up_to = ? WHERE space_id = ?').run(upTo, spaceId);
  }

  setFollowUp(spaceId: string, at: number | null, note: string | null): void {
    this.db.prepare('UPDATE chats SET follow_up_at = ?, follow_up_note = ? WHERE space_id = ?').run(at, note, spaceId);
  }

  dueFollowUps(now: number): Chat[] {
    const rows = this.db.prepare('SELECT space_id FROM chats WHERE follow_up_at IS NOT NULL AND follow_up_at <= ?').all(now) as { space_id: string }[];
    return rows.map((r) => this.chat(r.space_id));
  }

  addMessage(m: Omit<StoredMessage, 'id'>, image?: { mime: string; bytes: Uint8Array }): number {
    const r = this.db
      .prepare('INSERT INTO messages (space_id, at, sender, role, text, msg_id, has_image) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(m.spaceId, m.at, m.sender, m.role, m.text, m.msgId ?? null, image ? 1 : 0);
    const id = Number(r.lastInsertRowid);
    if (image) {
      this.db.prepare('INSERT INTO images (msg_id, space_id, mime, bytes, at) VALUES (?, ?, ?, ?, ?)').run(id, m.spaceId, image.mime, image.bytes, m.at);
      // Keep the five most recent images per chat.
      this.db.prepare('DELETE FROM images WHERE space_id = ? AND msg_id NOT IN (SELECT msg_id FROM images WHERE space_id = ? ORDER BY msg_id DESC LIMIT 5)').run(m.spaceId, m.spaceId);
    }
    this.db.prepare('UPDATE chats SET updated_at = ? WHERE space_id = ?').run(m.at, m.spaceId);
    return id;
  }

  /** The last `limit` messages of a chat, oldest first. */
  recent(spaceId: string, limit = 60): StoredMessage[] {
    const rows = this.db.prepare('SELECT * FROM messages WHERE space_id = ? ORDER BY id DESC LIMIT ?').all(spaceId, limit) as unknown as RawRow[];
    return rows.reverse().map(fromRow);
  }

  /** Messages after `afterId`, oldest first. */
  since(spaceId: string, afterId: number): StoredMessage[] {
    const rows = this.db.prepare('SELECT * FROM messages WHERE space_id = ? AND id > ? ORDER BY id ASC').all(spaceId, afterId) as unknown as RawRow[];
    return rows.map(fromRow);
  }

  /** When Homi last posted in a chat (0 = never). */
  lastHomiAt(spaceId: string): number {
    const r = this.db.prepare("SELECT MAX(at) AS at FROM messages WHERE space_id = ? AND role = 'homi'").get(spaceId) as { at: number | null };
    return r.at ?? 0;
  }

  lastId(spaceId: string): number {
    const r = this.db.prepare('SELECT MAX(id) AS id FROM messages WHERE space_id = ?').get(spaceId) as { id: number | null };
    return r.id ?? 0;
  }

  /** Homi's own message with that platform id (for reactions / replies to it). */
  homiMessageByRef(spaceId: string, msgId: string): StoredMessage | undefined {
    const row = this.db.prepare("SELECT * FROM messages WHERE space_id = ? AND role = 'homi' AND msg_id = ? ORDER BY id DESC LIMIT 1").get(spaceId, msgId) as RawRow | undefined;
    return row ? fromRow(row) : undefined;
  }

  images(spaceId: string, msgIds: number[]): StoredImage[] {
    if (!msgIds.length) return [];
    const rows = this.db
      .prepare(`SELECT * FROM images WHERE space_id = ? AND msg_id IN (${msgIds.map(() => '?').join(',')}) ORDER BY msg_id ASC`)
      .all(spaceId, ...msgIds) as { msg_id: number; mime: string; bytes: Uint8Array; at: number }[];
    return rows.map((r) => ({ msgId: r.msg_id, mime: r.mime, bytes: r.bytes, at: r.at }));
  }

  // ───────────── people (name <-> platform handle, for DMs) ─────────────

  /** Remember which group a handle belongs to and what the person is called there. */
  setHandle(handle: string, name: string, groupSpaceId: string, at: number): void {
    this.db.prepare('INSERT OR REPLACE INTO handles (handle, name, space_id, at) VALUES (?, ?, ?, ?)').run(handle, name, groupSpaceId, at);
  }

  /** The group a handle was last seen in (for routing a DM reply back to the group). */
  groupOfHandle(handle: string): { name: string; spaceId: string; at: number } | undefined {
    const r = this.db.prepare('SELECT name, space_id, at FROM handles WHERE handle = ?').get(handle) as { name: string; space_id: string; at: number } | undefined;
    return r ? { name: r.name, spaceId: r.space_id, at: r.at } : undefined;
  }

  /** The platform handle of a person in a group, by name (case-insensitive, first-name match allowed). */
  handleOf(groupSpaceId: string, name: string): string | undefined {
    const rows = this.db.prepare('SELECT handle, name FROM handles WHERE space_id = ?').all(groupSpaceId) as { handle: string; name: string }[];
    const n = name.trim().toLowerCase();
    const digits = n.replace(/\D/g, '');
    return (
      rows.find((r) => r.name.toLowerCase() === n) ??
      rows.find((r) => r.name.toLowerCase().split(/\s+/)[0] === n) ??
      (digits.length >= 4 ? rows.find((r) => r.handle.replace(/\D/g, '').endsWith(digits) || r.name.replace(/\D/g, '') === digits) : undefined)
    )?.handle;
  }

  // ───────────── ledger (who owes whom, netted) ─────────────

  /** Records a bill or a payment under a label; the same label replaces its earlier entries (corrections). */
  record(spaceId: string, label: string, entries: LedgerEntry[], at: number): void {
    this.db.prepare('DELETE FROM ledger WHERE space_id = ? AND label = ?').run(spaceId, label);
    const ins = this.db.prepare('INSERT INTO ledger (space_id, label, kind, from_name, to_name, cents, at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const e of entries) ins.run(spaceId, label, e.kind, e.from.trim(), e.to.trim(), Math.round(e.amount * 100), at);
  }

  /** Net balance per pair: "Jo owes Ben $5.00". A debt from->to adds; a payment from->to subtracts. */
  balances(spaceId: string): { from: string; to: string; cents: number }[] {
    const rows = this.db.prepare('SELECT kind, from_name, to_name, cents FROM ledger WHERE space_id = ?').all(spaceId) as { kind: string; from_name: string; to_name: string; cents: number }[];
    const net = new Map<string, { a: string; b: string; cents: number }>();
    for (const r of rows) {
      const [a, b] = [r.from_name, r.to_name].sort((x, y) => x.toLowerCase().localeCompare(y.toLowerCase()));
      const key = `${a.toLowerCase()}|${b.toLowerCase()}`;
      const cur = net.get(key) ?? { a, b, cents: 0 };
      const sign = (r.kind === 'payment' ? -1 : 1) * (r.from_name === a ? 1 : -1);
      cur.cents += sign * r.cents; // positive = a owes b
      net.set(key, cur);
    }
    return [...net.values()].filter((x) => x.cents !== 0).map((x) => (x.cents > 0 ? { from: x.a, to: x.b, cents: x.cents } : { from: x.b, to: x.a, cents: -x.cents }));
  }

  balancesText(spaceId: string): string {
    const b = this.balances(spaceId);
    return b.length ? b.map((x) => `${x.from} owes ${x.to} $${(x.cents / 100).toFixed(2)}`).join('; ') : 'everyone is even';
  }

  /** "forget": wipes a chat's transcript, images and notes. */
  forget(spaceId: string): void {
    this.db.prepare('DELETE FROM messages WHERE space_id = ?').run(spaceId);
    this.db.prepare('DELETE FROM images WHERE space_id = ?').run(spaceId);
    this.db.prepare('DELETE FROM ledger WHERE space_id = ?').run(spaceId);
    this.db.prepare("UPDATE chats SET notes = '', processed_up_to = 0, follow_up_at = NULL, follow_up_note = NULL WHERE space_id = ?").run(spaceId);
  }
}

interface RawRow {
  id: number;
  space_id: string;
  at: number;
  sender: string;
  role: string;
  text: string;
  msg_id: string | null;
  has_image: number;
}

function fromRow(r: RawRow): StoredMessage {
  return {
    id: r.id,
    spaceId: r.space_id,
    at: r.at,
    sender: r.sender,
    role: r.role as StoredMessage['role'],
    text: r.text,
    ...(r.msg_id ? { msgId: r.msg_id } : {}),
    hasImage: r.has_image === 1,
  };
}
