// Bill splitting and the group tab (docs/BILLS.md). Equal, custom and itemized splits with tax, tip, service
// and fees; integer cents with one largest-remainder rounding so shares always add up to the total; expenses
// with a payer go on the tab in state.space.ext.bills, and "homi settle up" turns the tab into the fewest
// obvious transfers. Handles addressed messages only. No payment is ever made.

import type { GroupState, MessageEvent } from '../types.js';
import type { Extension } from './types.js';
import { type Step, planOf, say } from '../plan/core.js';
import { counts } from '../schedule.js';
import { capitalize, clean, listJoin } from '../util.js';
import { usd } from './util.js';
import type { BillCmd } from './bills/cmd.js';
import { parseBills } from './bills/parse.js';
import { type Split, customSplit, equalSplit, itemizedSplit } from './bills/split.js';
import { type Expense, type ExpenseKind, MAX_EXPENSES, addExpense, balances, getTab, setTab, settle, tabTotal } from './bills/ledger.js';
import { SELF, display, isName } from './bills/names.js';
import * as C from './bills/copy.js';

type LogCmd = Extract<BillCmd, { kind: 'equal' | 'custom' | 'itemized' }>;

/** One bill is shared by at most this many people. */
const MAX_PEOPLE = 50;

/** The sender's first name as Homi already knows it (plan member name, else the platform's display name). */
function selfToken(st: Step, ev: MessageEvent): string | undefined {
  const known = planOf(st)?.members[ev.from.key]?.name ?? ev.from.platformName;
  const first = known?.trim().split(/\s+/)[0]?.toLowerCase();
  return first && isName(first) ? first : undefined;
}

function tokensOf(c: LogCmd): string[] {
  const t = c.payer ? [c.payer] : [];
  if (c.kind === 'equal') return [...t, ...c.names];
  if (c.kind === 'custom') return [...t, ...c.parts.map((p) => p.name)];
  return [...t, ...c.people.map((p) => p.name), ...c.shared.flatMap((s) => s.by ?? [])];
}

/** Default head count for "split 120": the yes votes on the chosen date, else the people still in. */
function defaultWays(st: Step): number {
  const p = planOf(st);
  if (!p) return 0;
  const o = p.options.find((x) => x.id === p.chosenOptionId);
  if (o) return counts(p, o).yes;
  return Object.values(p.members).filter((m) => m.status !== 'out').length;
}

/** "everyone" / "between us": the plan members who are not out (0 without a plan, so Homi asks how many ways). */
function everyoneWays(st: Step): number {
  const p = planOf(st);
  return p ? Object.values(p.members).filter((m) => m.status !== 'out').length : 0;
}

const labelOf = (l: string | undefined) => (l ? capitalize(clean(l, 30)) : undefined);
const dedupe = (xs: string[]) => xs.filter((x, i) => xs.indexOf(x) === i);

/** Puts an expense on the tab. Returns false (and says so) when the tab is full. */
function onTab(st: Step, kind: ExpenseKind, label: string | undefined, payer: string, s: Split): boolean {
  const tab = getTab(st.s);
  if (tab && tab.expenses.length >= MAX_EXPENSES) {
    say(st, C.tabFull(MAX_EXPENSES));
    return false;
  }
  const e: Expense = { kind, payer, total: s.total, shares: s.names.map((name, i) => ({ name, cents: s.shares[i] })), createdAt: st.ctx.now };
  if (label) e.label = label;
  addExpense(st, e);
  return true;
}

