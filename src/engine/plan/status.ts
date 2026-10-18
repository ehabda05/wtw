// Read-only command answers: the one-message plan card, `homi why`, bill split, calendar handoff, notes.

import { TEMPLATES as T } from '../templates.js';
import {
  activeMembers, activeOptions, chooseOption, counts, groupSize, isTimeMaybe, optionShortNames, tallyLine, whyTally,
} from '../schedule.js';
import { whoLabel } from '../nudge.js';
import { ICS_MIME, ics, icsText } from '../ics.js';
import { cardWhen, fmtTime, listJoin, money, relLabel, shortDay } from '../util.js';
import { type Step, P, planOf, say, tzOf } from './core.js';
import { lockWhen } from './availability.js';

function chosenCounts(st: Step): { yes: number; maybe: number } {
  const p = P(st);
  const o = p.options.find((x) => x.id === p.chosenOptionId);
  if (o) return counts(p, o);
  return { yes: Object.values(p.members).filter((m) => m.status !== 'out').length, maybe: 0 };
}

/** `homi where are we at`: date, place, who's in, who's pending, in one message. */
export function statusText(st: Step): string {
  const p = planOf(st);
  if (!p) return T.statusNone();
  const now = st.ctx.now;
  const tz = tzOf(st);
  const when = p.eventAt !== undefined ? cardWhen(p.eventAt, tz) : '';
  switch (p.state) {
    case 'collecting_dates':
      return T.statusDates({ activity: p.activity });
    case 'collecting_availability': {
      const ch = chooseOption(p);
      const top = ch?.ranked.find((r) => r.id === ch.optionId);
      const names = optionShortNames(p);
      const tied = top ? ch!.ranked.filter((r) => r.yes === top.yes) : [];
      const lead = !top || top.yes === 0 ? 'no picks yet'
        : tied.length > 1 ? `${listJoin(tied.map((r) => names[r.id]))} are tied at ${top.yes} yes`
        : `${names[top.id]} leads with ${top.yes} yes`;
      const pend = Object.values(p.members).filter((m) => m.status === 'pending');
      const unknown = Math.max(0, groupSize(p) - activeMembers(p).length);
      const who = pend.length || unknown ? whoLabel(pend, unknown) : undefined;
      return T.statusAvail({ activity: p.activity, window: p.windowLabel ?? 'soon', lead, tally: tallyLine(p), who, deadline: lockWhen(st) });
    }
    case 'collecting_details': {
      const c = chosenCounts(st);
      if (p.place) return T.statusConfirmed({ activity: p.activity, when, place: p.place.name, yes: c.yes, maybe: c.maybe, pending: 0 });
      return T.statusDetails({ activity: p.activity, when, yes: c.yes, maybe: c.maybe });
    }
    case 'collecting_place':
      return T.statusPlace({ activity: p.activity, when: p.hungry?.instant ? undefined : when || undefined, voting: p.hungry?.phase === 'voting' });
    case 'confirmed':
    case 'reminded': {
      const c = chosenCounts(st);
      const pending = p.chosenOptionId !== undefined ? Object.values(p.members).filter((m) => m.status === 'pending').length : 0;
      const place = p.place ? (p.place.address ? `${p.place.name}, ${p.place.address}` : p.place.name) : undefined;
      return T.statusConfirmed({ activity: p.activity, when, place, yes: c.yes, maybe: c.maybe, pending });
    }
    case 'completed':
      return T.statusCompleted({ activity: p.activity, when, deletes: p.purgeAt ? relLabel(p.purgeAt, now, tz) : 'soon' });
    default:
      return T.statusNone();
  }
}

const OSM = '© OpenStreetMap contributors, ODbL';

