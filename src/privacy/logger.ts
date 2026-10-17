// Redacting structured logger (PRIVACY.md §7). JSON lines.
// - Drops known-sensitive keys anywhere in the payload (text, content, handle, phone, address, name, email, to, ...).
// - Scrubs every remaining string (message + values + error messages) with redact().
// - Level filtering. A test hook (setLogSink / captureLogs) captures lines instead of writing to stderr.

import { redact } from './redact.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';
const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

/** Keys that are dropped wherever they appear (compared lower-cased). */
export const DROPPED_KEYS: ReadonlySet<string> = new Set([
  'text',
  'content',
  'handle',
  'phone',
  'address',
  'name',
  'email',
  'to',
  'from_number',
  'to_number',
  // extra belt-and-braces keys that can carry personal data in this codebase
  'body',
  'rawbody',
  'answertext',
  'question',
  'caption',
  'from',
  'spaceid',
  'platformname',
  'members',
  'neighborhood',
  'near',
  'query',
  'headers',
]);

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  child(bindings: LogFields): Logger;
  readonly level: LogLevel;
}

export type LogSink = (line: string) => void;

const stderrSink: LogSink = (line) => {
  process.stderr.write(line + '\n');
};
let globalSink: LogSink = stderrSink;

/** Replace the process-wide sink (tests). Returns the previous sink. */
export function setLogSink(sink: LogSink | null): LogSink {
  const prev = globalSink;
  globalSink = sink ?? stderrSink;
  return prev;
}

/** Capture every line written by any logger until restore() is called. */
export function captureLogs(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const prev = setLogSink((l) => lines.push(l));
  return { lines, restore: () => setLogSink(prev) };
}

const MAX_DEPTH = 6;

/**
 * An error whose message we wrote ourselves and that never contains user data. Only these (and a few known
 * internal error types) have their message logged; any other error message may echo chat text or a handle
 * (SDK / HTTP errors often do), so only its name / code / status are kept.
 */
export class SafeError extends Error {
  readonly safe = true;
  constructor(message: string, opts?: { cause?: unknown }) {
    super(message, opts);
    this.name = 'SafeError';
  }
}

const SAFE_ERROR_NAMES = new Set(['SafeError', 'SealError', 'TimeoutError']);

function isSafeError(err: Error): boolean {
  if ((err as { safe?: unknown }).safe === true || SAFE_ERROR_NAMES.has(err.name)) return true;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' && code.startsWith('ERR_SQLITE');
}

function sanitizeError(err: Error): Record<string, unknown> {
  const out: Record<string, unknown> = { name: redact(String(err.name ?? 'Error')).slice(0, 60) };
  if (isSafeError(err)) out.message = redact(String(err.message ?? '')).slice(0, 300);
  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string' && /^[A-Z0-9_]{1,40}$/.test(code)) out.code = code;
  if (typeof code === 'number') out.code = code;
  for (const k of ['status', 'statusCode'] as const) {
    const v = (err as unknown as Record<string, unknown>)[k];
    if (typeof v === 'number') out[k] = v;
  }
  return out;
}

export function sanitize(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redact(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (value instanceof Error) return sanitizeError(value);
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return `[${value.length} bytes]`;
  if (depth >= MAX_DEPTH) return '[depth]';
  if (typeof value === 'object') {
    if (seen.has(value as object)) return '[circular]';
    seen.add(value as object);
    if (Array.isArray(value)) return value.slice(0, 50).map((v) => sanitize(v, depth + 1, seen));
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (DROPPED_KEYS.has(k.toLowerCase())) continue;
      const s = sanitize(v, depth + 1, seen);
      if (s !== undefined) out[k] = s;
    }
    return out;
  }
  return undefined;
}

export interface LoggerOptions {
  level?: LogLevel;
  /** Per-logger sink; defaults to the process-wide sink (see setLogSink). */
  sink?: LogSink;
  bindings?: LogFields;
  now?: () => number;
}

class JsonLogger implements Logger {
  readonly level: LogLevel;
  readonly #sink?: LogSink;
  readonly #bindings: LogFields;
  readonly #now: () => number;

  constructor(opts: LoggerOptions) {
    this.level = opts.level ?? 'info';
    this.#sink = opts.sink;
    this.#bindings = opts.bindings ?? {};
    this.#now = opts.now ?? Date.now;
  }

  #write(level: Exclude<LogLevel, 'silent'>, msg: string, fields?: LogFields): void {
    if (ORDER[level] < ORDER[this.level]) return;
    let line: string;
    try {
      const payload = sanitize({ ...this.#bindings, ...(fields ?? {}) }) as Record<string, unknown>;
      line = JSON.stringify({ t: new Date(this.#now()).toISOString(), level, msg: redact(String(msg)), ...payload });
    } catch {
      line = JSON.stringify({ t: new Date(this.#now()).toISOString(), level, msg: 'log serialization failed' });
    }
    (this.#sink ?? globalSink)(line);
  }

  debug(msg: string, fields?: LogFields): void {
    this.#write('debug', msg, fields);
  }
  info(msg: string, fields?: LogFields): void {
    this.#write('info', msg, fields);
  }
  warn(msg: string, fields?: LogFields): void {
    this.#write('warn', msg, fields);
  }
  error(msg: string, fields?: LogFields): void {
    this.#write('error', msg, fields);
  }
  child(bindings: LogFields): Logger {
    return new JsonLogger({
      level: this.level,
      sink: this.#sink,
      bindings: { ...this.#bindings, ...bindings },
      now: this.#now,
    });
  }
}

export function createLogger(opts: LoggerOptions = {}): Logger {
  return new JsonLogger(opts);
}

/** A logger that writes nothing (useful default for libraries / tests). */
export const silentLogger: Logger = createLogger({ level: 'silent' });
