// Direct Telegram Bot API chat surface (SURFACES=telegram-direct): needs only a @BotFather token, no Photon project and
// no public URL. The plan for real Telegram groups: Photon 2.0's managed bot receives group messages but cannot send
// into groups (409 SPACE_NOT_SENDABLE "Telegram sends require a private chat Space", verified live 2026-10-17), and the
// spectrum-ts path (telegram.ts) depends on Photon's edge and is unverified for group inbound. Engine surface 'telegram'; mapping in
// telegram-direct-map.ts follows telegram.ts so the engine behaves the same.
// - Inbound: getUpdates long polling (timeout 25 s, allowed_updates message / edited_message / message_reaction), offset
//   tracking (an update_id below the offset is a duplicate), exponential backoff, 429 retry_after. On start: getMe (bot
//   id, username, privacy mode) and deleteWebhook WITHOUT drop_pending_updates (getUpdates is refused while a webhook
//   is set). Updates older than the backlog window (default 15 min before boot) are skipped, not replayed.
// - Outbound: sendMessage (plain text, reply_parameters for replies), editMessageText (tally header),
//   setMessageReaction, sendChatAction, sendDocument (.ics), leaveChat. Paced 1 message / s per chat; 429 retry_after.
// - Supergroup upgrade: the migrate_to / migrate_from notices map the new chat id onto the old space (in memory), and a
//   send that fails with migrate_to_chat_id is retried once on the new id.
// - Never logs the token (it only appears in request URLs), message text, names, handles or chat ids.

import type { Capabilities, MsgRef } from '../engine/types.js';
import type { Config } from '../config.js';
import { SafeError, silentLogger, type Logger } from '../privacy/logger.js';
import { Pacer } from './telegram.js';
import { CAPS, type ChannelAdapter, type ChannelInbound } from './types.js';
import {
  TELEGRAM_ALLOWED_UPDATES, botIdFromToken, chatIdParam, messageIdOf, normalizeTelegramUpdate, type TgFileRef,
} from './telegram-direct-map.js';

export const TELEGRAM_API_BASE = 'https://api.telegram.org';

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const idStr = (v: unknown): string | undefined => (typeof v === 'number' && Number.isInteger(v) ? String(v) : typeof v === 'string' && /^-?\d+$/.test(v) ? v : undefined);

/** Fixed reason codes classified from Bot API replies. Telegram's free-text descriptions are never kept or logged. */
export type TgErrorReason =
  | 'rate_limited' | 'unauthorized' | 'forbidden' | 'not_found' | 'conflict' | 'migrated' | 'not_modified'
  | 'bad_request' | 'server' | 'network' | 'timeout' | 'aborted' | 'bad_response';

export class TelegramApiError extends SafeError {
  constructor(
    readonly method: string,
    readonly status: number | undefined,
    readonly reason: TgErrorReason,
    readonly parameters: { retry_after?: number; migrate_to_chat_id?: number } = {},
  ) {
    super(`telegram-direct: ${method} failed (${status ?? 'no response'} ${reason})`);
    this.name = 'TelegramApiError';
  }
}

function classify(status: number | undefined, description: string): TgErrorReason {
  if (status === 429) return 'rate_limited';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status !== undefined && status >= 500) return 'server';
  if (/message is not modified/i.test(description)) return 'not_modified';
  if (/upgraded to a supergroup|migrated/i.test(description)) return 'migrated';
  return 'bad_request';
}

export interface CallOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Minimal Bot API client. The token lives only inside the request URLs built here. */
export interface TelegramApi {
  call<T = unknown>(method: string, params?: Rec, opts?: CallOptions): Promise<T>;
  upload<T = unknown>(method: string, form: FormData): Promise<T>;
  /** File bytes for a getFile file_path; undefined when larger than maxBytes. */
  download(filePath: string, maxBytes: number): Promise<Uint8Array | undefined>;
}

