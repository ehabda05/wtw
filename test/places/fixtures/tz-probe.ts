// Child-process probe for hours.test.ts: evaluates opening hours at fixed New York times and
// prints JSON. Run under different TZ values to prove the result is server-TZ independent.
import opening_hours from 'opening_hours';
import { DateTime } from 'luxon';
import { openAt, wallClockDate } from '../../../src/places/hours.js';

const ny = (iso: string) => DateTime.fromISO(iso, { zone: 'America/New_York' }).toMillis();
const HOURS = 'Mo-Fr 11:00-14:00; Sa 18:00-23:00';
const times = ['2026-10-16T12:00', '2026-10-16T20:00', '2026-10-17T12:00', '2026-10-17T19:00', '2026-11-26T12:00'];

const correct = times.map((t) => openAt(HOURS, ny(t)));
const naive = times.map((t) => new opening_hours(HOURS, null).getState(new Date(ny(t))));
const wall = wallClockDate(ny('2026-10-16T19:05'));

process.stdout.write(
  JSON.stringify({ tz: process.env.TZ ?? null, correct, naive, wall: [wall.getDay(), wall.getHours(), wall.getMinutes()] }),
);
