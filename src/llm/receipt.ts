// Receipt reading (docs/PRIVACY.md §3, docs/BILLS.md): when someone asks Homi to split "the bill" and a photo was
// just posted, that one image goes to Claude to read the total (and tax / tip when printed). Same switch as the
// other hosted-LLM uses; the image is held in memory for a few minutes and never stored or logged.

import { LLM_MODEL, fallbackParams, isEnabled, makeClient, type LlmConfig, type MessagesClient } from './redacted.js';

export interface ReceiptTotals {
  total: number;
  currency?: string;
  subtotal?: number;
  tax?: number;
  tip?: number;
}

export type ReceiptReader = (bytes: Uint8Array, mime: string) => Promise<ReceiptTotals | null>;

const SCHEMA = {
  type: 'object',
  properties: {
    total: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    currency: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    subtotal: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    tax: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    tip: { anyOf: [{ type: 'number' }, { type: 'null' }] },
  },
  required: ['total', 'currency', 'subtotal', 'tax', 'tip'],
  additionalProperties: false,
} as const;

const SYSTEM =
  'You read one photo of a restaurant or shop receipt. Return the grand total actually charged (after tax and any tip ' +
  'or service charge that is printed), plus the subtotal, tax and tip when they are printed, as numbers. If the image is ' +
  'not a receipt or no total is legible, return null for total. Never guess digits you cannot read.';

const MEDIA = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

/** Reads the totals off a receipt photo. Null when disabled, when the image type is unsupported, or on any failure. */
export async function readReceipt(cfg: LlmConfig, bytes: Uint8Array, mime: string, client?: MessagesClient): Promise<ReceiptTotals | null> {
  if (!isEnabled(cfg)) return null;
  const mediaType = mime.toLowerCase().split(';')[0];
  if (!MEDIA.has(mediaType) || bytes.length === 0 || bytes.length > 10 * 1024 * 1024) return null;
  try {
    const c = client ?? (await makeClient(cfg.apiKey!));
    const response = await c.beta.messages.create(
      {
        model: LLM_MODEL,
        max_tokens: 512,
        ...fallbackParams(LLM_MODEL),
        output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
        system: SYSTEM,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: Buffer.from(bytes).toString('base64') } },
              { type: 'text', text: 'Read the totals on this receipt.' },
            ],
          },
        ],
      },
      { timeout: 20_000, maxRetries: 0 },
    );
    if (response.stop_reason === 'refusal') return null;
    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') return null;
    const parsed = JSON.parse(text.text) as { total: number | null; currency: string | null; subtotal: number | null; tax: number | null; tip: number | null };
    const num = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : undefined);
    const total = num(parsed.total);
    if (total === undefined || total <= 0 || total > 100_000) return null;
    return {
      total,
      ...(parsed.currency ? { currency: parsed.currency } : {}),
      ...(num(parsed.subtotal) !== undefined ? { subtotal: num(parsed.subtotal) } : {}),
      ...(num(parsed.tax) !== undefined ? { tax: num(parsed.tax) } : {}),
      ...(num(parsed.tip) !== undefined ? { tip: num(parsed.tip) } : {}),
    };
  } catch {
    return null;
  }
}
