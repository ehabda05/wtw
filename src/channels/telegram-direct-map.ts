// Telegram Bot API Update -> ChannelInbound for the direct adapter (SURFACES=telegram-direct). Pure; no I/O.
// Same conventions as the spectrum-ts Telegram adapter (telegram.ts) so the engine sees identical traffic:
// - surface 'telegram'; spaceId = String(chat.id) (groups and supergroups are negative); msgId = String(message_id);
//   sender handle = String(from.id); reaction target = String(message_id), the same id sendMessage returns.
// - Mentions: the @bot and /cmd@bot regex plus the "/start@bot <token>" deep link; private chats are always addressed;
//   plain "homi ..." is left to the engine's detectAddressed (the runner calls it when mentionsAgent is false).
// What the Bot API adds over spectrum-ts: reply_to (inline replies to Homi count as addressed), edits (delivered as a
// new text with its own id so corrected answers count), reaction removals, the bot being added (consent intro right
// away), photos, and supergroup migration notices.

import { isStartGroup, isTelegramAddressed } from './telegram.js';
import type { ChannelInbound } from './types.js';

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
/** Telegram ids are integers (chat ids up to 52 bits); keep them as decimal strings. */
const idStr = (v: unknown): string | undefined => (typeof v === 'number' && Number.isInteger(v) ? String(v) : typeof v === 'string' && /^-?\d+$/.test(v) ? v : undefined);

/** Update types the poller asks for. message_reaction is delivered only where the bot is a group admin. */
export const TELEGRAM_ALLOWED_UPDATES = ['message', 'edited_message', 'message_reaction'] as const;

/** Content that is something a member did (shown as member_seen), as opposed to a service notice. */
const MEDIA = ['photo', 'document', 'sticker', 'voice', 'audio', 'video', 'video_note', 'animation', 'location', 'venue', 'contact', 'poll', 'dice', 'story'];

export interface TgFileRef {
  fileId: string;
  mime: string;
  size?: number;
}

export type TgEvent =
  | { type: 'inbound'; inbound: ChannelInbound; file?: TgFileRef }
  | { type: 'migrate'; from: string; to: string }
  | { type: 'skip'; reason: 'malformed' | 'own' | 'anonymous' | 'channel' | 'service' | 'removed' | 'unsupported' };

export interface TgNormalizeOptions {
  /** The bot's own user id (getMe, else the token prefix). Its own messages are dropped. */
  botId?: string;
  botUsername?: string;
}

function displayName(user: Rec): string | undefined {
  const first = str(user.first_name)?.trim();
  const name = first || str(user.username);
  return name ? name.slice(0, 64) : undefined;
}

function userRef(user: Rec, id: string): { handle: string; platformName?: string } {
  const n = displayName(user);
  return { handle: id, ...(n ? { platformName: n } : {}) };
}

/** Largest photo size (by file_size, else pixel area), or an image sent as a file. */
export function photoFileOf(m: Rec): TgFileRef | undefined {
  if (Array.isArray(m.photo) && m.photo.length) {
    const sizes = m.photo.map(rec).filter((p): p is Rec => !!p && !!str(p.file_id));
    const area = (p: Rec) => num(p.file_size) ?? (num(p.width) ?? 0) * (num(p.height) ?? 0);
    const best = sizes.reduce<Rec | undefined>((b, p) => (!b || area(p) > area(b) ? p : b), undefined);
    if (best) return { fileId: str(best.file_id)!, mime: 'image/jpeg', ...(num(best.file_size) ? { size: num(best.file_size) } : {}) };
  }
  const doc = rec(m.document);
  const mime = str(doc?.mime_type)?.toLowerCase();
  if (doc && str(doc.file_id) && mime?.startsWith('image/')) return { fileId: str(doc.file_id)!, mime, ...(num(doc.file_size) ? { size: num(doc.file_size) } : {}) };
  return undefined;
}

function chatOf(v: unknown): { id: string; isGroup: boolean; channel: boolean } | undefined {
  const c = rec(v);
  const id = idStr(c?.id);
  if (!c || !id) return undefined;
  const type = str(c.type);
  return { id, isGroup: type === 'group' || type === 'supergroup' || (!type && id.startsWith('-')), channel: type === 'channel' };
}

