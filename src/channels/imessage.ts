// iMessage: cloud (spectrum-ts/providers/imessage, shared or dedicated line) and macOS local
// (@spectrum-ts/imessage-local, NOT installed by default: loaded with a guarded dynamic import).
//
// Cloud:
//  - imessage(space).phone === 'shared' -> CAPS['imessage-shared'] (DMs only, #217), else CAPS['imessage-dedicated'].
//  - dedicated groups: space.getMembers() -> a 'members' inbound (first sight per process and on membership events).
//  - tapbacks arrive as content 'reaction' with the full target message.
//  - inline replies arrive as content 'reply' { content, target }: unwrapped.
//  - mention metadata (message.mentions[].address === our line) -> mentionsAgent.
// Local (platform 'local_imessage'):
//  - replies are wrapped with a stub target: unwrapped; send via space.send (message.reply is a no-op).
//  - allowlist: a chat that never had a Homi trigger is dropped before anything is logged.

import type { Capabilities, Surface } from '../engine/types.js';
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
  type UserLike,
} from './spectrum.js';
import { CAPS, type ChannelAdapter, type ChannelInbound } from './types.js';

export const LOCAL_IMESSAGE_PACKAGE = '@spectrum-ts/imessage-local';

interface UnwrappedContent {
  inner: ContentLike;
  replyTo?: string;
}

/** Unwrap content.type 'reply' -> inner content + target id. */
export function unwrapReply(c: ContentLike): UnwrappedContent {
  if (c.type === 'reply' && c.content) return { inner: c.content, replyTo: c.target?.id };
  return { inner: c };
}

export function imessageSurfaceOf(space: { phone?: unknown }): Surface {
  return space.phone === 'shared' ? 'imessage-shared' : 'imessage-dedicated';
}

export function isImessageGroup(space: { id: string; type?: unknown }): boolean {
  if (space.type === 'group') return true;
  if (space.type === 'dm') return false;
  return space.id.includes(';+;');
}

function mentionsLine(message: MessageLike, linePhone: string | undefined): boolean {
  const mentions = message.mentions as readonly { address?: string }[] | undefined;
  if (!Array.isArray(mentions) || mentions.length === 0 || !linePhone || linePhone === 'shared') return false;
  return mentions.some((m) => m.address === linePhone);
}

export interface CloudNormalized {
  inbound: ChannelInbound | null;
  /** A membership event happened: the adapter should refresh the roster. */
  membershipChanged: boolean;
  /** Our own line was in an addMember event. */
  addedSelf: boolean;
}

/** Pure normalizer for cloud iMessage. */
export function normalizeImessageCloud(space: SpaceLike & { phone?: unknown; type?: unknown }, message: MessageLike): CloudNormalized {
  const surface = imessageSurfaceOf(space);
  const isGroup = isImessageGroup(space);
  const at = message.timestamp instanceof Date ? message.timestamp.getTime() : Date.now();
  const sender: UserLike | undefined = message.sender;
  const linePhone = typeof space.phone === 'string' ? space.phone : undefined;
  const base = { surface, spaceId: space.id, isGroup, msgId: message.id, at };
  const c = message.content;

  if (c.type === 'addMember' || c.type === 'removeMember' || c.type === 'leaveSpace') {
    const addedSelf = c.type === 'addMember' && !!linePhone && (c.members ?? []).includes(linePhone);
    return {
      inbound: addedSelf ? { ...base, kind: 'added_to_group', mentionsAgent: false } : null,
      membershipChanged: true,
      addedSelf,
    };
  }
  if (!sender) return { inbound: null, membershipChanged: false, addedSelf: false };
  const from = { handle: String(sender.id) };

  if (c.type === 'reaction') {
    if (!c.emoji || !c.target?.id) return { inbound: null, membershipChanged: false, addedSelf: false };
    return {
      inbound: { ...base, kind: 'reaction', from, mentionsAgent: false, reaction: { emoji: c.emoji, target: String(c.target.id) } },
      membershipChanged: false,
      addedSelf: false,
    };
  }
  const { inner, replyTo } = unwrapReply(c);
  if ((inner.type === 'text' || inner.type === 'markdown') && typeof inner.text === 'string') {
    return {
      inbound: {
        ...base,
        kind: 'text',
        from,
        text: inner.text,
        mentionsAgent: mentionsLine(message, linePhone) || !isGroup,
        ...(replyTo ? { replyTo } : {}),
      },
      membershipChanged: false,
      addedSelf: false,
    };
  }
  return { inbound: { ...base, kind: 'other', from, mentionsAgent: false }, membershipChanged: false, addedSelf: false };
}

