// Photon 2.0 setup helpers behind `npm run photon2:check` and `npm run photon2:telegram` (injected client: testable).
// connectTelegramBot (POST /v1/projects/{id}/platforms/telegram/bots) takes an EMPTY body and an Idempotency-Key:
// no BotFather token. It returns an Operation (202) whose detail.setupUrl the human opens in Telegram to create or
// pick the managed bot. One unfinished provision per project: a different key while one is active returns
// 409 TELEGRAM_PROVISION_IN_PROGRESS { operationId, operationUrl }; replaying the same key returns the original
// operation forever, even after completion. Output never includes the API key.

import { createHash, randomUUID } from 'node:crypto';
import type { Photon2Platform } from '../config.js';
import { apiStatus, type Photon2AdminClient } from './photon2.js';

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

/** A safe one-line description of an API failure: status + problem code + request id, never the detail text. */
export function describeApiError(err: unknown): string {
  const status = apiStatus(err);
  const code = str(rec(rec(err)?.body)?.code);
  const requestId = str(rec(err)?.requestId);
  if (status === undefined) return `request failed (${err instanceof Error ? err.name : 'error'})`;
  return `HTTP ${status}${code ? ` ${code}` : ''}${requestId ? ` (request ${requestId})` : ''}`;
}

export interface Photon2CheckResult {
  spaces: number;
  spacesByPlatform: Partial<Record<Photon2Platform, number | null>>;
  /** Platform types the project can use, or null if the key lacks platforms:read. */
  platformTypes: number | null;
}

/** Harmless reads: count Spaces (total and per configured platform) and list platform types. Throws if the key is refused. */
export async function checkPhoton2(client: Photon2AdminClient, projectId: string, platforms: readonly Photon2Platform[]): Promise<Photon2CheckResult> {
  const path = { id: projectId };
  const total = await client.countSpaces({ path });
  const spacesByPlatform: Photon2CheckResult['spacesByPlatform'] = {};
  for (const p of platforms) {
    spacesByPlatform[p] = await client.countSpaces({ path, query: { platform: p } }).then((r) => r.count, () => null);
  }
  const platformTypes = await client.platforms.listProjectPlatforms({ path }).then((r) => r.platforms.length, () => null);
  return { spaces: total.count, spacesByPlatform, platformTypes };
}

/** Stable per project, so re-running shows the same operation; `fresh` starts over after a failed/cancelled one. */
export function telegramConnectKey(projectId: string, fresh = false): string {
  if (fresh) return `homi-telegram-${randomUUID()}`;
  return `homi-telegram-${createHash('sha256').update(projectId).digest('hex').slice(0, 24)}`;
}

export interface TelegramConnectResult {
  outcome: 'started' | 'in_progress';
  operationId?: string;
  operationUrl?: string;
  state?: string;
  setupUrl?: string;
  resourceId?: string;
  /** Other human-useful strings from the operation / resource detail (bot username, t.me link, ...). */
  details: Record<string, string>;
  error?: string;
}

const SHOWN_KEY = /url|link|username|handle|^name$|botname|display/i;
const HIDDEN_KEY = /token|secret|password|key/i;

function pickDetails(...sources: unknown[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const src of sources) {
    for (const [k, v] of Object.entries(rec(src) ?? {})) {
      if (k === 'setupUrl' || HIDDEN_KEY.test(k) || !SHOWN_KEY.test(k)) continue;
      if (typeof v === 'string' && v.length > 0 && v.length < 300) out[k] = v;
    }
  }
  return out;
}

function fromOperation(op: unknown, resource?: unknown): Omit<TelegramConnectResult, 'outcome'> {
  const o = rec(op) ?? {};
  const detail = rec(o.detail);
  const error = rec(o.error);
  return {
    operationId: str(o.operationId),
    state: str(o.state),
    setupUrl: str(detail?.setupUrl),
    resourceId: str(o.resourceId),
    details: pickDetails(detail, rec(resource)?.detail),
    ...(error ? { error: str(error.code) ?? 'failed' } : {}),
  };
}

