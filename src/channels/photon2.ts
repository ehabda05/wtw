// Photon 2.0 chat surface (SURFACES=photon2): one REST client, polled, serving up to three ChannelAdapter views
// (telegram; imessage-shared / imessage-dedicated for SMS + iMessage; see photon2-map.ts for why).
// - Inbound: GET /v1/projects/{id}/messages, direction=received, orderBy=created_at asc, createdSince = a watermark
//   minus an overlap window (the list is "eventually consistent"), every ~1.5 s, following nextPageToken. Starts at
//   boot time (no history replay). Dedupe by message id; own/agent messages skipped. Backoff on errors, Retry-After on 429.
// - Outbound: POST /v1/projects/{id}/messages with Idempotency-Key = a fresh per-send ref, reused on our 429 retry.
//   senderId is the agent that received the space's traffic (receivedBy), else resolved from the space's participants.
// - Never logs message text, handles, phone numbers, ids or keys. Not yet run against a live Photon 2.0 project.

import { randomUUID } from 'node:crypto';
import type {
  CountSpacesInput, DownloadAttachmentInput, GetAttachmentInput, GetOperationInput, GetSpaceInput, GetUserInput,
  ListMessagesInput, ListProjectPlatformsInput, SendMessageInput, SetSpaceTypingInput, ConnectTelegramBotInput,
} from '@photon-ai/api';
import type { Capabilities, MsgRef, Surface } from '../engine/types.js';
import type { Config, Photon2Platform } from '../config.js';
import { SafeError, silentLogger, type Logger } from '../privacy/logger.js';
import { PHOTON2_CAPS, normalizePhoton2, photon2IdAndTime } from './photon2-map.js';
import type { ChannelAdapter, ChannelInbound } from './types.js';

/** The slice of `photon.projects` the channel uses. Outputs are read defensively. */
export interface Photon2Client {
  listMessages(input: ListMessagesInput): Promise<{ items: readonly unknown[]; nextPageToken?: string }>;
  sendMessage(input: SendMessageInput): Promise<unknown>;
  getSpace(input: GetSpaceInput): Promise<unknown>;
  getUser(input: GetUserInput): Promise<unknown>;
  setSpaceTyping(input: SetSpaceTypingInput): Promise<unknown>;
  getAttachment(input: GetAttachmentInput): Promise<unknown>;
  downloadAttachment(input: DownloadAttachmentInput): Promise<Blob>;
}

/** The slice the setup scripts use (photon2:check, photon2:telegram). */
export interface Photon2AdminClient {
  countSpaces(input: CountSpacesInput): Promise<{ count: number }>;
  platforms: {
    listProjectPlatforms(input: ListProjectPlatformsInput): Promise<{ platforms: readonly { type: string }[] }>;
    connectTelegramBot(input: ConnectTelegramBotInput): Promise<unknown>;
    getOperation(input: GetOperationInput): Promise<unknown>;
  };
}

