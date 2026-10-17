// Env parsing and defaults. Mirrors .env.example and docs/ARCHITECTURE.md "Configuration".
// Secrets are kept as Buffers / strings in memory only and are never logged.

import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

export type SurfaceName = 'sim' | 'terminal' | 'imessage' | 'imessage-local' | 'telegram' | 'telegram-direct' | 'photon2';
/** Platforms the Photon 2.0 chat surface polls (PHOTON2_PLATFORMS). */
export type Photon2Platform = 'telegram' | 'sms' | 'imessage';
export const PHOTON2_PLATFORMS: readonly Photon2Platform[] = ['telegram', 'sms', 'imessage'];
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
  /** Direct Telegram Bot API surface (SURFACES=telegram-direct). Never logged. docs/CHANNELS.md "Direct Telegram". */
  telegramDirect: {
    /** @BotFather token (TELEGRAM_BOT_TOKEN, else SPECTRUM_TELEGRAM_BOT_TOKEN). */
    token?: string;
    /** TELEGRAM_REACTIONS=on: the bot is a group admin, so reactions arrive and count as votes. */
    reactions: boolean;
  };
  /** Photon 2.0 chat (api.photon.codes/v1). Never logged. docs/CHANNELS.md "Photon 2.0 chat". */
  photon2: {
    /** Project API key, pho_sk_... (PHOTON2_API_KEY). */
    apiKey?: string;
    /** pho_prj_... (PHOTON2_PROJECT_ID; PHOTON_PROJECT_ID is the Stable CLI's name and is ignored). */
    projectId?: string;
    platforms: Photon2Platform[];
  };
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
  /** HOMI_LLM_FIRST=on: Claude reads every addressed message first (docs/PRIVACY.md §3). Needs the LLM switch on. */
  llmFirst: boolean;
  /**
   * Demo quorum: QUORUM_DM_AFTER_MS (0 = off) after the options go out, the silent are asked privately; QUORUM_REPLY_MS
   * later they count as not coming; the plan locks with MIN_ATTENDEES yes votes or is cancelled.
   */
  quorum?: { dmAfterMs: number; replyMs: number; minYes: number };
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
  /** Directory for persistent extension data (shared album photos, encrypted). */
  dataDir: string;
  /** Public base URL for member-only links (album page), e.g. https://wtw.example.com. Unset = demo links. */
  publicBaseUrl?: string;
  /** 'simulated' (default). Real payments need an integration: docs/COMMITMENTS.md. */
  paymentsProvider: string;
  /** 'estimates' (default). Live search needs provider credentials: docs/TRAVEL.md. */
  travelProvider: string;
  port: number;
  logLevel: LogLevel;
  /** DEMO_MODE=true enables the visible `homi demo ff <duration>` chat command (live demo only). */
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

const SURFACES: readonly SurfaceName[] = ['sim', 'terminal', 'imessage', 'imessage-local', 'telegram', 'telegram-direct', 'photon2'];
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

/**
 * PHOTON2_* settings. Warnings name variables, never values. The Photon 2.0 views reuse existing surfaces
 * (telegram; imessage-shared/-dedicated for SMS + iMessage), so they cannot run next to the Spectrum surface
 * that owns the same name.
 */
export function parsePhoton2(env: NodeJS.ProcessEnv, surfaces: readonly SurfaceName[], warn: (m: string) => void): Config['photon2'] {
  const platforms: Photon2Platform[] = [];
  for (const p of (str(env, 'PHOTON2_PLATFORMS') ?? PHOTON2_PLATFORMS.join(',')).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) {
    if (!(PHOTON2_PLATFORMS as readonly string[]).includes(p)) throw new Error(`config: unknown platform "${p}" in PHOTON2_PLATFORMS (use telegram, sms, imessage)`);
    if (!platforms.includes(p as Photon2Platform)) platforms.push(p as Photon2Platform);
  }
  const apiKey = str(env, 'PHOTON2_API_KEY');
  const projectId = str(env, 'PHOTON2_PROJECT_ID');
  if (surfaces.includes('photon2')) {
    if (surfaces.includes('telegram') && platforms.includes('telegram'))
      throw new Error('config: SURFACES has both telegram (Spectrum) and photon2 with Telegram. Remove one, or set PHOTON2_PLATFORMS=sms,imessage');
    if (surfaces.includes('imessage') && (platforms.includes('sms') || platforms.includes('imessage')))
      throw new Error('config: SURFACES has both imessage (Spectrum) and photon2 with sms/imessage. Remove one, or set PHOTON2_PLATFORMS=telegram');
    if (!apiKey) warn('photon2: PHOTON2_API_KEY is not set (a Photon 2.0 project API key, pho_sk_...). The photon2 surface is skipped.');
    else if (!apiKey.startsWith('pho_sk_')) warn('photon2: PHOTON2_API_KEY does not look like a project API key (expected the pho_sk_ prefix).');
    if (!projectId) {
      const hint = str(env, 'PHOTON_PROJECT_ID') ? ' PHOTON_PROJECT_ID is the Stable Photon CLI name and is ignored here.' : '';
      warn(`photon2: PHOTON2_PROJECT_ID is not set (pho_prj_...). The photon2 surface is skipped.${hint}`);
    } else if (!projectId.startsWith('pho_prj_')) warn('photon2: PHOTON2_PROJECT_ID does not look like a Photon 2.0 project id (expected the pho_prj_ prefix).');
  }
  return { apiKey, projectId, platforms: platforms.length ? platforms : [...PHOTON2_PLATFORMS] };
}

