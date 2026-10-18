// The dining agent: one Claude call per batch of new messages, with the whole recent transcript, the group's notes
// and any recent receipt photos in context. Claude decides whether to speak at all, what to say, what to remember,
// whether to search the web for places, and when to follow up. Tools: web_search (server), split_bill (exact
// math), save_notes (its own memory), react, follow_up_in, stay_silent.

import type Anthropic from '@anthropic-ai/sdk';
import { DateTime } from 'luxon';
import { splitBill, type SplitInput } from './split.js';
import type { StoredImage, StoredMessage } from './memory.js';

export const DEFAULT_MODEL = 'claude-haiku-5-5';

export interface AgentConfig {
  apiKey: string;
  model?: string;
  /** Where the group usually is, for place searches ("Cambridge, Massachusetts"). */
  city?: string;
  tz?: string;
  botName?: string;
  /** Request timeout in ms. */
  timeoutMs?: number;
}

export interface AgentInput {
  surface: string;
  isGroup: boolean;
  members?: number;
  /** Names of everyone in the chat, when the platform provides them. */
  roster?: string[];
  /** Netted ledger, e.g. "Jo owes Ben $5.00; Ana owes Ben $31.12". */
  balances?: string;
  notes: string;
  /** Older context, oldest first (already processed). */
  history: StoredMessage[];
  /** The new messages to react to, oldest first. */
  fresh: StoredMessage[];
  images: StoredImage[];
  /** A follow-up timer fired instead of a message. */
  followUp?: string;
  now: number;
}

export interface AgentOutput {
  reply: string | null;
  react?: string;
  notes?: string;
  followUpMinutes?: number;
  followUpNote?: string;
  dms?: { name: string; text: string }[];
  ledger?: { label: string; entries: { kind: 'debt' | 'payment'; from: string; to: string; amount: number }[] }[];
  /** For logs. */
  toolsUsed: string[];
}

export type Client = Pick<Anthropic, 'beta'>;

const MEDIA = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

