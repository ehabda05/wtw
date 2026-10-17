// In-process multi-persona group-chat simulator (no Photon, no network). Implements ChannelAdapter with CAPS.sim.
// Personas speak with say(); Otto's outbound calls land in a transcript with refs "sim-<n>".

import type { Capabilities, MsgRef } from '../engine/types.js';
import { CAPS, type ChannelAdapter, type ChannelInbound, type InboundUser } from './types.js';

export const DEFAULT_PERSONAS = ['ana', 'ben', 'sam', 'jo', 'maya', 'you'] as const;

export type TranscriptKind = 'send' | 'reply' | 'dm' | 'file' | 'edit' | 'react' | 'call' | 'leave';

export interface TranscriptEntry {
  at: number;
  spaceId: string;
  /** 'otto', a persona id, or 'system'. */
  from: string;
  text: string;
  kind: TranscriptKind;
  tag?: string;
  /** Message id of this entry (Otto: "sim-<n>", personas: "u-<n>"). */
  ref?: MsgRef;
  /** For reply / edit / react: the target message. */
  target?: MsgRef;
  /** For dm / call: the persona addressed. */
  to?: string;
  /** For file: file name + mime. */
  file?: { name: string; mime: string; content: string };
}

export interface SimSpace {
  id: string;
  personas: string[];
  left: boolean;
}

export interface SimHubOptions {
  now?: () => number;
  /** Awaited before each Otto message is recorded (the CLI's typing-dot animation). */
  beforeOttoMessage?: (spaceId: string) => Promise<void>;
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
  #ottoSeq = 0;
  #userSeq = 0;
  #spaceSeq = 0;
  readonly typingState = new Map<string, boolean>();

  constructor(opts: SimHubOptions = {}) {
    this.#now = opts.now ?? Date.now;
    this.#before = opts.beforeOttoMessage;
  }

  // ───────────── ChannelAdapter ─────────────

  async start(onInbound: (m: ChannelInbound) => Promise<void>): Promise<void> {
    this.#onInbound = onInbound;
  }

  async stop(): Promise<void> {
    this.#onInbound = undefined;
  }

  async send(spaceId: string, text: string): Promise<MsgRef | undefined> {
    return this.#otto(spaceId, 'send', text);
  }

  async reply(spaceId: string, to: MsgRef, text: string): Promise<MsgRef | undefined> {
    return this.#otto(spaceId, 'reply', text, { target: to });
  }

  async edit(spaceId: string, target: MsgRef, text: string): Promise<void> {
    const orig = this.#byRef.get(target);
    if (orig && orig.from === 'otto') orig.text = text;
    this.#push({ at: this.#now(), spaceId, from: 'otto', text, kind: 'edit', target });
  }

  /**
   * Overloaded by arity:
   *  - react(spaceId, to, emoji)                    Otto reacts (ChannelAdapter)
   *  - react(spaceId, persona, emoji, targetRef)    a persona reacts (inbound)
   */
  react(spaceId: string, to: MsgRef, emoji: string): Promise<void>;
  react(spaceId: string, persona: string, emoji: string, targetRef: MsgRef): Promise<void>;
  async react(spaceId: string, a: string, emoji: string, targetRef?: MsgRef): Promise<void> {
    if (targetRef === undefined) {
      this.#push({ at: this.#now(), spaceId, from: 'otto', text: emoji, kind: 'react', target: a });
      return;
    }
    await this.reactAs(spaceId, a, emoji, targetRef);
  }

  async dm(handle: string, text: string): Promise<MsgRef | undefined> {
    const persona = personaFromHandle(handle) ?? 'unknown';
    const space = [...this.spaces.values()].find((s) => s.personas.includes(persona));
    return this.#otto(space?.id ?? 'dm', 'dm', text, { to: persona });
  }

  async file(spaceId: string, name: string, mime: string, content: string, caption?: string): Promise<MsgRef | undefined> {
    return this.#otto(spaceId, 'file', caption ? `${caption} [${name}]` : `[${name}]`, { file: { name, mime, content } });
  }

  async leave(spaceId: string): Promise<void> {
    const s = this.spaces.get(spaceId);
    if (s) s.left = true;
    this.#push({ at: this.#now(), spaceId, from: 'otto', text: 'Otto left the group', kind: 'leave' });
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

  /** Simulate the platform telling us Otto was added. */
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

  /** Attach an engine tag to an Otto message (the runner's onSent hook). */
  annotate(ref: MsgRef, tag: string | undefined): void {
    if (!tag) return;
    const e = this.#byRef.get(ref);
    if (e) e.tag = tag;
  }

  entry(ref: MsgRef): TranscriptEntry | undefined {
    return this.#byRef.get(ref);
  }

  /** Latest Otto message (send / reply / file) in a space. */
  lastOttoMessage(spaceId: string): TranscriptEntry | undefined {
    for (let i = this.transcript.length - 1; i >= 0; i--) {
      const e = this.transcript[i];
      if (e.spaceId === spaceId && e.from === 'otto' && e.ref && (e.kind === 'send' || e.kind === 'reply' || e.kind === 'file')) return e;
    }
    return undefined;
  }

  ottoMessages(spaceId: string): TranscriptEntry[] {
    return this.transcript.filter((e) => e.spaceId === spaceId && e.from === 'otto' && !!e.ref);
  }

  // ───────────── internals ─────────────

  #user(persona: string): InboundUser {
    return { handle: personaHandle(persona), platformName: personaName(persona) };
  }

  async #deliver(m: ChannelInbound): Promise<void> {
    if (!this.#onInbound) throw new Error('SimHub not started');
    if (this.spaces.get(m.spaceId)?.left) return; // Otto left this group: it no longer sees anything here
    await this.#onInbound(m);
  }

  async #otto(spaceId: string, kind: TranscriptKind, text: string, extra: Partial<TranscriptEntry> = {}): Promise<MsgRef> {
    if (this.#before) await this.#before(spaceId);
    const ref = `sim-${++this.#ottoSeq}`;
    this.#push({ at: this.#now(), spaceId, from: 'otto', text, kind, ref, ...extra });
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
