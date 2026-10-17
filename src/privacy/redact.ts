// Scrubs personal identifiers from free text (PRIVACY.md §3, §7).
// Used by the logger on every string and by the optional hosted-LLM path before anything leaves the server.
//
// Removes: emails, phone numbers in common written forms (+1 (617) 555-0134, 617.555.0134, +44 20 7946 0958 ...),
// @handles, and any run of 7+ digits. ISO dates / times are left alone so logs stay readable.

export const REDACTED = {
  email: '[email]',
  phone: '[phone]',
  number: '[number]',
  handle: '@[handle]',
} as const;

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Optional +country code, optional (area), then 2-4 digit groups joined by space . or -
const PHONE_RE = /(?<![\w+])(?:\+\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d{2,4}(?:[\s.-]\d{2,4}){1,4}(?![\w])/g;
const PAREN_PHONE_RE = /(?<![\w+])(?:\+\d{1,3}[\s.-]?)?\(\d{1,4}\)[\s.-]?\d{3,4}[\s.-]?\d{3,4}(?![\w])/g;
const DIGIT_RUN_RE = /\+?\d{7,}/g;
const HANDLE_RE = /(?<![\w.])@[A-Za-z0-9_](?:[A-Za-z0-9_.]{0,62}[A-Za-z0-9_])?/g;
const ISO_DATE_START = /^\d{4}-\d{2}-\d{2}(?:[T\s]|$)/;

function digitCount(s: string): number {
  let n = 0;
  for (const ch of s) if (ch >= '0' && ch <= '9') n++;
  return n;
}

function phoneReplacer(match: string): string {
  if (digitCount(match) < 7) return match;
  if (ISO_DATE_START.test(match)) return match;
  return REDACTED.phone;
}

export function redact(input: string): string {
  if (!input) return input;
  let s = input.replace(EMAIL_RE, REDACTED.email);
  s = s.replace(PAREN_PHONE_RE, phoneReplacer);
  s = s.replace(PHONE_RE, phoneReplacer);
  s = s.replace(DIGIT_RUN_RE, REDACTED.number);
  s = s.replace(HANDLE_RE, REDACTED.handle);
  return s;
}

/** True if the string still contains something redact() would remove. */
export function containsPii(input: string): boolean {
  return redact(input) !== input;
}
