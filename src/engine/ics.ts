// Calendar handoff (DATE_FINDING.md §7): an RFC 5545 VEVENT with no attendees and no organizer, or a plain
// text block where the channel can't send files. Otto never reads a calendar.

import type { Plan } from './types.js';
import { MIN, capitalize, cardWhen, fmtTimeMs, local } from './util.js';

const DURATION_MIN: Record<string, number> = {
  dinner: 120, drinks: 120, lunch: 60, brunch: 90, breakfast: 60, coffee: 60, movie: 150, 'game night': 180, hike: 180, picnic: 150, park: 150,
};

export function durationMs(activity: string): number {
  return (DURATION_MIN[activity] ?? 120) * MIN;
}

function utcStamp(ms: number): string {
  return local(ms, 'UTC').toFormat("yyyyMMdd'T'HHmmss'Z'");
}

function localStamp(ms: number, tz: string): string {
  return local(ms, tz).toFormat("yyyyMMdd'T'HHmmss");
}

/** RFC 5545 §3.3.11 TEXT escaping. */
export function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function utf8Len(ch: string): number {
  const cp = ch.codePointAt(0) ?? 0;
  return cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
}

/** RFC 5545 §3.1 folding: lines longer than 75 octets continue on the next line after CRLF + space. */
export function fold(line: string): string {
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const b = utf8Len(ch);
    if (bytes + b > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

export function summaryOf(plan: Plan): string {
  return plan.place ? `${capitalize(plan.activity)} · ${plan.place.name}` : capitalize(plan.activity);
}

/**
 * The plan as an .ics file. Times are UTC by default (no VTIMEZONE needed); pass `tz` to write
 * DTSTART;TZID=... local times instead. Returns '' when the plan has no time yet.
 */
export function ics(plan: Plan, opts: { tz?: string } = {}): string {
  if (plan.eventAt === undefined) return '';
  const start = plan.eventAt;
  const end = start + durationMs(plan.activity);
  const dt = (name: string, ms: number) => (opts.tz ? `${name};TZID=${opts.tz}:${localStamp(ms, opts.tz)}` : `${name}:${utcStamp(ms)}`);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Otto//Group plan//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${plan.id}@otto.plan`,
    `DTSTAMP:${utcStamp(plan.updatedAt)}`,
    dt('DTSTART', start),
    dt('DTEND', end),
    `SUMMARY:${icsEscape(summaryOf(plan))}`,
  ];
  const loc = plan.place?.address ?? plan.place?.name;
  if (loc) lines.push(`LOCATION:${icsEscape(loc)}`);
  if (plan.place?.mapsUrl) lines.push(`URL:${plan.place.mapsUrl}`);
  lines.push(`DESCRIPTION:${icsEscape(`Planned in your group chat with Otto.${plan.place?.mapsUrl ? ` Map: ${plan.place.mapsUrl}` : ''}`)}`);
  lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT1H', `DESCRIPTION:${icsEscape(summaryOf(plan))}`, 'END:VALARM');
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

/** Copyable text block for channels without files. */
export function icsText(plan: Plan, tz: string): string {
  if (plan.eventAt === undefined) return '';
  const end = plan.eventAt + durationMs(plan.activity);
  const lines = [summaryOf(plan), `${cardWhen(plan.eventAt, tz)} to ${fmtTimeMs(end, tz)} (${tz})`];
  if (plan.place?.address) lines.push(plan.place.address);
  if (plan.place?.mapsUrl) lines.push(plan.place.mapsUrl);
  return lines.join('\n');
}

export const ICS_MIME = 'text/calendar';
