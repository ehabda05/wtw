// In-process multi-persona group-chat simulator (no Photon, no network). Implements ChannelAdapter with CAPS.sim.
// Personas speak with say(); Homi's outbound calls land in a transcript with refs "sim-<n>".

import type { Capabilities, MsgRef } from '../engine/types.js';
import { CAPS, type ChannelAdapter, type ChannelInbound, type InboundUser } from './types.js';
import { samplePhoto } from '../album/sample.js';

export const DEFAULT_PERSONAS = ['ana', 'ben', 'sam', 'jo', 'maya', 'you'] as const;

export type TranscriptKind = 'send' | 'reply' | 'dm' | 'file' | 'edit' | 'react' | 'call' | 'leave';

export interface TranscriptEntry {
  at: number;
  spaceId: string;
  /** 'homi', a persona id, or 'system'. */
  from: string;
  text: string;
  kind: TranscriptKind;
  tag?: string;
  /** Message id of this entry (Homi: "sim-<n>", personas: "u-<n>"). */
  ref?: MsgRef;
  /** For reply / edit / react: the target message. */
  target?: MsgRef;
  /** For dm / call: the persona addressed. */
  to?: string;
  /** For file: file name + mime. */
  file?: { name: string; mime: string; content: string };
  /** For a persona photo: type and size only (the bytes go to the runner, never into the transcript). */
  photo?: { mime: string; size: number };
}

export interface SimSpace {
  id: string;
  personas: string[];
  left: boolean;
}

export interface SimHubOptions {
  now?: () => number;
  /** Awaited before each Homi message is recorded (the CLI's typing-dot animation). */
  beforeHomiMessage?: (spaceId: string) => Promise<void>;
}

export function personaHandle(persona: string): string {
  return `persona:${persona}`;
}

export function personaName(persona: string): string {
  return persona.charAt(0).toUpperCase() + persona.slice(1);
}

export function personaFromHandle(handle: string): string | undefined {
  return handle.startsWith('persona:') ? handle.slice('persona:'.length) : undefined;
}

export class SimHub implements ChannelAdapter {
  readonly surface = 'sim' as const;
  readonly caps: Capabilities = CAPS.sim;
  readonly transcript: TranscriptEntry[] = [];
  readonly spaces = new Map<string, SimSpace>();
  readonly #listeners: ((e: TranscriptEntry) => void)[] = [];
  readonly #byRef = new Map<string, TranscriptEntry>();
  readonly #now: () => number;
  readonly #before?: (spaceId: string) => Promise<void>;
  #onInbound?: (m: ChannelInbound) => Promise<void>;
  #homiSeq = 0;
  #userSeq = 0;
  #spaceSeq = 0;
  readonly typingState = new Map<string, boolean>();

  constructor(opts: SimHubOptions = {}) {
    this.#now = opts.now ?? Date.now;
    this.#before = opts.beforeHomiMessage;
  }

  // ───────────── ChannelAdapter ─────────────

  async start(onInbound: (m: ChannelInbound) => Promise<void>): Promise<void> {
    this.#onInbound = onInbound;
  }

  async stop(): Promise<void> {
    this.#onInbound = undefined;
  }

  async send(spaceId: string, text: string): Promise<MsgRef | undefined> {
    return this.#homi(spaceId, 'send', text);
  }

  async reply(spaceId: string, to: MsgRef, text: string): Promise<MsgRef | undefined> {
    return this.#homi(spaceId, 'reply', text, { target: to });
  }

  async edit(spaceId: string, target: MsgRef, text: string): Promise<void> {
    const orig = this.#byRef.get(target);
    if (orig && orig.from === 'homi') orig.text = text;
    this.#push({ at: this.#now(), spaceId, from: 'homi', text, kind: 'edit', target });
  }