/** Default allowlist trigger for local iMessage: Homi's name or a slash command. */
export function defaultLocalTrigger(text: string): boolean {
  return /\bhomi\b/i.test(text) || /^\s*\/(plan|homi|start)\b/i.test(text);
}

export interface LocalNormalizeOptions {
  /** Is this chat already known (consent store / spaces table)? */
  isKnown: (spaceId: string) => boolean;
  isTrigger?: (text: string) => boolean;
}

/** Pure normalizer for macOS local iMessage, with the allowlist applied first. */
export function normalizeImessageLocal(space: SpaceLike & { type?: unknown }, message: MessageLike, opts: LocalNormalizeOptions): ChannelInbound | null {
  const { inner, replyTo } = unwrapReply(message.content);
  const text = (inner.type === 'text' || inner.type === 'markdown') && typeof inner.text === 'string' ? inner.text : undefined;
  // Allowlist BEFORE anything else (no logging): unknown chats need an explicit Homi trigger.
  if (!opts.isKnown(space.id)) {
    if (text === undefined || !(opts.isTrigger ?? defaultLocalTrigger)(text)) return null;
  }
  const sender = message.sender;
  if (!sender) return null;
  const at = message.timestamp instanceof Date ? message.timestamp.getTime() : Date.now();
  const base = {
    surface: 'imessage-local' as const,
    spaceId: space.id,
    isGroup: isImessageGroup(space),
    msgId: message.id,
    at,
    from: { handle: String(sender.id) },
    mentionsAgent: false,
  };
  if (text !== undefined) return { ...base, kind: 'text', text, ...(replyTo ? { replyTo } : {}) };
  return { ...base, kind: 'other' };
}

// ───────────── cloud adapters ─────────────

class ImessageCloudChannel extends SpectrumChannel {
  readonly surface: Surface;
  readonly caps: Capabilities;
  constructor(surface: 'imessage-shared' | 'imessage-dedicated', cache: PlatformCache, logger: Logger) {
    super(cache, logger);
    this.surface = surface;
    this.caps = CAPS[surface];
  }
}

export interface ImessageCloudOptions {
  config: Pick<Config, 'spectrum'>;
  logger?: Logger;
}

/** One binding for platform 'imessage' serving two ChannelAdapters (shared + dedicated profiles). */
export class ImessageCloudBinding implements PlatformBinding {
  readonly platformId = 'imessage';
  readonly shared: ImessageCloudChannel;
  readonly dedicated: ImessageCloudChannel;
  readonly #config: ImessageCloudOptions['config'];
  readonly #log: Logger;
  readonly #rosterFetched = new Set<string>();
  #fn?: PlatformFn;

