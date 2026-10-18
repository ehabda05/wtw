// Glue between the chat adapters and the agent: store every inbound message, batch bursts (a short quiet window
// so five quick messages become one reply), run the agent per chat under a mutex, post the reply, fire follow-up
// timers. No state machine: the transcript and the agent's notes are the state.

import type { ChannelAdapter, ChannelInbound } from '../channels/types.js';
import type { Surface } from '../engine/types.js';
import type { DiningAgent, AgentOutput } from './agent.js';
import type { DiningMemory } from './memory.js';

export interface DiningLog {
  (level: 'debug' | 'info' | 'warn' | 'error', msg: string, fields?: Record<string, unknown>): void;
}

export interface DiningRunnerOptions {
  agent: DiningAgent;
  memory: DiningMemory;
  log?: DiningLog;
  botName?: string;
  /** Quiet window before answering a burst of messages (ms). */
  debounceMs?: number;
  /** Shorter window when the bot was addressed directly. */
  addressedDebounceMs?: number;
  now?: () => number;
  /** Messages of history to show the model. */
  historyLimit?: number;
  /** After Homi speaks, unaddressed group messages still reach it for this long (people answering it). */
  openWindowMs?: number;
}

/** Food, plans, places, money: the things Homi is for. Anything else is friends talking. */
const TOPIC = new RegExp(
  '\\b(dinner|lunch|brunch|breakfast|eat|eating|food|hungry|starving|restaurant|place|spot|reserv\\w*|book\\w*|table|' +
    'tonight|tmrw|tomorrow|tonite|weekend|mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|' +
    '\\d{1,2}\\s?(am|pm)|\\d{1,2}:\\d{2}|' +
    'split|bill|receipt|check|tab|owe|owes|venmo|zelle|cash|pay|paid|tip|settle|pledge|flake\\w*|' +
    "i'?m in|im in|count me|i'?m out|can'?t make|cant make|cancel\\w*|running late|on my way|omw|here|arrived|" +
    'ramen|sushi|pizza|tacos?|thai|indian|chinese|italian|mexican|korean|burgers?|wings|bbq|vegan|vegetarian|halal|gluten|' +
    'plan|plans|where|when|what time|who\'?s in|whos in)\\b',
  'i',
);

const INTRO = (name: string) =>
  `Hey! I'm ${name} 🍜 I help this chat get dinner on the calendar: say when you're free, tell me what you're craving and I'll find spots, then send me the receipt and I'll split it. Just talk normally, I'm listening.`;

export class DiningRunner {
  readonly #agent: DiningAgent;
  readonly #mem: DiningMemory;
  readonly #log: DiningLog;
  readonly #name: string;
  readonly #debounce: number;
  readonly #addressed: number;
  readonly #now: () => number;
  readonly #historyLimit: number;
  readonly #openWindowMs: number;
  readonly #adapters = new Map<Surface, ChannelAdapter>();
  readonly #timers = new Map<string, NodeJS.Timeout>();
  readonly #busy = new Map<string, Promise<void>>();
  readonly #pending = new Set<Promise<void>>();
  #followTimer?: NodeJS.Timeout;

  constructor(o: DiningRunnerOptions) {
    this.#agent = o.agent;
    this.#mem = o.memory;
    this.#log = o.log ?? (() => undefined);
    this.#name = o.botName ?? 'Homi';
    this.#debounce = o.debounceMs ?? 1500;
    this.#addressed = o.addressedDebounceMs ?? 400;
    this.#now = o.now ?? Date.now;
    this.#historyLimit = o.historyLimit ?? 60;
    this.#openWindowMs = o.openWindowMs ?? 4 * 60_000;
  }

  addAdapter(a: ChannelAdapter): void {
    this.#adapters.set(a.surface, a);
  }

  /** Polls follow-up timers (the agent's "check back in 20 minutes"). */
  start(pollMs = 5_000): void {
    this.#followTimer = setInterval(() => void this.tickFollowUps(), pollMs);
    this.#followTimer.unref?.();
  }

