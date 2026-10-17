// spectrum-ts terminal provider (tuichat) with a persona shim: the terminal only ever has one sender
// ("terminal-user"), so "ana: hello" speaks as persona ana, "/as ben" switches the default persona (default "you").
// Needs the tuichat binary on first run (pre-cache it, or set TUICHAT_BINARY).

import type { Capabilities } from '../engine/types.js';
import { silentLogger, type Logger } from '../privacy/logger.js';
import { personaHandle, personaName } from './sim.js';
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

export const DEFAULT_TERMINAL_PERSONA = 'you';
const RESERVED = new Set(['homi', 'http', 'https', 'mailto', 'tel']);

export interface PersonaLine {
  persona: string;
  text: string;
  /** "/as ana" switched the default persona; there is no message to deliver. */
  switchedTo?: string;
}

/** Parse the persona shim: "ana: hello" -> {persona:'ana', text:'hello'}; "/as ben" -> switch. */
export function parsePersonaLine(raw: string, current: string = DEFAULT_TERMINAL_PERSONA): PersonaLine {
  const as = /^\s*\/as\s+([A-Za-z][A-Za-z0-9_-]{0,19})\s*$/.exec(raw);
  if (as) {
    const p = as[1].toLowerCase();
    return { persona: p, text: '', switchedTo: p };
  }
  const m = /^\s*([A-Za-z][A-Za-z0-9_-]{0,19})\s*:\s+([\s\S]+)$/.exec(raw);
  if (m && !RESERVED.has(m[1].toLowerCase())) return { persona: m[1].toLowerCase(), text: m[2].trim() };
  return { persona: current, text: raw.trim() };
}

export interface NormalizeTerminalState {
  persona: string;
}

/** Pure normalizer: terminal [space, message] -> ChannelInbound (persona shim applied). Mutates state on "/as". */
export function normalizeTerminal(space: { id: string }, message: MessageLike, state: NormalizeTerminalState): ChannelInbound | null {
  const c: ContentLike = message.content;
  const at = message.timestamp instanceof Date ? message.timestamp.getTime() : Date.now();
  const replyTo = (message.replyTo as { messageId?: string } | undefined)?.messageId;
  const base = { surface: 'terminal' as const, spaceId: space.id, isGroup: true, msgId: message.id, mentionsAgent: false, at };
  if (c.type === 'text' && typeof c.text === 'string') {
    const line = parsePersonaLine(c.text, state.persona);
    if (line.switchedTo) {
      state.persona = line.switchedTo;
      return null;
    }
    if (!line.text) return null;
    return {
      ...base,
      kind: 'text',
      from: { handle: personaHandle(line.persona), platformName: personaName(line.persona) },
      text: line.text,
      ...(replyTo ? { replyTo } : {}),
    };
  }
  if (c.type === 'reaction' && c.emoji && c.target?.id) {
    return {
      ...base,
      kind: 'reaction',
      from: { handle: personaHandle(state.persona), platformName: personaName(state.persona) },
      reaction: { emoji: c.emoji, target: c.target.id },
    };
  }
  return { ...base, kind: 'other', from: { handle: personaHandle(state.persona), platformName: personaName(state.persona) } };
}

export class TerminalAdapter extends SpectrumChannel implements PlatformBinding {
  readonly surface = 'terminal' as const;
  readonly caps: Capabilities = CAPS.terminal;
  readonly platformId = 'terminal';
  readonly #state: NormalizeTerminalState = { persona: DEFAULT_TERMINAL_PERSONA };
  #fn?: PlatformFn;

  constructor(logger: Logger = silentLogger) {
    super(new PlatformCache(), logger);
  }

  async provider(): Promise<unknown | null> {
    const mod = await import('spectrum-ts/providers/terminal');
    this.#fn = mod.terminal as unknown as PlatformFn;
    return mod.terminal.config({ commands: [{ name: 'plan', description: 'start a plan' }] });
  }

  attach(ctx: HubContext): void {
    this.bind(ctx, this.#fn);
  }

  adapters(): ChannelAdapter[] {
    return [this];
  }

  async handle(space: SpaceLike, message: MessageLike): Promise<void> {
    this.remember(space, message);
    const inbound = normalizeTerminal(space, message, this.#state);
    if (inbound) await this.deliver(inbound);
  }
}
