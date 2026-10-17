// Small pure helpers: calendar math in the group time zone (luxon), labels, text normalization.
// Never reads the clock: every function takes the instant it reasons about.

import { DateTime } from 'luxon';

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;
export const DEFAULT_TZ = 'America/New_York';

const WD = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WD_LONG = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MON = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function local(ms: number, tz: string): DateTime {
  return DateTime.fromMillis(ms, { zone: tz });
}

/** "America/Chicago" style IANA zone that luxon understands (no clock read). */
export function isValidZone(zone: string): boolean {
  return /^[A-Za-z_]+\/[A-Za-z_/+-]+$/.test(zone) && DateTime.fromMillis(0, { zone }).isValid;
}

/** ISO date ("2026-10-23") of an instant in the group tz. */
export function isoDay(ms: number, tz: string): string {
  return local(ms, tz).toISODate() as string;
}

/** Epoch ms of a local wall-clock time ("2026-10-23", "19:00") in the group tz. */
export function atLocal(day: string, time: string, tz: string): number {
  return DateTime.fromISO(`${day}T${time}`, { zone: tz }).toMillis();
}

/** ISO weekday (1 = Mon ... 7 = Sun) of an ISO date. */
export function weekdayOf(day: string): number {
  return DateTime.fromISO(day, { zone: 'UTC' }).weekday;
}

export function addDays(day: string, n: number): string {
  return DateTime.fromISO(day, { zone: 'UTC' }).plus({ days: n }).toISODate() as string;
}

export function dayOfMonth(day: string): number {
  return DateTime.fromISO(day, { zone: 'UTC' }).day;
}

export function monthOf(day: string): number {
  return DateTime.fromISO(day, { zone: 'UTC' }).month;
}

export function shortDay(day: string): string {
  return WD[weekdayOf(day)];
}

export function longDay(day: string): string {
  return WD_LONG[weekdayOf(day)];
}

export function hm(h: number, m = 0): string {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function parseHm(time: string): { h: number; m: number } {
  const [h, m] = time.split(':').map((x) => Number(x));
  return { h, m };
}

export function minutesOf(time: string): number {
  const { h, m } = parseHm(time);
  return h * 60 + m;
}

/** "19:00" -> "7pm", "20:30" -> "8:30pm", "12:00" -> "12pm", "11:00" -> "11am". */
export function fmtTime(time: string): string {
  const { h, m } = parseHm(time);
  const suffix = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, '0')}${suffix}`;
}

export function timeOfMs(ms: number, tz: string): string {
  const d = local(ms, tz);
  return hm(d.hour, d.minute);
}

export function fmtTimeMs(ms: number, tz: string): string {
  return fmtTime(timeOfMs(ms, tz));
}

/** "Thu Oct 22" */
export function dayLabel(day: string): string {
  return `${shortDay(day)} ${MON[monthOf(day)]} ${dayOfMonth(day)}`;
}

/** Option label: "Thu Oct 22 · 7pm" */
export function optionLabel(day: string, time: string): string {
  return `${dayLabel(day)} · ${fmtTime(time)}`;
}

/** Card label: "Fri Oct 23, 7pm" */
export function cardWhen(ms: number, tz: string): string {
  return `${dayLabel(isoDay(ms, tz))}, ${fmtTimeMs(ms, tz)}`;
}

/** Relative label for a future instant: "tonight 9:30pm", "today 3pm", "tomorrow 10am", "Sun 10am", "Sun Oct 25 10am". */
export function relLabel(ms: number, now: number, tz: string): string {
  const d = isoDay(ms, tz);
  const today = isoDay(now, tz);
  const t = fmtTimeMs(ms, tz);
  if (d === today) return local(ms, tz).hour >= 17 ? `tonight ${t}` : `today ${t}`;
  if (d === addDays(today, 1)) return `tomorrow ${t}`;
  const diff = Math.round((DateTime.fromISO(d, { zone: 'UTC' }).toMillis() - DateTime.fromISO(today, { zone: 'UTC' }).toMillis()) / DAY);
  if (diff > 0 && diff < 7) return `${shortDay(d)} ${t}`;
  return `${dayLabel(d)} ${t}`;
}

/** Relative day word for reminders: "Tonight", "Today", "Tomorrow", "Fri". */
export function relDayWord(ms: number, now: number, tz: string): string {
  const d = isoDay(ms, tz);
  const today = isoDay(now, tz);
  if (d === today) return local(ms, tz).hour >= 17 ? 'Tonight' : 'Today';
  if (d === addDays(today, 1)) return 'Tomorrow';
  return shortDay(d);
}

// ───────────────────────── quiet hours ─────────────────────────

export function isQuiet(ms: number, tz: string, qh: [number, number]): boolean {
  const [start, end] = qh;
  const h = local(ms, tz).hour;
  return start > end ? h >= start || h < end : h >= start && h < end;
}

/** The first instant at or after `ms` that is outside quiet hours (the next `end`:00 local). */
export function quietEnd(ms: number, tz: string, qh: [number, number]): number {
  if (!isQuiet(ms, tz, qh)) return ms;
  const [start, end] = qh;
  let d = local(ms, tz);
  if (start > end && d.hour >= start) d = d.plus({ days: 1 });
  return d.set({ hour: end, minute: 0, second: 0, millisecond: 0 }).toMillis();
}

/** The local `time` on the evening that starts the quiet stretch containing `ms` (for "10:30pm" fallbacks). */
export function eveningBefore(ms: number, tz: string, qh: [number, number], time: string): number {
  const [start] = qh;
  let d = local(ms, tz);
  if (d.hour < start) d = d.minus({ days: 1 });
  const { h, m } = parseHm(time);
  return d.set({ hour: h, minute: m, second: 0, millisecond: 0 }).toMillis();
}

export function roundUp(ms: number, step: number): number {
  return Math.ceil(ms / step) * step;
}

// ───────────────────────── text ─────────────────────────

/** Lowercase, straight quotes, single spaces. Used for matching only; never stored. */
export function normText(s: string): string {
  return s
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/️/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => capitalize(w))
    .join(' ');
}

/** "a", "a and b", "a, b and c" */
export function listJoin(items: string[], conj = 'and'): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} ${conj} ${items[items.length - 1]}`;
}

/**
 * Sanitizes a member-provided string (name, note, place) before it is rendered or stored as plan data:
 * single spaces, no sentence breaks inside (so the two-sentence rule holds), bounded length.
 */
export function clean(s: string, max = 80): string {
  let t = s.replace(/\s+/g, ' ').trim();
  t = t.replace(/[.!?]+(?=\s)/g, ',').replace(/[.!?]+$/g, '');
  t = t.replace(/^["'\s]+|["'\s]+$/g, '');
  if (t.length > max) t = t.slice(0, max).trim();
  return t;
}

export function numberWord(n: number, capital = false): string {
  const w = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][n] ?? String(n);
  return capital ? capitalize(w) : w;
}

export function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

export function money(n: number): string {
  return `$${n.toFixed(2)}`;
}
