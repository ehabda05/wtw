// spectrum-ts bootstrap: ONE Spectrum() for every Photon surface in SURFACES, telemetry off.
// Loops app.messages, routes [space, message] to the platform binding (terminal / telegram / imessage /
// local_imessage), which normalizes it into a ChannelInbound. Outbound goes through the same app.
//
// Notes (research/platform-setup.md):
//  - Telegram must NEVER be registered without projectId + projectSecret: Fusor then fails the whole merged stream.
//  - spectrum-ts' root entry only re-exports core at runtime; providers load from 'spectrum-ts/providers/<name>'.
//  - Unsupported sends warn-and-skip (no throw), so adapters branch on Capabilities instead of catching.
//  - SDK modules are imported dynamically so tests of the pure normalizers never load Photon.

import type * as SpectrumTs from 'spectrum-ts';
import type { Capabilities, MsgRef, Surface } from '../engine/types.js';
import type { Config } from '../config.js';
import { SafeError, silentLogger, type Logger } from '../privacy/logger.js';
import type { ChannelAdapter, ChannelInbound } from './types.js';

export type SpectrumSdk = typeof SpectrumTs;

// ───────────── structural views of SDK objects (keeps normalizers testable with plain objects) ─────────────

export interface ContentLike {
  type: string;
  text?: string;
  emoji?: string;
  target?: { id: string; content?: unknown };
  content?: ContentLike;
  members?: readonly string[];
  items?: readonly { id?: string; content?: ContentLike }[];
  [k: string]: unknown;
}

export interface UserLike {
  id: string;
  kind?: string;
  handle?: string;
  [k: string]: unknown;
}

export interface MessageLike {
  id: string;
  content: ContentLike;
  platform?: string;
  direction?: 'inbound' | 'outbound';
  sender?: UserLike;
  timestamp?: Date;
  [k: string]: unknown;
}

export interface SpaceLike {
  id: string;
  send(content: unknown): Promise<MessageLike | undefined>;
  edit?(message: unknown, content: unknown): Promise<void>;
  leave?(): Promise<void>;
  startTyping?(): Promise<void>;
  stopTyping?(): Promise<void>;
  getMessage?(id: string): Promise<MessageLike | undefined>;
  getMembers?(): Promise<UserLike[]>;
  [k: string]: unknown;
}

/** Minimal view of a PlatformInstance (e.g. telegram(app)). */
export interface PlatformApiLike {
  space: { get(id: string): Promise<SpaceLike>; create(users: unknown): Promise<SpaceLike> };
  user(id: string): Promise<unknown>;
}

export type PlatformFn = (app: unknown) => PlatformApiLike;

export interface HubContext {
  app: unknown;
  sdk: SpectrumSdk;
  logger: Logger;
}

/** One per Photon platform id; registered with the hub. */
export interface PlatformBinding {
  readonly platformId: string;
  /** Build the provider config, or null to skip this platform (the binding logs why, without secrets). */
  provider(): Promise<unknown | null>;
  attach(ctx: HubContext): void;
  handle(space: SpaceLike, message: MessageLike): Promise<void>;
  /** ChannelAdapters this binding serves (iMessage cloud serves two surfaces). */
  adapters(): ChannelAdapter[];
}

// ───────────── shared caches + base adapter ─────────────

export class Lru<V> {
  readonly #m = new Map<string, V>();
  constructor(private readonly max: number) {}
  get(k: string): V | undefined {
    const v = this.#m.get(k);
    if (v !== undefined) {
      this.#m.delete(k);
      this.#m.set(k, v);
    }
    return v;
  }
  set(k: string, v: V): void {
    this.#m.delete(k);
    this.#m.set(k, v);
    if (this.#m.size > this.max) {
      const first = this.#m.keys().next().value;
      if (first !== undefined) this.#m.delete(first);
    }
  }
  has(k: string): boolean {
    return this.#m.has(k);
  }
  get size(): number {
    return this.#m.size;
  }
}

