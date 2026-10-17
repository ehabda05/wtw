// Optional hosted-LLM fallback for availability replies that the local parser could not read
// (docs/PRIVACY.md §3). OFF by default: it runs only when DISABLE_HOSTED_LLM=false AND
// ANTHROPIC_API_KEY is set. The model never sees raw text: names, handles, emails, phone
// numbers, URLs and long digit runs are replaced before the request, and the prompt carries
// only the redacted reply plus the option labels ("Thu Oct 22 · 7pm", ...).

import type Anthropic from '@anthropic-ai/sdk';
import type { Vote } from '../engine/types.js';

/** Haiku 5.5: the fast, low-cost model; one call is a short prompt and a one-line JSON answer. */
export const LLM_MODEL = 'claude-haiku-5-5';

/**
 * Server-side refusal fallback, only for models that have one. Haiku 5.5 has none (a fallback list there is a
 * 400), so it gets no beta header and no `fallbacks`; a refusal simply means "no answer" and the rules stand.
 */
export function fallbackParams(model: string): { betas?: ['server-side-fallback-2026-07-01']; fallbacks?: 'default' } {
  return /^claude-haiku/.test(model) ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };
}

export interface LlmVote {
  optionIds: number[];
  vote: Vote;
}

export interface LlmConfig {
  disableHostedLlm: boolean;
  apiKey?: string;
}

/** Minimal client surface we use, so tests can inject a fake without network. */
export interface MessagesClient {
  beta: { messages: { create: Anthropic['beta']['messages']['create'] } };
}

const DAY_OR_TIME = /\b(mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun)[a-z]*\b|\b\d{1,2}(:\d{2})?\s?(am|pm)\b|\b\d{1,2}(st|nd|rd|th)\b/i;

export type SlotKind = 'link' | 'email' | 'handle' | 'number' | 'name';

/**
 * The one redaction pass. `label` turns each removed piece into its placeholder. Kept: day/time words, short
 * numbers, money amounts ("84", "23.40", "$1240.50") and years ("2030"); a phone-like run needs 7+ digits.
 */
function redactCore(text: string, knownNames: string[], label: (kind: SlotKind, original: string) => string): string {
  let out = text
    .replace(/https?:\/\/\S+/gi, (m) => label('link', m))
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, (m) => label('email', m))
    .replace(/@\w+/g, (m) => label('handle', m))
    .replace(/(\+?\d[\d\s().-]{6,}\d)/g, (m) => ((m.match(/\d/g)?.length ?? 0) >= 7 ? label('number', m) : m));
  const names = [...new Map(knownNames.map((n) => [n.trim().toLowerCase(), n.trim()])).values()]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), (m) => label('name', m));
  }
  // Long digit runs that are not times, years or amounts are dropped; short numbers (1, 2, 3, 7pm) survive.
  out = out.replace(/\b\d{4,}\b/g, (m, offset: number, all: string) => {
    const amount = m.length <= 6 && (all[offset - 1] === '$' || /^\.\d/.test(all.slice(offset + m.length)));
    const year = /^(19|20)\d\d$/.test(m);
    return DAY_OR_TIME.test(m) || amount || year ? m : label('number', m);
  });
  return out.slice(0, 280);
}

/** Redacts anything identifying while keeping day/time words the model needs. */
export function redactForLlm(text: string, knownNames: string[] = []): string {
  return redactCore(text, knownNames, (kind) => `[${kind}]`);
}

/**
 * Same redaction, with numbered placeholders ("[name1]", "[number2]") and the original text of each, so a
 * model's answer can be mapped back locally. The slots never leave this process.
 */
export function redactWithSlots(text: string, knownNames: string[] = []): { text: string; slots: Record<string, string> } {
  const slots: Record<string, string> = {};
  const counts: Partial<Record<SlotKind, number>> = {};
  const out = redactCore(text, knownNames, (kind, original) => {
    const n = (counts[kind] = (counts[kind] ?? 0) + 1);
    slots[`${kind}${n}`] = original;
    return `[${kind}${n}]`;
  });
  return { text: out, slots };
}

const SCHEMA = {
  type: 'object',
  properties: {
    option_ids: { type: 'array', items: { type: 'integer' } },
    vote: { type: 'string', enum: ['yes', 'maybe', 'no'] },
  },
  required: ['option_ids', 'vote'],
  additionalProperties: false,
} as const;

export function isEnabled(cfg: LlmConfig): boolean {
  return cfg.disableHostedLlm === false && Boolean(cfg.apiKey);
}

/**
 * Asks the model which of the posted options a reply refers to. Returns null when disabled,
 * on refusal, on error, or when the answer doesn't validate. Never throws.
 */
export async function classifyAvailability(
  cfg: LlmConfig,
  reply: string,
  optionLabels: string[],
  knownNames: string[] = [],
  client?: MessagesClient,
): Promise<LlmVote | null> {
  if (!isEnabled(cfg)) return null;
  const redacted = redactForLlm(reply, knownNames);
  try {
    const c: MessagesClient = client ?? (await makeClient(cfg.apiKey!));
    const options = optionLabels.map((l, i) => `${i + 1}: ${l}`).join('\n');
    const response = await c.beta.messages.create({
      model: LLM_MODEL,
      max_tokens: 1024,
      ...fallbackParams(LLM_MODEL),
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system:
        'You read one short group-chat reply about when someone is free and map it onto the numbered options. ' +
        'Return the option numbers the reply talks about and whether the person can make them (yes), might (maybe), or cannot (no). ' +
        'If the reply says every option works, list all of them. If it refers to none, return an empty list.',
      messages: [{ role: 'user', content: `Options:\n${options}\n\nReply: "${redacted}"` }],
    });
    if (response.stop_reason === 'refusal') return null;
    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') return null;
    const parsed = JSON.parse(text.text) as { option_ids: number[]; vote: Vote };
    const ids = parsed.option_ids.filter((id) => Number.isInteger(id) && id >= 1 && id <= optionLabels.length);
    if (!['yes', 'maybe', 'no'].includes(parsed.vote)) return null;
    return { optionIds: [...new Set(ids)], vote: parsed.vote };
  } catch {
    return null;
  }
}

export async function makeClient(apiKey: string): Promise<MessagesClient> {
  const mod = await import('@anthropic-ai/sdk');
  return new mod.default({ apiKey }) as unknown as MessagesClient;
}
