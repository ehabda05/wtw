// The group tab: expenses members logged with Homi (payer, who shares it, cents per person, a label), kept in
// state.space.ext.bills until "homi clear the tab" or "homi stop". Settling up nets everyone's balance and pays
// the largest debtor to the largest creditor until everyone is even. Pure; integer cents.

import type { GroupState } from '../../types.js';
import type { Step } from '../../plan/core.js';

export type ExpenseKind = 'equal' | 'custom' | 'itemized';

export interface Share {
  name: string;
  cents: number;
}

export interface Expense {
  label?: string;
  payer: string;
  total: number;
  shares: Share[];
  kind: ExpenseKind;
  createdAt: number;
}

export interface BillTab {
  expenses: Expense[];
}

/** A tab this long should be settled first (keeps the sealed settings blob small). */
export const MAX_EXPENSES = 100;

export function getTab(s: GroupState): BillTab | undefined {
  const t = s.space.ext?.bills as BillTab | undefined;
  return t && Array.isArray(t.expenses) && t.expenses.length ? t : undefined;
}

export function setTab(st: Step, tab: BillTab | undefined): void {
  const ext = { ...(st.s.space.ext ?? {}) };
  if (tab && tab.expenses.length) ext.bills = tab;
  else delete ext.bills;
  st.s.space.ext = ext;
}

export function addExpense(st: Step, e: Expense): BillTab {
  const tab: BillTab = { expenses: [...(getTab(st.s)?.expenses ?? []), e] };
  setTab(st, tab);
  return tab;
}

export function tabTotal(tab: BillTab): number {
  return tab.expenses.reduce((a, e) => a + e.total, 0);
}

const key = (name: string) => name.toLowerCase();

/** Net cents per person (paid minus owed), in first-seen order. Positive = is owed money. Sums to zero. */
export function balances(tab: BillTab): Array<{ name: string; net: number }> {
  const net = new Map<string, { name: string; net: number }>();
  const at = (name: string) => {
    let b = net.get(key(name));
    if (!b) net.set(key(name), (b = { name, net: 0 }));
    return b;
  };
  for (const e of tab.expenses) {
    at(e.payer).net += e.total;
    for (const s of e.shares) at(s.name).net -= s.cents;
  }
  return [...net.values()];
}

export interface Transfer {
  from: string;
  to: string;
  cents: number;
}

const byAmountThenName = (a: { name: string; amt: number }, b: { name: string; amt: number }) =>
  b.amt - a.amt || (key(a.name) < key(b.name) ? -1 : key(a.name) > key(b.name) ? 1 : 0);

/** Greedy settle-up: the largest debtor pays the largest creditor (ties by name) until everyone is even. */
export function settle(tab: BillTab): Transfer[] {
  const bal = balances(tab);
  const debtors = bal.filter((b) => b.net < 0).map((b) => ({ name: b.name, amt: -b.net }));
  const creditors = bal.filter((b) => b.net > 0).map((b) => ({ name: b.name, amt: b.net }));
  const out: Transfer[] = [];
  for (;;) {
    debtors.sort(byAmountThenName);
    creditors.sort(byAmountThenName);
    const d = debtors[0];
    const c = creditors[0];
    if (!d || !c || d.amt <= 0 || c.amt <= 0) break;
    const cents = Math.min(d.amt, c.amt);
    out.push({ from: d.name, to: c.name, cents });
    d.amt -= cents;
    c.amt -= cents;
    if (!d.amt) debtors.shift();
    if (!c.amt) creditors.shift();
  }
  return out;
}