/** Per-platform caches shared by every adapter of that platform. */
export class PlatformCache {
  readonly spaces = new Lru<SpaceLike>(500);
  readonly messages = new Lru<MessageLike>(2000);
}

export function stubMessage(id: string): MessageLike {
  return { id, content: { type: 'text', text: '' } };
}

// ───────────── inbound photos (shared album) ─────────────

const IMAGE_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic']);
export const MAX_INBOUND_PHOTO_BYTES = 10 * 1024 * 1024;

/** Image attachments of a message (a reply is unwrapped; a group yields its images and first text). Pure. */
export function imageAttachments(c: ContentLike): { items: ContentLike[]; caption?: string; replyTo?: string } {
  const replyTo = c.type === 'reply' ? c.target?.id : undefined;
  const inner = c.type === 'reply' && c.content ? c.content : c;
  const parts = inner.type === 'group' && inner.items ? inner.items.map((it) => it.content).filter((x): x is ContentLike => !!x) : [inner];
  const items = parts.filter(
    (p) => p.type === 'attachment' && typeof p.mimeType === 'string' && IMAGE_TYPES.has(p.mimeType.split(';')[0].trim().toLowerCase()) && typeof p.read === 'function',
  );
  const caption = parts.find((p) => (p.type === 'text' || p.type === 'markdown') && typeof p.text === 'string')?.text;
  return { items, ...(caption ? { caption } : {}), ...(replyTo ? { replyTo: String(replyTo) } : {}) };
}

/** Reads one image attachment into memory (never to disk here); null when it is over 10 MB. */
export async function readImage(att: ContentLike): Promise<{ mime: string; bytes: Uint8Array } | null> {
  if (typeof att.size === 'number' && att.size > MAX_INBOUND_PHOTO_BYTES) return null;
  const bytes = await (att.read as () => Promise<Uint8Array>)();
  if (!bytes || bytes.byteLength === 0 || bytes.byteLength > MAX_INBOUND_PHOTO_BYTES) return null;
  return { mime: String(att.mimeType), bytes };
}

/**
 * Base ChannelAdapter over a spectrum-ts platform. Subclasses set surface/caps and may override outbound methods.
 */
export abstract class SpectrumChannel implements ChannelAdapter {
  abstract readonly surface: Surface;
  abstract readonly caps: Capabilities;
  protected onInbound?: (m: ChannelInbound) => Promise<void>;
  protected ctx?: HubContext;
  protected platformFn?: PlatformFn;

  constructor(
    protected readonly cache: PlatformCache,
    protected readonly log: Logger = silentLogger,
  ) {}

  async start(onInbound: (m: ChannelInbound) => Promise<void>): Promise<void> {
    this.onInbound = onInbound;
  }

  async stop(): Promise<void> {
    this.onInbound = undefined;
  }

  bind(ctx: HubContext, platformFn: PlatformFn | undefined): void {
    this.ctx = ctx;
    this.platformFn = platformFn;
  }

  protected get sdk(): SpectrumSdk {
    if (!this.ctx) throw new SafeError(`${this.surface}: spectrum not started`);
    return this.ctx.sdk;
  }

  protected api(): PlatformApiLike {
    if (!this.ctx || !this.platformFn) throw new SafeError(`${this.surface}: spectrum not started`);
    return this.platformFn(this.ctx.app);
  }

  /** Remember inbound objects so replies / reactions can target the real Message. */
  remember(space: SpaceLike, message?: MessageLike): void {
    this.cache.spaces.set(space.id, space);
    if (message) this.cache.messages.set(message.id, message);
  }

