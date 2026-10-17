// PRIVACY.md §8: "otto what do you know". Built from the same GroupState that the purge deletes, so the dump
// cannot drift from what is stored. Prints decrypted plan fields only: never member keys, plan ids, message
// ids or ciphertext (it says how many message IDs it holds, never which).

import type { GroupState } from './types.js';
import type { EnginePlan } from './model.js';
import { TEMPLATES as T } from './templates.js';
import { activeOptions, counts, tallyLine } from './schedule.js';
import { clean, relLabel } from './util.js';
import { cuisineLabel, rankedCuisines } from './hungry.js';

const STATE_LABEL: Record<string, string> = {
  idle: 'no plan',
  collecting_dates: 'waiting for a rough time',
  collecting_availability: 'collecting availability',
  date_chosen: 'date chosen',
  collecting_details: 'date locked, place open',
  collecting_place: 'picking a place',
  confirmed: 'confirmed',
  reminded: 'reminded',
  completed: 'completed',
  purged: 'deleted',
};

export function dump(state: GroupState, now?: number): string {
  const sp = state.space;
  const inner = `tone ${sp.tone}, time zone ${sp.tz}, notice ${sp.notice ? 'on' : 'off'}`;
  const settings = `settings (${inner})`;
  const p = state.plan as EnginePlan | null;
  if (!p) return T.dumpNoPlan({ settings: `settings only (${inner})` });
  const at = now ?? p.updatedAt;
  const parts: string[] = [settings];
  parts.push(`plan "${p.activity}"${p.windowLabel ? ` (${p.windowLabel})` : ''}, ${STATE_LABEL[p.state] ?? p.state}`);
  const active = activeOptions(p);
  if (active.length) parts.push(`options ${active.map((o) => o.label.replace(' · ', ' ')).join(', ')}`);
  const removed = p.options.length - active.length;
  if (removed) parts.push(`${removed} vetoed ${removed === 1 ? 'option' : 'options'}`);
  if (active.length) parts.push(`votes ${tallyLine(p).replace(/ · /g, ', ')}`);
  const chosen = p.options.find((o) => o.id === p.chosenOptionId);
  if (chosen) {
    const c = counts(p, chosen);
    parts.push(`chosen ${chosen.label.replace(' · ', ' ')} (${c.yes} yes${c.maybe ? `, ${c.maybe} maybe` : ''})`);
  }
  if (p.place) parts.push(`place ${clean(p.place.name)}${p.place.address ? `, ${clean(p.place.address)}` : ''}`);
  if (p.neighborhood) parts.push(`area ${p.neighborhood}`);
  const ms = Object.values(p.members);
  const answered = ms.filter((m) => m.status === 'answered').length;
  const pending = ms.filter((m) => m.status === 'pending').length;
  const out = ms.filter((m) => m.status === 'out').length;
  parts.push(`${ms.length} ${ms.length === 1 ? 'person' : 'people'}: ${answered} answered, ${pending} pending${out ? `, ${out} out` : ''}`);
  const names = ms.filter((m) => m.name).map((m) => m.name as string);
  if (names.length) parts.push(`names I know: ${names.join(', ')}`);
  const optIns = ms.filter((m) => m.optInDm || m.optInCall).length;
  if (optIns) parts.push(`private check-ins allowed by ${optIns} (a sealed contact for each, deleted with the plan)`);
  const refs = ms.filter((m) => m.lastMsgRef).length;
  if (refs) parts.push(`last-message IDs for ${refs} ${refs === 1 ? 'person' : 'people'} (IDs only, never text)`);
  if (p.expectedHeadcount) parts.push(`headcount ${p.expectedHeadcount}`);
  if (p.threshold) parts.push(`lock threshold ${p.threshold} yes`);
  const notes = Object.entries(p.notes);
  if (notes.length) parts.push(`notes: ${notes.map(([k, v]) => `${clean(k)} = ${clean(v, 200)}`).join('; ')}`);
  const h = p.hungry;
  if (h) {
    const bits: string[] = [];
    const cs = rankedCuisines(h);
    if (cs.length) bits.push(cs.map(([c, n]) => `${cuisineLabel(c)} ${n}`).join(', '));
    if (h.vetoes.length) bits.push(`no ${h.vetoes.map(cuisineLabel).join('/')}`);
    if (h.priceMax) bits.push(`budget ${'$'.repeat(h.priceMax)}`);
    if (h.diet.length) bits.push(`diet ${h.diet.join('/').replace(/_/g, ' ')}`);
    if (bits.length) parts.push(`food answers: ${bits.join('; ')}`);
    if (h.options.length && h.phase !== 'done') parts.push(`place options ${h.options.map((o) => clean(o.name)).join(', ')}`);
  }
  if (p.remindReq30) parts.push('30-minute reminder requested');
  parts.push(`${p.nudges.length} ${p.nudges.length === 1 ? 'nudge' : 'nudges'} sent`);
  parts.push(p.purgeAt ? `deletes ${relLabel(p.purgeAt, at, sp.tz)}` : 'deletes 24h after the event');
  return T.dumpPlan({ parts: parts.join(' · ') });
}
