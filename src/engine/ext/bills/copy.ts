// Every message the bills extension sends. Hard rule: at most two sentences; cards are a header ending in ":",
// short fragment lines (no sentence punctuation) and a one-sentence footer. Names and labels are already
// display-ready (capitalized, sanitized). Pure.

import type { ExtraLine, Split } from './split.js';
import type { BillTab, Transfer } from './ledger.js';
import type { BillCmd } from './cmd.js';
import { usd } from '../util.js';
import { fmtPct } from './money.js';
import { display, joinNames } from './names.js';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const expenses = (n: number) => plural(n, 'expense', 'expenses');

/** "tax $7.81 + 20% tip $22.30" */
export function extrasDesc(extras: ExtraLine[]): string {
  return extras
    .map((e) => {
      const pct = e.pct !== undefined ? `${fmtPct(e.pct)} ` : '';
      if (e.kind === 'tax') return `tax ${usd(e.amount)}`;
      if (e.kind === 'tip') return `${pct}tip${e.onTotal ? ' on total' : ''} ${usd(e.amount)}`;
      if (e.kind === 'service') return `${pct}service ${usd(e.amount)}`;
      return `${e.label ? `${e.label} ` : ''}fee ${usd(e.amount)}`;
    })
    .join(' + ');
}

/** " (tax $7.81 + 20% tip $22.30)" for itemized bills, " ($86.40 + 18% tip $15.55)" when the base was typed. */
function extraPart(s: Split, withBase: boolean): string {
  if (!s.extras.length) return '';
  return ` (${withBase ? `${usd(s.base)} + ` : ''}${extrasDesc(s.extras)})`;
}

const what = (label: string | undefined, total: number) => (label ? `${label} ${usd(total)}` : usd(total));

/** "Ana $25.02 · Ben $36.45 · ..." five to a line. */
function lines(s: Split): string[] {
  const cells = s.names.map((n, i) => `${n} ${usd(s.shares[i])}`);
  const out: string[] = [];
  for (let i = 0; i < cells.length; i += 5) out.push(cells.slice(i, i + 5).join(' · '));
  return out;
}

export interface CardOpts {
  label?: string;
  payer?: string;
  /** Show the typed base inside the parentheses (equal and custom splits). */
  withBase: boolean;
  /** Not on the tab because nobody said who paid: add a hint. */
  hintPayer?: string;
}

/** Header, one line per five people, "Adds up to $X exactly." (+ a hint when it could not go on the tab). */
export function card(s: Split, o: CardOpts): string {
  const x = extraPart(s, o.withBase);
  const head = o.payer
    ? `${what(o.label, s.total)}${x}, paid by ${o.payer}:`
    : o.label ? `${what(o.label, s.total)}${x}:` : `${usd(s.total)} split${x}:`;
  const foot = `Adds up to ${usd(s.total)} exactly.${o.hintPayer ? ` ${payerHint(o.hintPayer)}` : ''}`;
  return [head, ...lines(s), foot].join('\n');
}

export const payerHint = (first: string) => `Say who paid ("paid by ${first.toLowerCase()}") to put it on the tab.`;
export const namesHint = () => `Name everyone ("split 60 between ana ben, paid by ana") to put it on the tab.`;

/** Named, even split: "Uber $23.40 paid by Jo: $7.80 each for Ana, Jo and You." */
export function evenNamed(s: Split, label: string | undefined, payer: string | undefined): string {
  const x = extraPart(s, true);
  const each = usd(s.shares[0]);
  if (payer) return `${what(label, s.total)}${x} paid by ${payer}: ${each} each for ${joinNames(s.names)}.`;
  return `${what(label, s.total)}${x} split between ${joinNames(s.names)}: ${each} each. ${payerHint(s.names[0])}`;
}

/** Unnamed: "$101.95 split 4 ways ($86.40 + 18% tip $15.55): 3 pay $25.49, 1 pays $25.48." */
export function unnamed(s: Split, label: string | undefined, payerGiven: boolean): string {
  const x = extraPart(s, true);
  const hi = Math.max(...s.shares);
  const lo = Math.min(...s.shares);
  const nHi = s.shares.filter((c) => c === hi).length;
  const dist = hi === lo
    ? `${usd(hi)} each`
    : `${nHi} ${nHi === 1 ? 'pays' : 'pay'} ${usd(hi)}, ${s.shares.length - nHi} ${s.shares.length - nHi === 1 ? 'pays' : 'pay'} ${usd(lo)}`;
  return `${what(label, s.total)} split ${s.shares.length} ways${x}: ${dist}.${payerGiven ? ` ${namesHint()}` : ''}`;
}

