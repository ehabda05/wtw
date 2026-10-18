import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateReceiptResponse } from '../../src/llm/receipt.js';

const receipt = (over: Record<string, unknown> = {}) => JSON.stringify({
  total: 23.6,
  currency: 'USD',
  subtotal: 20,
  tax: 1.6,
  tip: 2,
  serviceCharge: null,
  discount: null,
  items: [
    { name: 'Noodles', quantity: 1, unitPrice: 16, total: 16 },
    { name: 'Tea', quantity: 1, unitPrice: 4, total: 4 },
  ],
  ...over,
});

test('receipt extraction preserves line items and printed charges after cent validation', () => {
  const result = validateReceiptResponse(receipt());
  assert.deepEqual(result, {
    status: 'ok',
    receipt: {
      total: 23.6, currency: 'USD', subtotal: 20, tax: 1.6, tip: 2,
      items: [{ name: 'Noodles', quantity: 1, unitPrice: 16, total: 16 }, { name: 'Tea', quantity: 1, unitPrice: 4, total: 4 }],
      arithmeticConsistent: true,
    },
  });
});

test('receipt arithmetic and unit prices must reconcile before splitting', () => {
  assert.deepEqual(validateReceiptResponse(receipt({ total: 24 })), { status: 'inconsistent' });
  assert.deepEqual(validateReceiptResponse(receipt({
    items: [{ name: 'Noodles', quantity: 2, unitPrice: 16, total: 30 }],
  })), { status: 'inconsistent' });
});

test('receipt reader rejects unknown and unsupported currencies instead of treating them as USD', () => {
  assert.deepEqual(validateReceiptResponse(receipt({ currency: null })), { status: 'unknown-currency' });
  assert.deepEqual(validateReceiptResponse(receipt({ currency: 'CAD' })), { status: 'unsupported-currency' });
});

test('malformed or incomplete extraction is classified as unreadable', () => {
  assert.deepEqual(validateReceiptResponse('not json'), { status: 'unreadable' });
  assert.deepEqual(validateReceiptResponse(receipt({ items: null })), { status: 'unreadable' });
});