  /**
   * Hands a normalized message to the runner. Image attachments (album photos) become kind 'photo' with the bytes
   * read in memory only (one inbound per image, max 10 per message); the runner passes them straight to the store.
   */
  async deliver(m: ChannelInbound): Promise<void> {
    if (!this.onInbound) return;
    const msg = (m.kind === 'text' || m.kind === 'other') && m.from ? this.cache.messages.get(m.msgId) : undefined;
    const found = msg ? imageAttachments(msg.content) : undefined;
    if (!found?.items.length) return this.onInbound(m);
    let n = 0;
    for (const att of found.items.slice(0, 10)) {
      const photo = await readImage(att).catch((err: unknown) => {
        this.log.warn('spectrum: photo attachment unreadable', { surface: this.surface, err });
        return null;
      });
      if (!photo) continue;
      const text = m.text ?? found.caption;
      const k = n++;
      await this.onInbound({
        ...m, kind: 'photo', msgId: k === 0 ? m.msgId : `${m.msgId}:${k}`, photo,
        ...(text ? { text } : {}), ...(m.replyTo ?? found.replyTo ? { replyTo: m.replyTo ?? found.replyTo } : {}),
      });
    }
  }

  protected async space(spaceId: string): Promise<SpaceLike> {
    const cached = this.cache.spaces.get(spaceId);
    if (cached) return cached;
    const s = await this.api().space.get(spaceId);
    this.cache.spaces.set(spaceId, s);
    return s;
  }

  protected async target(space: SpaceLike, ref: MsgRef): Promise<MessageLike> {
    const cached = this.cache.messages.get(ref);
    if (cached) return cached;
    if (space.getMessage) {
      try {
        const m = await space.getMessage(ref);
        if (m) return m;
      } catch {
        /* fall through to a stub; providers that only need target.id accept it */
      }
    }
    return stubMessage(ref);
  }

  protected track(msg: MessageLike | undefined): MsgRef | undefined {
    if (!msg) return undefined;
    this.cache.messages.set(msg.id, msg);
    return msg.id;
  }

  async send(spaceId: string, text: string): Promise<MsgRef | undefined> {
    const s = await this.space(spaceId);
    return this.track(await s.send(text));
  }

  async reply(spaceId: string, to: MsgRef, text: string): Promise<MsgRef | undefined> {
    if (!this.caps.inlineReply) return this.send(spaceId, text);
    const s = await this.space(spaceId);
    const target = await this.target(s, to);
    return this.track(await s.send(this.sdk.reply(text, target as unknown as SpectrumTs.Message)));
  }

  async edit(spaceId: string, target: MsgRef, text: string): Promise<void> {
    if (!this.caps.edit) return;
    const s = await this.space(spaceId);
    const msg = await this.target(s, target);
    await s.send(this.sdk.edit(text, msg as unknown as SpectrumTs.Message));
  }

  async react(spaceId: string, to: MsgRef, emoji: string): Promise<void> {
    if (!this.caps.reactionsOut) return;
    const s = await this.space(spaceId);
    const msg = await this.target(s, to);
    await s.send(this.sdk.reaction(emoji, msg as unknown as SpectrumTs.Message));
  }

  async file(spaceId: string, name: string, mime: string, content: string, caption?: string): Promise<MsgRef | undefined> {
    if (!this.caps.files) return caption ? this.send(spaceId, caption) : undefined;
    const s = await this.space(spaceId);
    const ref = this.track(await s.send(this.sdk.attachment(Buffer.from(content, 'utf8'), { name, mimeType: mime })));
    if (caption) await this.send(spaceId, caption);
    return ref;
  }

  async typing(spaceId: string, on: boolean): Promise<void> {
    if (!this.caps.typing) return;
    const s = await this.space(spaceId);
    if (on) await s.startTyping?.();
    else await s.stopTyping?.();
  }

  async leave(spaceId: string): Promise<void> {
    if (!this.caps.leave) return;
    const s = await this.space(spaceId);
    await s.leave?.();
  }

  async dm(handle: string, text: string): Promise<MsgRef | undefined> {
    if (!this.caps.dm) return undefined;
    const api = this.api();
    const space = await api.space.create(handle);
    this.cache.spaces.set(space.id, space);
    return this.track(await space.send(text));
  }
}

// ───────────── the hub ─────────────

export interface SpectrumHubOptions {
  config: Pick<Config, 'spectrum' | 'logLevel'>;
  logger?: Logger;
  /** Override the SDK loader (tests). */
  loadSdk?: () => Promise<SpectrumSdk>;
}

