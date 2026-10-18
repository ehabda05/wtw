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
  serviceCharge?: number;
  discount?: number;
  items: ReceiptItem[];
  arithmeticConsistent: boolean;
}

export interface ReceiptItem {
  name: string;
  quantity: number;
  unitPrice?: number;
  total: number;
}

export type ReceiptReadResult =
  | { status: 'ok'; receipt: ReceiptTotals }
  | { status: 'inconsistent' }
  | { status: 'disabled' | 'unsupported' | 'unsupported-currency' | 'unknown-currency' | 'unreadable' | 'provider-error' };

export type ReceiptReader = (bytes: Uint8Array, mime: string) => Promise<ReceiptReadResult>;

const SCHEMA = {
  type: 'object',
  properties: {
    total: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    currency: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    subtotal: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    tax: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    tip: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    serviceCharge: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    discount: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          quantity: { type: 'number' },
          unitPrice: { anyOf: [{ type: 'number' }, { type: 'null' }] },
          total: { type: 'number' },
        },
        required: ['name', 'quantity', 'unitPrice', 'total'],
        additionalProperties: false,
      },
    },
  },
  required: ['total', 'currency', 'subtotal', 'tax', 'tip', 'serviceCharge', 'discount', 'items'],
  additionalProperties: false,
} as const;

const SYSTEM =
  'Read one photo of a receipt. Return the grand total charged, currency, subtotal, tax, tip, service charge, discounts, ' +
  'and every readable purchased line item with quantity, unit price when printed, and line total. Amounts are positive ' +
  'decimal currency units; represent discounts as positive amounts. Use null for an amount not printed, an empty array ' +
  'when no line items are readable, and null for total if this is not a receipt or the total is illegible. Never guess.';

const MEDIA = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

const cents = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100_000 ? Math.round(v * 100) : undefined;

/** Validates the structured model response before any amount can reach the bill splitter. */
export function validateReceiptResponse(text: string): ReceiptReadResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { status: 'unreadable' };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { status: 'unreadable' };
  const parsed = value as Record<string, unknown>;
  const total = cents(parsed.total);
  if (total === undefined || total === 0) return { status: 'unreadable' };
  if (typeof parsed.currency !== 'string' || !/^[A-Z]{3}$/.test(parsed.currency)) return { status: 'unknown-currency' };
  if (parsed.currency !== 'USD') return { status: 'unsupported-currency' };
  if (!Array.isArray(parsed.items)) return { status: 'unreadable' };
  const items: ReceiptItem[] = [];
  for (const value of parsed.items) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { status: 'unreadable' };
    const item = value as Record<string, unknown>;
    const lineTotal = cents(item.total);
    if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 100 ||
        typeof item.quantity !== 'number' || !Number.isFinite(item.quantity) || item.quantity <= 0 ||
        item.quantity > 100 || lineTotal === undefined) return { status: 'unreadable' };
    const unitPrice = item.unitPrice === null ? undefined : cents(item.unitPrice);
    if (item.unitPrice !== null && unitPrice === undefined) return { status: 'unreadable' };
    if (unitPrice !== undefined && Math.abs(unitPrice * item.quantity - lineTotal) > 2) return { status: 'inconsistent' };
    items.push({
      name: item.name.trim(),
      quantity: item.quantity,
      total: lineTotal / 100,
      ...(unitPrice !== undefined ? { unitPrice: unitPrice / 100 } : {}),
    });
  }
  const amount = (v: unknown) => (v === null ? undefined : cents(v));
  const subtotal = amount(parsed.subtotal);
  const tax = amount(parsed.tax);
  const tip = amount(parsed.tip);
  const serviceCharge = amount(parsed.serviceCharge);
  const discount = amount(parsed.discount);
  const rawAmounts = [parsed.subtotal, parsed.tax, parsed.tip, parsed.serviceCharge, parsed.discount];
  const values = [subtotal, tax, tip, serviceCharge, discount];
  if (rawAmounts.some((v, i) => v !== null && values[i] === undefined)) return { status: 'unreadable' };
  const itemSum = items.reduce((sum, item) => sum + Math.round(item.total * 100), 0);
  if (items.length && subtotal !== undefined && Math.abs(itemSum - subtotal) > 2) return { status: 'inconsistent' };
  if (subtotal !== undefined) {
    const expected = subtotal - (discount ?? 0) + (tax ?? 0) + (tip ?? 0) + (serviceCharge ?? 0);
    if (Math.abs(expected - total) > 2) return { status: 'inconsistent' };
  }
  return {
    status: 'ok',
    receipt: {
      total: total / 100,
      currency: parsed.currency,
      ...(subtotal !== undefined ? { subtotal: subtotal / 100 } : {}),
      ...(tax !== undefined ? { tax: tax / 100 } : {}),
      ...(tip !== undefined ? { tip: tip / 100 } : {}),
      ...(serviceCharge !== undefined ? { serviceCharge: serviceCharge / 100 } : {}),
      ...(discount !== undefined ? { discount: discount / 100 } : {}),
      items,
      arithmeticConsistent: true,
    },
  };
}

/** Reads a receipt and keeps provider, unsupported-input, and unreadable outcomes distinct. */
export async function readReceipt(cfg: LlmConfig, bytes: Uint8Array, mime: string, client?: MessagesClient): Promise<ReceiptReadResult> {
  if (!isEnabled(cfg)) return { status: 'disabled' };
  const mediaType = mime.toLowerCase().split(';')[0];
  if (!MEDIA.has(mediaType) || bytes.length === 0 || bytes.length > 10 * 1024 * 1024) return { status: 'unsupported' };
  let response;
  try {
    const c = client ?? (await makeClient(cfg.apiKey!));
    response = await c.beta.messages.create(
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
  } catch {
    return { status: 'provider-error' };
  }
  if (response.stop_reason === 'refusal') return { status: 'unreadable' };
  const text = response.content.find((b) => b.type === 'text');
  if (!text || text.type !== 'text') return { status: 'unreadable' };
  return validateReceiptResponse(text.text);
}
