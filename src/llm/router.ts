// Optional "repair router" (docs/PRIVACY.md §3). When Homi was addressed but the rule-based engine could only answer
// with a generic fallback ("Not sure what you mean…"), the runner may ask Claude to map the message onto ONE of
// Homi's canonical commands, then re-runs the engine on that command. OFF by default. The model sees only a
// redacted snippet (names, handles, emails, phones, links and long digit runs replaced by numbered placeholders)
// plus a context line with no personal data, and it can only answer with a command from a fixed catalog.

import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { LLM_MODEL, fallbackParams, isEnabled, makeClient, redactForLlm, redactWithSlots, type LlmConfig, type MessagesClient } from './redacted.js';

export const ROUTER_TIMEOUT_MS = 4000;
const MAX_REWRITE = 200;

/** What the runner may tell the model about the group: no names, no message text, no places. */
export interface RepairContext {
  /** 'none' or the plan state, e.g. 'collecting_availability'. */
  planState: string;
  /** Open date option labels ("Thu Oct 22 · 7pm"). */
  options: string[];
  members?: number;
  /** e.g. 'bill tab', 'trip', 'pledge', 'album', 'food vote'. */
  openFlows: string[];
}

export interface RepairRequest {
  /** The raw addressed message. Redacted here before anything leaves the process. */
  text: string;
  knownNames: string[];
  context: RepairContext;
}

export interface RepairResult {
  /** Canonical command; may contain the snippet's placeholders ("[name1]"), which the runner restores locally. */
  rewrite: string;
}

export type RepairFn = (req: RepairRequest, signal?: AbortSignal) => Promise<RepairResult | null>;

export interface RouterConfig extends LlmConfig {
  /** Model id; default claude-haiku-5-5 (HOMI_LLM_MODEL overrides it where the router is set up). */
  model?: string;
  timeoutMs?: number;
}

const SCHEMA = {
  type: 'object',
  properties: { rewrite: { anyOf: [{ type: 'string' }, { type: 'null' }] } },
  required: ['rewrite'],
  additionalProperties: false,
} as const;

export const ROUTER_SYSTEM = `You help Homi, a bot in a friends' group chat, understand one message that was addressed to it.
Map the message onto exactly ONE command from the catalog below and answer {"rewrite": "<command>"}, or {"rewrite": null} when nothing clearly fits, when it is small talk, or when it already is one of these commands.
The message is redacted: [name1], [number1], [link1], [email1], [handle1] stand for removed text. Keep these placeholders exactly as written where they belong; never guess what they were.
Rules:
- Start the command with "homi ". Only an answer to open date options may be a bare vote reply ("fri or sat works", "1 3", "anything but thu", "none").
- Never add amounts, prices, percentages, dates or people the message does not contain. A head count like "5 ways" may come from the message or from "members" in the context.
- Never pick stop, forget, delete, remove, clear, undo or cancel unless the message plainly asks for that.
- One line, at most 200 characters, no explanation.
- Casual wording maps onto the plain command: "break down the 84 between the 3 of us" -> "homi split 84 3 ways"; "everyone"/"all of us" with an amount -> "homi split <amount> <members> ways". Never write "me and 2 others".
- When date options are open and the person says any day, whichever day, whatever most people pick, or that they are flexible, answer "all work". If they rule days out, answer like "anything but thu".
Worked examples:
"wait who's actually coming so far" -> "homi where are we at"
"can u break down the 84 dollar uber between the 3 of us" -> "homi split 84 3 ways"
"honestly whatever day most people can do is fine by me" -> "all work"
"im down for whenever just not the weekend" (options Thu, Fri, Sat) -> "anything but sat"
"what are we eating tho" -> "homi find food"
"we should def do barcelona next spring, can u figure it out" -> "homi let's plan Barcelona for next spring"
"how much do i owe [name1]" -> "homi settle up"
Catalog (patterns, not answers: always use the message's own place, time, amounts and people, never the example ones):
Plans and dates: homi dinner next week? | fri or sat works | 1 3 | anything but thu | none | homi where are we at | homi why fri | homi lock fri | homi lock it when 4 say yes | homi I'm out | homi remind me | homi add to calendar | homi note parking: behind the building | homi what did we decide about parking | homi tone gentle | homi you can DM me | homi you can call me | homi I'm [name1] | homi we're in Boston | homi notice on
Food: homi find food | homi ramen, cheap, harvard square
Bills (Homi never moves money): homi split 120 5 ways | homi split 84 between [name1] [name2] me | homi split 86.40 + 18% tip 4 ways | homi split 120 between [name1] [name2], paid by [name1] | homi [name1] paid 23.40 for the uber, split [name2] [name1] me | homi itemize dinner, paid by [name1]: [name2] ramen 16.50; [name1] gyoza 8; tax 7%; tip 20% | homi settle up | homi tab | homi undo | homi clear the tab
Pledges (simulated money): homi let's do a $10 show-up pledge | homi I'm in | homi I'm here | homi pledges | homi cancel my pledge | homi dispute
Album: homi start an album | homi album | homi remove my photos
Trips: homi let's plan <place> for <when> (use the message's own place and time) | homi trip | homi comfortable please | homi budget is fine | homi go | homi forget the trip
Privacy and help: homi privacy | homi what do you know | homi forget | homi stop | homi help`;