export function settleCard(tab: BillTab, total: number, transfers: Transfer[]): string {
  if (!transfers.length) return `Everyone's even on the tab (${expenses(tab.expenses.length)}, ${usd(total)}).`;
  const head = `Here's who pays whom (${expenses(tab.expenses.length)}, ${usd(total)}):`;
  return [head, ...transfers.map((t) => `${t.from} → ${t.to} ${usd(t.cents)}`), `Then everyone's even.`].join('\n');
}

export function tabCard(tab: BillTab, total: number): string {
  const shown = tab.expenses.slice(-10);
  const latest = shown.length < tab.expenses.length ? `, latest ${shown.length}` : '';
  const head = `The tab (${expenses(tab.expenses.length)}, ${usd(total)}${latest}):`;
  const rows = shown.map((e) => `${e.label ?? 'Bill'} ${usd(e.total)} · paid by ${e.payer} · ${plural(e.shares.length, 'person', 'people')}`);
  return [head, ...rows, `Say "homi settle up" to see who pays whom.`].join('\n');
}

export const tabEmpty = () => `The tab is empty; log a bill with "homi split 60 between ana ben, paid by ana".`;
export const cleared = (n: number, total: number) => `Done: I deleted the tab (${expenses(n)}, ${usd(total)}).`;
export const clearedNothing = () => `The tab is already empty.`;
export const undone = (label: string | undefined, total: number, payer: string, left: number, leftTotal: number) =>
  `Removed ${label ?? 'Bill'} ${usd(total)} (paid by ${payer}) from the tab; ${left ? `${expenses(left)} left, ${usd(leftTotal)}` : "it's empty now"}.`;
export const undoNothing = () => `The tab is empty, so there's nothing to undo.`;
export const tabFull = (max: number) => `The tab already has ${max} expenses; settle up and say "homi clear the tab" before adding more.`;
/** With a plan open, "homi I'm Ana" is remembered, so Homi asks for it; otherwise names are the way. */
export const whoIsMe = (planOpen = false) =>
  planOpen ? `Who's "me"? Say "homi I'm <name>".` :`I don't know your name yet, so use names instead of "me" (like "paid by ana").`;
export const askWays = () => `How many ways? Try "homi split 142.50 5 ways" or "homi split 142.50 between ana ben jo".`;

export function customError(error: 'over' | 'under' | 'pctOver' | 'restEmpty', sum: number, base: number): string {
  if (error === 'over') return `Those parts add up to ${usd(sum)}, more than the ${usd(base)} bill.`;
  if (error === 'under') return `Those parts add up to ${usd(sum)}, not ${usd(base)}; fix an amount or give someone "rest".`;
  if (error === 'pctOver') return `Those percentages add up to more than 100%.`;
  return `The parts already cover ${usd(base)}, so nothing is left for "rest".`;
}

export function helpText(c: Extract<BillCmd, { kind: 'help' }>): string {
  switch (c.why) {
    case 'itemize':
      return `List each person's items, then extras: "homi itemize dinner, paid by ben: ana ramen 16.50; ben curry 18; shared edamame 6; tax 7%; tip 20%".`;
    case 'noPrice':
      return `I couldn't find a price for ${c.detail ? display(c.detail) : 'the shared items'}; write items like "ana ramen 16.50 + tea 3".`;
    case 'tooBig':
      return `That's more than I can split; I handle bills up to $100,000.`;
    case 'badPct':
      return `That percentage looks off; tip, tax and service go up to 100%.`;
    case 'oneName':
      return `Name at least two people, like "homi split 120 between ana ben jo".`;
    case 'mismatch':
      return `That's ${c.names} names but ${c.ways} ways; list everyone or just say "${c.ways} ways".`;
    case 'custom':
      return `Give each person an amount, a percentage or "rest", like "homi split 60 custom: ana 25, ben 20, jo rest".`;
    default:
      return `Try "homi split 86.40 4 ways", "homi split 120 between ana ben jo, paid by ana" or "homi split 60 custom: ana 25, ben 20, jo rest".`;
  }
}