export function telegramApi(token: string, opts: { fetchFn?: typeof fetch; base?: string } = {}): TelegramApi {
  const f = opts.fetchFn ?? fetch;
  const base = (opts.base ?? TELEGRAM_API_BASE).replace(/\/+$/, '');
  const signalOf = (o: CallOptions) => {
    const t = AbortSignal.timeout(o.timeoutMs ?? 30_000);
    return o.signal ? AbortSignal.any([o.signal, t]) : t;
  };
  const fetchOnce = async (method: string, url: string, init: RequestInit, o: CallOptions): Promise<Response> => {
    try {
      return await f(url, { ...init, signal: signalOf(o) });
    } catch (err) {
      // Never wrap the original error: it can carry the request URL (and with it the token).
      const name = (err as Error | undefined)?.name;
      throw new TelegramApiError(method, undefined, o.signal?.aborted ? 'aborted' : name === 'TimeoutError' ? 'timeout' : 'network');
    }
  };
  const parse = async <T>(method: string, res: Response): Promise<T> => {
    let body: Rec | undefined;
    try {
      body = rec(await res.json());
    } catch {
      body = undefined;
    }
    if (body?.ok === true) return body.result as T;
    const status = num(body?.error_code) ?? res.status;
    const p = rec(body?.parameters);
    const parameters = {
      ...(num(p?.retry_after) !== undefined ? { retry_after: num(p?.retry_after) } : {}),
      ...(num(p?.migrate_to_chat_id) !== undefined ? { migrate_to_chat_id: num(p?.migrate_to_chat_id) } : {}),
    };
    const reason = !body ? 'bad_response' : parameters.migrate_to_chat_id !== undefined ? 'migrated' : classify(status, str(body.description) ?? '');
    throw new TelegramApiError(method, status, reason, parameters);
  };
  return {
    async call<T>(method: string, params: Rec = {}, o: CallOptions = {}): Promise<T> {
      const init = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) };
      return parse<T>(method, await fetchOnce(method, `${base}/bot${token}/${method}`, init, o));
    },
    async upload<T>(method: string, form: FormData): Promise<T> {
      return parse<T>(method, await fetchOnce(method, `${base}/bot${token}/${method}`, { method: 'POST', body: form }, { timeoutMs: 60_000 }));
    },
    async download(filePath: string, maxBytes: number): Promise<Uint8Array | undefined> {
      const res = await fetchOnce('download', `${base}/file/bot${token}/${filePath}`, { method: 'GET' }, { timeoutMs: 60_000 });
      if (!res.ok) throw new TelegramApiError('download', res.status, classify(res.status, ''));
      if (Number(res.headers.get('content-length') ?? 0) > maxBytes) return undefined;
      const bytes = new Uint8Array(await res.arrayBuffer());
      return bytes.length > maxBytes ? undefined : bytes;
    },
  };
}

/** Split text at Telegram's 4096-character message limit (on a newline or space when possible). */
export function splitTelegramText(text: string, max = 4096): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const cut = Math.max(rest.lastIndexOf('\n', max), rest.lastIndexOf(' ', max));
    const at = cut > max / 2 ? cut : max;
    out.push(rest.slice(0, at));
    rest = rest.slice(at).replace(/^[\n ]/, '');
  }
  out.push(rest);
  return out;
}

export interface TelegramDirectOptions {
  token: string;
  botUsername?: string;
  /** Reactions arrive only where the bot is a group admin, so votes-by-reaction are opt-in (TELEGRAM_REACTIONS=on). */
  reactionsIn?: boolean;
  logger?: Logger;
  fetchFn?: typeof fetch;
  apiBase?: string;
  now?: () => number;
  pacer?: Pacer;
  /** getUpdates long-poll timeout in seconds. */
  pollTimeoutSec?: number;
  maxBackoffMs?: number;
  /** Updates older than this before boot are skipped (Telegram keeps undelivered updates for 24 h). */
  backlogMs?: number;
  maxPhotoBytes?: number;
}

export interface TelegramBotInfo {
  id?: string;
  username?: string;
  canJoinGroups?: boolean;
  /** true = privacy mode off (the bot sees every group message). */
  canReadAllGroupMessages?: boolean;
}