function logBill(st: Step, ev: MessageEvent, c: LogCmd): void {
  const self = selfToken(st, ev);
  if (tokensOf(c).some((t) => SELF.has(t)) && !self) return say(st, C.whoIsMe(Boolean(planOf(st))));
  const R = (t: string) => (SELF.has(t) ? (self as string) : t);
  if (c.payer && !isName(R(c.payer))) return say(st, C.helpText({ kind: 'help', why: 'split' }));
  const payer = c.payer ? display(R(c.payer)) : undefined;
  const label = labelOf(c.label);

  if (c.kind === 'equal') {
    const names = dedupe(c.names.map(R));
    if (names.length === 1) return say(st, C.helpText({ kind: 'help', why: 'oneName' }));
    const ways = names.length || c.ways || (c.everyone ? everyoneWays(st) : defaultWays(st));
    if (!ways || ways < 2) return say(st, C.askWays());
    if (ways > MAX_PEOPLE) return say(st, C.helpText({ kind: 'help', why: 'split' }));
    const s = equalSplit(c.base, c.extras, names.length ? names.map(display) : Array.from({ length: ways }, () => ''));
    if (!names.length) return say(st, C.unnamed(s, label, Boolean(payer)));
    if (payer && !onTab(st, 'equal', label, payer, s)) return;
    const even = s.shares.every((x) => x === s.shares[0]);
    return say(st, even ? C.evenNamed(s, label, payer) : C.card(s, { label, payer, withBase: true, hintPayer: payer ? undefined : s.names[0] }));
  }

  if (c.kind === 'custom') {
    const parts = c.parts.map((p) => ({ ...p, name: R(p.name) }));
    if (dedupe(parts.map((p) => p.name)).length !== parts.length) return say(st, C.helpText({ kind: 'help', why: 'custom' }));
    const r = customSplit(c.base, c.extras, parts.map((p) => ({ ...p, name: display(p.name) })));
    if (!r.ok) return say(st, C.customError(r.error, r.sum, c.base));
    if (payer && !onTab(st, 'custom', label, payer, r.split)) return;
    return say(st, C.card(r.split, { label, payer, withBase: true, hintPayer: payer ? undefined : r.split.names[0] }));
  }

  // Itemized: merge people who resolve to the same name, then add shared-only people at the end.
  const names: string[] = [];
  const own: number[] = [];
  for (const p of c.people) {
    const n = R(p.name);
    const i = names.indexOf(n);
    if (i >= 0) own[i] += p.cents;
    else {
      names.push(n);
      own.push(p.cents);
    }
  }
  const shared = c.shared.map((x) => {
    if (!x.by) return { cents: x.cents };
    const by = dedupe(x.by.map(R)).map((n) => {
      if (!names.includes(n)) {
        names.push(n);
        own.push(0);
      }
      return names.indexOf(n);
    });
    return { cents: x.cents, by };
  });
  if (names.length > MAX_PEOPLE) return say(st, C.helpText({ kind: 'help', why: 'itemize' }));
  const s = itemizedSplit(names.map(display), own, shared, c.extras);
  if (s.total <= 0) return say(st, C.helpText({ kind: 'help', why: 'itemize' }));
  if (payer && !onTab(st, 'itemized', label, payer, s)) return;
  say(st, C.card(s, { label, payer, withBase: false, hintPayer: payer ? undefined : s.names[0] }));
}

function onCommand(st: Step, ev: MessageEvent, c: BillCmd): boolean {
  const tab = getTab(st.s);
  switch (c.kind) {
    case 'settle':
      say(st, tab ? C.settleCard(tab, tabTotal(tab), settle(tab)) : C.tabEmpty());
      return true;
    case 'tab':
      say(st, tab ? C.tabCard(tab, tabTotal(tab)) : C.tabEmpty());
      return true;
    case 'clear':
      if (tab) setTab(st, undefined);
      say(st, tab ? C.cleared(tab.expenses.length, tabTotal(tab)) : C.clearedNothing());
      return true;
    case 'undo': {
      if (!tab) {
        if (!c.explicit) return false; // a bare "homi undo" may belong to someone else
        say(st, C.undoNothing());
        return true;
      }
      const last = tab.expenses[tab.expenses.length - 1];
      const rest = { expenses: tab.expenses.slice(0, -1) };
      setTab(st, rest);
      say(st, C.undone(last.label, last.total, last.payer, rest.expenses.length, tabTotal(rest)));
      return true;
    }
    case 'help':
      say(st, C.helpText(c));
      return true;
    default:
      logBill(st, ev, c);
      return true;
  }
}

/** "bill tab: 2 expenses, $165.01 (Dinner paid by Ben, Uber paid by Jo), Ben is owed $105.16" */
function dumpLine(state: GroupState): string[] {
  const tab = getTab(state);
  if (!tab) return [];
  const n = tab.expenses.length;
  const shown = tab.expenses.slice(-10).map((e) => `${e.label ?? 'Bill'} paid by ${e.payer}`);
  const what = (n > shown.length ? [`${n - shown.length} earlier`, ...shown] : shown).join(', ');
  const owed = balances(tab).filter((b) => b.net > 0).map((b) => `${b.name} is owed ${usd(b.net)}`);
  const tail = owed.length ? listJoin(owed) : 'everyone even';
  return [`bill tab: ${n} ${n === 1 ? 'expense' : 'expenses'}, ${usd(tabTotal(tab))} (${what}), ${tail}`];
}

export const bills: Extension = {
  name: 'bills',
  onMessage(st, ev, body, addressed) {
    if (!addressed) return false;
    const c = parseBills(body);
    return c ? onCommand(st, ev, c) : false;
  },
  onStop(st) {
    setTab(st, undefined);
  },
  dump: (state) => dumpLine(state),
};