/** `homi why`: the tally plus low-confidence reads, time constraints, who forced a lock, and the data source. */
export function whyText(st: Step, ref?: string): string {
  const p = P(st);
  const h = p.hungry;
  const source = h?.source === 'fallback' ? `places came from the offline OpenStreetMap snapshot (${OSM})` : h?.source === 'osm' ? `places come from OpenStreetMap (${OSM})` : undefined;
  if (h && h.options.length && (p.state === 'collecting_place' || (!ref && !activeOptions(p).length))) {
    const lines = h.options.map((o) => `${o.id} ${o.name}${o.why ? `: ${o.why}` : ''}`).join('; ');
    return T.whyPlaces({ lines, source: source ? source[0].toUpperCase() + source.slice(1) : undefined });
  }
  if (!activeOptions(p).length) return statusText(st);
  const sn = optionShortNames(p);
  const notes: string[] = [];
  const chosen = p.chosenOptionId !== undefined ? sn[p.chosenOptionId] : undefined;
  if (chosen && p.lockedBy === 'forced') notes.push(`${(p.forcedBy && p.members[p.forcedBy]?.name) || 'someone'} asked me to lock ${chosen}`);
  else if (chosen && p.lockedBy === 'threshold') notes.push(`${chosen} reached the threshold of ${p.threshold} yes`);
  else if (chosen && p.lockedBy === 'everyone') notes.push(`everyone answered, so I locked ${chosen} early`);
  else if (chosen && p.lockedBy === 'deadline') notes.push(`I locked ${chosen} at the deadline`);
  for (const m of Object.values(p.members)) {
    if (m.lowConfidence) notes.push(`I read ${m.name ? `${m.name}'s` : 'one'} reply as a yes to everything (low confidence)`);
    const seen = new Set<string>();
    for (const o of activeOptions(p)) {
      if (!isTimeMaybe(m, o) || seen.has(o.day)) continue;
      seen.add(o.day);
      const dp = m.dayPrefs[o.day];
      const win = dp.notBefore ? `after ${fmtTime(dp.notBefore)}` : `before ${fmtTime(dp.notAfter as string)}`;
      notes.push(`${m.name ?? 'someone'} can only do ${shortDay(o.day)} ${win}`);
    }
  }
  if (source) notes.push(source);
  return T.why({ tally: whyTally(p), notes: notes.join('; ') || undefined });
}

/** `homi split 142.50 [5 ways]`: rounds up to the cent so the total is covered. Defaults to the yes count. */
export function splitText(st: Step, amount: number, ways?: number): string {
  const p = planOf(st);
  let n = ways;
  if (!n && p) n = chosenCounts(st).yes;
  if (!n || n < 1) return T.splitAsk();
  const each = Math.ceil(Math.round(amount * 100) / n) / 100;
  return T.split({ each: money(each), n });
}

/** `.ics` where the channel supports files, else a copyable text block. Never reads a calendar. */
export function calendar(st: Step): void {
  const p = planOf(st);
  if (!p || p.eventAt === undefined) return say(st, T.icsNoDate());
  if (st.ctx.caps.files) {
    const slug = p.activity.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    st.acts.push({ type: 'file', name: `homi-${slug}.ics`, mime: ICS_MIME, content: ics(p), caption: T.icsCaption({ activity: p.activity }), prompting: 'prompted' });
    return;
  }
  say(st, T.icsText({ block: icsText(p, tzOf(st)) }));
}

const STATUS_WORDS = /^(?:plan|time|date|day|place|spot|address|location|restaurant|where|when|status|update|updates|progress|tally|summary|vote|votes|count|latest)$/;

/** `homi what did we decide about parking`: answers from plan notes only. */
export function noteGet(st: Step, key: string): string {
  const p = P(st);
  // "what's the status of the reservation": look for a "reservation" note, else show the plan card.
  const of = key.toLowerCase().match(/^(?:status|update|progress|latest) (?:of|on|for|with) (?:the )?(.+)$/);
  const k = of ? of[1] : key.toLowerCase();
  const entries = Object.entries(p.notes);
  const hit = entries.find(([n]) => n === k) ?? entries.find(([n]) => n.includes(k) || k.includes(n));
  if (hit) return T.noteFound({ key: hit[0], value: hit[1] });
  if (of || STATUS_WORDS.test(k)) return statusText(st);
  return T.noteMissing({ key: k });
}

export function notesList(st: Step): string {
  const entries = Object.entries(P(st).notes);
  return T.notesList({ list: entries.length ? entries.map(([k, v]) => `${k}: ${v}`).join('; ') : undefined });
}
