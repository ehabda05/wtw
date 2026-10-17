// Env parsing and defaults. Mirrors .env.example and docs/ARCHITECTURE.md "Configuration".
// Secrets are kept as Buffers / strings in memory only and are never logged.

import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

export type SurfaceName = 'sim' | 'terminal' | 'imessage' | 'imessage-local' | 'telegram';
export type VoiceMode = 'mock' | 'poll' | 'webhook';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface Config {
  surfaces: SurfaceName[];
  spectrum: {
    projectId?: string;
    projectSecret?: string;
    imessageLine: 'shared' | 'dedicated';
    webhookSecret?: string;
    telegramBotToken?: string;
    telegramWebhookSecret?: string;
  };
  telegramBotUsername?: string;
  voice: {
    mode: VoiceMode;
    photonNumber?: string;
    retellApiKey?: string;
    retellAgentId?: string;
  };
  places: {
    provider: string;
    apiKey?: string;
  };
  disableHostedLlm: boolean;
  anthropicApiKey?: string;
  retentionHours: number;
  /** [startHour, endHour] in group-local time, e.g. [23, 9]. */
  quietHours: [number, number];
  defaultTz: string;
  /** 32-byte AES-256-GCM key. */
  dataKey: Buffer;
  /** HMAC key for member / space keys. */
  idSalt: Buffer;
  /** true when DATA_KEY / ID_SALT were generated in memory (sim only). */
  ephemeralKeys: boolean;
  dbPath: string;
  port: number;
  logLevel: LogLevel;
  /** DEMO_MODE=true enables the visible `otto demo ff <duration>` chat command (live demo only). */
  demoMode: boolean;
}

export interface LoadConfigOptions {
  /** Environment to read (defaults to process.env). */
  env?: NodeJS.ProcessEnv;
  /** Load ./.env with process.loadEnvFile() when present (default true when env is process.env). */
  loadDotEnv?: boolean;
  /** Allow ephemeral keys even if SURFACES contains real surfaces (the sim CLI sets this). */
  sim?: boolean;
  /** Called with human-readable warnings (never contains secrets). */
  warn?: (msg: string) => void;
}

const SURFACES: readonly SurfaceName[] = ['sim', 'terminal', 'imessage', 'imessage-local', 'telegram'];
const LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error', 'silent'];

function str(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const v = env[name];
  if (v === undefined) return undefined;
  const t = v.trim();
  return t === '' ? undefined : t;
}

function bool(env: NodeJS.ProcessEnv, name: string, dflt: boolean): boolean {
  const v = str(env, name);
  if (v === undefined) return dflt;
  return !/^(0|false|no|off)$/i.test(v);
}

function int(env: NodeJS.ProcessEnv, name: string, dflt: number): number {
  const v = str(env, name);
  if (v === undefined) return dflt;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) throw new Error(`config: ${name} must be an integer`);
  return n;
}

export function parseSurfaces(v: string | undefined): SurfaceName[] {
  const list = (v ?? 'sim').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const out: SurfaceName[] = [];
  for (const s of list) {
    if (!(SURFACES as readonly string[]).includes(s)) throw new Error(`config: unknown surface "${s}" in SURFACES`);
    if (!out.includes(s as SurfaceName)) out.push(s as SurfaceName);
  }
  return out.length ? out : ['sim'];
}

export function parseQuietHours(v: string | undefined): [number, number] {
  const m = /^\s*(\d{1,2})\s*-\s*(\d{1,2})\s*$/.exec(v ?? '23-9');
  if (!m) throw new Error('config: QUIET_HOURS must look like "23-9"');
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a > 23 || b > 23) throw new Error('config: QUIET_HOURS hours must be 0-23');
  return [a, b];
}

function decodeKey(v: string, name: string): Buffer {
  const buf = Buffer.from(v, 'base64');
  if (buf.length !== 32) throw new Error(`config: ${name} must be 32 random bytes, base64-encoded (run: npm run keys)`);
  return buf;
}

/** Generate fresh DATA_KEY and ID_SALT values (base64, 32 bytes each). */
export function generateKeys(): { DATA_KEY: string; ID_SALT: string } {
  return { DATA_KEY: randomBytes(32).toString('base64'), ID_SALT: randomBytes(32).toString('base64') };
}