export function systemPrompt(botName: string, city: string): string {
  return `You are ${botName}, the friend in a group chat who makes dinner plans actually happen. You live inside the group's existing chat (Telegram or iMessage). You are warm, quick, casual, and useful. You never sound like a bot or a form.

WHAT YOU DO (the dining vertical, end to end)
1. Plan: turn "we should get dinner" into a real plan: when, where, who's in. Propose concrete options instead of asking open questions. Ask at most ONE question at a time, and only when you truly cannot proceed. Prefer "Friday 7:30 at X? react 👍 if in" over "what time works for everyone?".
2. Recommend: when the group wants a place, use web_search to find real, currently-open restaurants that fit what they said (cuisine, vibe, budget, dietary needs, location). Give exactly 3 options, ONE line each: "1. Name (neighborhood, $$) - why it fits this group" where the why names the thing that matters to them (vegetarian, cheap, near work). No links, no hours, no paragraphs; if they want the address or a link for one, give it when asked. Default area: ${city}. If they already named a specific place, don't search, just confirm it. Search again when they change their mind. You may also suggest dishes, timing, reservations, or a backup if a place is busy.
3. Keep track of who's in, who's out, dietary needs, budget, who can't do what day. Remember it. People change their answers; the latest one counts.
4. Bill: when someone posts a receipt photo, read it carefully: every line item with its price, subtotal, tax, tip, service charge, total. List the items back briefly ("I see: ramen 16.50, gyoza 8, ...") and figure out who had what from the conversation (people often say "I had the salmon", "the fries were shared"). Ask ONE short question only for items you cannot place. Then call split_bill with the items, the people, and the extras, and post each person's share with who pays whom. Tax and tip are split in proportion to what each person ordered. If nobody says what the tip was, ask or assume what's printed. If they just say "split it evenly" do an equal split. Shares must come from split_bill, never from your own arithmetic.
5. Settle: the ledger is a running account between people, netted automatically (if Ben owed Jo $20 and Jo now owes Ben $25, the balance is Jo owes Ben $5). After split_bill with a payer, call record_debts with the bill as label and one debt entry per transfer; a correction to the same bill uses the SAME label and replaces it. When someone says they paid someone back ("I venmoed ben"), call record_debts with a payment entry. The current balances are in the header every turn: answer "who owes what", "settle up", "what's the damage" straight from them, one line per pair, nothing else.
6. Accountability pledge (optional, the group opts in): when someone says "let's do a $10 pledge" / "no-show pays $20" / "flakers buy dessert", record the pledge in your notes (amount or forfeit, who agreed). Everyone who then says they're in has committed. If a committed person cancels late (after the plan is locked, or on the day) or doesn't show up, they owe the pledge: split it evenly among the people who did show up and add it to who-owes-whom like any other debt (or, for a non-money forfeit, note who owes it). Cancelling well in advance with a reason the group accepts is fine; use judgment and keep it light, this is friends keeping friends honest, not a fine. Someone can propose a pledge only before the plan is locked; once it is set, say what the pledge is when you confirm the plan ("$10 no-show pledge is on"). On the day, set a follow_up_in timer for about 30 minutes after the start time to ask who made it, then settle the pledge and update the debts. Anyone can ask "who flaked" / "pledges" and you answer from your notes.
7. Anything else dining-related: reservations, what to order, dietary swaps, a toast, the next dinner. Be helpful beyond the script.

DECIDING WITH THE WHOLE GROUP (the quorum rule)
- You know who is in the chat (the roster in the header). A plan (day, time, or place) is NOT decided until every person on the roster has answered, or the 30-second window has passed.
- Every time you propose something that needs answers (a time, 3 places, "who's in"), call follow_up_in with minutes 0.5 and a note like "quorum check: waiting on Jo, Sam". When that timer fires, DM each person who has not answered (the dm tool, one short private message: "hey, the group's doing Santouka Fri 7:30, are you in?"), say one line in the group ("pinged Jo privately"), and set a second follow_up_in of 2 minutes. If they still haven't answered when that fires, they count as not coming, say so in one line and decide with the votes you have. If everyone answered before a timer, decide right away.
- A DM reply shows up in the group transcript as "(by DM) Jo: yes"; treat it as their vote. Never DM anyone for anything other than a plan question they have not answered.
- Never lock a plan while someone on the roster is still silent and the window is open. Never wait longer than the windows.

WHEN TO SPEAK (this matters most)
- You see EVERY message in the group. Most are between friends and are not for you. Reply only when it adds value: you were addressed (your name, @mention, a reply to you, a direct question), a decision needs a nudge, the group reached a decision you should lock in, a receipt was posted, someone asks about food/places/money/the plan, or someone answered a question you asked.
- Default to silence. Call stay_silent for banter, jokes, side conversations, one-word acknowledgements, people agreeing with each other, and anything that doesn't need you. If you are not sure whether to speak, don't. The group should feel like you only talk when it moves the dinner forward. Never reply "ok", "noted" or "got it" on its own; a 👍 reaction via react is the way to acknowledge quietly.
- When people are mid-discussion (two friends negotiating a day, for example), WAIT. Let them finish; come in when there is a decision to confirm or they get stuck. Use follow_up_in to check back later instead of nagging now (e.g. "ask again in 20 minutes if nobody answered").
- Several new messages may arrive at once; read them together and answer once.
- In a direct (1:1) chat, always reply.

HOW YOU TALK
- SHORT. Hard cap: 3 lines for anything except a 3-option recommendation or a bill (one line per person). No preamble, no recap of what people said, no "let me know". Say the thing, then stop.
- Plain text only: no markdown headers, no bold with asterisks, no bullet symbols like "-" at line starts (chat apps show them literally). Short lines, blank lines between blocks, a few emojis are fine. Numbers for options (1/2/3).
- Short. A plan confirmation is one or two lines. Recommendations: 3 compact blocks. A bill: one line per person.
- On iMessage people appear as the last 4 digits of their phone number (like "6606") until they tell you their name. The moment someone says who they are ("I'm Riad", "this is Charlie"), use that name from then on and keep the mapping in your notes ("6606 = Riad"). If you need a name you don't have, ask once ("who's this?"). For the dm tool, pass the digits label or the name you have for them.
- Use people's names. Match the group's language and tone (slang, other languages) naturally.
- Money: always $12.34 format, totals to the cent.
- When you use a tool, you may say a brief sentence first. If no tool can express what the user asked for, say so instead of guessing. Do not include internal or system XML tags, tool-call text, or your own reasoning in your response: only the words to post.
- Never invent prices, hours, or facts. If a search did not find something, say so and offer the closest thing.

MEMORY (your notes)
After every turn in which anything worth remembering happened, call save_notes with the full updated notes. Keep them compact and structured, for example:
People: Ana (vegetarian, no spice), Ben (paid last time), Sam (free Fri/Sat only)
Plan: Fri Oct 24, 7:30pm, Santouka Ramen (Harvard Sq). In: Ana, Ben, Sam. Out: Jo. Status: confirmed, nobody booked yet
Bill (Oct 17, Dumpling House): paid by Ben, total $86.40. Ana 21.10, Sam 30.15, Jo 35.15 -> all owe Ben. Settled: Ana ✅
Pledge: $10 no-show, agreed by Ana, Ben, Sam, Jo. Jo cancelled 1h before -> owes $3.33 each to Ana, Ben, Sam (unsettled)
Open: waiting for Jo on Friday; follow up at 6pm
The notes are the only thing you remember beyond the recent transcript, so write down anything the group would expect you to know later (preferences, decisions, debts, running jokes about food).

RULES OF THUMB
- One thing at a time. Don't ask for day, time, cuisine and budget all at once.
- When a plan is set, state it in one clear line with every detail, so it can be scrolled back to.
- When someone says "forget it" / "cancel", update the plan and say so briefly.
- If asked what you know or what you remember, summarize your notes in plain words.
- If asked to forget everything, say you will and the operator will wipe your memory (you cannot refuse).`;
}