/** Start (or re-show) the managed Telegram bot provision. A 409 in-progress returns that operation instead of failing. */
export async function connectTelegram(client: Photon2AdminClient, projectId: string, idempotencyKey: string): Promise<TelegramConnectResult> {
  const path = { id: projectId };
  try {
    const op = await client.platforms.connectTelegramBot({ path, body: {}, headers: { idempotencyKey } });
    return { outcome: 'started', ...fromOperation(op) };
  } catch (err) {
    const body = rec(rec(err)?.body);
    if (apiStatus(err) !== 409 || body?.code !== 'TELEGRAM_PROVISION_IN_PROGRESS') throw err;
    const operationId = str(body.operationId);
    const operationUrl = str(body.operationUrl);
    let more: Omit<TelegramConnectResult, 'outcome'> = { details: {} };
    if (operationId) {
      more = await client.platforms
        .getOperation({ path: { id: projectId, operationId } })
        .then((r) => fromOperation(rec(r)?.operation, rec(r)?.resource), () => ({ details: {} }));
    }
    return { outcome: 'in_progress', ...more, operationId: operationId ?? more.operationId, ...(operationUrl ? { operationUrl } : {}) };
  }
}

/** Poll the operation until it ends (or the deadline). Returns the last view. */
export async function waitForTelegram(
  client: Photon2AdminClient,
  projectId: string,
  operationId: string,
  opts: { sleep?: (ms: number) => Promise<void>; intervalMs?: number; timeoutMs?: number; onState?: (state: string) => void } = {},
): Promise<Omit<TelegramConnectResult, 'outcome'>> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = Date.now() + (opts.timeoutMs ?? 10 * 60_000);
  let last: Omit<TelegramConnectResult, 'outcome'> = { details: {} };
  let lastState: string | undefined;
  while (Date.now() < deadline) {
    const r = rec(await client.platforms.getOperation({ path: { id: projectId, operationId } }));
    last = fromOperation(r?.operation, r?.resource);
    if (last.state && last.state !== lastState) opts.onState?.((lastState = last.state));
    if (last.state === 'succeeded' || last.state === 'failed' || last.state === 'cancelled') return last;
    await sleep(opts.intervalMs ?? 5_000);
  }
  return last;
}

/** Human next steps for a connect result (no secrets in here: the setup link is meant to be opened by the human). */
export function telegramNextSteps(r: Omit<TelegramConnectResult, 'outcome'> & { outcome?: TelegramConnectResult['outcome'] }): string[] {
  const lines: string[] = [];
  if (r.outcome === 'in_progress') lines.push('A Telegram bot setup is already in progress for this project (409 TELEGRAM_PROVISION_IN_PROGRESS).');
  if (r.operationId) lines.push(`operation: ${r.operationId}${r.state ? `  state: ${r.state}` : ''}`);
  if (r.operationUrl) lines.push(`operation URL (API, poll with your key): ${r.operationUrl}`);
  for (const [k, v] of Object.entries(r.details)) lines.push(`${k}: ${v}`);
  if (r.resourceId) lines.push(`bot resource: ${r.resourceId}`);
  if (r.state === 'succeeded') {
    lines.push('Done: the managed bot is connected. Add it to your Telegram group (see docs/CHANNELS.md), then run: SURFACES=photon2 npm.cmd start');
  } else if (r.state === 'failed' || r.state === 'cancelled') {
    lines.push(`This setup ended (${r.state}${r.error ? `: ${r.error}` : ''}). Start a new one with: npm.cmd run photon2:telegram -- --fresh`);
  } else if (r.setupUrl) {
    lines.push(`NEXT: open this link on a device signed in to Telegram and create (or pick) the bot:\n  ${r.setupUrl}`);
    lines.push('Then re-run `npm.cmd run photon2:telegram` (same key, shows the status) or add `-- --wait` to watch it finish.');
  } else {
    lines.push('No setup link in the response (only shown to keys with platforms:write). Open app.beta.photon.codes → Platforms → Telegram.');
  }
  return lines;
}
