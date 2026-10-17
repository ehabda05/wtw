// Small helpers shared by the extensions. Pure.

import type { ExtName } from '../types.js';
import { type Step, P } from '../plan/core.js';

/** Schedules an extension job on the current plan: job 'ext', key `${planId}:ext:${ext}:${name}`. */
export function scheduleExt(st: Step, ext: ExtName, name: string, at: number, payload: Record<string, unknown> = {}): void {
  const p = P(st);
  st.acts.push({ type: 'schedule', key: `${p.id}:ext:${ext}:${name}`, job: 'ext', at, planId: p.id, payload: { ...payload, ext, name } });
}

export function cancelExt(st: Step, ext: ExtName, name = ''): void {
  const p = P(st);
  st.acts.push({ type: 'cancel', keyPrefix: `${p.id}:ext:${ext}:${name}` });
}

/** Formats integer cents as "$1,234.56". */
export function usd(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100).toLocaleString('en-US');
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, '0')}`;
}

/** Formats whole dollars as "$2,670". */
export function usdWhole(dollars: number): string {
  return `$${Math.round(dollars).toLocaleString('en-US')}`;
}
