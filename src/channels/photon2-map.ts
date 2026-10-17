// Photon 2.0 (api.photon.codes/v1, @photon-ai/api 0.5.0) message -> ChannelInbound. Pure; no I/O.
// Read from the published types (dist/generated/types.gen.d.ts), not guessed:
// - Message: { id, platform, status: received|accepted|dispatched|delivered|failed, content, sentBy, receivedBy?,
//   addressedTo?, space: { id, kind: string, participantIds[], details }, parentMessageId?, timestamps, createdAt }.
// - Telegram content: text | attachment | voice | group (no reactions). iMessage: text | attachment | message.read |
//   space.typing.update | group (no reactions). SMS adds reaction { action: add|remove, reaction } and polls.
// - space.kind is an undocumented free string: we read "group"/"direct"-like values, then details, then participant count.
// - Agents of this project expose details.resourceId (other projects: managedBy; iMessage lines: details.type).
//
// Surface mapping: Surface and the spaces table CHECK constraint are closed sets owned by src/engine and
// src/store, so Photon 2.0 traffic reuses existing surfaces: Telegram -> 'telegram'; SMS and iMessage ->
// 'imessage-dedicated' for group spaces and 'imessage-shared' for direct ones. Space keys stay distinct because
// Photon space ids differ from Spectrum chat ids; config refuses to run both owners of a surface at once.

import type { Capabilities, Surface } from '../engine/types.js';
import type { Photon2Platform } from '../config.js';
import { isStartGroup, isTelegramAddressed } from './telegram.js';
import type { ChannelInbound } from './types.js';

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

const BASE = {
  reactionsIn: false, // SMS reactions are mapped when they arrive, but undocumented in practice: ask for text replies
  reactionsOut: false, // sendMessage is documented for "text and image messages" only
  edit: false,
  editWindowMs: 0,
  polls: false,
  roster: false,
  leave: false, // no leave operation in the API: `homi stop` tombstones
  files: false, // .ics files are not "text and image"
  dm: false,
} as const;

/** Honest capability profiles for the Photon 2.0 views (one adapter per surface; see header). */
export const PHOTON2_CAPS = {
  telegram: { surface: 'telegram', groups: true, inlineReply: true, typing: true, ...BASE },
  phoneDirect: { surface: 'imessage-shared', groups: false, inlineReply: false, typing: false, ...BASE },
  phoneGroup: { surface: 'imessage-dedicated', groups: true, inlineReply: false, typing: false, ...BASE },
} as const satisfies Record<string, Capabilities>;

export function photon2SurfaceOf(platform: Photon2Platform, isGroup: boolean): Surface {
  if (platform === 'telegram') return 'telegram';
  return isGroup ? 'imessage-dedicated' : 'imessage-shared';
}

export function isPhoton2Group(space: unknown): boolean {
  const sp = rec(space) ?? {};
  const kind = str(sp.kind)?.toLowerCase();
  if (kind) {
    if (/group|channel|multi/.test(kind)) return true;
    if (/direct|private|dm|individual|one_to_one|1:1/.test(kind)) return false;
  }
  const d = rec(sp.details);
  const t = str(d?.type ?? d?.chatType ?? d?.chat_type)?.toLowerCase();
  if (t) {
    if (/group|channel/.test(t)) return true;
    if (t === 'private' || t === 'direct') return false;
  }
  return Array.isArray(sp.participantIds) && sp.participantIds.length > 2;
}

/** True for an Agent (this project's line/bot, another project's, or an iMessage line). Humans have none of these. */
export function isPhoton2Agent(user: unknown): boolean {
  const u = rec(user);
  if (!u) return false;
  const d = rec(u.details);
  if (str(d?.resourceId) || str(d?.managedBy)) return true;
  if (d?.type === 'shared' || d?.type === 'dedicated') return true;
  return /^(agent|bot|shared)$/i.test(str(u.kind) ?? '');
}

/** id + createdAt (ms) of a raw page item, or null if it is not a supported Message. */
export function photon2IdAndTime(raw: unknown): { id: string; createdAt: number } | null {
  const m = rec(raw);
  const id = str(m?.id);
  const createdAt = Date.parse(str(m?.createdAt) ?? '');
  if (!id || !Number.isFinite(createdAt)) return null;
  return { id, createdAt };
}

const USERNAME = /^@?[A-Za-z][A-Za-z0-9_]{3,31}$/;

export interface Photon2NormalizeOptions {
  platforms: readonly Photon2Platform[];
  /** Agent user ids we know (receivedBy ids, our sendMessage senders). */
  ownUserIds: ReadonlySet<string>;
  /** Message ids sendMessage returned. */
  ownMessageIds: ReadonlySet<string>;
  /** Telegram bot username (TELEGRAM_BOT_USERNAME, else learned from receivedBy.handle). */
  botUsername?: string;
}

