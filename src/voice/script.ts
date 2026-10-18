// What Homi says on a call. PRIVACY.md §10: a call carries ONLY the open question and its
// options. No member names, no place, no group name, nothing said in the chat.
//
// Option labels come from the engine (Option.label, e.g. "Fri Oct 23, 7pm") and are turned
// into natural spoken forms ("Friday at 7"). The result is passed to Retell as the single
// dynamic variable {{question}} (docs.retellai.com/build/dynamic-variables).

/** Agent prompt, from docs/CHANNELS.md (Voice → Create the agent), plus call-handling rules. */
export const AGENT_PROMPT =
  "You are Homi, calling on behalf of a friend group's plan. Ask exactly: {{question}}. " +
  'Accept a short answer, repeat it back in one sentence, thank them, and hang up. ' +
  "Never mention anyone's name or any other plan detail.\n\n" +
  'Rules:\n' +
  '- Keep every turn to one or two short sentences.\n' +
  "- If they ask who you are: you are Homi, the planning helper their group added, and they agreed to a quick call. Say nothing else about the group.\n" +
  '- If they are unsure or say none of the times work, accept that as the answer ("none work" or "not sure").\n' +
  '- If they say it is a bad time, ask you to stop, or ask not to be called: say sorry for the interruption, thank them, and hang up.\n' +
  '- If you reach voicemail or an answering machine, hang up without leaving a message.\n' +
  '- Never ask for or repeat a phone number, address, email, or any personal detail.';

/** First utterance: the question itself (dynamic variables work in the begin message per Retell docs). */
export const BEGIN_MESSAGE = '{{question}}';

/** Used only for Retell dashboard test calls, where no dynamic variables are supplied. */
export const DEFAULT_TEST_QUESTION =
  "Hi, this is Homi with a test call about your group's plan. Does Friday at 7 or Saturday at 7 work better for you?";

/** Post-call analysis field description (no dynamic variables: keep it self-contained). */
export const ANSWER_FIELD_DESCRIPTION =
  "The callee's answer to the question the agent asked, as one short phrase in their own words, " +
  "naming the day or time they picked if any (for example: 'Friday works', 'Saturday at 7', 'both work', " +
  "'none work', 'not sure'). Leave empty if they did not answer. Never include names, phone numbers or other details.";

const WEEKDAYS: Record<string, string> = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
};

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Generic activities that are safe to say on the phone. Anything else is dropped (it may be chat text). */
const SAFE_ACTIVITIES: Record<string, string> = {
  dinner: 'dinner', lunch: 'lunch', brunch: 'brunch', breakfast: 'breakfast', coffee: 'coffee', drinks: 'drinks',
  movie: 'movie', movies: 'movie', 'movie night': 'movie night', 'game night': 'game night', 'hang out': 'hangout',
  hangout: 'hangout', 'hang-out': 'hangout', karaoke: 'karaoke', bowling: 'bowling', hike: 'hike', picnic: 'picnic',
  'study session': 'study session', study: 'study session', party: 'party',
};

interface ParsedOption {
  weekday?: string;      // "Friday"
  dayOfMonth?: number;   // 23
  time?: string;         // "7", "7:30", "noon", "10 in the morning"
  fallback: string;      // sanitized label, used when the weekday can't be read
}

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