/** Bot token for the direct Telegram surface: TELEGRAM_BOT_TOKEN, else SPECTRUM_TELEGRAM_BOT_TOKEN. */
export function telegramDirectToken(env: NodeJS.ProcessEnv): string | undefined {
  return str(env, 'TELEGRAM_BOT_TOKEN') ?? str(env, 'SPECTRUM_TELEGRAM_BOT_TOKEN');
}

/**
 * Direct Telegram settings. telegram-direct owns the engine surface 'telegram', like the Spectrum telegram surface and
 * photon2's Telegram view, so it refuses to run next to either. Warnings name variables, never values.
 */
export function parseTelegramDirect(
  env: NodeJS.ProcessEnv,
  surfaces: readonly SurfaceName[],
  photon2Platforms: readonly Photon2Platform[],
  warn: (m: string) => void,
): Config['telegramDirect'] {
  const token = telegramDirectToken(env);
  const reactions = bool(env, 'TELEGRAM_REACTIONS', false);
  if (surfaces.includes('telegram-direct')) {
    if (surfaces.includes('telegram'))
      throw new Error('config: SURFACES has both telegram (Spectrum) and telegram-direct. Both serve the same Telegram surface; keep one (telegram-direct needs only the bot token).');
    if (surfaces.includes('photon2') && photon2Platforms.includes('telegram'))
      throw new Error('config: SURFACES has both photon2 with Telegram and telegram-direct. Set PHOTON2_PLATFORMS=sms,imessage (Photon 2.0 keeps SMS/iMessage, telegram-direct serves Telegram), or remove one.');
    if (!token) warn('telegram-direct: TELEGRAM_BOT_TOKEN is not set (the @BotFather token). The telegram-direct surface is skipped.');
    else if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) warn('telegram-direct: TELEGRAM_BOT_TOKEN does not look like a @BotFather token (expected <digits>:<secret>).');
  }
  return { token, reactions };
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
  const warn = opts.warn ?? ((m: string) => process.stderr.write(`[homi] ${m}\n`));

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
  const photon2 = parsePhoton2(env, surfaces, warn);

  return {
    surfaces,
    spectrum: {
      // PROJECT_ID / PROJECT_SECRET are the names the Photon CLI scaffolder writes; accept them too.
      projectId: str(env, 'SPECTRUM_PROJECT_ID') ?? str(env, 'PROJECT_ID'),
      projectSecret: str(env, 'SPECTRUM_PROJECT_SECRET') ?? str(env, 'PROJECT_SECRET'),
      imessageLine: line,
      webhookSecret: str(env, 'SPECTRUM_WEBHOOK_SECRET'),
      telegramBotToken: str(env, 'SPECTRUM_TELEGRAM_BOT_TOKEN'),
      telegramWebhookSecret: str(env, 'SPECTRUM_TELEGRAM_WEBHOOK_SECRET'),
    },
    telegramBotUsername: tgUser ? tgUser.replace(/^@/, '') : undefined,
    telegramDirect: parseTelegramDirect(env, surfaces, photon2.platforms, warn),
    photon2,
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
    llmFirst: bool(env, 'HOMI_LLM_FIRST', false),
    quorum: parseQuorum(env),
    retentionHours,
    quietHours: parseQuietHours(str(env, 'QUIET_HOURS')),
    defaultTz: str(env, 'DEFAULT_TZ') ?? 'America/New_York',
    dataKey,
    idSalt,
    ephemeralKeys,
    dbPath: str(env, 'DB_PATH') ?? './data/wtw.db',
    dataDir: str(env, 'DATA_DIR') ?? './data',
    publicBaseUrl: str(env, 'PUBLIC_BASE_URL'),
    paymentsProvider: str(env, 'PAYMENTS_PROVIDER') ?? 'simulated',
    travelProvider: str(env, 'TRAVEL_PROVIDER') ?? 'estimates',
    port: int(env, 'PORT', 8787),
    logLevel: logLevel as LogLevel,
  };
}

/** QUORUM_DM_AFTER_MS > 0 switches the demo quorum on; QUORUM_REPLY_MS defaults to 15 s, MIN_ATTENDEES to 2. */
export function parseQuorum(env: NodeJS.ProcessEnv): Config['quorum'] {
  const dmAfterMs = int(env, 'QUORUM_DM_AFTER_MS', 0);
  if (dmAfterMs <= 0) return undefined;
  const replyMs = Math.max(1000, int(env, 'QUORUM_REPLY_MS', 15_000));
  const minYes = Math.max(1, int(env, 'MIN_ATTENDEES', 2));
  return { dmAfterMs: Math.max(1000, dmAfterMs), replyMs, minYes };
}

/** True when a hosted LLM call is allowed at all (PRIVACY.md §3): explicitly enabled AND a key is set. */
export function hostedLlmAllowed(c: Config): boolean {
  return !c.disableHostedLlm && !!c.anthropicApiKey;
}