/** The context line: plan state, open option labels, member count, open flows. Nothing personal. */
export function contextLine(ctx: RepairContext, knownNames: string[] = []): string {
  const opts = ctx.options.slice(0, 8).map((o) => redactForLlm(o, knownNames).replace(/[|;\n]/g, ' ').replace(/\s+/g, ' ').trim());
  return [
    `plan state: ${ctx.planState || 'none'}`,
    `open options: ${opts.length ? opts.join(' | ') : 'none'}`,
    `members: ${ctx.members ?? 'unknown'}`,
    `open flows: ${ctx.openFlows.length ? ctx.openFlows.join(', ') : 'none'}`,
  ].join('; ');
}

/** Builds exactly what is sent: the redacted snippet and the context line. */
export function buildRepairPrompt(req: RepairRequest): { redacted: string; prompt: string } {
  const redacted = redactWithSlots(req.text, req.knownNames).text.replace(/\s+/g, ' ').trim();
  return { redacted, prompt: `Context: ${contextLine(req.context, req.knownNames)}\nMessage: "${redacted}"` };
}

const DAY = '(?:mon(?:day)?|tue(?:s|sday)?|wed(?:s|nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)s?';
const VOTE_REPLY = new RegExp(
  '^(?:' +
    'none(?: of (?:them|these))?(?: works?)?' +
    '|(?:all|any|anything|everything)(?: of them)?(?: works?)?' +
    '|\\d{1,2}(?:\\s*(?:,|and|or|&)?\\s*\\d{1,2})*(?: works?)?' +
    `|(?:anything but |not |only )?${DAY}(?:\\s*(?:,|or|and|&|/)\\s*${DAY})*(?: (?:works?|is good|are good|only))?` +
    ")[.!]?$",
  'i',
);
const DESTRUCTIVE = /^homi (?:stop|forget|delete|remove|clear|undo|cancel)\b/i;
const ASKED_TO_DESTROY = /\b(?:stop|forget|delete|remove|clear|undo|cancel|leave|erase|wipe)\b/i;
const PLACEHOLDER = /\[(name|number|link|email|handle)(\d*)\]/gi;

function numbersIn(s: string): Set<number> {
  return new Set((s.replace(PLACEHOLDER, ' ').match(/\d+(?:\.\d+)?/g) ?? []).map(Number));
}

/**
 * Accepts a model answer only if it is a short canonical command (or a bare vote reply), uses no placeholder the
 * snippet lacks, invents no amount (anything with $ . % or >= 10 must be in the snippet; option-label numbers are
 * allowed for non-money), and only destroys data when the message asked to. Returns the normalized command.
 */
export function validateRewrite(raw: unknown, redacted: string, ctx?: RepairContext): string | null {
  if (typeof raw !== 'string') return null;
  let s = raw.replace(/\s+/g, ' ').trim();
  if (!s || s.length > MAX_REWRITE) return null;
  const addressed = /^@?homi[,:]?\s+(\S.*)$/i.exec(s);
  if (addressed) s = `homi ${addressed[1]}`;
  else if (!VOTE_REPLY.test(s)) return null;
  if (s.toLowerCase() === redacted.replace(/\s+/g, ' ').trim().toLowerCase()) return null;
  if (DESTRUCTIVE.test(s) && !ASKED_TO_DESTROY.test(redacted)) return null;
  for (const m of s.matchAll(PLACEHOLDER)) {
    const tag = `[${m[1].toLowerCase()}${m[2]}]`;
    if (m[2] ? !redacted.includes(tag) : !new RegExp(`\\[${m[1].toLowerCase()}\\d+\\]`).test(redacted)) return null;
  }
  const said = numbersIn(redacted);
  const labels = numbersIn((ctx?.options ?? []).join(' '));
  for (const m of s.replace(PLACEHOLDER, ' ').matchAll(/(\$)?(\d+(?:\.\d+)?)(%)?/g)) {
    const v = Number(m[2]);
    const money = Boolean(m[1] || m[3] || m[2].includes('.'));
    if (said.has(v)) continue;
    if (money || (v >= 10 && !labels.has(v))) return null;
  }
  return s;
}

/**
 * Restores numbered placeholders in a rewrite from the ORIGINAL text (same names => same slots). An unnumbered
 * "[name]" is accepted only when the snippet had exactly one name. Returns null if any placeholder can't be mapped.
 */
export function restorePlaceholders(rewrite: string, originalText: string, knownNames: string[]): string | null {
  const { slots } = redactWithSlots(originalText, knownNames);
  let ok = true;
  const out = rewrite.replace(PLACEHOLDER, (_m, kind: string, idx: string) => {
    const k = kind.toLowerCase();
    const keys = Object.keys(slots).filter((s) => s.replace(/\d+$/, '') === k);
    const key = idx ? `${k}${idx}` : keys.length === 1 ? keys[0] : undefined;
    const v = key ? slots[key] : undefined;
    if (v === undefined) ok = false;
    return v ?? '';
  });
  return ok ? out : null;
}