function sanitizeLabel(label: string): string {
  return label
    .replace(/[·•|]/g, ', ')
    .replace(/[^A-Za-z0-9 :,'.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/^[\s,]+|[\s,]+$/g, '');
}

/** "7pm" → "7", "7:30pm" → "7:30", "12pm" → "noon", "19:00" → "7", "10am" → "10 in the morning". */
export function spokenTime(raw: string): string | undefined {
  const s = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (s === 'noon' || s === 'midday') return 'noon';
  if (s === 'midnight') return 'midnight';
  const m = /^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.|a|p)?$/.exec(s);
  if (!m) return undefined;
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  const suffix = m[3]?.[0]; // 'a' | 'p' | undefined
  if (minute > 59 || hour > 23 || (suffix && (hour < 1 || hour > 12))) return undefined;
  let hour24: number | undefined; // undefined = bare "7": say it as given
  if (suffix === 'p') hour24 = (hour % 12) + 12;
  else if (suffix === 'a') hour24 = hour % 12;
  else if (hour >= 13 || hour === 0 || (m[2] !== undefined && m[1]!.startsWith('0'))) hour24 = hour; // "19:00", "09:30"
  if (hour24 === 12 && minute === 0) return 'noon';
  if (hour24 === 0 && minute === 0) return 'midnight';
  if (hour24 !== undefined) hour = hour24 % 12 || 12;
  const clock = minute === 0 ? `${hour}` : `${hour}:${String(minute).padStart(2, '0')}`;
  if (hour24 !== undefined && hour24 >= 5 && hour24 < 12) return `${clock} in the morning`;
  if (hour24 !== undefined && hour24 < 5) return `${clock} a.m.`;
  return clock;
}

function parseOption(label: string): ParsedOption {
  const fallback = sanitizeLabel(label);
  const text = label.replace(/[·•|]/g, ' , ').replace(/\s+/g, ' ').trim();
  const wd = /^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?(?=[\s,]|$)/i.exec(text);
  if (!wd) return { fallback };
  const weekday = WEEKDAYS[wd[1]!.toLowerCase()];
  let rest = text.slice(wd[0].length);

  let dayOfMonth: number | undefined;
  const md = /^[\s,]*([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?=[\s,]|$)/i.exec(rest);
  if (md && MONTHS.includes(md[1]!.slice(0, 3).toLowerCase())) {
    dayOfMonth = Number(md[2]);
    rest = rest.slice(md[0].length);
  } else {
    const num = /^[\s,]*(\d{1,2})\/(\d{1,2})(?=[\s,]|$)/.exec(rest);
    if (num) {
      dayOfMonth = Number(num[2]);
      rest = rest.slice(num[0].length);
    }
  }

  const timeText = rest.replace(/^[\s,@-]*(at\s+)?/i, '').replace(/[\s,]+$/, '');
  const time = timeText ? spokenTime(timeText) : undefined;
  if (timeText && time === undefined) return { fallback }; // unknown trailing text: don't guess
  return { weekday, dayOfMonth, time, fallback };
}

/** Spoken form of each option, e.g. ["Thursday at 7", "Friday at 7:30", "Saturday at noon"]. */
export function spokenOptions(options: string[]): string[] {
  const parsed = options.map(parseOption);
  // Distinct dates per weekday: two different Fridays need "the 23rd" / "the 30th".
  const datesByWeekday = new Map<string, Set<number | undefined>>();
  for (const p of parsed) {
    if (!p.weekday) continue;
    const set = datesByWeekday.get(p.weekday) ?? new Set<number | undefined>();
    set.add(p.dayOfMonth);
    datesByWeekday.set(p.weekday, set);
  }
  const out: string[] = [];
  for (const p of parsed) {
    let s: string;
    if (!p.weekday) s = p.fallback;
    else {
      const repeated = (datesByWeekday.get(p.weekday)?.size ?? 0) > 1 && p.dayOfMonth !== undefined;
      s = repeated ? `${p.weekday} the ${ordinal(p.dayOfMonth!)}` : p.weekday;
      if (p.time) s += ` at ${p.time}`;
    }
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

function joinOptions(spoken: string[]): string {
  if (spoken.length === 1) return `Does ${spoken[0]} work for you?`;
  if (spoken.length === 2) return `Does ${spoken[0]} or ${spoken[1]} work better for you?`;
  return `Does ${spoken.slice(0, -1).join(', ')}, or ${spoken[spoken.length - 1]} work for you?`;
}

export type Greeting = 'outbound' | 'inbound' | 'none';

/**
 * Build the one open question Homi asks on a call.
 * buildQuestion(["Thu Oct 22, 7pm", "Fri Oct 23, 7pm", "Sat Oct 24, 7pm"]) →
 * "Hi, this is Homi calling about your group's plan. Does Thursday at 7, Friday at 7, or Saturday at 7 work for you?"
 * `activity` is spoken only if it is a generic word from SAFE_ACTIVITIES ("dinner"); free text is dropped.
 */
export function buildQuestion(options: string[], activity?: string, opts: { greeting?: Greeting } = {}): string {
  const spoken = spokenOptions(options.filter((o) => typeof o === 'string' && o.trim() !== ''));
  if (spoken.length === 0) throw new Error('buildQuestion: no options');
  const safeActivity = activity ? SAFE_ACTIVITIES[activity.trim().toLowerCase()] : undefined;
  const plan = safeActivity ? `your group's ${safeActivity} plan` : "your group's plan";
  const greeting = opts.greeting ?? 'outbound';
  const intro =
    greeting === 'outbound' ? `Hi, this is Homi calling about ${plan}. `
    : greeting === 'inbound' ? `Hi, it's Homi, thanks for calling about ${plan}. `
    : '';
  return intro + joinOptions(spoken);
}

export class UnsafeQuestionError extends Error {
  constructor(readonly reason: string) {
    // Never echo the offending token: it may be a member's name.
    super(`unsafe call question: ${reason}`);
    this.name = 'UnsafeQuestionError';
  }
}

const MAX_QUESTION_CHARS = 400;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Throws UnsafeQuestionError if the question contains any forbidden token (member names, place
 * names, group name) as a whole word, case-insensitive, or anything that looks like contact data
 * (phone number, email, URL), an unresolved template, or is too long.
 */
export function assertSafeQuestion(q: string, forbidden: string[]): void {
  if (typeof q !== 'string' || q.trim() === '') throw new UnsafeQuestionError('empty');
  if (q.length > MAX_QUESTION_CHARS) throw new UnsafeQuestionError('too long');
  if (/\{\{|\}\}/.test(q)) throw new UnsafeQuestionError('unresolved template');
  for (const run of q.match(/\+?\d[\d\s().-]*\d/g) ?? []) {
    if (run.replace(/\D/g, '').length >= 7) throw new UnsafeQuestionError('looks like a phone number');
  }
  if (/[^\s@]+@[^\s@]+\.[a-z]{2,}/i.test(q)) throw new UnsafeQuestionError('looks like an email');
  if (/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|org|net|io|co|app|me|ly)\b/i.test(q)) throw new UnsafeQuestionError('looks like a link');
  forbidden.forEach((raw, i) => {
    const token = (raw ?? '').trim();
    if (token.length < 2) return;
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(token)}(?![\\p{L}\\p{N}])`, 'iu');
    if (re.test(q)) throw new UnsafeQuestionError(`forbidden token #${i + 1}`);
  });
}