  stop(): void {
    if (this.#followTimer) clearInterval(this.#followTimer);
    for (const t of this.#timers.values()) clearTimeout(t);
  }

  async whenIdle(): Promise<void> {
    // Flush debounced batches now, then wait for the agent runs.
    for (const [key, t] of [...this.#timers]) {
      clearTimeout(t);
      this.#timers.delete(key);
      this.#track(this.#runLocked(key, () => this.#process(key)));
    }
    while (this.#pending.size) await Promise.allSettled([...this.#pending]);
  }

  async handleInbound(m: ChannelInbound): Promise<void> {
    const key = `${m.surface}|${m.spaceId}`;
    if (!this.#mem.firstTime(`${key}|${m.msgId}`, m.at || this.#now())) return;
    const chat = this.#mem.chat(key, m.surface, m.isGroup);
    const at = m.at || this.#now();
    const sender = m.from ? nameFor(m.from) : 'someone';

    switch (m.kind) {
      case 'added_to_group': {
        const ref = await this.#send(m.surface, m.spaceId, INTRO(this.#name));
        this.#mem.addMessage({ spaceId: key, at, sender: this.#name, role: 'homi', text: INTRO(this.#name), msgId: ref, hasImage: false });
        this.#mem.setProcessed(key, this.#mem.lastId(key));
        return;
      }
      case 'headcount':
        if (m.headcount) this.#mem.setMembers(key, m.headcount);
        return;
      case 'members':
        if (m.members?.length) {
          const names = m.members.map(nameFor);
          for (const u of m.members) this.#mem.setHandle(`${m.surface}|${u.handle}`, nameFor(u), key, at);
          this.#mem.setRoster(key, names);
        }
        return;
      case 'reaction': {
        if (!m.reaction || m.reaction.removed) return;
        const target = this.#mem.homiMessageByRef(key, m.reaction.target);
        if (!target) return; // reactions to each other's messages are not for Homi
        const about = `your message #${target.id} ("${target.text.slice(0, 80).replace(/\s+/g, ' ')}")`;
        this.#mem.addMessage({ spaceId: key, at, sender, role: 'user', text: `reacted ${m.reaction.emoji} to ${about}`, msgId: m.msgId, hasImage: false });
        this.#schedule(key, this.#debounce);
        return;
      }
      case 'text':
      case 'photo':
      case 'other': {
        const text = (m.text ?? '').trim() || (m.kind === 'photo' ? '(photo)' : '(media)');
        if (m.kind === 'other' && !m.text) return;
        // A private reply from someone a group is waiting on goes into that group's transcript as their vote.
        if (!m.isGroup && m.from) {
          const g = this.#mem.groupOfHandle(`${m.surface}|${m.from.handle}`);
          if (g && g.spaceId !== key && this.#mem.chat(g.spaceId).followUpNote !== undefined) {
            this.#mem.addMessage({ spaceId: g.spaceId, at, sender: g.name, role: 'user', text: `(by DM) ${text}`, msgId: `dm:${m.msgId}`, hasImage: false });
            this.#schedule(g.spaceId, this.#addressed);
            return;
          }
        }
        if (m.isGroup && m.from) this.#mem.setHandle(`${m.surface}|${m.from.handle}`, sender, key, at);
        if (m.isGroup && m.from && !(chat.roster ?? []).includes(sender)) this.#mem.setRoster(key, [...(chat.roster ?? []), sender]);
        if (/^\s*(?:@?\w+[,:]?\s+)?(?:forget everything|wipe your memory|forget all)\b/i.test(text)) {
          this.#mem.forget(key);
          const ref = await this.#send(m.surface, m.spaceId, 'Done, wiped everything I had for this chat. Clean slate 🧽');
          this.#mem.addMessage({ spaceId: key, at, sender: this.#name, role: 'homi', text: 'Done, wiped everything I had for this chat. Clean slate 🧽', msgId: ref, hasImage: false });
          this.#mem.setProcessed(key, this.#mem.lastId(key));
          return;
        }
        const replyTo = m.replyTo ? this.#mem.homiMessageByRef(key, m.replyTo) : undefined;
        const body = replyTo ? `(replying to your #${replyTo.id}) ${text}` : text;
        this.#mem.addMessage({ spaceId: key, at, sender, role: 'user', text: body, msgId: m.msgId, hasImage: !!m.photo }, m.photo ? { mime: m.photo.mime, bytes: m.photo.bytes } : undefined);
        const addressed = !m.isGroup || m.mentionsAgent || !!replyTo || new RegExp(`\\b${this.#name}\\b`, 'i').test(text);
        if (!addressed && !m.photo && !this.#relevant(key, chat, text, at)) {
          this.#log('debug', 'dining: silent (not for Homi)', { key });
          return; // remembered, but Homi is not even consulted
        }
        this.#schedule(key, addressed || m.photo ? this.#addressed : this.#debounce);
        return;
      }
      default:
        return;
    }
  }

  /**
   * The silence gate: in a group, an unaddressed message wakes Homi only when it has an open question (a follow-up
   * timer), it spoke in the last few minutes (people are answering it), or the message is about food, plans or money.
   */
  #relevant(key: string, chat: { followUpNote?: string }, text: string, at: number): boolean {
    if (chat.followUpNote !== undefined) return true;
    if (at - this.#mem.lastHomiAt(key) < this.#openWindowMs) return true;
    return TOPIC.test(text);
  }

  #schedule(key: string, delay: number): void {
    const prev = this.#timers.get(key);
    if (prev) clearTimeout(prev);
    const t = setTimeout(() => {
      this.#timers.delete(key);
      this.#track(this.#runLocked(key, () => this.#process(key)));
    }, delay);
    this.#timers.set(key, t);
  }

  #track(p: Promise<void>): void {
    this.#pending.add(p);
    void p.finally(() => this.#pending.delete(p));
  }

  #runLocked(key: string, fn: () => Promise<void>): Promise<void> {
    const prev = this.#busy.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn).catch((err) => this.#log('error', 'dining: run failed', { err: String(err) }));
    this.#busy.set(key, next);
    return next;
  }

  async tickFollowUps(): Promise<void> {
    const now = this.#now();
    for (const chat of this.#mem.dueFollowUps(now)) {
      const note = chat.followUpNote ?? '';
      this.#mem.setFollowUp(chat.spaceId, null, null);
      this.#track(this.#runLocked(chat.spaceId, () => this.#process(chat.spaceId, note)));
    }
    await Promise.allSettled([...this.#pending]);
  }

  async #process(key: string, followUp?: string): Promise<void> {
    const chat = this.#mem.chat(key);
    const fresh = this.#mem.since(key, chat.processedUpTo);
    if (!fresh.length && followUp === undefined) return;
    const [surface, spaceId] = splitKey(key);
    const all = this.#mem.recent(key, this.#historyLimit + fresh.length);
    const freshIds = new Set(fresh.map((m) => m.id));
    const history = all.filter((m) => !freshIds.has(m.id)).slice(-this.#historyLimit);
    const withImages = all.filter((m) => m.hasImage).slice(-3).map((m) => m.id);
    const images = this.#mem.images(key, withImages);
    const lastId = fresh.length ? fresh[fresh.length - 1].id : this.#mem.lastId(key);

    const adapter = this.#adapters.get(surface as Surface);
    const typing = adapter?.typing?.(spaceId, true).catch(() => undefined);
    const started = this.#now();
    let out: AgentOutput;
    try {
      out = await this.#agent.run({
        surface,
        isGroup: chat.isGroup,
        members: chat.members,
        roster: chat.roster,
        balances: this.#mem.balancesText(key),
        notes: chat.notes,
        history,
        fresh,
        images,
        followUp,
        now: this.#now(),
      });
    } catch (err) {
      this.#log('error', 'dining: agent call failed', { err: String(err) });
      // Leave the messages unprocessed so the next message retries with them in context.
      return;
    } finally {
      await typing;
    }
    this.#mem.setProcessed(key, lastId);
    if (out.notes !== undefined) this.#mem.setNotes(key, out.notes);
    if (out.followUpMinutes) this.#mem.setFollowUp(key, this.#now() + out.followUpMinutes * 60_000, out.followUpNote ?? '');
    this.#log('info', 'dining: turn', { ms: this.#now() - started, fresh: fresh.length, tools: out.toolsUsed, replied: !!out.reply, reply: out.reply ?? undefined, notes: out.notes });

    for (const l of out.ledger ?? []) this.#mem.record(key, l.label, l.entries, this.#now());
    for (const d of out.dms ?? []) {
      const handle = this.#mem.handleOf(key, d.name)?.replace(`${surface}|`, '');
      if (!handle || !adapter?.dm) {
        this.#log('warn', 'dining: cannot DM (no handle, or no DMs on this surface)', { name: d.name, surface });
        continue;
      }
      try {
        await adapter.dm(handle, d.text);
        this.#mem.addMessage({ spaceId: key, at: this.#now(), sender: this.#name, role: 'homi', text: `(sent a DM to ${d.name}) ${d.text}`, hasImage: false });
      } catch (err) {
        this.#log('warn', 'dining: DM failed', { name: d.name, err: String(err) });
      }
    }
    if (out.react && adapter?.react) {
      const last = fresh.filter((m) => m.role === 'user' && m.msgId).at(-1);
      if (last?.msgId) await adapter.react(spaceId, last.msgId, out.react).catch((err) => this.#log('warn', 'dining: react failed', { err: String(err) }));
    }
    if (out.reply) {
      const ref = await this.#send(surface as Surface, spaceId, out.reply);
      this.#mem.addMessage({ spaceId: key, at: this.#now(), sender: this.#name, role: 'homi', text: out.reply, msgId: ref, hasImage: false });
      this.#mem.setProcessed(key, this.#mem.lastId(key));
    }
  }

  async #send(surface: Surface, spaceId: string, text: string): Promise<string | undefined> {
    const a = this.#adapters.get(surface);
    if (!a) {
      this.#log('warn', 'dining: no adapter for surface', { surface });
      return undefined;
    }
    try {
      return await a.send(spaceId, text);
    } catch (err) {
      this.#log('error', 'dining: send failed', { surface, err: String(err) });
      return undefined;
    }
  }
}

/** How a person is labeled in the transcript: the platform's name, else the last 4 digits of their number (iMessage). */
function nameFor(u: { handle: string; platformName?: string }): string {
  const n = u.platformName?.trim();
  if (n) return n;
  const digits = u.handle.replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : u.handle.slice(-6);
}

function splitKey(key: string): [string, string] {
  const i = key.indexOf('|');
  return [key.slice(0, i), key.slice(i + 1)];
}