export class SpectrumHub {
  readonly #bindings = new Map<string, PlatformBinding>();
  readonly #config: SpectrumHubOptions['config'];
  readonly #log: Logger;
  readonly #loadSdk: () => Promise<SpectrumSdk>;
  #app?: { messages: AsyncIterable<[unknown, unknown]>; stop(): Promise<void> };
  #stopping = false;
  #loop?: Promise<void>;

  constructor(opts: SpectrumHubOptions) {
    this.#config = opts.config;
    this.#log = opts.logger ?? silentLogger;
    this.#loadSdk = opts.loadSdk ?? (() => import('spectrum-ts'));
  }

  register(b: PlatformBinding): void {
    this.#bindings.set(b.platformId, b);
  }

  get bindings(): PlatformBinding[] {
    return [...this.#bindings.values()];
  }

  hasCredentials(): boolean {
    return !!(this.#config.spectrum.projectId && this.#config.spectrum.projectSecret);
  }

  /** Build Spectrum with every registered provider and start the message loop. Returns false if nothing to run. */
  async start(): Promise<boolean> {
    if (this.#bindings.size === 0) return false;
    const sdk = await this.#loadSdk();
    const providers: unknown[] = [];
    const active: PlatformBinding[] = [];
    for (const b of this.#bindings.values()) {
      try {
        const p = await b.provider();
        if (p) {
          providers.push(p);
          active.push(b);
        }
      } catch (err) {
        this.#log.error('spectrum: provider setup failed', { platform: b.platformId, err });
      }
    }
    if (providers.length === 0) {
      this.#log.warn('spectrum: no providers enabled; Photon stream not started');
      return false;
    }
    const logLevel = this.#config.logLevel === 'silent' ? 'silent' : this.#config.logLevel;
    const base = { providers, telemetry: false, options: { logLevel } };
    const opts = this.hasCredentials()
      ? { ...base, projectId: this.#config.spectrum.projectId!, projectSecret: this.#config.spectrum.projectSecret! }
      : base;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const app = (await (sdk.Spectrum as any)(opts)) as { messages: AsyncIterable<[unknown, unknown]>; stop(): Promise<void> };
    this.#app = app;
    const ctx: HubContext = { app, sdk, logger: this.#log };
    for (const b of active) b.attach(ctx);
    this.#log.info('spectrum: started', { platforms: active.map((b) => b.platformId), telemetry: false });
    this.#loop = this.#run();
    return true;
  }

  async #run(): Promise<void> {
    let failures = 0;
    while (!this.#stopping && this.#app) {
      try {
        for await (const [space, message] of this.#app.messages) {
          if (this.#stopping) break;
          failures = 0;
          await this.#route(space as SpaceLike, message as MessageLike);
        }
        if (this.#stopping) return;
        this.#log.warn('spectrum: message stream ended');
      } catch (err) {
        this.#log.error('spectrum: message stream failed', { err });
      }
      if (this.#stopping) return;
      if (++failures > 5) {
        this.#log.error('spectrum: giving up on message stream after repeated failures');
        return;
      }
      await new Promise((r) => setTimeout(r, Math.min(30_000, 1000 * 2 ** failures)));
    }
  }

  async #route(space: SpaceLike, message: MessageLike): Promise<void> {
    try {
      if (message.direction === 'outbound' || message.sender?.kind === 'agent') return;
      const b = message.platform ? this.#bindings.get(message.platform) : undefined;
      if (!b) return; // unknown platform: drop without logging content
      await b.handle(space, message);
    } catch (err) {
      this.#log.error('spectrum: inbound handling failed', { platform: message.platform, err });
    }
  }

  async stop(): Promise<void> {
    this.#stopping = true;
    try {
      await this.#app?.stop();
    } catch (err) {
      this.#log.warn('spectrum: stop failed', { err });
    }
    await Promise.race([this.#loop, new Promise((r) => setTimeout(r, 2000))]);
  }
}