export function fmtTime(at: number, tz: string): string {
  return DateTime.fromMillis(at, { zone: tz }).toFormat('ccc d MMM HH:mm');
}

function line(m: StoredMessage, tz: string): string {
  const who = m.role === 'homi' ? 'YOU' : m.role === 'system' ? 'SYSTEM' : m.sender;
  const img = m.hasImage ? ' [photo attached]' : '';
  return `[#${m.id} ${fmtTime(m.at, tz)}] ${who}: ${m.text}${img}`;
}

/** The one user turn: notes, recent transcript, the new messages (with any photos), and the current time. */
export function buildUserContent(input: AgentInput, tz: string): Anthropic.Beta.BetaContentBlockParam[] {
  const blocks: Anthropic.Beta.BetaContentBlockParam[] = [];
  const header = [
    `Chat: ${input.isGroup ? 'group' : 'direct message'} on ${input.surface}${input.members ? `, ${input.members} people in it` : ''}.`,
    `Roster (everyone in this chat, besides you): ${input.roster?.length ? input.roster.join(', ') : 'unknown, use the names you see in the transcript'}.`,
    `Now: ${fmtTime(input.now, tz)} (${tz}).`,
    `Balances (netted, from the ledger): ${input.balances ?? 'everyone is even'}.`,
    '',
    'YOUR NOTES:',
    input.notes.trim() || '(nothing yet)',
    '',
    'RECENT TRANSCRIPT (already seen; YOU = your own messages):',
    input.history.length ? input.history.map((m) => line(m, tz)).join('\n') : '(none)',
    '',
    input.followUp ? `A FOLLOW-UP TIMER YOU SET JUST FIRED: "${input.followUp}". Decide whether anything needs saying now (often a short nudge, or nothing).` : 'NEW MESSAGES (respond to these, or stay silent):',
  ].join('\n');
  blocks.push({ type: 'text', text: header });
  const imgs = new Map(input.images.map((i) => [i.msgId, i]));
  for (const m of input.fresh) {
    blocks.push({ type: 'text', text: line(m, tz) });
    const img = imgs.get(m.id);
    if (img) blocks.push(imageBlock(img));
  }
  // Earlier photos still in memory (e.g. the receipt from a few messages ago) go in too, so "split that" works.
  const freshIds = new Set(input.fresh.map((m) => m.id));
  const older = input.images.filter((i) => !freshIds.has(i.msgId)).slice(-2);
  for (const img of older) {
    blocks.push({ type: 'text', text: `(photo attached to message #${img.msgId}, for reference)` });
    blocks.push(imageBlock(img));
  }
  blocks.push({
    type: 'text',
    text: 'Reply with the exact message to post in the chat (plain text), or call stay_silent. Call save_notes if anything should be remembered.',
  });
  return blocks;
}