export type Photon2SkipReason = 'malformed' | 'platform' | 'own' | 'unsupported';

export interface Photon2Normalized {
  inbound: ChannelInbound;
  platform: Photon2Platform;
  /** Attachment to fetch: the channel upgrades the inbound to kind 'photo' if it is an image. */
  attachmentId?: string;
  /** receivedBy: the agent that received it (our sender for replies in this space). */
  agentId?: string;
  agentHandle?: string;
}

interface Body {
  text?: string;
  attachmentId?: string;
  reaction?: { emoji: string; removed: boolean };
  type: string;
}

function bodyOf(content: Rec): Body {
  const type = str(content.type) ?? '';
  if (type === 'text') return { type, text: typeof content.text === 'string' ? content.text : undefined };
  if (type === 'attachment') return { type, attachmentId: str(content.attachmentId) };
  if (type === 'reaction') {
    const emoji = str(content.reaction);
    return emoji ? { type, reaction: { emoji, removed: content.action === 'remove' } } : { type };
  }
  if (type === 'group' && Array.isArray(content.parts)) {
    const texts: string[] = [];
    let attachmentId: string | undefined;
    for (const p of content.parts) {
      const part = rec(p);
      if (part?.type === 'text' && typeof part.text === 'string') texts.push(part.text);
      if (part?.type === 'attachment' && !attachmentId) attachmentId = str(part.attachmentId);
    }
    return { type, text: texts.length ? texts.join('\n') : undefined, attachmentId };
  }
  return { type };
}

/** Content types that are protocol noise, not something a member said. */
const IGNORED = new Set(['message.read', 'space.typing.update', 'space.participants.update', 'text.update', 'message.delete', 'poll.update']);

export function normalizePhoton2(raw: unknown, opts: Photon2NormalizeOptions): Photon2Normalized | { skip: Photon2SkipReason } {
  const m = rec(raw);
  const it = photon2IdAndTime(raw);
  const space = rec(m?.space);
  const spaceId = str(space?.id);
  const content = rec(m?.content);
  if (!m || !it || !spaceId || !content) return { skip: 'malformed' };
  const platform = str(m.platform) as Photon2Platform | undefined;
  if (!platform || !opts.platforms.includes(platform)) return { skip: 'platform' };
  const sentBy = rec(m.sentBy);
  const senderId = str(sentBy?.id);
  if (m.status !== 'received' || opts.ownMessageIds.has(it.id) || (senderId && opts.ownUserIds.has(senderId)) || isPhoton2Agent(sentBy))
    return { skip: 'own' };
  if (!senderId) return { skip: 'malformed' };
  const body = bodyOf(content);
  if (IGNORED.has(body.type)) return { skip: 'unsupported' };

  const isGroup = isPhoton2Group(space);
  const receivedAt = Date.parse(str(rec(m.timestamps)?.receivedAt) ?? '');
  const displayName = str(rec(sentBy?.metadata)?.displayName);
  const handle = str(sentBy?.handle);
  const platformName = displayName ?? (platform === 'telegram' && handle && USERNAME.test(handle) ? handle.replace(/^@/, '') : undefined);
  const parent = str(m.parentMessageId);
  const receivedBy = rec(m.receivedBy);
  const agentId = str(receivedBy?.id);
  const agentHandle = platform === 'telegram' && USERNAME.test(str(receivedBy?.handle) ?? '') ? str(receivedBy?.handle)!.replace(/^@/, '') : undefined;
  const base = {
    surface: photon2SurfaceOf(platform, isGroup),
    spaceId,
    isGroup,
    msgId: it.id,
    at: Number.isFinite(receivedAt) ? receivedAt : it.createdAt,
    from: { handle: senderId, ...(platformName ? { platformName: platformName.slice(0, 64) } : {}) },
  };
  const extra = { platform, ...(agentId ? { agentId } : {}), ...(agentHandle ? { agentHandle } : {}) };

  if (body.type === 'reaction') {
    if (!body.reaction || !parent) return { skip: 'unsupported' };
    return { ...extra, inbound: { ...base, kind: 'reaction', mentionsAgent: false, reaction: { emoji: body.reaction.emoji, target: parent, ...(body.reaction.removed ? { removed: true } : {}) } } };
  }
  const bot = opts.botUsername ?? agentHandle;
  const att = body.attachmentId ? { attachmentId: body.attachmentId } : {};
  if (body.text !== undefined) {
    const mentioned = platform === 'telegram' && (isTelegramAddressed(body.text, bot) || isStartGroup(body.text, bot));
    const inbound: ChannelInbound = { ...base, kind: 'text', text: body.text, mentionsAgent: !isGroup || mentioned, ...(parent ? { replyTo: parent } : {}) };
    return { ...extra, ...att, inbound };
  }
  return { ...extra, ...att, inbound: { ...base, kind: 'other', mentionsAgent: false, ...(parent ? { replyTo: parent } : {}) } };
}
