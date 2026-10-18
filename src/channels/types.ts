// Channel adapter contract. Only files in src/channels/ may import Photon (spectrum-ts).
// Adapters translate platform traffic into ChannelInbound and execute outbound calls.
// Raw handles and text cross this boundary in memory only; the runner hashes / seals / drops them.

import type { Capabilities, MsgRef, Surface } from '../engine/types.js';

export interface InboundUser {
  /** Raw platform handle: E.164 phone, email, Telegram user id, or a sim persona id. Never logged. */
  handle: string;
  /** Name the platform itself provides (Telegram first name / @username, sim persona name). Never a phone number. */
  platformName?: string;
  /** Present only when the platform identifies service accounts. */
  isBot?: boolean;
}

export interface ChannelInbound {
  surface: Surface;
  /** Raw platform space (chat) id. The runner hashes it into a SpaceKey and seals the raw value for routing. */
  spaceId: string;
  isGroup: boolean;
  kind: 'text' | 'reaction' | 'poll_vote' | 'added_to_group' | 'members' | 'headcount' | 'photo' | 'other';
  from?: InboundUser;
  /** Transient. Never persisted, never logged. */
  text?: string;
  /** Platform message id (used for dedupe hashing and inline replies). */
  msgId: string;
  /** If this message is an inline reply, the id of the message it replies to. */
  replyTo?: MsgRef;
  /** Platform-level mention of the agent (Telegram @bot entity, iMessage mention metadata). */
  mentionsAgent: boolean;
  reaction?: { emoji: string; target: MsgRef; removed?: boolean };
  poll?: { pollId: MsgRef; optionIndexes: number[] };
  members?: InboundUser[];
  /** kind 'headcount': people in the chat besides the agent, where the platform only gives a count (Telegram). */
  headcount?: number;
  /** kind 'photo': image bytes (in memory only until the runner hands them to the album store); caption in `text`. */
  photo?: { mime: string; bytes: Uint8Array; name?: string };
  at: number;
}

export interface ChannelAdapter {
  readonly surface: Surface;
  readonly caps: Capabilities;
  start(onInbound: (m: ChannelInbound) => Promise<void>): Promise<void>;
  stop(): Promise<void>;
  send(spaceId: string, text: string): Promise<MsgRef | undefined>;
  reply(spaceId: string, to: MsgRef, text: string): Promise<MsgRef | undefined>;
  poll?(spaceId: string, question: string, options: string[]): Promise<MsgRef | undefined>;
  edit?(spaceId: string, target: MsgRef, text: string): Promise<void>;
  react?(spaceId: string, to: MsgRef, emoji: string): Promise<void>;
  /** Private message to one member (opt-in only; the engine always announces it in the group). */
  dm?(handle: string, text: string): Promise<MsgRef | undefined>;
  file?(spaceId: string, name: string, mime: string, content: string, caption?: string): Promise<MsgRef | undefined>;
  leave?(spaceId: string): Promise<void>;
  typing?(spaceId: string, on: boolean): Promise<void>;
}

/**
 * Capability profiles per surface (verified in research/photon-capabilities.md and research/platform-setup.md,
 * spectrum-ts 12.11.0). Notes:
 * - Reaction REMOVAL is never surfaced on any surface, so votes from reactions are add-only.
 * - Telegram: poll answers and inbound reply-to are not surfaced by the SDK; reactions need the bot to be an
 *   admin plus a one-time setWebhook with allowed_updates (TELEGRAM_REACTIONS=on). Leave uses Bot API leaveChat.
 * - macOS local iMessage: no inbound reactions, no reply/react/leave/edit (silently no-op), sent ids are synthetic.
 */
export const CAPS: Record<Surface, Capabilities> = {
  sim: {
    surface: 'sim', groups: true, reactionsIn: true, reactionsOut: true, inlineReply: true, edit: true,
    editWindowMs: 0, polls: false, roster: true, leave: true, files: true, dm: true, typing: true,
  },
  terminal: {
    surface: 'terminal', groups: true, reactionsIn: true, reactionsOut: true, inlineReply: true, edit: false,
    editWindowMs: 0, polls: false, roster: false, leave: false, files: false, dm: false, typing: true,
  },
  'imessage-shared': {
    // Shared-pool lines: DMs only (photon-hq/spectrum-ts#217). Used for opt-in private check-ins.
    surface: 'imessage-shared', groups: false, reactionsIn: true, reactionsOut: true, inlineReply: true, edit: true,
    editWindowMs: 15 * 60_000, polls: false, roster: false, leave: false, files: true, dm: true, typing: true,
  },
  'imessage-dedicated': {
    surface: 'imessage-dedicated', groups: true, reactionsIn: true, reactionsOut: true, inlineReply: true, edit: true,
    editWindowMs: 15 * 60_000, polls: false, roster: true, leave: true, files: true, dm: true, typing: true,
  },
  'imessage-local': {
    surface: 'imessage-local', groups: true, reactionsIn: false, reactionsOut: false, inlineReply: false, edit: false,
    editWindowMs: 0, polls: false, roster: false, leave: false, files: true, dm: false, typing: false,
  },
  telegram: {
    surface: 'telegram', groups: true, reactionsIn: true, reactionsOut: true, inlineReply: true, edit: true,
    editWindowMs: 0, polls: false, roster: false, leave: true, files: true, dm: true, typing: true,
  },
};