export function loadConfig(opts: LoadConfigOptions = {}): Config {
  const usingProcessEnv = opts.env === undefined;
  const env = opts.env ?? process.env;
  const warn = opts.warn ?? ((m: string) => process.stderr.write(`[otto] ${m}\n`));

  if ((opts.loadDotEnv ?? usingProcessEnv) && existsSync('.env')) {
    try {
      process.loadEnvFile('.env');
    } catch (err) {
      warn(`could not load .env (${(err as Error).name})`);
    }
  }

  const surfaces = opts.sim ? (['sim'] as SurfaceName[]) : parseSurfaces(str(env, 'SURFACES'));
  const simOnly = surfaces.every((s) => s === 'sim');

  const line = (str(env, 'SPECTRUM_IMESSAGE_LINE') ?? 'shared').toLowerCase();
  if (line !== 'shared' && line !== 'dedicated') throw new Error('config: SPECTRUM_IMESSAGE_LINE must be shared or dedicated');

  const voiceMode = (str(env, 'VOICE_MODE') ?? 'mock').toLowerCase();
  if (!['mock', 'poll', 'webhook'].includes(voiceMode)) throw new Error('config: VOICE_MODE must be mock, poll or webhook');

  const logLevel = (str(env, 'LOG_LEVEL') ?? 'info').toLowerCase();
  if (!(LEVELS as readonly string[]).includes(logLevel)) throw new Error('config: LOG_LEVEL must be debug, info, warn, error or silent');

  let dataKeyStr = str(env, 'DATA_KEY');
  let idSaltStr = str(env, 'ID_SALT');
  let ephemeralKeys = false;
  if (!dataKeyStr || !idSaltStr) {
    if (simOnly || opts.sim) {
      const k = generateKeys();
      dataKeyStr = dataKeyStr ?? k.DATA_KEY;
      idSaltStr = idSaltStr ?? k.ID_SALT;
      ephemeralKeys = true;
      warn('DATA_KEY / ID_SALT not set: using ephemeral in-memory keys (sim only; data is unreadable after exit).');
    } else {
      throw new Error('config: DATA_KEY and ID_SALT are required outside the sim. Run `npm run keys` and put them in .env.');
    }
  }
  const dataKey = decodeKey(dataKeyStr, 'DATA_KEY');
  if (idSaltStr.length < 16) throw new Error('config: ID_SALT must be at least 16 characters (run: npm run keys)');
  const idSalt = Buffer.from(idSaltStr, 'utf8');

  const retentionHours = int(env, 'RETENTION_HOURS', 24);
  if (retentionHours < 0) throw new Error('config: RETENTION_HOURS must be >= 0');

  const tgUser = str(env, 'TELEGRAM_BOT_USERNAME');

  return {
    surfaces,
    spectrum: {
      projectId: str(env, 'SPECTRUM_PROJECT_ID'),
      projectSecret: str(env, 'SPECTRUM_PROJECT_SECRET'),
      imessageLine: line,
      webhookSecret: str(env, 'SPECTRUM_WEBHOOK_SECRET'),
      telegramBotToken: str(env, 'SPECTRUM_TELEGRAM_BOT_TOKEN'),
      telegramWebhookSecret: str(env, 'SPECTRUM_TELEGRAM_WEBHOOK_SECRET'),
    },
    telegramBotUsername: tgUser ? tgUser.replace(/^@/, '') : undefined,
    voice: {
      mode: voiceMode as VoiceMode,
      photonNumber: str(env, 'PHOTON_VOICE_NUMBER'),
      retellApiKey: str(env, 'RETELL_API_KEY'),
      retellAgentId: str(env, 'RETELL_AGENT_ID'),
    },
    places: {
      provider: str(env, 'PLACES_PROVIDER') ?? 'offline',
      apiKey: str(env, 'PLACES_API_KEY'),
    },
    demoMode: bool(env, 'DEMO_MODE', false),
    disableHostedLlm: bool(env, 'DISABLE_HOSTED_LLM', true),
    anthropicApiKey: str(env, 'ANTHROPIC_API_KEY'),
    retentionHours,
    quietHours: parseQuietHours(str(env, 'QUIET_HOURS')),
    defaultTz: str(env, 'DEFAULT_TZ') ?? 'America/New_York',
    dataKey,
    idSalt,
    ephemeralKeys,
    dbPath: str(env, 'DB_PATH') ?? './data/otto.db',
    port: int(env, 'PORT', 8787),
    logLevel: logLevel as LogLevel,
  };
}

/** True when a hosted LLM call is allowed at all (PRIVACY.md §3): explicitly enabled AND a key is set. */
export function hostedLlmAllowed(c: Config): boolean {
  return !c.disableHostedLlm && !!c.anthropicApiKey;
}