export function parseBotInfo(me: unknown): TelegramBotInfo {
  const m = rec(me);
  const flag = (v: unknown) => (typeof v === 'boolean' ? v : undefined);
  return {
    ...(idStr(m?.id) ? { id: idStr(m?.id) } : {}),
    ...(str(m?.username) ? { username: str(m?.username) } : {}),
    ...(flag(m?.can_join_groups) !== undefined ? { canJoinGroups: flag(m?.can_join_groups) } : {}),
    ...(flag(m?.can_read_all_group_messages) !== undefined ? { canReadAllGroupMessages: flag(m?.can_read_all_group_messages) } : {}),
  };
}

export class TelegramDirectChannel implements ChannelAdapter {
  readonly surface = 'telegram' as const;
  readonly caps: Capabilities;
  readonly #api: TelegramApi;
  readonly #log: Logger;
  readonly #pacer: Pacer;
  readonly #now: () => number;
  readonly #o: { pollTimeoutSec: number; maxBackoffMs: number; backlogMs: number; maxPhotoBytes: number };
  /** old chat id -> new chat id (outbound redirect after a supergroup upgrade). */
  readonly #movedTo = new Map<string, string>();
  /** new chat id -> the space id the runner already knows (inbound alias, from live migrate notices only). */
  readonly #aliasOf = new Map<string, string>();
  readonly #abort = new AbortController();
  #botId?: string;
  #botUsername?: string;
  #onInbound?: (m: ChannelInbound) => Promise<void>;
  #offset = 0;
  #bootAt: number;
  #failures = 0;
  #started = false;
  #stopped = false;
  #loop?: Promise<void>;
  #timer?: NodeJS.Timeout;
  #wake?: () => void;