function imageBlock(img: StoredImage): Anthropic.Beta.BetaImageBlockParam {
  const media = (MEDIA.has(img.mime) ? img.mime : 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  return { type: 'image', source: { type: 'base64', media_type: media, data: Buffer.from(img.bytes).toString('base64') } };
}

export function tools(city: string, tz: string, model = DEFAULT_MODEL): Anthropic.Beta.BetaToolUnion[] {
  const [cityName, region] = city.split(',').map((s) => s.trim());
  return [
    {
      // Haiku takes the basic web search variant; Opus / Sonnet 4.6+ take the newer one.
      type: /^claude-haiku/.test(model) ? 'web_search_20250305' : 'web_search_20260209',
      name: 'web_search',
      max_uses: 4,
      user_location: { type: 'approximate', city: cityName, ...(region ? { region } : {}), country: 'US', timezone: tz },
    },
    {
      name: 'split_bill',
      description:
        'Exact bill math. Give the people on the bill, the line items with who had each (shared_by empty = everyone), and tax/tip/service/fee as a percent or amount. Returns each share to the cent (tax and tip proportional to what each person ordered) and who pays whom when paid_by is set. For an even split with no items, pass total instead of items.',
      strict: true,
      input_schema: {
        type: 'object',
        additionalProperties: false,
        required: ['people', 'items', 'total', 'tax', 'tip', 'service', 'fee', 'paid_by'],
        properties: {
          people: { type: 'array', items: { type: 'string' } },
          items: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'price', 'shared_by'],
              properties: { name: { type: 'string' }, price: { type: 'number' }, shared_by: { type: 'array', items: { type: 'string' } } },
            },
          },
          total: { type: ['number', 'null'] },
          tax: extraSchema(),
          tip: extraSchema(),
          service: extraSchema(),
          fee: extraSchema(),
          paid_by: { type: ['string', 'null'] },
        },
      },
    },
    {
      name: 'save_notes',
      description: 'Replace your notes for this chat with the full updated version (people, plan, bill, debts, open items).',
      strict: true,
      input_schema: { type: 'object', additionalProperties: false, required: ['notes'], properties: { notes: { type: 'string' } } },
    },
    {
      name: 'react',
      description: 'Put one emoji reaction on the latest message instead of (or in addition to) replying. Use 👍 to acknowledge quietly.',
      strict: true,
      input_schema: { type: 'object', additionalProperties: false, required: ['emoji'], properties: { emoji: { type: 'string' } } },
    },
    {
      name: 'follow_up_in',
      description: 'Wake yourself up later (in minutes) with a note, to nudge or check on something if nobody answered. Replaces any earlier timer.',
      strict: true,
      input_schema: { type: 'object', additionalProperties: false, required: ['minutes', 'note'], properties: { minutes: { type: 'number' }, note: { type: 'string' } } },
    },
    {
      name: 'dm',
      description: 'Send one short private message to a person in this chat (by their name in the roster). Only to ask someone who has not answered a plan question.',
      strict: true,
      input_schema: { type: 'object', additionalProperties: false, required: ['name', 'text'], properties: { name: { type: 'string' }, text: { type: 'string' } } },
    },
    {
      name: 'record_debts',
      description:
        'Write to the running ledger. label: the bill or payment ("Santouka Oct 17", "Jo paid Ben"); the same label replaces earlier entries, so re-send a corrected bill under its original label. entries: kind "debt" means from owes to; kind "payment" means from paid to. Balances are netted automatically and shown in your header.',
      strict: true,
      input_schema: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'entries'],
        properties: {
          label: { type: 'string' },
          entries: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['kind', 'from', 'to', 'amount'],
              properties: { kind: { type: 'string', enum: ['debt', 'payment'] }, from: { type: 'string' }, to: { type: 'string' }, amount: { type: 'number' } },
            },
          },
        },
      },
    },
    {
      name: 'stay_silent',
      description: 'Post nothing in the chat this turn.',
      strict: true,
      input_schema: { type: 'object', additionalProperties: false, required: ['reason'], properties: { reason: { type: 'string' } } },
    },
  ];
}

function extraSchema() {
  return {
    type: ['object', 'null'],
    additionalProperties: false,
    required: ['percent', 'amount'],
    properties: { percent: { type: ['number', 'null'] }, amount: { type: ['number', 'null'] } },
  } as const;
}

export class DiningAgent {
  readonly #cfg: Required<Pick<AgentConfig, 'model' | 'city' | 'tz' | 'botName' | 'timeoutMs'>> & { apiKey: string };
  #client?: Promise<Client>;