/** Real client (lazy import keeps boot light when photon2 is off). The key only goes in the Authorization header. */
export async function loadPhoton2Api(
  apiKey: string,
  opts: { fetch?: typeof globalThis.fetch; baseUrl?: string } = {},
): Promise<Photon2Client & Photon2AdminClient> {
  const { Photon } = await import('@photon-ai/api');
  // Short SDK retry (long Retry-After values surface as ApiError 429 so the poller's own backoff honors them).
  const photon = new Photon({
    headers: { Authorization: `Bearer ${apiKey}` },
    timeoutMs: 15_000,
    retry: { maxAttempts: 2, maximumRetryAfterMs: 5_000 },
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
    ...(opts.baseUrl ? { baseUrl: opts.baseUrl } : {}),
  });
  return photon.projects;
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => (v && typeof v === 'object' ? (v as Rec) : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

/** HTTP status of an ApiError (duck-typed so fakes work). */
export function apiStatus(err: unknown): number | undefined {
  const s = rec(err)?.status;
  return typeof s === 'number' ? s : undefined;
}

/** Delay for a 429: Retry-After (seconds or HTTP date), else 2 s. undefined for anything that is not a 429. */
export function retryAfterMs(err: unknown, now = Date.now()): number | undefined {
  if (apiStatus(err) !== 429) return undefined;
  const h = rec(err)?.headers as { get?: (k: string) => string | null } | undefined;
  const v = typeof h?.get === 'function' ? h.get('retry-after') : null;
  if (v) {
    const s = Number(v);
    if (Number.isFinite(s) && s >= 0) return Math.ceil(s * 1000);
    const d = Date.parse(v);
    if (Number.isFinite(d)) return Math.max(0, d - now);
  }
  return 2_000;
}

/** An agent this project owns (can be our senderId): dedicated lines/bots expose resourceId, shared iMessage type=shared. */
function isOwnAgent(user: unknown): boolean {
  const d = rec(rec(user)?.details);
  return !!str(d?.resourceId) || d?.type === 'shared';
}

/** Format of outbound text content (the contract types it as a free string). */
export const PHOTON2_TEXT_FORMAT = 'plain';

export interface Photon2Options {
  client: Photon2Client;
  projectId: string;
  platforms: readonly Photon2Platform[];
  botUsername?: string;
  logger?: Logger;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Idempotency-Key factory (one per logical send). */
  newRef?: () => string;
  pollIntervalMs?: number;
  /** Re-read window behind the watermark, for late-visible ("eventually consistent") messages. */
  overlapMs?: number;
  /** Accept messages created this long before boot (clock skew); older history is never replayed. */
  bootGraceMs?: number;
  maxBackoffMs?: number;
  pageSize?: number;
  maxPagesPerTick?: number;
  maxPhotoBytes?: number;
}

type Resolved = Required<Omit<Photon2Options, 'botUsername' | 'logger'>>;

interface SpaceInfo {
  platform: Photon2Platform;
  senderId?: string;
}

export class Photon2Channel {
  readonly #o: Resolved;
  readonly #log: Logger;
  readonly #views: Photon2View[];
  readonly #seen = new Map<string, number>();
  readonly #ownUserIds = new Set<string>();
  readonly #ownMessageIds = new Set<string>();
  readonly #spaces = new Map<string, SpaceInfo>();
  #botUsername?: string;
  #onInbound?: (m: ChannelInbound) => Promise<void>;
  #floor = 0;
  #watermark = 0;
  #failures = 0;
  #started = false;
  #stopped = false;
  #loop?: Promise<void>;
  #timer?: NodeJS.Timeout;
  #wake?: () => void;

  constructor(opts: Photon2Options) {
    this.#o = {
      now: Date.now, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), newRef: () => `homi-${randomUUID()}`,
      pollIntervalMs: 1_500, overlapMs: 20_000, bootGraceMs: 5_000, maxBackoffMs: 60_000, pageSize: 100, maxPagesPerTick: 10,
      maxPhotoBytes: 10 * 1024 * 1024, ...opts,
    } as Resolved;
    this.#log = opts.logger ?? silentLogger;
    this.#botUsername = opts.botUsername;
    const p = opts.platforms;
    this.#views = [];
    if (p.includes('telegram')) this.#views.push(new Photon2View(PHOTON2_CAPS.telegram, this));
    if (p.includes('sms') || p.includes('imessage')) this.#views.push(new Photon2View(PHOTON2_CAPS.phoneDirect, this), new Photon2View(PHOTON2_CAPS.phoneGroup, this));
    this.#floor = this.#watermark = this.#o.now() - this.#o.bootGraceMs;
  }

  adapters(): ChannelAdapter[] {
    return [...this.#views];
  }

  /** Set the inbound handler without starting the poll loop (tests drive pollOnce directly). */
  attach(onInbound: (m: ChannelInbound) => Promise<void>): void {
    this.#onInbound = onInbound;
  }

  async start(onInbound: (m: ChannelInbound) => Promise<void>): Promise<void> {
    this.attach(onInbound);
    if (this.#started) return;
    this.#started = true;
    this.#floor = this.#watermark = this.#o.now() - this.#o.bootGraceMs; // start from "now"
    this.#log.info('photon2: polling started', { platforms: this.#o.platforms, intervalMs: this.#o.pollIntervalMs });
    this.#loop = (async () => {
      while (!this.#stopped) {
        const delay = await this.pollOnce();
        if (this.#stopped) break;
        await new Promise<void>((r) => {
          this.#wake = r;
          this.#timer = setTimeout(r, delay);
        });
      }
    })();
  }

  async stop(): Promise<void> {
    if (this.#stopped) return;
    this.#stopped = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#wake?.();
    await this.#loop?.catch(() => undefined);
  }

  /** One poll: fetch every page since the watermark, deliver new messages in order. Returns ms until the next poll. */
  async pollOnce(): Promise<number> {
    const since = new Date(Math.max(this.#floor, this.#watermark - this.#o.overlapMs)).toISOString();
    const single = this.#o.platforms.length === 1 ? { platform: this.#o.platforms[0] } : {};
    try {
      let pageToken: string | undefined;
      let pages = 0;
      do {
        const page = await this.#o.client.listMessages({
          path: { id: this.#o.projectId },
          query: { createdSince: since, orderBy: 'created_at', order: 'asc', direction: 'received', pageSize: this.#o.pageSize, ...single, ...(pageToken ? { pageToken } : {}) },
        });
        for (const raw of page.items ?? []) await this.#ingest(raw);
        pageToken = page.nextPageToken;
      } while (pageToken && ++pages < this.#o.maxPagesPerTick && !this.#stopped);
      if (this.#failures > 0) this.#log.info('photon2: polling recovered', { failures: this.#failures });
      this.#failures = 0;
      const cutoff = Math.max(this.#floor, this.#watermark - this.#o.overlapMs) - 1_000;
      for (const [id, at] of this.#seen) if (at < cutoff) this.#seen.delete(id);
      return this.#o.pollIntervalMs;
    } catch (err) {
      this.#failures++;
      const status = apiStatus(err);
      const ra = retryAfterMs(err, this.#o.now());
      const delay = ra ?? Math.min(this.#o.maxBackoffMs, this.#o.pollIntervalMs * 2 ** this.#failures);
      if (status === 401 || status === 403) this.#log.error('photon2: API key rejected; check PHOTON2_API_KEY / PHOTON2_PROJECT_ID', { status });
      else this.#log.warn('photon2: poll failed, backing off', { status, failures: this.#failures, retryInMs: delay, err });
      return status === 401 || status === 403 ? this.#o.maxBackoffMs : delay;
    }
  }

  async #ingest(raw: unknown): Promise<void> {
    const it = photon2IdAndTime(raw);
    if (!it || it.createdAt < this.#floor || this.#seen.has(it.id)) return;
    this.#seen.set(it.id, it.createdAt);
    if (it.createdAt > this.#watermark) this.#watermark = it.createdAt;
    const n = normalizePhoton2(raw, { platforms: this.#o.platforms, ownUserIds: this.#ownUserIds, ownMessageIds: this.#ownMessageIds, botUsername: this.#botUsername });
    if ('skip' in n) {
      this.#log.debug('photon2: message skipped', { reason: n.skip });
      return;
    }
    const prev = this.#spaces.get(n.inbound.spaceId);
    this.#spaces.set(n.inbound.spaceId, { platform: n.platform, senderId: n.agentId ?? prev?.senderId });
    if (n.agentId) this.#ownUserIds.add(n.agentId);
    if (n.agentHandle && !this.#botUsername) this.#botUsername = n.agentHandle;
    const inbound = n.attachmentId ? await this.#withPhoto(n.inbound, n.attachmentId) : n.inbound;
    try {
      await this.#onInbound?.(inbound);
    } catch (err) {
      this.#log.warn('photon2: inbound handler failed', { kind: inbound.kind, err });
    }
  }

  /** Image attachments become kind 'photo' (bytes in memory only); anything else stays as it was. */
  async #withPhoto(inbound: ChannelInbound, attachmentId: string): Promise<ChannelInbound> {
    try {
      const path = { id: this.#o.projectId, attachmentId };
      const meta = rec(await this.#o.client.getAttachment({ path }));
      const mime = str(meta?.contentType)?.toLowerCase();
      const size = meta?.sizeBytes;
      if (!mime?.startsWith('image/') || (typeof size === 'number' && size > this.#o.maxPhotoBytes)) return inbound;
      const blob = await this.#o.client.downloadAttachment({ path });
      if (blob.size > this.#o.maxPhotoBytes) return inbound;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      return { ...inbound, kind: 'photo', photo: { mime, bytes } };
    } catch (err) {
      this.#log.warn('photon2: attachment fetch failed', { err });
      return inbound;
    }
  }

  async #spaceInfo(spaceId: string): Promise<SpaceInfo> {
    const known = this.#spaces.get(spaceId);
    if (known?.senderId) return known;
    // After a restart (scheduled sends) we have not seen this space yet: find our agent among its participants.
    const space = rec(await this.#o.client.getSpace({ path: { id: this.#o.projectId, spaceId } }));
    const platform = (str(space?.platform) ?? known?.platform) as Photon2Platform | undefined;
    if (!platform) throw new SafeError('photon2: space not found');
    const pids = space?.participantIds;
    const ids = (Array.isArray(pids) ? pids : []).filter((x): x is string => typeof x === 'string').slice(0, 25);
    let senderId = ids.find((id) => this.#ownUserIds.has(id));
    for (const userId of senderId ? [] : ids) {
      if (isOwnAgent(await this.#o.client.getUser({ path: { id: this.#o.projectId, userId } }).catch(() => undefined))) {
        senderId = userId;
        break;
      }
    }
    const info = { platform, senderId };
    this.#spaces.set(spaceId, info);
    if (senderId) this.#ownUserIds.add(senderId);
    return info;
  }

  async send(spaceId: string, text: string, parentMessageId?: string): Promise<MsgRef | undefined> {
    const info = await this.#spaceInfo(spaceId);
    if (!info.senderId) throw new SafeError('photon2: no agent sender known for this space');
    const body: SendMessageInput['body'] = {
      spaceId,
      senderId: info.senderId,
      content: { type: 'text', format: PHOTON2_TEXT_FORMAT, text },
      ...(parentMessageId ? { parentMessageId } : {}),
      ...(info.platform === 'telegram' ? { telegram: { richMessage: false } } : {}),
    };
    let res: unknown;
    try {
      res = await this.#sendOnce(body);
    } catch (err) {
      const s = apiStatus(err);
      if (parentMessageId && (s === 400 || s === 422)) return this.send(spaceId, text); // reply-to refused: plain send, new key
      throw err;
    }
    const id = str(rec(res)?.id);
    if (id) {
      this.#ownMessageIds.add(id);
      if (this.#ownMessageIds.size > 5_000) this.#ownMessageIds.delete(this.#ownMessageIds.values().next().value!);
    }
    return id;
  }

  /** One logical send = one Idempotency-Key, reused for our single 429 retry so Photon never double-sends. */
  async #sendOnce(body: SendMessageInput['body']): Promise<unknown> {
    const input: SendMessageInput = { path: { id: this.#o.projectId }, headers: { 'idempotency-key': this.#o.newRef() }, body };
    try {
      return await this.#o.client.sendMessage(input);
    } catch (err) {
      const ra = retryAfterMs(err, this.#o.now());
      if (ra === undefined || ra > 30_000) throw err;
      await this.#o.sleep(ra);
      return this.#o.client.sendMessage(input);
    }
  }

  async typing(spaceId: string, on: boolean): Promise<void> {
    const info = await this.#spaceInfo(spaceId);
    if (!info.senderId) return;
    await this.#o.client.setSpaceTyping({ path: { id: this.#o.projectId, spaceId }, body: { senderId: info.senderId, typing: on } });
  }
}

/** One surface's face of the shared channel. */
export class Photon2View implements ChannelAdapter {
  readonly surface: Surface;
  constructor(readonly caps: Capabilities, readonly channel: Photon2Channel) {
    this.surface = caps.surface;
  }
  start(onInbound: (m: ChannelInbound) => Promise<void>): Promise<void> {
    return this.channel.start(onInbound);
  }
  stop(): Promise<void> {
    return this.channel.stop();
  }
  send(spaceId: string, text: string): Promise<MsgRef | undefined> {
    return this.channel.send(spaceId, text);
  }
  reply(spaceId: string, to: MsgRef, text: string): Promise<MsgRef | undefined> {
    return this.channel.send(spaceId, text, this.caps.inlineReply ? to : undefined);
  }
  typing(spaceId: string, on: boolean): Promise<void> {
    return this.channel.typing(spaceId, on);
  }
}

/** Boot helper: [] (with a warning) when credentials are missing. */
export async function createPhoton2Adapters(
  config: Pick<Config, 'photon2' | 'telegramBotUsername'>,
  logger: Logger,
  client?: Photon2Client,
): Promise<ChannelAdapter[]> {
  const { apiKey, projectId, platforms } = config.photon2;
  if (!projectId || (!apiKey && !client)) {
    logger.warn('photon2: skipped, needs PHOTON2_API_KEY and PHOTON2_PROJECT_ID');
    return [];
  }
  const api = client ?? (await loadPhoton2Api(apiKey!));
  return new Photon2Channel({ client: api, projectId, platforms, botUsername: config.telegramBotUsername, logger }).adapters();
}