  /**
   * Overloaded by arity:
   *  - react(spaceId, to, emoji)                    Homi reacts (ChannelAdapter)
   *  - react(spaceId, persona, emoji, targetRef)    a persona reacts (inbound)
   */
  react(spaceId: string, to: MsgRef, emoji: string): Promise<void>;
  react(spaceId: string, persona: string, emoji: string, targetRef: MsgRef): Promise<void>;
  async react(spaceId: string, a: string, emoji: string, targetRef?: MsgRef): Promise<void> {
    if (targetRef === undefined) {
      this.#push({ at: this.#now(), spaceId, from: 'homi', text: emoji, kind: 'react', target: a });
      return;
    }
    await this.reactAs(spaceId, a, emoji, targetRef);
  }

  async dm(handle: string, text: string): Promise<MsgRef | undefined> {
    const persona = personaFromHandle(handle) ?? 'unknown';
    const space = [...this.spaces.values()].find((s) => s.personas.includes(persona));
    return this.#homi(space?.id ?? 'dm', 'dm', text, { to: persona });
  }

  async file(spaceId: string, name: string, mime: string, content: string, caption?: string): Promise<MsgRef | undefined> {
    return this.#homi(spaceId, 'file', caption ? `${caption} [${name}]` : `[${name}]`, { file: { name, mime, content } });
  }

  async leave(spaceId: string): Promise<void> {
    const s = this.spaces.get(spaceId);
    if (s) s.left = true;
    this.#push({ at: this.#now(), spaceId, from: 'homi', text: 'Homi left the group', kind: 'leave' });
  }

  async typing(spaceId: string, on: boolean): Promise<void> {
    this.typingState.set(spaceId, on);
  }

  // ───────────── simulator controls ─────────────

  onTranscript(cb: (e: TranscriptEntry) => void): void {
    this.#listeners.push(cb);
  }

  createSpace(personas: readonly string[] = DEFAULT_PERSONAS, id?: string): SimSpace {
    const space: SimSpace = { id: id ?? `sim-group-${++this.#spaceSeq}`, personas: [...personas], left: false };
    this.spaces.set(space.id, space);
    return space;
  }

