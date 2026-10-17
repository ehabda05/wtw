// Telegram via spectrum-ts (inbound through Photon's Fusor edge; outbound direct to the Bot API).
// - Entities and reply_to are dropped by the SDK, so mentions are a regex on @<bot> and /cmd@<bot>.
//   "/start@<bot> <token>" (the ?startgroup= deep link) counts as addressed.
// - Reaction targets are stubs { id: String(message_id) }: the same id string space.send returns, so refs match.
// - space.leave() silently no-ops: leave via POST https://api.telegram.org/bot<TOKEN>/leaveChat.
// - Pacing: at most 1 message / 3 s per chat; on 429 wait retry_after and retry once.
// - Never registered without Photon project credentials (it would kill the whole merged stream).

import type { Capabilities, MsgRef } from '../engine/types.js';
import type { Config } from '../config.js';
import { SafeError, silentLogger, type Logger } from '../privacy/logger.js';
import {
  PlatformCache,
  SpectrumChannel,
  type ContentLike,
  type HubContext,
  type MessageLike,
  type PlatformBinding,
  type PlatformFn,
  type SpaceLike,
} from './spectrum.js';
import { CAPS, type ChannelAdapter, type ChannelInbound } from './types.js';

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Regex matching "@bot" anywhere or "/cmd@bot" (case-insensitive). */
export function telegramMentionRegex(botUsername: string): RegExp {
  const u = escapeRe(botUsername.replace(/^@/, ''));
  return new RegExp(`(?:^|[^\\w@])@${u}\\b|(?:^|\\s)\\/[A-Za-z0-9_]+@${u}\\b`, 'i');
}

export function isTelegramAddressed(text: string, botUsername: string | undefined): boolean {
  if (!botUsername) return false;
  return telegramMentionRegex(botUsername).test(text);
}

/** True for the "add to group" deep-link message "/start@bot <token>" (or bare "/start@bot"). */
export function isStartGroup(text: string, botUsername: string | undefined): boolean {
  if (!botUsername) return false;
  return new RegExp(`^\\s*\\/start@${escapeRe(botUsername.replace(/^@/, ''))}\\b`, 'i').test(text);
}

function textOf(c: ContentLike): string | undefined {
  if ((c.type === 'text' || c.type === 'markdown') && typeof c.text === 'string') return c.text;
  if (c.type === 'group' && c.items) {
    for (const it of c.items) if (it.content && it.content.type === 'text' && typeof it.content.text === 'string') return it.content.text;
  }
  return undefined;
}

export interface TelegramNormalizeOptions {
  botUsername?: string;
}

/** Pure normalizer: telegram [space, message] -> ChannelInbound. */
export function normalizeTelegram(space: { id: string }, message: MessageLike, opts: TelegramNormalizeOptions): ChannelInbound | null {
  const chatId = space.id;
  const isGroup = Number(chatId) < 0;
  const at = message.timestamp instanceof Date ? message.timestamp.getTime() : Date.now();
  const sender = message.sender;
  if (!sender) return null;
  const from = { handle: String(sender.id), ...(typeof sender.handle === 'string' && sender.handle ? { platformName: sender.handle } : {}) };
  const base = { surface: 'telegram' as const, spaceId: chatId, isGroup, msgId: message.id, at, from };
  const c = message.content;
  if (c.type === 'reaction') {
    if (!c.emoji || !c.target?.id) return null;
    return { ...base, kind: 'reaction', mentionsAgent: false, reaction: { emoji: c.emoji, target: String(c.target.id) } };
  }
  const text = textOf(c);
  if (text !== undefined) {
    const mentions = isTelegramAddressed(text, opts.botUsername) || isStartGroup(text, opts.botUsername);
    return { ...base, kind: 'text', text, mentionsAgent: !isGroup || mentions };
  }
  return { ...base, kind: 'other', mentionsAgent: false };
}

// ───────────── pacing ─────────────

export function retryAfterSeconds(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const e = err as Record<string, unknown>;
  const candidates: unknown[] = [
    e.retry_after,
    e.retryAfter,
    (e.parameters as Record<string, unknown> | undefined)?.retry_after,
    ((e.response as Record<string, unknown> | undefined)?.parameters as Record<string, unknown> | undefined)?.retry_after,
    ((e.cause as Record<string, unknown> | undefined)?.parameters as Record<string, unknown> | undefined)?.retry_after,
  ];
  for (const c of candidates) if (typeof c === 'number' && c >= 0) return c;
  const msg = typeof e.message === 'string' ? e.message : '';
  const m = /retry[ _-]?after[^0-9]{0,5}(\d+)/i.exec(msg);
  if (m) return Number(m[1]);
  if (/\b429\b|too many requests/i.test(msg)) return 3;
  return undefined;
}

export interface PacerOptions {
  intervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Serializes sends per chat with a minimum interval, and retries once after a 429 retry_after. */
export class Pacer {
  readonly #next = new Map<string, number>();
  readonly #chains = new Map<string, Promise<unknown>>();
  readonly #interval: number;
  readonly #now: () => number;
  readonly #sleep: (ms: number) => Promise<void>;

