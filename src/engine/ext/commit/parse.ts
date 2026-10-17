// Pledge commands. Closed vocabulary on the address-stripped body; text is read, never stored (the goal of a
// goal pledge is the one piece a member explicitly hands Homi, cleaned and bounded).

import { DateTime } from 'luxon';
import { TRAIL } from '../../parse.js';
import { clean, normText } from '../../util.js';

export type CommitCmd =
  | { kind: 'start'; cents: number; goal?: string; by?: string }
  | { kind: 'status' }
  | { kind: 'in' }
  | { kind: 'here' }
  | { kind: 'done' }
  | { kind: 'confirm'; name: string }
  | { kind: 'cancel' }
  | { kind: 'dispute' }
  | { kind: 'verdict'; choice: 'refund' | 'keep'; name?: string };

export function norm(body: string): string {
  return normText(body).replace(TRAIL, '').trim();
}

const NAME = "([a-z][\\w'-]*(?: [a-z][\\w'-]*)?)";
const AMOUNT = [
  /\$\s?(\d{1,6}(?:\.\d{1,2})?)/,
  /\b(\d{1,6}(?:\.\d{1,2})?)\s?(?:dollars?|bucks|usd)\b/,
  /\b(?:pledge|commit)\s+(\d{1,6}(?:\.\d{1,2})?)\b/,
];

/** "10" -> 1000, "12.5" -> 1250 (integer math, no floats). */
export function toCents(s: string): number {
  const [d, f = ''] = s.split('.');
  return Number(d) * 100 + Number((f + '00').slice(0, 2));
}

export function parseCommit(body: string): CommitCmd | null {
  const b = norm(body);
  const q = b.replace(/\?+$/, '').trim();
  if (/^(?:please )?(?:cancel|drop|withdraw|undo)(?: my| the)? pledge$|^i'?m out of the pledge$/.test(q)) return { kind: 'cancel' };
  if (/^dispute(?: it| that| this| my (?:no-?show|forfeit|pledge)| the (?:no-?show|forfeit))?$/.test(q)) return { kind: 'dispute' };
  let m = q.match(new RegExp(`^refund(?: (?:for |to )?${NAME})?$`));
  if (m) return m[1] ? { kind: 'verdict', choice: 'refund', name: m[1] } : { kind: 'verdict', choice: 'refund' };
  if (/^keep(?: it| the money)?$/.test(q)) return { kind: 'verdict', choice: 'keep' };
  m = q.match(new RegExp(`^keep(?: it| the money)? for ${NAME}$`)) ?? q.match(/^keep ([a-z][\w-]*)'s(?: money| pledge| \$?\d+)?$/);
  if (m) return { kind: 'verdict', choice: 'keep', name: m[1] };
  if (/^(?:the |a )?(?:show-?up )?pledges?(?: status)?$|^(?:show|open) (?:the )?pledges?$|^who(?:'s| is)? (?:pledged|in the pledge)$|^how'?s the pledge(?: going)?$/.test(q)) {
    return { kind: 'status' };
  }
  if (/^(?:i'?m|i am|count me|me|we'?re) in(?: too| for the pledge| for it)?$|^i'?ll pledge$/.test(q)) return { kind: 'in' };
  if (/^(?:i'?m|i am|we'?re|we are) here$|^here$|^checking in$|^check(?:ed)? in$|^(?:i )?made it$/.test(q)) return { kind: 'here' };
  if (/^(?:i'?m |i am |all )?done$|^(?:i )?did it$/.test(q)) return { kind: 'done' };
  m = q.match(new RegExp(`^confirm(?:ed)? ${NAME}$`));
  if (m) return { kind: 'confirm', name: m[1] };
  if (!/\b(?:pledge|commit(?:ment)?)\b/.test(b)) return null;
  if (/\b(?:can'?t|cannot|won'?t|not|don'?t|never)\s+(?:\w+\s+)?(?:pledge|commit)/.test(b)) return null;
  const a = AMOUNT.map((re) => b.match(re)).find((x) => x);
  if (!a) return null;
  const cents = toCents(a[1]);
  const g = body.match(/\bthat\s+(.+?)(?:\s+by\s+(.+?))?\s*[.!?]*$/i);
  if (!g) return { kind: 'start', cents };
  const goal = clean(g[1], 60);
  return g[2] ? { kind: 'start', cents, goal, by: g[2] } : { kind: 'start', cents, goal };
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "Dec 1", "december 1st", "12/1" -> the next such ISO day in the group tz (this year or next). */
export function deadlineDay(phrase: string, now: number, tz: string): string | null {
  const t = norm(phrase);
  let mon: number;
  let dom: number;
  let m = t.match(/^(?:the )?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?$/);
  if (m) {
    mon = MONTHS.indexOf(m[1]) + 1;
    dom = Number(m[2]);
  } else if ((m = t.match(/^(\d{1,2})\/(\d{1,2})$/))) {
    mon = Number(m[1]);
    dom = Number(m[2]);
  } else return null;
  const today = DateTime.fromMillis(now, { zone: tz }).startOf('day');
  for (const y of [today.year, today.year + 1]) {
    const d = DateTime.fromObject({ year: y, month: mon, day: dom }, { zone: tz });
    if (d.isValid && d >= today) return d.toISODate();
  }
  return null;
}

/** Destination vote: "1", "option 2", "#3", or the option words ("group fund", "split", "charity"). */
export function destChoice(body: string): { n: number; numeric: boolean } | null {
  const b = norm(body).replace(/\?+$/, '');
  const m = b.match(/^(?:option\s*|#)?([1-3])$/);
  if (m) return { n: Number(m[1]), numeric: true };
  if (/^(?:the )?(?:group )?fund(?: it)?$|^group fund for the next outing$/.test(b)) return { n: 1, numeric: false };
  if (/^split(?: it)?(?: among (?:the people who (?:showed up|made it)|everyone who (?:shows|showed) up))?$/.test(b)) return { n: 2, numeric: false };
  if (/^(?:donate(?: it)?(?: to (?:a )?charity(?: we pick)?)?|charity)$/.test(b)) return { n: 3, numeric: false };
  return null;
}