  constructor(opts: ImessageCloudOptions) {
    const cache = new PlatformCache();
    this.#log = opts.logger ?? silentLogger;
    this.#config = opts.config;
    this.shared = new ImessageCloudChannel('imessage-shared', cache, this.#log);
    this.dedicated = new ImessageCloudChannel('imessage-dedicated', cache, this.#log);
  }

  adapters(): ChannelAdapter[] {
    return [this.shared, this.dedicated];
  }

  async provider(): Promise<unknown | null> {
    if (!this.#config.spectrum.projectId || !this.#config.spectrum.projectSecret) {
      this.#log.warn('imessage: skipped, needs SPECTRUM_PROJECT_ID and SPECTRUM_PROJECT_SECRET');
      return null;
    }
    const mod = await import('spectrum-ts/providers/imessage');
    this.#fn = mod.imessage as unknown as PlatformFn;
    return mod.imessage.config();
  }

  attach(ctx: HubContext): void {
    this.shared.bind(ctx, this.#fn);
    this.dedicated.bind(ctx, this.#fn);
  }

  async #roster(channel: ImessageCloudChannel, space: SpaceLike, at: number): Promise<void> {
    if (!space.getMembers) return;
    try {
      const members = await space.getMembers();
      await channel.deliver({
        surface: channel.surface,
        spaceId: space.id,
        isGroup: true,
        kind: 'members',
        msgId: `members:${at}:${members.length}`,
        mentionsAgent: false,
        members: members.map((m) => ({ handle: String(m.id) })),
        at,
      });
    } catch (err) {
      this.#log.warn('imessage: roster fetch failed', { err });
    }
  }

  async handle(space: SpaceLike, message: MessageLike): Promise<void> {
    const s = space as SpaceLike & { phone?: unknown; type?: unknown };
    const n = normalizeImessageCloud(s, message);
    const channel = imessageSurfaceOf(s) === 'imessage-shared' ? this.shared : this.dedicated;
    channel.remember(space, message);
    const dedicatedGroup = channel === this.dedicated && isImessageGroup(s);
    const at = message.timestamp instanceof Date ? message.timestamp.getTime() : Date.now();
    if (dedicatedGroup && n.addedSelf && n.inbound) await channel.deliver(n.inbound);
    if (dedicatedGroup && (n.membershipChanged || !this.#rosterFetched.has(space.id))) {
      this.#rosterFetched.add(space.id);
      await this.#roster(channel, space, at);
    }
    if (n.inbound && !n.addedSelf) await channel.deliver(n.inbound);
  }
}

// ───────────── local adapter ─────────────

export interface LocalImessageOptions {
  logger?: Logger;
  isKnown: (spaceId: string) => boolean;
  isTrigger?: (text: string) => boolean;
  /** Override the module loader (tests). */
  loadModule?: () => Promise<{ localIMessage: { config(): unknown } & PlatformFn }>;
}

export class LocalImessageAdapter extends SpectrumChannel implements PlatformBinding {
  readonly surface = 'imessage-local' as const;
  readonly caps: Capabilities = CAPS['imessage-local'];
  readonly platformId = 'local_imessage';
  readonly #opts: LocalImessageOptions;
  #fn?: PlatformFn;

  constructor(opts: LocalImessageOptions) {
    super(new PlatformCache(), opts.logger ?? silentLogger);
    this.#opts = opts;
  }

  adapters(): ChannelAdapter[] {
    return [this];
  }

  async provider(): Promise<unknown | null> {
    let mod: { localIMessage?: { config(): unknown } & PlatformFn };
    try {
      if (this.#opts.loadModule) {
        mod = await this.#opts.loadModule();
      } else {
        const spec: string = LOCAL_IMESSAGE_PACKAGE;
        mod = (await import(spec)) as typeof mod;
      }
    } catch {
      throw new SafeError(
        `imessage-local: ${LOCAL_IMESSAGE_PACKAGE} is not installed. On the macOS 26+ Mac run: ` +
          `bun add @spectrum-ts/imessage-local@12.11.0 (needs Full Disk Access and Messages.app running).`,
      );
    }
    if (!mod.localIMessage) throw new SafeError(`imessage-local: ${LOCAL_IMESSAGE_PACKAGE} does not export localIMessage`);
    this.#fn = mod.localIMessage;
    return mod.localIMessage.config();
  }

  attach(ctx: HubContext): void {
    this.bind(ctx, this.#fn);
  }

  async handle(space: SpaceLike, message: MessageLike): Promise<void> {
    const inbound = normalizeImessageLocal(space, message, { isKnown: this.#opts.isKnown, isTrigger: this.#opts.isTrigger });
    if (!inbound) return; // not allowlisted: dropped before any logging
    this.remember(space, message);
    await this.deliver(inbound);
  }

  // message.reply / react / edit / leave are no-ops on local: always plain space.send.
  override async reply(spaceId: string, _to: string, text: string): Promise<string | undefined> {
    return this.send(spaceId, text);
  }
}