  /** A persona speaks in the group. Resolves after the runner has processed the message. */
  async say(spaceId: string, persona: string, text: string, opts: { replyTo?: MsgRef } = {}): Promise<MsgRef> {
    const ref = `u-${++this.#userSeq}`;
    this.#push({ at: this.#now(), spaceId, from: persona, text, kind: opts.replyTo ? 'reply' : 'send', ref, target: opts.replyTo });
    await this.#deliver({
      surface: 'sim',
      spaceId,
      isGroup: true,
      kind: 'text',
      from: this.#user(persona),
      text,
      msgId: ref,
      replyTo: opts.replyTo,
      mentionsAgent: false,
      at: this.#now(),
    });
    return ref;
  }

  /** A persona reacts to a message. */
  async reactAs(spaceId: string, persona: string, emoji: string, targetRef: MsgRef): Promise<void> {
    const ref = `u-${++this.#userSeq}`;
    this.#push({ at: this.#now(), spaceId, from: persona, text: emoji, kind: 'react', ref, target: targetRef });
    await this.#deliver({
      surface: 'sim',
      spaceId,
      isGroup: true,
      kind: 'reaction',
      from: this.#user(persona),
      msgId: ref,
      mentionsAgent: false,
      reaction: { emoji, target: targetRef },
      at: this.#now(),
    });
  }

  /**
   * A persona shares a photo (kind 'photo'); the caption travels in `text`. Without bytes it sends a generated
   * sample PNG (src/album/sample.ts), so the album demo needs no image files.
   */
  async photoAs(
    spaceId: string,
    persona: string,
    caption?: string,
    opts: { replyTo?: MsgRef; bytes?: Uint8Array; mime?: string } = {},
  ): Promise<MsgRef> {
    const ref = `u-${++this.#userSeq}`;
    const bytes = opts.bytes ?? samplePhoto(`${spaceId}:${persona}:${ref}`);
    const mime = opts.mime ?? 'image/png';
    const text = caption ? `📷 ${caption}` : '📷 (photo)';
    this.#push({ at: this.#now(), spaceId, from: persona, text, kind: opts.replyTo ? 'reply' : 'send', ref, target: opts.replyTo, photo: { mime, size: bytes.byteLength } });
    await this.#deliver({
      surface: 'sim',
      spaceId,
      isGroup: true,
      kind: 'photo',
      from: this.#user(persona),
      ...(caption ? { text: caption } : {}),
      msgId: ref,
      replyTo: opts.replyTo,
      mentionsAgent: false,
      photo: { mime, bytes },
      at: this.#now(),
    });
    return ref;
  }

  /** Roster snapshot of the space (the sim has full roster capability). */
  async members(spaceId: string): Promise<void> {
    const space = this.spaces.get(spaceId);
    if (!space) return;
    await this.#deliver({
      surface: 'sim',
      spaceId,
      isGroup: true,
      kind: 'members',
      msgId: `members-${++this.#userSeq}`,
      mentionsAgent: false,
      members: space.personas.map((p) => this.#user(p)),
      at: this.#now(),
    });
  }

  /** Simulate the platform telling us Homi was added. */
  async addedToGroup(spaceId: string): Promise<void> {
    await this.#deliver({
      surface: 'sim',
      spaceId,
      isGroup: true,
      kind: 'added_to_group',
      msgId: `added-${++this.#userSeq}`,
      mentionsAgent: false,
      at: this.#now(),
    });
  }

  /** Append a system line (e.g. a simulated phone call) to the transcript. */
  system(spaceId: string, text: string, kind: TranscriptKind = 'send', extra: Partial<TranscriptEntry> = {}): void {
    this.#push({ at: this.#now(), spaceId, from: 'system', text, kind, ...extra });
  }

  /** Attach an engine tag to a Homi message (the runner's onSent hook). */
  annotate(ref: MsgRef, tag: string | undefined): void {
    if (!tag) return;
    const e = this.#byRef.get(ref);
    if (e) e.tag = tag;
  }

  entry(ref: MsgRef): TranscriptEntry | undefined {
    return this.#byRef.get(ref);
  }

  /** Latest Homi message (send / reply / file) in a space. */
  lastHomiMessage(spaceId: string): TranscriptEntry | undefined {
    for (let i = this.transcript.length - 1; i >= 0; i--) {
      const e = this.transcript[i];
      if (e.spaceId === spaceId && e.from === 'homi' && e.ref && (e.kind === 'send' || e.kind === 'reply' || e.kind === 'file')) return e;
    }
    return undefined;
  }

  homiMessages(spaceId: string): TranscriptEntry[] {
    return this.transcript.filter((e) => e.spaceId === spaceId && e.from === 'homi' && !!e.ref);
  }

  // ───────────── internals ─────────────

  #user(persona: string): InboundUser {
    return { handle: personaHandle(persona), platformName: personaName(persona) };
  }

  async #deliver(m: ChannelInbound): Promise<void> {
    if (!this.#onInbound) throw new Error('SimHub not started');
    if (this.spaces.get(m.spaceId)?.left) return; // Homi left this group: it no longer sees anything here
    await this.#onInbound(m);
  }

  async #homi(spaceId: string, kind: TranscriptKind, text: string, extra: Partial<TranscriptEntry> = {}): Promise<MsgRef> {
    if (this.#before) await this.#before(spaceId);
    const ref = `sim-${++this.#homiSeq}`;
    this.#push({ at: this.#now(), spaceId, from: 'homi', text, kind, ref, ...extra });
    return ref;
  }

  #push(e: TranscriptEntry): void {
    this.transcript.push(e);
    if (e.ref) this.#byRef.set(e.ref, e);
    for (const l of this.#listeners) {
      try {
        l(e);
      } catch {
        /* listener errors never break the sim */
      }
    }
  }
}