let cached: { apiKey: string; client: Promise<MessagesClient> } | undefined;

/** One SDK client per key. Loading the SDK takes a few seconds on a cold start, so setup starts it early. */
function clientFor(apiKey: string): Promise<MessagesClient> {
  if (!cached || cached.apiKey !== apiKey) {
    const client = makeClient(apiKey);
    client.catch(() => (cached = undefined));
    cached = { apiKey, client };
  }
  return cached.client;
}

/**
 * Asks the model for a canonical command. Returns null when disabled, on refusal, error, timeout, or when the
 * answer does not validate. Never throws. Sends only buildRepairPrompt(req) and the fixed system prompt.
 */
export async function rewriteToCommand(cfg: RouterConfig, req: RepairRequest, client?: MessagesClient, signal?: AbortSignal): Promise<RepairResult | null> {
  if (!isEnabled(cfg)) return null;
  const { redacted, prompt } = buildRepairPrompt(req);
  if (!redacted) return null;
  try {
    const c = client ?? (await clientFor(cfg.apiKey!));
    const response = await c.beta.messages.create(
      {
        model: cfg.model || LLM_MODEL,
        max_tokens: 1024,
        ...fallbackParams(cfg.model || LLM_MODEL),
        output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
        system: ROUTER_SYSTEM,
        messages: [{ role: 'user', content: prompt }],
      },
      { timeout: cfg.timeoutMs ?? ROUTER_TIMEOUT_MS, maxRetries: 0, signal },
    );
    if (response.stop_reason === 'refusal') return null;
    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') return null;
    const parsed = JSON.parse(text.text) as { rewrite?: unknown } | null;
    const rewrite = validateRewrite(parsed?.rewrite, redacted, req.context);
    return rewrite ? { rewrite } : null;
  } catch {
    return null;
  }
}

export function makeRepair(cfg: RouterConfig): RepairFn {
  // Warm up at startup so the first real message isn't the one that pays for loading the SDK.
  if (isEnabled(cfg)) void clientFor(cfg.apiKey!).catch(() => undefined);
  return (req, signal) => rewriteToCommand(cfg, req, undefined, signal);
}

export interface RouterSetup {
  repair: RepairFn | null;
  /** One startup line; never contains the key. */
  note: string;
}

export const NOTE_ON = 'LLM fallback ON (Claude, redacted snippets)';

/** The production switch (src/index.ts): DISABLE_HOSTED_LLM=false AND ANTHROPIC_API_KEY. */
export function routerFromConfig(c: { disableHostedLlm: boolean; anthropicApiKey?: string }, env: NodeJS.ProcessEnv = process.env): RouterSetup {
  const cfg: RouterConfig = { disableHostedLlm: c.disableHostedLlm, apiKey: c.anthropicApiKey, model: env.HOMI_LLM_MODEL?.trim() || undefined };
  return isEnabled(cfg) ? { repair: makeRepair(cfg), note: NOTE_ON } : { repair: null, note: 'LLM fallback OFF' };
}

/**
 * The web demo / sim opt-in: (HOMI_LLM=on or DISABLE_HOSTED_LLM=false) AND ANTHROPIC_API_KEY. HOMI_LLM=off always
 * wins. Reads only HOMI_LLM, DISABLE_HOSTED_LLM, ANTHROPIC_API_KEY and HOMI_LLM_MODEL: the environment first,
 * then .env for anything unset.
 */
export function routerFromEnv(env: NodeJS.ProcessEnv = process.env, dotEnvPath = '.env'): RouterSetup {
  let file: Record<string, string | undefined> = {};
  try {
    if (existsSync(dotEnvPath)) file = parseEnv(readFileSync(dotEnvPath, 'utf8')) as Record<string, string | undefined>;
  } catch {
    /* unreadable .env: treat as empty */
  }
  const get = (k: string) => (env[k] || file[k] || '').trim();
  const flag = get('HOMI_LLM');
  const off = /^(0|false|no|off)$/i.test(flag);
  const optedIn = !off && (/^(1|true|yes|on)$/i.test(flag) || /^(0|false|no|off)$/i.test(get('DISABLE_HOSTED_LLM')));
  if (!optedIn) return { repair: null, note: 'LLM fallback OFF (set HOMI_LLM=on and ANTHROPIC_API_KEY to enable)' };
  const apiKey = get('ANTHROPIC_API_KEY');
  if (!apiKey) return { repair: null, note: 'LLM fallback OFF: HOMI_LLM is on but ANTHROPIC_API_KEY is not set' };
  return { repair: makeRepair({ disableHostedLlm: false, apiKey, model: get('HOMI_LLM_MODEL') || undefined }), note: NOTE_ON };
}
