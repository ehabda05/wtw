// Stage 1 of intent detection (rules): addressing, commands, activity/window words, and the closed-vocabulary
// reply grammar from DATE_FINDING.md §3. Otto only matches replies against the options it posted, so this is a
// small classification problem, not open-ended NLP. Pure; text is only read, never returned or stored
// (except the pieces a member explicitly hands Otto: names, notes, place text).

import type { DayPref, Option, Tone, Vote } from './types.js';
import type { ActivityInfo, Command, ParsedAvailability, WindowSpec } from './model.js';
import { addDays, dayOfMonth, hm, isoDay, longDay, listJoin, monthOf, normText, shortDay, titleCase, clean, weekdayOf } from './util.js';

// ───────────────────────── addressing ─────────────────────────

const LEAD = /^\s*(?:(?:hey|hi|hello|yo|ok|okay|oi)\s*,?\s+)?@?otto(?![\w'’])[\s,:;!.\-]*/i;

/** True for a leading "otto" / "@otto" / "hey otto", a "/command", an @otto mention, or "otto" followed by , or ?. */
export function detectAddressed(text: string): boolean {
  const t = normText(text);
  if (/^\/[a-z]/.test(t)) return true;
  if (LEAD.test(t)) return true;
  if (/@otto(?![\w'])/.test(t)) return true;
  if (/(?:^|[^\w'])otto\s*[,?]/.test(t)) return true;
  return midCommand(t) !== null;
}

/** "wait otto what do you know": a short lead-in, then "otto" and a recognized command. */
function midCommand(text: string): string | null {
  const m = text.match(/^((?:[\w']+[\s,]+){1,3})otto(?![\w'])[\s,:]+(.+)$/i);
  if (!m) return null;
  const cmd = parseCommand(m[2]);
  return cmd && !['yes', 'no', 'go'].includes(cmd.kind) ? m[2] : null;
}

/** Removes the address ("hey otto, ", "@otto", trailing ", otto?", "/cmd@bot") and keeps the original case. */
export function stripAddress(text: string): string {
  let t = text.replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/️/g, '').trim();
  t = midCommand(t) ?? t.replace(LEAD, '');
  t = t.replace(/[\s,]*@?otto[\s?!.]*$/i, (m) => (m.includes('?') ? '?' : ''));
  t = t.replace(/@otto(?![\w'])\s*/gi, '');
  t = t.replace(/^\/([a-z]+)@\w+/i, '/$1');
  return t.replace(/\s+/g, ' ').trim();
}

// ───────────────────────── days ─────────────────────────

const DAY_NUM: Record<string, number> = {
  mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5, sat: 6, saturday: 6, sun: 7, sunday: 7,
};
const DAY_RE = /\b(mon|monday|tue|tues|tuesday|wed|weds|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday|sun|sunday)(?:s|'s)?\b/g;

/** Weekday tokens in order (1..7), skipping "the sun", "I sat down", "got wed", "c'mon". */
export function dayTokens(t: string): Array<{ wd: number; index: number; len: number }> {
  const out: Array<{ wd: number; index: number; len: number }> = [];
  for (const m of t.matchAll(DAY_RE)) {
    const word = m[1];
    const i = m.index ?? 0;
    const before = t.slice(Math.max(0, i - 12), i);
    const after = t.slice(i + m[0].length, i + m[0].length + 10);
    if (word === 'sun' && /\b(the|some|in)\s+$/.test(before)) continue;
    if (word === 'sat' && (/\b(i|we|he|she|they|you|just|had|it|was)\s+$/.test(before) || /^\s+(down|on|there|with|around|next to|by)\b/.test(after))) continue;
    if (word === 'wed' && /\b(get|got|getting|be|being|newly|were)\s+$/.test(before)) continue;
    if (word === 'mon' && /c'$/.test(before)) continue;
    out.push({ wd: DAY_NUM[word], index: i, len: m[0].length });
  }
  return out;
}

// ───────────────────────── activity ─────────────────────────

const ACTIVITIES: Array<[string, RegExp, boolean, boolean]> = [
  ['game night', /\bgame night\b|\bboard games?\b/, false, false],
  ['brunch', /\bbrunch\b/, false, true],
  ['breakfast', /\bbreakfast\b/, false, false],
  ['lunch', /\blunch\b/, false, false],
  ['dinner', /\bdinner\b|\bsupper\b/, false, false],
  ['drinks', /\bdrinks?\b|\bbeers?\b|\bcocktails?\b|\bhappy hour\b/, false, false],
  ['coffee', /\bcoffee\b/, false, false],
  ['movie', /\bmovies?\b|\bfilm\b|\bcinema\b/, false, false],
  ['hike', /\bhike\b|\bhiking\b/, true, true],
  ['picnic', /\bpicnic\b/, true, true],
  ['park', /\bpark\b/, true, true],
];

export function detectActivity(text: string): ActivityInfo {
  const t = normText(text);
  for (const [activity, re, outdoor, weekendPref] of ACTIVITIES) {
    if (re.test(t)) return { activity, named: true, outdoor, weekendPref };
  }
  return { activity: 'hang out', named: false, outdoor: false, weekendPref: false };
}

const PLAN_WORDS =
  /\b(plan|plans|hang ?out|hang|get together|meet ?up|catch up|do something|let'?s do|should we do|let'?s get|let'?s have|sometime|party|game night|bowling|karaoke|trip)\b|^\/plan\b/;

export function hasPlanWords(text: string): boolean {
  return PLAN_WORDS.test(normText(text));
}

// ───────────────────────── windows ─────────────────────────

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function nextOccurrence(today: string, wd: number, includeToday = true): string {
  const cur = weekdayOf(today);
  let delta = (wd - cur + 7) % 7;
  if (delta === 0 && !includeToday) delta = 7;
  return addDays(today, delta);
}

function nextWeekDay(today: string, wd: number): string {
  const mon = addDays(today, 8 - weekdayOf(today));
  return addDays(mon, wd - 1);
}

/** Days ruled out in a trigger: "not monday", "except fri", "can't do thu". */
export function excludedWeekdays(text: string): number[] {
  const t = normText(text);
  const out: number[] = [];
  for (const m of t.matchAll(/\b(?:not|no|except|but not|can'?t do|cant do|without)\s+(?:on\s+)?(mon|monday|tue|tues|tuesday|wed|weds|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday|sun|sunday)s?\b/g)) {
    out.push(DAY_NUM[m[1]]);
  }
  return [...new Set(out)];
}

function dateFromText(t: string, today: string): string | null {
  const year = Number(today.slice(0, 4));
  const mk = (mo: number, d: number): string | null => {
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    let iso = `${year}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (iso < today) iso = `${year + 1}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    return iso;
  };
  let m = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/);
  if (m) return mk(MONTHS[m[1]], Number(m[2]));
  m = t.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (m) return mk(Number(m[1]), Number(m[2]));
  m = t.match(/\bthe (\d{1,2})(?:st|nd|rd|th)\b/);
  if (m) {
    const d = Number(m[1]);
    const mo = monthOf(today);
    const cand = mk(mo, d);
    if (cand && cand >= today && dayOfMonth(cand) === d && monthOf(cand) === mo) return cand;
    return mk(mo === 12 ? 1 : mo + 1, d);
  }
  return null;
}

/**
 * Window phrase -> candidate days (DATE_FINDING §1 step 2). Returns null when the text names no window.
 * Explicit day lists ("thu, fri or sat?") override generation.
 */
export function parseWindow(text: string, now: number, tz: string): WindowSpec | null {
  const t = normText(text);
  const today = isoDay(now, tz);
  const wd = weekdayOf(today);
  const excluded = excludedWeekdays(t);
  const named = [...new Set(dayTokens(t).map((d) => d.wd).filter((d) => !excluded.includes(d)))];
  const isNextWeek = /\bnext week\b/.test(t);
  const phrase = phraseWindow(t, today, wd);

  // Named days, optionally with "tonight"/"tomorrow": "dinner tonight, fri or sat?" -> explicit options.
  const rel: Array<{ day: string; label: string }> = [];
  if (/\btonight\b|\bthis evening\b/.test(t)) rel.push({ day: today, label: 'tonight' });
  else if (/\btoday\b/.test(t)) rel.push({ day: today, label: 'today' });
  if (TOMORROW_RE.test(t)) rel.push({ day: addDays(today, 1), label: 'tomorrow' });
  if (named.length >= 1 && named.length + rel.length >= 2) {
    const days: string[] = rel.map((r) => r.day);
    const labels: string[] = rel.map((r) => r.label);
    // One forward run of days: "thu, fri or sat" said on a Saturday means next Thu, Fri and Sat, not today.
    const anchor = rel.length ? today : isNextWeek ? nextWeekDay(today, named[0]) : nextOccurrence(today, named[0]);
    for (const d of named) {
      const day = nextOccurrence(anchor, d);
      if (days.includes(day)) continue;
      days.push(day);
      labels.push(shortDay(day));
    }
    const range = phrase && !phrase.single ? phrase.days : days;
    return { label: listJoin(labels, 'or'), days, single: false, explicit: true, range };
  }
  if (named.length === 1 && (!phrase || !phrase.single)) {
    const isNext = new RegExp(`\\bnext\\s+(?:${Object.keys(DAY_NUM).join('|')})`).test(t);
    let day = isNext || isNextWeek ? nextWeekDay(today, named[0]) : nextOccurrence(today, named[0]);
    if (phrase) day = phrase.days.find((d) => weekdayOf(d) === named[0]) ?? day;
    return { label: longDay(day), days: [day], single: true, range: phrase?.days ?? [day] };
  }
  return phrase;
}

const TOMORROW_RE = /\btomorrow\b|\btmrw?\b|\btmr\b|\btomorow\b/;

/** Window phrases without named weekdays (DATE_FINDING §1 step 2). */
function phraseWindow(t: string, today: string, wd: number): WindowSpec | null {
  const mk = (label: string, days: string[]): WindowSpec => ({ label, days, single: days.length === 1, range: days });
  if (/\btonight\b|\bthis evening\b/.test(t)) return mk('tonight', [today]);
  if (/\btoday\b|\bthis afternoon\b/.test(t)) return mk('today', [today]);
  if (TOMORROW_RE.test(t)) return mk('tomorrow', [addDays(today, 1)]);
  if (/\bnext weekend\b/.test(t)) {
    const fri = nextWeekDay(today, 5);
    return mk('next weekend', [fri, addDays(fri, 1), addDays(fri, 2)]);
  }
  if (/\b(?:this|the) weekend\b|\bweekend\b/.test(t)) {
    const days: string[] = [];
    const start = wd <= 5 ? addDays(today, 5 - wd) : today;
    for (let d = start; weekdayOf(d) >= 5; d = addDays(d, 1)) {
      days.push(d);
      if (weekdayOf(d) === 7) break;
    }
    return mk('this weekend', days);
  }
  if (/\bnext week\b/.test(t)) {
    const mon = addDays(today, 8 - wd);
    return mk('next week', Array.from({ length: 7 }, (_, i) => addDays(mon, i)));
  }
  if (/\bthis week\b|\bthis coming week\b/.test(t)) {
    const days: string[] = [];
    for (let i = 1; i <= 7 - wd; i++) days.push(addDays(today, i));
    if (days.length === 0) return mk('this week', Array.from({ length: 7 }, (_, i) => addDays(today, i + 1)));
    return mk('this week', days);
  }
  const date = dateFromText(t, today);
  if (date) return mk(`${shortDay(date)} the ${dayOfMonth(date)}${ordSuffix(dayOfMonth(date))}`, [date]);
  if (/\bsoon\b|\bsometime\b|\bsome time\b|\bthis month\b|\bnext few days\b|\bin a few days\b|\bwhenever\b/.test(t)) {
    return mk('soon', Array.from({ length: 7 }, (_, i) => addDays(today, i + 1)));
  }
  return null;
}

function ordSuffix(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return 'th';
  return ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
}

/** "at 8", "at 7:30pm" in a trigger -> "HH:mm" (evening by default). */
export function preferredTime(text: string): string | undefined {
  const m = normText(text).match(/\bat (\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (!m) return undefined;
  const h = toHour(Number(m[1]), m[3], true);
  if (h === null) return undefined;
  return hm(h, Number(m[2] ?? 0));
}

function toHour(h: number, ampm: string | undefined, evening: boolean): number | null {
  if (h < 0 || h > 23) return null;
  if (ampm === 'pm') return h === 12 ? 12 : h + 12;
  if (ampm === 'am') return h === 12 ? 0 : h;
  if (h >= 13) return h;
  if (h === 12) return 12;
  if (evening) return h + 12;
  return h <= 6 ? h + 12 : h;
}

/** "lock it when 4 say yes" anywhere in the text. */
export function thresholdIn(text: string): number | undefined {
  const m = normText(text).match(/\block(?: it)? (?:when|once|if|at) (\d{1,2})(?: people)?(?: (?:say yes|yes|are in|can make it|say they can))?/);
  return m ? Number(m[1]) : undefined;
}

// ───────────────────────── commands ─────────────────────────

const NAME_STOP = new Set([
  'in', 'out', 'down', 'up', 'free', 'busy', 'here', 'there', 'back', 'good', 'ok', 'okay', 'fine', 'starving', 'hungry', 'so', 'not',
  'sure', 'maybe', 'late', 'early', 'going', 'coming', 'done', 'game', 'open', 'around', 'available', 'away', 'on', 'off', 'tired',
  'sick', 'the', 'a', 'an', 'also', 'too', 'with', 'for', 'at', 'from', 'vegan', 'vegetarian', 'allergic', 'broke', 'new', 'just',
  'still', 'very', 'really', 'gonna', 'going', 'confused', 'lost', 'good', 'great', 'happy', 'sorry', 'ready', 'home', 'stuck',
  'if', 'when', 'later', 'thinking', 'craving', 'easy', 'flexible', 'cool', 'all', 'any', 'either', 'either', 'excited', 'bored',
  'mon', 'monday', 'tue', 'tuesday', 'wed', 'wednesday', 'thu', 'thursday', 'fri', 'friday', 'sat', 'saturday', 'sun', 'sunday',
  'yes', 'no', 'yeah', 'nope', 'busy', 'driving', 'working', 'eating', 'cooking', 'leaving', 'heading', 'otto', 'everyone',
  'thai', 'cheap', 'fancy', 'kosher', 'halal', 'pescatarian', 'gluten', 'lactose', 'dairy', 'nut',
  'dying', 'dead', 'sleepy', 'cold', 'hot', 'sad', 'mad', 'glad', 'curious', 'wondering', 'asking', 'kidding', 'joking', 'serious',
  'outside', 'inside', 'nearby', 'close', 'far', 'travelling', 'traveling', 'abroad', 'stuffed', 'full', 'fasting', 'dieting', 'in,',
]);

const TZ_CITIES: Record<string, [string, string]> = {
  boston: ['America/New_York', 'Boston'], cambridge: ['America/New_York', 'Boston'], somerville: ['America/New_York', 'Boston'],
  'new york': ['America/New_York', 'New York'], nyc: ['America/New_York', 'New York'], brooklyn: ['America/New_York', 'New York'],
  philly: ['America/New_York', 'Philadelphia'], philadelphia: ['America/New_York', 'Philadelphia'], dc: ['America/New_York', 'DC'],
  'washington dc': ['America/New_York', 'DC'], miami: ['America/New_York', 'Miami'], atlanta: ['America/New_York', 'Atlanta'],
  chicago: ['America/Chicago', 'Chicago'], austin: ['America/Chicago', 'Austin'], dallas: ['America/Chicago', 'Dallas'],
  houston: ['America/Chicago', 'Houston'], nashville: ['America/Chicago', 'Nashville'], minneapolis: ['America/Chicago', 'Minneapolis'],
  denver: ['America/Denver', 'Denver'], 'salt lake city': ['America/Denver', 'Salt Lake City'], phoenix: ['America/Phoenix', 'Phoenix'],
  'los angeles': ['America/Los_Angeles', 'Los Angeles'], la: ['America/Los_Angeles', 'Los Angeles'], sf: ['America/Los_Angeles', 'San Francisco'],
  'san francisco': ['America/Los_Angeles', 'San Francisco'], 'bay area': ['America/Los_Angeles', 'San Francisco'],
  seattle: ['America/Los_Angeles', 'Seattle'], portland: ['America/Los_Angeles', 'Portland'], 'san diego': ['America/Los_Angeles', 'San Diego'],
  'las vegas': ['America/Los_Angeles', 'Las Vegas'], honolulu: ['Pacific/Honolulu', 'Honolulu'], hawaii: ['Pacific/Honolulu', 'Honolulu'],
  anchorage: ['America/Anchorage', 'Anchorage'],
};

/** City (as typed) -> [IANA zone, display city], for "otto we're in <city>". */
export function cityZone(place: string): [string, string] | null {
  const k = normText(place).replace(/[.!?]+$/, '').replace(/,.*$/, '').trim();
  return TZ_CITIES[k] ?? null;
}

const SLASH: Record<string, (args: string, raw: string) => Command | null> = {
  plan: (a) => ({ kind: 'plan', rest: a }),
  status: () => ({ kind: 'status' }),
  food: () => ({ kind: 'food' }),
  threshold: (a) => (/^\d+$/.test(a) ? { kind: 'threshold', n: Number(a) } : null),
  ics: () => ({ kind: 'ics' }),
  calendar: () => ({ kind: 'ics' }),
  forget: () => ({ kind: 'forget' }),
  stop: () => ({ kind: 'stop' }),
  privacy: () => ({ kind: 'privacy' }),
  dump: () => ({ kind: 'dump' }),
  help: () => ({ kind: 'help' }),
  start: () => ({ kind: 'help' }),
  why: (a) => ({ kind: 'why', ref: a || undefined }),
  tone: (a) => (/^(gentle|normal|ruthless)$/.test(a) ? { kind: 'tone', tone: a as Tone } : null),
  notice: (a) => (/^(on|off)$/.test(a) ? { kind: 'notice', on: a === 'on' } : null),
  tz: (a) => ({ kind: 'tz', place: a }),
  headcount: (a) => (/^\d+$/.test(a) ? { kind: 'headcount', n: Number(a) } : null),
  lock: (a) => ({ kind: 'lock', ref: a }),
  remind: () => ({ kind: 'remind' }),
  notes: () => ({ kind: 'notes' }),
  split: (a) => splitArgs(a),
  out: () => ({ kind: 'out' }),
  name: (_a, raw) => {
    const n = raw.trim().split(/\s+/)[0];
    return n ? { kind: 'name', name: titleCase(clean(n, 20)) } : null;
  },
};

function splitArgs(a: string): Command | null {
  const m = a.match(/^\$?(\d+(?:[.,]\d{1,2})?)(?:\s*(?:\/|by|between|among|for|across|x)?\s*(\d{1,2})(?:\s*(?:ways?|people|ppl|of us|persons))?)?\b/);
  if (!m) return null;
  const amount = Number(m[1].replace(',', '.'));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const ways = m[2] ? Number(m[2]) : undefined;
  return { kind: 'split', amount, ways: ways && ways > 0 ? ways : undefined };
}

/**
 * Parses a command from the de-addressed body (case preserved; matching is case-insensitive).
 * Returns null when the body is not a command. Whether an unaddressed command counts is decided by the caller.
 */
export function parseCommand(body: string): Command | null {
  const raw = body.trim();
  const b = normText(raw).replace(TRAIL, '').trim();
  if (!b) return null;

  const slash = b.match(/^\/([a-z]+)\s*(.*)$/);
  if (slash) {
    const f = SLASH[slash[1]];
    const rawArgs = raw.replace(/^\/[a-z]+(?:@\w+)?\s*/i, '');
    return f ? f(slash[2].trim(), rawArgs) : { kind: 'help' };
  }

  if (/^(?:please )?(?:stop|leave)(?: (?:now|please|it all|everything))?$/.test(b)) return { kind: 'stop' };
  if (/^(?:please )?forget(?: (?:it|this|that|the plan|this plan|everything|about it|it all))?$|^delete (?:the|this) plan$/.test(b)) return { kind: 'forget' };
  if (/^(?:privacy|privacy policy|what'?s your privacy policy|are you private|is this private|how do you use (?:my|our) data)\??$/.test(b)) return { kind: 'privacy' };
  if (/what do you know|what have you (?:got|stored|saved)|what do you (?:have|store|keep) (?:on|about) us|^dump$|what data do you have/.test(b)) return { kind: 'dump' };
  if (/^(?:help|what can you do|commands|\?|hi|hello|hey|yo|sup)\??$/.test(b)) return { kind: 'help' };
  if (/^(?:where are we at|where are we|where we at|status|what'?s the plan|whats the plan|what is the plan|plan status|where do we stand|what'?s happening|update me)\??$/.test(b)) return { kind: 'status' };
  const why = b.match(/^(?:why|explain|explain yourself|how did you decide|show (?:me )?the tally)(?:\s+(.+?))?\??$/);
  if (why) return { kind: 'why', ref: why[1] };
  if (/^(?:find (?:us )?(?:food|a place|a spot|somewhere to eat|a restaurant|somewhere)|food options|pick a (?:place|spot|restaurant)|where should we eat)\b/.test(b)) return { kind: 'food' };

  const thr = thresholdIn(b);
  if (thr !== undefined && /^lock/.test(b)) return { kind: 'threshold', n: thr };
  const thr2 = b.match(/^threshold (\d{1,2})$/);
  if (thr2) return { kind: 'threshold', n: Number(thr2[1]) };
  const lock = b.match(/^lock(?: it)?(?: in)?(?: (?:for|on))?(?: (.+))?$/);
  if (lock) return { kind: 'lock', ref: (lock[1] ?? '').trim() };

  if (/you can (?:call|ring|phone) me|^call me if\b|ok(?:ay)? to call me|feel free to call me/.test(b)) return { kind: 'optin', mode: 'call' };
  if (/you can (?:dm|text|message|pm) me|^(?:dm|text|message) me (?:if|when)\b|ok(?:ay)? to (?:dm|text) me|feel free to (?:dm|text) me/.test(b)) return { kind: 'optin', mode: 'dm' };

  const out = b.match(/^(?:(?:i'?m|i am|im) out\b(?!\s+(?:of|on|for)\b)|count me out\b|i'?ll sit this one out\b|(?:i'?m )?not coming\b)(.*)$/);
  if (out && dayTokens(out[1]).length === 0 && !/\b\d{1,2}\b|\b(?:tonight|tomorrow|today|weekend)\b/.test(out[1])) return { kind: 'out' };

  const name = raw.replace(/[!.]+$/, '').match(/^(?:i'?m|i am|im|call me|my name is|this is|it'?s)\s+([A-Za-z][A-Za-z'\-]{0,19})(?:\s+([A-Za-z][A-Za-z'\-]{0,19}))?$/i);
  if (name) {
    const w1 = name[1].toLowerCase();
    const w2 = name[2]?.toLowerCase();
    if (!NAME_STOP.has(w1) && (!w2 || !NAME_STOP.has(w2)) && !/^\d/.test(w1)) {
      const full = w2 && /^[A-Z]/.test(name[2]) ? `${name[1]} ${name[2]}` : name[1];
      if (!w2 || /^[A-Z]/.test(name[2])) return { kind: 'name', name: titleCase(clean(full, 30)) };
    }
  }

  const tone = b.match(/^(?:tone|be) (gentle|normal|ruthless)(?: mode)?$/);
  if (tone) return { kind: 'tone', tone: tone[1] as Tone };
  const notice = b.match(/^notice (on|off)$/);
  if (notice) return { kind: 'notice', on: notice[1] === 'on' };

  const head = b.match(/^(?:we'?re|we are|there are|there'?s|headcount) (\d{1,2})(?: (?:of us|people|ppl|total))?$/);
  if (head) return { kind: 'headcount', n: Number(head[1]) };
  const tz = raw.match(/^(?:we'?re|we are) (?:in|based in|located in) (.+?)(?: time)?[.!]*$/i) ?? raw.match(/^(?:time ?zone|tz)[:\s]+(.+)$/i);
  if (tz && !/^(?:for|on|at)\b/i.test(tz[1])) return { kind: 'tz', place: tz[1].trim() };

  const place =
    raw.match(/^(?:we'?re|we are) (?:going|heading|meeting|eating) (?:to|at) (.+)$/i) ??
    raw.match(/^(?:the )?place(?: is|:|=)\s*(.+)$/i) ??
    raw.match(/^(?:let'?s )?meet at (.+)$/i) ??
    raw.match(/^(?:we'?re )?(?:going|eating) at (.+)$/i);
  if (place && !/^(?:be|have|need|get|go|try|do|make|see|eat|grab|figure)\b/i.test(place[1])) {
    const p = clean(place[1], 80);
    if (p) return { kind: 'place_set', place: p };
  }
  if (/^(?:no place needed|no place|we don'?t need a place|don'?t need a place|we'?ll figure (?:it|that) out|place doesn'?t matter|skip the place|no need for a place)\b/.test(b)) return { kind: 'no_place' };
  if (/^(?:change|switch) (?:the )?(?:place|spot|restaurant)|^(?:let'?s go )?somewhere else$|^different (?:place|spot)$|^new (?:place|spot)$/.test(b)) return { kind: 'change_place' };
  if (/^remind (?:me|us)(?: 30 (?:min|mins|minutes) before)?$/.test(b)) return { kind: 'remind' };

  const noteSet = raw.replace(/[.!]+$/, '').match(/^(?:note|remember)(?: that)?:?\s+(.+?)\s*(?::|=|\s-\s|\s+is\s+|\s+are\s+)\s*(.+)$/i);
  if (noteSet) {
    const key = clean(noteSet[1].toLowerCase().replace(/^the\s+/, ''), 30);
    const value = clean(noteSet[2], 200);
    if (key && value) return { kind: 'note_set', key, value };
  }
  if (/^(?:notes|what are the notes|show (?:me )?(?:the )?notes)\??$/.test(b)) return { kind: 'notes' };
  const noteGet =
    b.match(/^what (?:did|do) we (?:decide|say|agree|have|pick)(?: (?:about|on|for|re))? (.+?)\??$/) ??
    b.match(/^what about (?:the )?(.+?)\??$/) ??
    b.match(/^(?:what'?s|what is|what was) the (.+?)(?: note| situation)?\??$/);
  if (noteGet) return { kind: 'note_get', key: clean(noteGet[1].replace(/^the\s+/, ''), 30) };

  if (/add (?:it |this |that )?to (?:my |our |the |your )?calendar|^calendar$|^(?:calendar )?invite$|^ics$|send (?:me |us )?(?:an? )?(?:calendar )?invite/.test(b)) return { kind: 'ics' };
  const split = b.match(/^split(?: the bill| it| the check)?\s+(.+)$/);
  if (split) {
    const c = splitArgs(split[1]);
    if (c) return c;
  }
  if (/^(?:just pick|you pick|pick for us|you choose|whatever you think|surprise us|dealer'?s choice|your call|you decide|pick one)\b|^go\b(?!\s+(?:to|with|at|for|ahead and|back)\b)/.test(b)) return { kind: 'go' };
  if (/^(?:yes|yeah|yep|yup|sure|ok|okay|do it|let'?s do it|sounds good|go for it|y|👍|yes please|please do)$/.test(b)) return { kind: 'yes' };
  if (/^(?:no|nope|nah|no thanks|keep it|leave it|no thank you)$/.test(b)) return { kind: 'no' };
  return null;
}

/** Trailing emoji, punctuation and skin tones (keeps "?" because it carries meaning). */
export const TRAIL = /[\s!.,\p{Extended_Pictographic}\u200d\u{1F3FB}-\u{1F3FF}\uFE0F]+$/u;

/** Commands that also count when nobody addressed Otto. */
export const UNADDRESSED_COMMANDS = new Set<Command['kind']>(['out']);

// ───────────────────────── reply grammar (DATE_FINDING §3) ─────────────────────────

const NOT_SURE = /\bnot sure\b|\bunsure\b|\bnot certain\b|\bidk\b/;
const NO_RE = /\b(not|can'?t|cannot|cant|no|busy|out|bad|won'?t|wont|doesn'?t|don'?t|dont|doesnt|nope|unavailable|nah|never|booked|except)\b|👎|❌/;
const MAYBE_RE = /\b(maybe|prob|probs|probably|might|should be|possibly|tentative|tentatively|if|perhaps|could|likely)\b|❓|🤔/;
const YES_RE = /\b(works?|good|down|in|free|can do|can make|yes|yeah|yep|yup|ya|perfect|fine|available|totally|definitely)\b|✅|👍|❤|🙌|💯|♥/;

const BARE_YES =
  /^(?:i'?m in|im in|i'?m down|im down|down|count me in|in|i'?m free|im free|works for me|sounds good|yes|yeah|yep|yup|sure|ok|okay|i can make it|i can come|i'?ll be there|i'?m there|👍|✅|❤|♥)(?: lol| too| as well)?[!.\s]*$/;
const BARE_ATTEND = /^(?:i'?m in|im in|i'?m down|im down|down|count me in|i'?m free|im free|i can make it|i'?ll be there|i'?m there)(?: lol| too)?[!.\s]*$/;
const NONE_RE =
  /^(?:none|neither|nothing works|none work|none works|none for me|none of (?:these|them|those|the (?:dates|times|options))(?: work| works)?(?: for me)?|(?:i )?can'?t do any(?: of (?:these|them|those))?|i can'?t make any(?: of (?:these|them|those))?|no dates work)[!.\s]*$/;
const ALL_RE =
  /^(?:either|any|all|both|whatever|anything|everything|all good|any works|either works|all work|all of them|any of them|any of those|all three|any day|any day works|all are good|any is fine|either is fine|both work|both are good|anything works|any time|anytime|all work for me|whichever)(?: (?:works|is fine|is good|for me|works for me|lol))?[!.\s]*$/;
const EXCLUDE_RE = /\b(?:anything|all|any|everything|either|any day|any of them|all of them)\s+(?:works\s+)?(?:but|except|other than|besides|apart from)\s+(.+)$/;
const QUANT_ALL_WORD = /\b(either|both|any|all|anything|everything|whatever|whichever)\b/;

interface Refs {
  days: Set<string>;
  ids: Set<number>;
  any: boolean;
}

interface TimeWin {
  notBefore?: string;
  notAfter?: string;
  slot?: string;
  /** Explicit constraints ("after 8:30", "late") count as a polarity cue; "night", "brunch" alone do not. */
  cue?: boolean;
}

function timeWindow(c: string, evening: boolean): TimeWin | null {
  let m = c.match(/\bafter (\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (m) {
    const h = toHour(Number(m[1]), m[3], evening);
    if (h !== null) {
      const t = hm(h, Number(m[2] ?? 0));
      return { notBefore: t, slot: t, cue: true };
    }
  }
  m = c.match(/\b(?:before|until|till|til|by) (\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (m) {
    const h = toHour(Number(m[1]), m[3], evening);
    if (h !== null) return { notAfter: hm(h, Number(m[2] ?? 0)), cue: true };
  }
  if (/\bafter work\b/.test(c)) return { notBefore: '18:00', slot: '18:30', cue: true };
  if (/\blate\b|\blate night\b/.test(c)) return { notBefore: '20:30', slot: '21:00', cue: true };
  if (/\bearly\b/.test(c)) return { notAfter: '18:30', slot: '17:30', cue: true };
  if (/\bbrunch\b/.test(c)) return { notBefore: '10:00', notAfter: '13:00', slot: '11:00' };
  if (/\blunch\b/.test(c)) return { notBefore: '11:30', notAfter: '14:00', slot: '12:30' };
  if (/\bbreakfast\b|\bmorning\b/.test(c)) return { notAfter: '12:00', slot: '10:00' };
  if (/\bafternoon\b/.test(c)) return { notBefore: '12:00', notAfter: '17:00', slot: '15:00' };
  if (/\bevening\b|\bnight\b/.test(c)) return { notBefore: '17:00' };
  return null;
}

function invert(w: TimeWin): TimeWin {
  // "except after 9" -> not after 9; "except early" -> not before 18:30.
  return { notBefore: w.notAfter, notAfter: w.notBefore, cue: w.cue };
}

const NUM_BLOCK_AFTER = /^\s*(?::|am\b|pm\b|ish\b|o'?clock|people|ppl|ways|of us|min|mins|minutes|hours|hrs|bucks|dollars|%|st\b|nd\b|rd\b|th\b|\.\d|h\b|k\b)|^\s*[-.]?\s*\d{3}/;
const NUM_BLOCK_BEFORE = /\b(after|before|at|by|until|till|til|around|past|split|under|over|about)\s+$|[$~:.+\-]$|\d{3}[\s.\-]*$/;
const ORDINALS: Record<string, number> = { first: 1, '1st': 1, second: 2, '2nd': 2, third: 3, '3rd': 3, fourth: 4, fifth: 5 };

function findRefs(c: string, options: Option[], today: string): Refs {
  const refs: Refs = { days: new Set(), ids: new Set(), any: false };
  const byPos = [...options].sort((a, b) => a.id - b.id);
  const ids = new Set(options.map((o) => o.id));
  const addDayWhere = (pred: (o: Option) => boolean) => {
    for (const o of options) if (pred(o)) refs.days.add(o.day);
  };

  for (const d of dayTokens(c)) addDayWhere((o) => weekdayOf(o.day) === d.wd);
  if (/\btonight\b|\btoday\b/.test(c)) addDayWhere((o) => o.day === today);
  if (/\btomorrow\b|\btmrw?\b|\btmr\b/.test(c)) addDayWhere((o) => o.day === addDays(today, 1));
  if (/\bweekends?\b/.test(c)) addDayWhere((o) => weekdayOf(o.day) >= 6);
  if (/\bweekdays?\b|\bweeknights?\b/.test(c)) addDayWhere((o) => weekdayOf(o.day) <= 5);

  for (const m of c.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/g)) {
    addDayWhere((o) => monthOf(o.day) === MONTHS[m[1]] && dayOfMonth(o.day) === Number(m[2]));
  }
  for (const m of c.matchAll(/\b(\d{1,2})\/(\d{1,2})\b/g)) {
    addDayWhere((o) => monthOf(o.day) === Number(m[1]) && dayOfMonth(o.day) === Number(m[2]));
  }
  for (const m of c.matchAll(/\b(?:the )?(\d{1,2})(st|nd|rd|th)\b/g)) {
    const n = Number(m[1]);
    if (n > 3) addDayWhere((o) => dayOfMonth(o.day) === n);
  }
  for (const m of c.matchAll(/(?:#|\boption\s*|\bopt\s*|\bnumber\s*|\bno\.?\s*)(\d{1,2})\b/g)) {
    const n = Number(m[1]);
    if (ids.has(n)) refs.ids.add(n);
  }
  for (const m of c.matchAll(/\b(\d{1,2})\b/g)) {
    const i = m.index ?? 0;
    const before = c.slice(Math.max(0, i - 8), i);
    const after = c.slice(i + m[0].length, i + m[0].length + 9);
    if (NUM_BLOCK_AFTER.test(after) || NUM_BLOCK_BEFORE.test(before) || /\/\s*$/.test(before) || /^\s*\//.test(after)) continue;
    if (/#\s*$|option\s*$|opt\s*$|number\s*$/.test(before)) continue;
    // Bare number (coordinator rule): a shown option number, else an index when <= the option count,
    // else a date only if it equals an option's day of month.
    const n = Number(m[1]);
    if (ids.has(n)) refs.ids.add(n);
    else if (n >= 1 && n <= byPos.length) refs.ids.add(byPos[n - 1].id);
    else addDayWhere((o) => dayOfMonth(o.day) === n);
  }
  // Ordinals: "the first", "2nd", "last one". Digit ordinals > 3 ("the 23rd", "4th") are dates (handled above).
  for (const m of c.matchAll(/\b(first|1st|second|2nd|third|3rd|fourth|fifth|last)\b/g)) {
    const pos = m[1] === 'last' ? byPos.length : ORDINALS[m[1]];
    const o = byPos[pos - 1];
    if (o) refs.ids.add(o.id);
  }
  if (QUANT_ALL_WORD.test(c) && refs.days.size === 0 && refs.ids.size === 0) refs.any = true;
  return refs;
}

const CONNECTORS =
  /\b(or|and|either|both|the|one|ones|option|options|opt|number|for me|pls|please|plz|works?|good|down|in|free|yes|yeah|yep|maybe|prob|probably|not|no|can'?t|cant|either one|day|days|night|evening|is|are|fine|ok|okay|i|i'?m|im|me|for|on|too)\b|[#,;.!?&+\/\-:()]|✅|👍|❤|♥|🙌|💯|👎|❓/g;

function onlyRefs(t: string): boolean {
  let s = t.replace(DAY_RE, ' ');
  s = s.replace(/\b(tonight|today|tomorrow|tmrw?|tmr|weekends?|weekdays?|weeknights?|first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|last|\d{1,2}(?:st|nd|rd|th)?)\b/g, ' ');
  s = s.replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/g, ' ');
  s = s.replace(CONNECTORS, ' ').replace(/\p{Extended_Pictographic}|\u200d|[\u{1F3FB}-\u{1F3FF}]/gu, ' ');
  return s.trim().length === 0;
}

function polarity(c: string): Vote | null {
  if (NOT_SURE.test(c)) return 'maybe';
  if (NO_RE.test(c)) return 'no';
  if (MAYBE_RE.test(c)) return 'maybe';
  if (YES_RE.test(c)) return 'yes';
  return null;
}

function splitClauses(t: string): Array<{ text: string; delim: string }> {
  const out: Array<{ text: string; delim: string }> = [];
  const re = /\s*(\bbut not\b|\bbut\b|\bexcept\b|\bthough\b|\bhowever\b|[,;.!]|\band\b(?=\s+(?:not|no|can'?t|cannot|won'?t|doesn'?t|isn'?t)\b))\s*/g;
  let last = 0;
  let delim = 'start';
  for (const m of t.matchAll(re)) {
    const i = m.index ?? 0;
    const text = t.slice(last, i).trim();
    if (text) out.push({ text, delim });
    const d = m[1];
    delim = d === 'but not' || d === 'except' ? 'except' : d === 'but' || d === 'though' || d === 'however' ? 'but' : d === 'and' ? 'and' : 'comma';
    last = i + m[0].length;
  }
  const rest = t.slice(last).trim();
  if (rest) out.push({ text: rest, delim });
  return out;
}

export interface ParseAvailabilityOpts {
  now?: number;
  /** Inline reply to this option bubble: references default to it. */
  replyOptionId?: number;
  /** Addressed / reply-to-Otto: bare "yes" counts too (low confidence). */
  addressed?: boolean;
}

/**
 * Reads an availability answer against the posted options. Day references become day-level prefs (they also
 * apply to options added later on that day); numbers and ordinals become explicit option votes.
 */
export function parseAvailability(text: string, options: Option[], tz: string, opts: ParseAvailabilityOpts = {}): ParsedAvailability {
  const res: ParsedAvailability = { dayPrefs: {}, optionVotes: {}, lowConfidence: false, matched: false, voteLike: false, slots: [] };
  const active = options.filter((o) => !o.removed);
  if (active.length === 0) return res;
  const now = opts.now ?? active[0].startsAt;
  const today = isoDay(now, tz);
  const evening = active.some((o) => Number(o.time.slice(0, 2)) >= 16);
  let t = normText(stripAddress(text)).replace(/(\d)\.(\d{2})\b/g, '$1:$2').replace(/(\w)\/(?=[a-z])/g, '$1 ');
  t = t.replace(/\b(fri|sat|sun|mon|tue|wed|thu|thurs|tues|weds)(?:day)?'s\b/g, '$1').replace(/\b(tonight|today|tomorrow)'s\b/g, '$1');
  if (!t) return res;
  /** Whole-message forms ("either", "down", "none") are matched without trailing emoji/punctuation. */
  const core = t.replace(TRAIL, '');

  const setAll = (vote: Vote) => {
    res.all = vote;
    for (const o of active) res.dayPrefs[o.day] = { vote };
    res.matched = true;
    res.voteLike = true;
  };

  // Inline reply to an option bubble: yes for it unless the text says otherwise.
  if (opts.replyOptionId !== undefined && active.some((o) => o.id === opts.replyOptionId)) {
    const refs = findRefs(t, active, today);
    if (refs.days.size === 0 && refs.ids.size === 0) {
      const pol = NONE_RE.test(core) ? 'no' : polarity(t) ?? 'yes';
      res.optionVotes[opts.replyOptionId] = pol;
      res.matched = true;
      res.voteLike = true;
      return res;
    }
  }

  if (NONE_RE.test(core) || parseCommand(core)?.kind === 'out') {
    setAll('no');
    return res;
  }
  if (BARE_YES.test(core) || BARE_YES.test(t)) {
    const attend = BARE_ATTEND.test(core);
    if (opts.addressed || opts.replyOptionId !== undefined || attend) {
      setAll('yes');
      res.lowConfidence = true;
      res.voteLike = attend || !!opts.addressed;
    }
    return res;
  }
  if (ALL_RE.test(core)) {
    setAll('yes');
    return res;
  }
  const ex = core.match(EXCLUDE_RE);
  if (ex) {
    const refs = findRefs(ex[1], active, today);
    if (refs.days.size || refs.ids.size) {
      setAll('yes');
      for (const d of refs.days) res.dayPrefs[d] = { vote: 'no' };
      for (const id of refs.ids) res.optionVotes[id] = 'no';
      return res;
    }
  }

  let anyRef = false;
  let anyCue = false;
  let prevDays: string[] = [];
  let prevVote: Vote | null = null;
  let prevAny = false;
  for (const { text: c, delim } of splitClauses(t)) {
    const refs = findRefs(c, active, today);
    let tw = timeWindow(c, evening);
    let pol = polarity(c);
    if (!pol && /\?\s*$/.test(c) && (refs.days.size || refs.ids.size)) pol = 'maybe';
    if (pol || tw?.cue) anyCue = true;
    const hasRefs = refs.days.size > 0 || refs.ids.size > 0;
    if (!hasRefs) {
      if (refs.any && pol) {
        // "either works" inside a longer message
        for (const o of active) res.dayPrefs[o.day] = { vote: pol };
        res.all = pol;
        anyRef = true;
        prevDays = active.map((o) => o.day);
        prevVote = pol;
        prevAny = true;
        continue;
      }
      if (tw && prevDays.length) {
        if (delim === 'except' || pol === 'no') tw = invert(tw);
        const vote: Vote = prevVote === 'no' ? 'yes' : prevVote ?? 'yes';
        for (const d of prevDays) applyDay(res, d, vote, tw);
      }
      continue;
    }
    anyRef = true;
    if (!pol && delim === 'except') pol = 'no';
    if (!pol && delim === 'but' && prevAny) pol = 'no';
    const vote: Vote = pol ?? 'yes';
    const days = new Set(refs.days);
    for (const id of refs.ids) {
      if (tw && vote !== 'no') {
        const o = active.find((x) => x.id === id);
        if (o) days.add(o.day);
      } else {
        res.optionVotes[id] = vote;
      }
    }
    for (const d of days) applyDay(res, d, vote, vote === 'no' ? null : tw);
    prevDays = [...days];
    prevVote = vote;
    prevAny = false;
  }

  res.matched = Object.keys(res.dayPrefs).length > 0 || Object.keys(res.optionVotes).length > 0;
  res.voteLike = res.matched && ((anyRef && anyCue) || onlyRefs(t));
  return res;

  function applyDay(r: ParsedAvailability, day: string, vote: Vote, tw: TimeWin | null) {
    const pref: DayPref = { vote };
    if (tw?.notBefore) pref.notBefore = tw.notBefore;
    if (tw?.notAfter) pref.notAfter = tw.notAfter;
    r.dayPrefs[day] = pref;
    if (tw?.slot && vote !== 'no') r.slots.push({ day, time: tw.slot, vote });
  }
}

/** Option references only (for "otto lock fri", "otto why sat", stranded "sat"). */
export function optionRefs(text: string, options: Option[], tz: string, now: number): number[] {
  const active = options.filter((o) => !o.removed);
  const t = normText(text);
  const refs = findRefs(t, active, isoDay(now, tz));
  const out = new Set<number>(refs.ids);
  for (const o of active) if (refs.days.has(o.day)) out.add(o.id);
  return [...out].sort((a, b) => a - b);
}

// ───────────────────────── other phrase classes ─────────────────────────

/** Tapback / reaction -> vote. ❤️ 👍 ‼️ yes, 👎 no, ❓ maybe, 😂 and everything else ignored. */
export function emojiVote(emoji: string): Vote | null {
  const e = emoji.replace(/️/g, '').replace(/[\u{1F3FB}-\u{1F3FF}]/gu, '').trim().toLowerCase();
  if (['❤', '♥', '👍', '‼', '😍', '🔥', '✅', '💯', '🙌', 'love', 'loved', 'like', 'liked', 'heart', 'emphasize', 'emphasized', 'thumbsup', 'thumbs_up', '+1', '!!'].includes(e)) return 'yes';
  if (['👎', 'dislike', 'disliked', 'thumbsdown', 'thumbs_down', '-1', '❌'].includes(e)) return 'no';
  if (['❓', '?', 'question', 'questioned', '🤔'].includes(e)) return 'maybe';
  return null;
}

export function isBareYes(text: string): boolean {
  return /^(?:yes|yeah|yep|yup|sure|ok|okay|do it|let'?s do it|sounds good|go for it|works|that works|👍|✅|y|yes please|perfect|great)[!.\s]*$/.test(normText(stripAddress(text)));
}

export function isBareNo(text: string): boolean {
  return /^(?:no|nope|nah|no thanks|keep it|leave it|doesn'?t work|that doesn'?t work)[!.\s]*$/.test(normText(stripAddress(text)));
}

/** "can't do friday anymore" against the chosen option (veto & swap). */
export function isVeto(text: string, chosen: Option, activity: string, tz: string, now: number, addressed: boolean): boolean {
  const t = normText(stripAddress(text));
  const neg = /\b(can'?t|cannot|cant|can no longer|won'?t be able|no longer|not able|unable|doesn'?t work|don'?t think i can|have to bail|gotta bail|need to bail|bail)\b/.test(t);
  if (!neg) return false;
  const temporal = /\b(anymore|any more|after all|now|no longer|something came up|unfortunately|sadly)\b/.test(t);
  if (!temporal && !addressed) return false;
  const wd = weekdayOf(chosen.day);
  const dayRef = dayTokens(t).some((d) => d.wd === wd);
  const rel = (/\btomorrow\b/.test(t) && chosen.day === addDays(isoDay(now, tz), 1)) || (/\btonight\b|\btoday\b/.test(t) && chosen.day === isoDay(now, tz));
  const it = /\b(it|that|this|that day|the plan)\b/.test(t) || new RegExp(`\\b${activity.split(' ')[0]}\\b`).test(t);
  return dayRef || rel || it;
}

/** Notice mode: "we should hang out" style messages. */
export function isHangoutPhrase(text: string): boolean {
  const t = normText(text);
  return (
    /\bwe (?:should|need to|gotta|have to|must|oughta) (?:hang|hang out|get together|meet up|catch up|grab (?:dinner|drinks|food|lunch|coffee|brunch)|get (?:dinner|drinks|food|lunch|coffee|brunch)|do something|do dinner|do this again|go out)\b/.test(t) ||
    /\blet'?s (?:hang|hang out|get together|meet up|catch up)(?: soon| sometime)\b/.test(t) ||
    /\bwe never hang\b|\bmiss (?:you|y'?all|you all) guys\b|\blong time no see\b/.test(t)
  );
}

/** Short day list for nudges: "Thu, Fri or Sat" (adds the time when a weekday repeats). */
export function optionDays(options: Option[]): string {
  const active = options.filter((o) => !o.removed);
  const counts = new Map<string, number>();
  for (const o of active) counts.set(shortDay(o.day), (counts.get(shortDay(o.day)) ?? 0) + 1);
  return listJoin(
    active.map((o) => {
      const d = shortDay(o.day);
      return (counts.get(d) ?? 0) > 1 ? `${d} ${fmtShortTime(o.time)}` : d;
    }),
    'or',
  );
}

function fmtShortTime(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const suffix = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, '0')}${suffix}` : `${h12}${suffix}`;
}