  constructor(cfg: AgentConfig, client?: Client) {
    this.#cfg = {
      apiKey: cfg.apiKey,
      model: cfg.model || DEFAULT_MODEL,
      city: cfg.city || 'Cambridge, Massachusetts',
      tz: cfg.tz || 'America/New_York',
      botName: cfg.botName || 'Homi',
      timeoutMs: cfg.timeoutMs ?? 90_000,
    };
    if (client) this.#client = Promise.resolve(client);
  }

  get model(): string {
    return this.#cfg.model;
  }

  #clientFor(): Promise<Client> {
    if (!this.#client) {
      this.#client = import('@anthropic-ai/sdk').then((mod) => new mod.default({ apiKey: this.#cfg.apiKey, maxRetries: 1, timeout: this.#cfg.timeoutMs }) as unknown as Client);
    }
    return this.#client;
  }

  /** Warm the SDK import so the first message is not the one that pays for it. */
  warm(): void {
    void this.#clientFor().catch(() => (this.#client = undefined));
  }

  async run(input: AgentInput): Promise<AgentOutput> {
    const client = await this.#clientFor();
    const { model, city, tz, botName } = this.#cfg;
    const out: AgentOutput = { reply: null, toolsUsed: [] };
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: buildUserContent(input, tz) }];
    let silent = false;
    let finalText = '';

    for (let turn = 0; turn < 8; turn++) {
      const response = await client.beta.messages.create({
        model,
        max_tokens: 1500,
        ...(/^claude-haiku/.test(model) ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }),
        output_config: { effort: 'low' },
        system: [{ type: 'text', text: systemPrompt(botName, city), cache_control: { type: 'ephemeral' } }],
        tools: tools(city, tz, model),
        messages,
      });
      if (response.stop_reason === 'refusal') return out;
      const text = response.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
      if (text) finalText = text;
      const uses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
      if (!uses.length || response.stop_reason !== 'tool_use') break;

      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const u of uses) {
        out.toolsUsed.push(u.name);
        let content = 'ok';
        let isError = false;
        try {
          const a = u.input as Record<string, unknown>;
          switch (u.name) {
            case 'split_bill':
              content = JSON.stringify(splitBill(normalizeSplit(a)));
              break;
            case 'save_notes':
              out.notes = String(a.notes ?? '');
              break;
            case 'react':
              out.react = String(a.emoji ?? '👍');
              break;
            case 'follow_up_in':
              out.followUpMinutes = Math.max(0.25, Number(a.minutes) || 30);
              out.followUpNote = String(a.note ?? '');
              break;
            case 'dm':
              (out.dms ??= []).push({ name: String(a.name ?? ''), text: String(a.text ?? '') });
              break;
            case 'record_debts':
              (out.ledger ??= []).push(a as NonNullable<AgentOutput['ledger']>[number]);
              break;
            case 'stay_silent':
              silent = true;
              break;
            default:
              content = `unknown tool ${u.name}`;
              isError = true;
          }
        } catch (err) {
          content = `error: ${(err as Error).message}`;
          isError = true;
        }
        results.push({ type: 'tool_result', tool_use_id: u.id, content, ...(isError ? { is_error: true } : {}) });
      }
      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: results });
    }
    out.reply = silent ? null : finalText || null;
    return out;
  }
}

function normalizeSplit(a: Record<string, unknown>): SplitInput {
  const ex = (v: unknown) => {
    if (!v || typeof v !== 'object') return undefined;
    const o = v as { percent?: number | null; amount?: number | null };
    return { ...(typeof o.percent === 'number' ? { percent: o.percent } : {}), ...(typeof o.amount === 'number' ? { amount: o.amount } : {}) };
  };
  return {
    people: Array.isArray(a.people) ? a.people.map(String) : [],
    ...(Array.isArray(a.items) && a.items.length ? { items: a.items as SplitInput['items'] } : {}),
    ...(typeof a.total === 'number' ? { total: a.total } : {}),
    ...(ex(a.tax) ? { tax: ex(a.tax) } : {}),
    ...(ex(a.tip) ? { tip: ex(a.tip) } : {}),
    ...(ex(a.service) ? { service: ex(a.service) } : {}),
    ...(ex(a.fee) ? { fee: ex(a.fee) } : {}),
    ...(typeof a.paid_by === 'string' && a.paid_by ? { paid_by: a.paid_by } : {}),
  };
}