function fromMessage(m: Rec, edited: boolean, opts: TgNormalizeOptions): TgEvent {
  const chat = chatOf(m.chat);
  const mid = num(m.message_id);
  if (!chat || mid === undefined) return { type: 'skip', reason: 'malformed' };
  if (chat.channel) return { type: 'skip', reason: 'channel' };
  const to = idStr(m.migrate_to_chat_id);
  if (to) return { type: 'migrate', from: chat.id, to };
  const fromOld = idStr(m.migrate_from_chat_id);
  if (fromOld) return { type: 'migrate', from: fromOld, to: chat.id };
  const user = rec(m.from);
  const uid = idStr(user?.id);
  if (!user || !uid) return { type: 'skip', reason: 'anonymous' };
  if (opts.botId && uid === opts.botId) return { type: 'skip', reason: 'own' };

  const editDate = num(m.edit_date);
  const date = (edited ? editDate : undefined) ?? num(m.date) ?? 0;
  const base = {
    surface: 'telegram' as const,
    spaceId: chat.id,
    isGroup: chat.isGroup,
    msgId: edited ? `${mid}:edit:${editDate ?? 0}` : String(mid),
    at: date * 1000,
    from: userRef(user, uid),
  };

  const joined = Array.isArray(m.new_chat_members) ? m.new_chat_members.map(rec) : [];
  if (m.group_chat_created || m.supergroup_chat_created || (opts.botId && joined.some((j) => idStr(j?.id) === opts.botId)))
    return { type: 'inbound', inbound: { ...base, kind: 'added_to_group', mentionsAgent: false } };
  if (opts.botId && idStr(rec(m.left_chat_member)?.id) === opts.botId) return { type: 'skip', reason: 'removed' };

  // In forum supergroups every topic message "replies" to the topic's first message: that is not a real reply.
  const replyId = num(rec(m.reply_to_message)?.message_id);
  const replyTo = replyId !== undefined && !(m.is_topic_message === true && replyId === num(m.message_thread_id)) ? String(replyId) : undefined;
  const reply = replyTo ? { replyTo } : {};
  const file = photoFileOf(m);
  const text = typeof m.text === 'string' ? m.text : typeof m.caption === 'string' ? m.caption : undefined;
  if (text !== undefined) {
    const mentioned = isTelegramAddressed(text, opts.botUsername) || isStartGroup(text, opts.botUsername);
    const inbound: ChannelInbound = { ...base, kind: 'text', text, mentionsAgent: !chat.isGroup || mentioned, ...reply };
    return { type: 'inbound', inbound, ...(file ? { file } : {}) };
  }
  if (!MEDIA.some((k) => m[k] !== undefined)) return { type: 'skip', reason: 'service' };
  return { type: 'inbound', inbound: { ...base, kind: 'other', mentionsAgent: false, ...reply }, ...(file ? { file } : {}) };
}

const emojisOf = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(rec).filter((r) => r?.type === 'emoji' && !!str(r.emoji)).map((r) => str(r!.emoji)!) : [];

/** message_reaction: one inbound per removed emoji (removed: true), then one per added emoji. */
function fromReaction(r: Rec, opts: TgNormalizeOptions): TgEvent[] {
  const chat = chatOf(r.chat);
  const mid = num(r.message_id);
  if (!chat || mid === undefined) return [{ type: 'skip', reason: 'malformed' }];
  const user = rec(r.user);
  const uid = idStr(user?.id);
  if (!user || !uid) return [{ type: 'skip', reason: 'anonymous' }];
  if (opts.botId && uid === opts.botId) return [{ type: 'skip', reason: 'own' }];
  const before = emojisOf(r.old_reaction);
  const after = emojisOf(r.new_reaction);
  const date = num(r.date) ?? 0;
  const target = String(mid);
  const one = (emoji: string, removed: boolean): TgEvent => ({
    type: 'inbound',
    inbound: {
      surface: 'telegram', spaceId: chat.id, isGroup: chat.isGroup, kind: 'reaction', mentionsAgent: false, at: date * 1000,
      msgId: `reaction:${chat.id}:${mid}:${date}:${uid}:${emoji}${removed ? ':removed' : ''}`,
      from: userRef(user, uid),
      reaction: { emoji, target, ...(removed ? { removed: true } : {}) },
    },
  });
  const out = [...before.filter((e) => !after.includes(e)).map((e) => one(e, true)), ...after.filter((e) => !before.includes(e)).map((e) => one(e, false))];
  return out.length ? out : [{ type: 'skip', reason: 'unsupported' }];
}

/** One Update -> zero or more events (a reaction change can add and remove several emoji at once). */
export function normalizeTelegramUpdate(update: unknown, opts: TgNormalizeOptions): TgEvent[] {
  const u = rec(update);
  if (!u) return [{ type: 'skip', reason: 'malformed' }];
  const reaction = rec(u.message_reaction);
  if (reaction) return fromReaction(reaction, opts);
  const msg = rec(u.message);
  if (msg) return [fromMessage(msg, false, opts)];
  const edited = rec(u.edited_message);
  if (edited) return [fromMessage(edited, true, opts)];
  return [{ type: 'skip', reason: 'unsupported' }];
}

/** Bot id from a BotFather token ("<id>:<secret>"). Never log the token itself. */
export function botIdFromToken(token: string): string | undefined {
  const m = /^(\d+):/.exec(token);
  return m ? m[1] : undefined;
}

/** Leading Telegram message_id of a MsgRef ("55", "55:edit:1700000000", photo "55:1"), else undefined. */
export function messageIdOf(ref: string): number | undefined {
  const m = /^(\d+)(?::|$)/.exec(ref);
  return m ? Number(m[1]) : undefined;
}

/** chat_id parameter: numeric ids as numbers, @channelusername stays a string. */
export function chatIdParam(id: string): number | string {
  return /^-?\d+$/.test(id) ? Number(id) : id;
}