  constructor(opts: TelegramDirectOptions) {
    this.#api = telegramApi(opts.token, { fetchFn: opts.fetchFn, base: opts.apiBase });
    this.#log = opts.logger ?? silentLogger;
    this.#now = opts.now ?? Date.now;
    this.#pacer = opts.pacer ?? new Pacer({ intervalMs: 1_000 });
    this.#o = {
      pollTimeoutSec: opts.pollTimeoutSec ?? 25, maxBackoffMs: opts.maxBackoffMs ?? 60_000,
      backlogMs: opts.backlogMs ?? 15 * 60_000, maxPhotoBytes: opts.maxPhotoBytes ?? 10 * 1024 * 1024,
    };
    this.caps = { ...CAPS.telegram, reactionsIn: opts.reactionsIn ?? false };
    this.#botId = botIdFromToken(opts.token);
    this.#botUsername = opts.botUsername?.replace(/^@/, '');
    this.#bootAt = this.#now();
  }

  /** The bot's username (configured, else learned from getMe). */
  get botUsername(): string | undefined {
    return this.#botUsername;
  }

  /** Set the inbound handler without polling (tests drive pollOnce directly). */
  attach(onInbound: (m: ChannelInbound) => Promise<void>): void {
    this.#onInbound = onInbound;
  }

  async start(onInbound: (m: ChannelInbound) => Promise<void>): Promise<void> {
    this.attach(onInbound);
    if (this.#started) return;
    this.#started = true;
    await this.init();
    this.#log.info('telegram-direct: polling started', { timeoutSec: this.#o.pollTimeoutSec, reactionsIn: this.caps.reactionsIn });
    this.#loop = (async () => {
      while (!this.#stopped) {
        const delay = await this.pollOnce();
        if (this.#stopped) break;
        if (delay > 0) await new Promise<void>((r) => ((this.#wake = r), (this.#timer = setTimeout(r, delay))));
      }
    })();
  }

  /** getMe (id, username, privacy mode) and deleteWebhook (keeps pending updates). Failures are logged, not fatal. */
  async init(): Promise<void> {
    this.#bootAt = this.#now();
    try {
      const me = parseBotInfo(await this.#api.call('getMe', {}, { timeoutMs: 15_000 }));
      if (me.id) this.#botId = me.id;
      if (me.username) {
        if (this.#botUsername && this.#botUsername.toLowerCase() !== me.username.toLowerCase())
          this.#log.warn('telegram-direct: TELEGRAM_BOT_USERNAME does not match the bot of this token; using the bot username from getMe');
        this.#botUsername = me.username;
      }
      if (me.canReadAllGroupMessages === false)
        this.#log.warn('telegram-direct: privacy mode is ON, so in groups the bot sees only @mentions, replies to it and /commands. Fix: @BotFather /setprivacy -> Disable, then remove and re-add the bot; or make it a group admin');
    } catch (err) {
      const bad = err instanceof TelegramApiError && (err.reason === 'unauthorized' || err.reason === 'not_found');
      this.#log[bad ? 'error' : 'warn'](bad ? 'telegram-direct: bot token rejected; check TELEGRAM_BOT_TOKEN' : 'telegram-direct: getMe failed', { err });
    }
    if (!this.#botUsername) this.#log.warn('telegram-direct: bot username unknown, @mentions will not be detected (set TELEGRAM_BOT_USERNAME)');
    try {
      await this.#api.call('deleteWebhook', { drop_pending_updates: false }, { timeoutMs: 15_000 });
      this.#log.info('telegram-direct: deleteWebhook done (pending updates kept), long polling enabled');
    } catch (err) {
      this.#log.warn('telegram-direct: deleteWebhook failed; getUpdates is refused (409) while a webhook is set', { err });
    }
  }

  async stop(): Promise<void> {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#abort.abort();
    if (this.#timer) clearTimeout(this.#timer);
    this.#wake?.();
    await this.#loop?.catch(() => undefined);
    // Confirm handled updates so a restart does not read them again (the returned update stays unconfirmed).
    if (this.#started && this.#offset)
      await this.#api.call('getUpdates', { offset: this.#offset, limit: 1, timeout: 0 }, { timeoutMs: 5_000 }).catch(() => undefined);
  }

  /** One long poll: deliver every update in order. Returns ms to wait before the next poll. */
  async pollOnce(): Promise<number> {
    try {
      const params = { ...(this.#offset ? { offset: this.#offset } : {}), timeout: this.#o.pollTimeoutSec, allowed_updates: [...TELEGRAM_ALLOWED_UPDATES] };
      const updates = await this.#api.call<unknown>('getUpdates', params, { signal: this.#abort.signal, timeoutMs: (this.#o.pollTimeoutSec + 15) * 1000 });
      const list = Array.isArray(updates) ? updates : [];
      for (const u of list) await this.#ingest(u);
      if (this.#failures > 0) this.#log.info('telegram-direct: polling recovered', { failures: this.#failures });
      this.#failures = 0;
      return list.length ? 0 : 250;
    } catch (err) {
      if (this.#stopped) return 0;
      this.#failures++;
      const e = err instanceof TelegramApiError ? err : undefined;
      if (e?.reason === 'unauthorized' || e?.reason === 'not_found') {
        this.#log.error('telegram-direct: bot token rejected; check TELEGRAM_BOT_TOKEN', { status: e.status });
        return this.#o.maxBackoffMs;
      }
      let delay = Math.min(this.#o.maxBackoffMs, 1_000 * 2 ** (this.#failures - 1));
      if (e?.reason === 'rate_limited') delay = Math.max(1, e.parameters.retry_after ?? 5) * 1_000;
      if (e?.reason === 'conflict') {
        delay = Math.max(delay, 5_000);
        this.#log.warn('telegram-direct: 409 conflict: another process is polling this bot, or a webhook was set again', { retryInMs: delay });
        return delay;
      }
      this.#log.warn('telegram-direct: poll failed, backing off', { status: e?.status, reason: e?.reason, failures: this.#failures, retryInMs: delay, err });
      return delay;
    }
  }

  async #ingest(raw: unknown): Promise<void> {
    const id = num(rec(raw)?.update_id);
    if (id === undefined) return;
    if (id < this.#offset) {
      this.#log.debug('telegram-direct: duplicate update skipped');
      return;
    }
    this.#offset = id + 1;
    for (const ev of normalizeTelegramUpdate(raw, { botId: this.#botId, botUsername: this.#botUsername })) {
      if (ev.type === 'skip') {
        this.#log.debug('telegram-direct: update skipped', { reason: ev.reason });
        continue;
      }
      if (ev.type === 'migrate') {
        this.#migrated(ev.from, ev.to);
        continue;
      }
      if (ev.inbound.at && ev.inbound.at < this.#bootAt - this.#o.backlogMs) {
        this.#log.debug('telegram-direct: stale update skipped (older than the backlog window)');
        continue;
      }
      const alias = this.#aliasOf.get(ev.inbound.spaceId);
      const inbound = alias ? { ...ev.inbound, spaceId: alias } : ev.inbound;
      const m = ev.file ? await this.#withPhoto(inbound, ev.file) : inbound;
      try {
        await this.#onInbound?.(m);
      } catch (err) {
        this.#log.warn('telegram-direct: inbound handler failed', { kind: m.kind, err });
      }
    }
  }

  /** Live upgrade notice: route sends to the new id and keep the new chat's traffic on the old space. */
  #migrated(from: string, to: string): void {
    if (from === to || this.#movedTo.get(from) === to) return;
    const root = this.#aliasOf.get(from) ?? from;
    this.#movedTo.set(from, to);
    this.#movedTo.set(root, to);
    this.#aliasOf.set(to, root);
    this.#log.info('telegram-direct: group upgraded to a supergroup; the new chat keeps its plan');
  }

  #chat(spaceId: string): string {
    let id = spaceId;
    for (let i = 0; i < 5 && this.#movedTo.has(id); i++) id = this.#movedTo.get(id)!;
    return id;
  }

  /** Calls fn with the current chat id; on "migrated to <id>" remembers the move and retries once. */
  async #toChat<T>(spaceId: string, fn: (chatId: number | string) => Promise<T>): Promise<T> {
    const target = this.#chat(spaceId);
    try {
      return await fn(chatIdParam(target));
    } catch (err) {
      const to = err instanceof TelegramApiError ? idStr(err.parameters.migrate_to_chat_id) : undefined;
      if (!to || to === target) throw err;
      this.#movedTo.set(target, to);
      if (spaceId !== target) this.#movedTo.set(spaceId, to);
      this.#log.info('telegram-direct: chat moved to a supergroup; retrying on the new id');
      return fn(chatIdParam(to));
    }
  }

  async #withPhoto(inbound: ChannelInbound, file: TgFileRef): Promise<ChannelInbound> {
    const max = this.#o.maxPhotoBytes;
    if (file.size !== undefined && file.size > max) return inbound;
    try {
      const f = rec(await this.#api.call('getFile', { file_id: file.fileId }));
      const path = str(f?.file_path);
      const size = num(f?.file_size);
      if (!path || (size !== undefined && size > max)) return inbound;
      const bytes = await this.#api.download(path, max);
      return bytes ? { ...inbound, kind: 'photo', photo: { mime: file.mime, bytes } } : inbound;
    } catch (err) {
      this.#log.warn('telegram-direct: photo download failed', { err });
      return inbound;
    }
  }

  async #sendText(spaceId: string, text: string, replyTo?: number): Promise<MsgRef | undefined> {
    let first: MsgRef | undefined;
    for (const [i, chunk] of splitTelegramText(text).entries()) {
      const params: Rec = { text: chunk, link_preview_options: { is_disabled: true } };
      if (i === 0 && replyTo !== undefined) params.reply_parameters = { message_id: replyTo, allow_sending_without_reply: true };
      const res = await this.#pacer.run(spaceId, () => this.#toChat(spaceId, (chat_id) => this.#api.call('sendMessage', { chat_id, ...params })));
      first ??= idStr(rec(res)?.message_id);
    }
    return first;
  }

  send(spaceId: string, text: string): Promise<MsgRef | undefined> {
    return this.#sendText(spaceId, text);
  }

  reply(spaceId: string, to: MsgRef, text: string): Promise<MsgRef | undefined> {
    return this.#sendText(spaceId, text, messageIdOf(to));
  }

  async edit(spaceId: string, target: MsgRef, text: string): Promise<void> {
    const message_id = messageIdOf(target);
    if (message_id === undefined) return;
    try {
      await this.#pacer.run(spaceId, () => this.#toChat(spaceId, (chat_id) => this.#api.call('editMessageText', { chat_id, message_id, text: text.slice(0, 4096) })));
    } catch (err) {
      if (err instanceof TelegramApiError && err.reason === 'not_modified') return;
      throw err;
    }
  }

  async react(spaceId: string, to: MsgRef, emoji: string): Promise<void> {
    const message_id = messageIdOf(to);
    if (message_id === undefined) return;
    // Telegram's reaction set uses bare code points ("❤", not "❤️").
    const reaction = [{ type: 'emoji', emoji: emoji.replace(/️/g, '') }];
    await this.#pacer.run(spaceId, () => this.#toChat(spaceId, (chat_id) => this.#api.call('setMessageReaction', { chat_id, message_id, reaction })));
  }

  async typing(spaceId: string, on: boolean): Promise<void> {
    if (!on) return; // the typing status clears itself after ~5 s or on the next message
    await this.#toChat(spaceId, (chat_id) => this.#api.call('sendChatAction', { chat_id, action: 'typing' }));
  }

  async leave(spaceId: string): Promise<void> {
    await this.#toChat(spaceId, (chat_id) => this.#api.call('leaveChat', { chat_id }));
  }

  /** Bots cannot open a conversation: works only after the member started the bot in a private chat. */
  async dm(handle: string, text: string): Promise<MsgRef | undefined> {
    const res = await this.#pacer.run(handle, () => this.#api.call('sendMessage', { chat_id: chatIdParam(handle), text: text.slice(0, 4096) }));
    return idStr(rec(res)?.message_id);
  }

  async file(spaceId: string, name: string, mime: string, content: string, caption?: string): Promise<MsgRef | undefined> {
    const inline = caption !== undefined && caption.length <= 1024;
    const res = await this.#pacer.run(spaceId, () =>
      this.#toChat(spaceId, (chat_id) => {
        const form = new FormData();
        form.set('chat_id', String(chat_id));
        form.set('document', new Blob([content], { type: mime }), name);
        if (inline) form.set('caption', caption);
        return this.#api.upload('sendDocument', form);
      }),
    );
    if (caption !== undefined && !inline) await this.send(spaceId, caption);
    return idStr(rec(res)?.message_id);
  }
}

/** Boot helper: [] (with a warning) when no token is configured. */
export function createTelegramDirectAdapters(
  config: Pick<Config, 'telegramDirect' | 'telegramBotUsername'>,
  logger: Logger,
  fetchFn?: typeof fetch,
): ChannelAdapter[] {
  const { token, reactions } = config.telegramDirect;
  if (!token) {
    logger.warn('telegram-direct: skipped, TELEGRAM_BOT_TOKEN is not set');
    return [];
  }
  return [new TelegramDirectChannel({ token, botUsername: config.telegramBotUsername, reactionsIn: reactions, logger, fetchFn })];
}

export interface TelegramCheckResult extends TelegramBotInfo {
  /** undefined when getWebhookInfo failed. */
  webhookSet?: boolean;
  pendingUpdates?: number;
}

/** npm run telegram:check: getMe + getWebhookInfo. Returns flags and counts only (never the webhook URL). */
export async function checkTelegramBot(api: TelegramApi): Promise<TelegramCheckResult> {
  const me = parseBotInfo(await api.call('getMe'));
  try {
    const w = rec(await api.call('getWebhookInfo'));
    const pending = num(w?.pending_update_count);
    return { ...me, webhookSet: !!str(w?.url), ...(pending !== undefined ? { pendingUpdates: pending } : {}) };
  } catch {
    return me;
  }
}