  constructor(opts: PacerOptions = {}) {
    this.#interval = opts.intervalMs ?? 3000;
    this.#now = opts.now ?? Date.now;
    this.#sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  run<T>(chatId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.#chains.get(chatId) ?? Promise.resolve();
    const task = async (): Promise<T> => {
      const wait = (this.#next.get(chatId) ?? 0) - this.#now();
      if (wait > 0) await this.#sleep(wait);
      try {
        return await fn();
      } catch (err) {
        const ra = retryAfterSeconds(err);
        if (ra === undefined) throw err;
        await this.#sleep(ra * 1000);
        return await fn();
      } finally {
        this.#next.set(chatId, this.#now() + this.#interval);
      }
    };
    const p = prev.then(task, task);
    this.#chains.set(chatId, p.catch(() => undefined));
    return p;
  }
}

// ───────────── adapter ─────────────

export interface TelegramAdapterOptions {
  config: Pick<Config, 'spectrum' | 'telegramBotUsername'>;
  logger?: Logger;
  pacer?: Pacer;
  fetchFn?: typeof fetch;
}

export class TelegramAdapter extends SpectrumChannel implements PlatformBinding {
  readonly surface = 'telegram' as const;
  readonly caps: Capabilities = CAPS.telegram;
  readonly platformId = 'telegram';
  readonly #config: TelegramAdapterOptions['config'];
  readonly #pacer: Pacer;
  readonly #fetch: typeof fetch;
  #fn?: PlatformFn;

  constructor(opts: TelegramAdapterOptions) {
    super(new PlatformCache(), opts.logger ?? silentLogger);
    this.#config = opts.config;
    this.#pacer = opts.pacer ?? new Pacer();
    this.#fetch = opts.fetchFn ?? fetch;
  }

  async provider(): Promise<unknown | null> {
    const { projectId, projectSecret, telegramBotToken, telegramWebhookSecret } = this.#config.spectrum;
    if (!projectId || !projectSecret) {
      this.log.warn('telegram: skipped, needs SPECTRUM_PROJECT_ID and SPECTRUM_PROJECT_SECRET (Fusor inbound)');
      return null;
    }
    if (!telegramBotToken) {
      this.log.warn('telegram: skipped, SPECTRUM_TELEGRAM_BOT_TOKEN is not set');
      return null;
    }
    if (!this.#config.telegramBotUsername) this.log.warn('telegram: TELEGRAM_BOT_USERNAME not set, @mentions will not be detected');
    const mod = await import('spectrum-ts/providers/telegram');
    this.#fn = mod.telegram as unknown as PlatformFn;
    return mod.telegram.config({ botToken: telegramBotToken, ...(telegramWebhookSecret ? { webhookSecret: telegramWebhookSecret } : {}) });
  }

  attach(ctx: HubContext): void {
    this.bind(ctx, this.#fn);
  }

  adapters(): ChannelAdapter[] {
    return [this];
  }

  async handle(space: SpaceLike, message: MessageLike): Promise<void> {
    this.remember(space, message);
    const inbound = normalizeTelegram(space, message, { botUsername: this.#config.telegramBotUsername });
    if (inbound) await this.deliver(inbound);
  }

  override async send(spaceId: string, text: string): Promise<MsgRef | undefined> {
    return this.#pacer.run(spaceId, () => super.send(spaceId, text));
  }

  override async reply(spaceId: string, to: MsgRef, text: string): Promise<MsgRef | undefined> {
    return this.#pacer.run(spaceId, () => super.reply(spaceId, to, text));
  }

  override async file(spaceId: string, name: string, mime: string, content: string, caption?: string): Promise<MsgRef | undefined> {
    return this.#pacer.run(spaceId, () => super.file(spaceId, name, mime, content, caption));
  }

  override async edit(spaceId: string, target: MsgRef, text: string): Promise<void> {
    return this.#pacer.run(spaceId, () => super.edit(spaceId, target, text));
  }

  override async dm(handle: string, text: string): Promise<MsgRef | undefined> {
    if (!this.caps.dm) return undefined;
    // Bots cannot open a conversation: works only after the member tapped t.me/<bot>?start=...
    return this.#pacer.run(handle, async () => {
      const api = this.api();
      const user = await api.user(handle);
      const space = await api.space.create(user);
      this.cache.spaces.set(space.id, space);
      return this.track(await space.send(text));
    });
  }

  /** space.leave() is a silent no-op on Telegram; call the Bot API directly. The token never reaches logs. */
  override async leave(spaceId: string): Promise<void> {
    const token = this.#config.spectrum.telegramBotToken;
    if (!token) throw new SafeError('telegram leave: bot token missing');
    let status = 0;
    let ok = false;
    try {
      const res = await this.#fetch(`https://api.telegram.org/bot${token}/leaveChat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: /^-?\d+$/.test(spaceId) ? Number(spaceId) : spaceId }),
      });
      status = res.status;
      ok = res.ok;
    } catch {
      throw new SafeError('telegram leaveChat request failed');
    }
    if (!ok) throw new SafeError(`telegram leaveChat returned HTTP ${status}`);
  }
}
