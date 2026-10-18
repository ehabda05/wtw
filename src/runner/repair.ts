// Runner side of the optional LLM repair router (src/llm/router.ts, docs/PRIVACY.md §3): decides when an engine
// result is only a generic fallback, gathers the names to redact and a context line with no personal data, and
// bounds the call with a timeout. Everything here is in memory only; nothing is logged or persisted.

import { TEMPLATES as T } from '../engine/templates.js';
import type { Action, GroupState, MessageEvent } from '../engine/types.js';
import type { RepairContext } from '../llm/router.js';

export const REPAIR_TIMEOUT_MS = 4000;

/** A bare address or an explicit "help" already got the right answer: never repaired. */
const SKIP = /^\s*(?:@?homi\b[,:!]?\s*)?\/?(?:help(?: me)?|commands|\?)?\s*[?!.]*\s*$/i;

// Bookkeeping the group never sees: a (re)scheduled job, a remembered handle. Never evidence that Homi understood.
const NEUTRAL = new Set<Action['type']>(['schedule', 'cancel', 'remember_handle']);

/**
 * The engine answers every ADDRESSED message, at worst with "Not sure what you mean" or by repeating its open
 * question. When the runner only pretended a message was addressed (Claude-first listening on unaddressed chatter),
 * those two safety-net replies must not reach the group: strip them before judging whether the rewrite said anything.
 */
export function withoutNetReplies(actions: Action[]): Action[] {
  const net = new Set([T.unknown(), T.cuisineAsk()]);
  return actions.filter((a) => !(a.type === 'send' && net.has(a.text)));
}

/**
 * True when the only things Homi would say are generic fallbacks (unknown, help, alreadyPlan, whichOnes, noteMissing, and
 * askWhen while dates are being collected) or nothing at all, ignoring the one-time intro and job bookkeeping.
 */
export function onlyGenericFallback(actions: Action[], pre: GroupState): boolean {
  // needPlan / statusNone: a loose question ("whats the damage…") with no plan open lands on "There's no plan yet".
  const exact = new Set([T.unknown(), T.help(), T.alreadyPlan(), T.statusNone(), T.needPlan()]);
  if (pre.plan?.state === 'collecting_dates') exact.add(T.askWhen());
  const [pfx, sfx = ''] = T.whichOnes({ ids: '\u0000' }).split('\u0000');
  // "I don't have a note about X" usually means a loose "what's the X" question that the note lookup caught.
  const nparts = T.noteMissing({ key: '\u0000' }).split('\u0000');
  const [npfx, nsfx] = [nparts[0], nparts[nparts.length - 1]];
  const framed = (t: string, a: string, b: string) => t.length > a.length + b.length && t.startsWith(a) && t.endsWith(b);
  const generic = (t: string) => exact.has(t) || framed(t, pfx, sfx) || framed(t, npfx, nsfx);
  let n = 0;
  for (const a of actions) {
    if (a.type === 'send' && a.tag === 'intro') continue;
    if (a.type === 'send' || a.type === 'reply') {
      if (!generic(a.text)) return false;
      n++;
    } else if (!NEUTRAL.has(a.type)) {
      return false;
    }
  }
  // n === 0: Homi would say nothing at all to someone who addressed it, which is worse than a generic reply.
  return true;
}

export function skipRepair(text: string): boolean {
  return SKIP.test(text);
}

const PRONOUNS = new Set(['you', 'me', 'i', 'we', 'us', 'everyone', 'all', 'homi']);
const NAME_KEYS = new Set(['name', 'payer', 'by', 'displayName']);

function collect(v: unknown, out: string[], depth = 0): void {
  if (depth > 6 || v === null || typeof v !== 'object') return;
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (typeof x === 'string') {
      if (NAME_KEYS.has(k)) out.push(x);
    } else {
      collect(x, out, depth + 1);
    }
  }
}

/** Every name Homi knows for this group (plan members, sender, bill tab / album names, extra), deduped. */
export function knownNamesFor(pre: GroupState, ev: MessageEvent, extra: Iterable<string> = []): string[] {
  const raw: string[] = [...extra];
  if (ev.from.platformName) raw.push(ev.from.platformName);
  for (const m of Object.values(pre.plan?.members ?? {})) if (m.name) raw.push(m.name);
  collect(pre.space.ext, raw);
  const out = new Map<string, string>();
  for (const r of raw) {
    const n = r.trim();
    if (!n || n.length > 40 || PRONOUNS.has(n.toLowerCase())) continue;
    if (!out.has(n.toLowerCase())) out.set(n.toLowerCase(), n);
  }
  return [...out.values()];
}

const FLOWS: Record<string, string> = { bills: 'bill tab', travel: 'trip', commit: 'pledge', album: 'album' };

export function repairContext(pre: GroupState, seenMembers = 0): RepairContext {
  const p = pre.plan;
  const flows = Object.entries(pre.space.ext ?? {})
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k]) => FLOWS[k] ?? k);
  if (p?.hungry) flows.push('food vote');
  const members = p ? Object.keys(p.members).length || undefined : seenMembers || undefined;
  return { planState: p?.state ?? 'none', options: (p?.options ?? []).filter((o) => !o.removed).map((o) => o.label), members, openFlows: flows };
}

export class RepairTimeout extends Error {}

/** Runs fn with an AbortSignal; rejects with RepairTimeout (and aborts) after ms. */
export async function withTimeout<R>(fn: (signal: AbortSignal) => Promise<R>, ms: number): Promise<R> {
  const ac = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new RepairTimeout('timeout')); // settle first, so an answer that races the abort never wins
      ac.abort();
    }, ms);
  });
  try {
    return await Promise.race([fn(ac.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Platform display names seen per space, kept in memory only while the repair router is on (for redaction). */
export class NameMemory {
  readonly #spaces = new Map<string, Set<string>>();
  constructor(
    private readonly perSpace = 64,
    private readonly maxSpaces = 1000,
  ) {}
  add(space: string, name: string | undefined): void {
    if (!name?.trim()) return;
    let set = this.#spaces.get(space);
    if (!set) {
      if (this.#spaces.size >= this.maxSpaces) {
        const oldest = this.#spaces.keys().next().value;
        if (oldest !== undefined) this.#spaces.delete(oldest);
      }
      this.#spaces.set(space, (set = new Set()));
    }
    if (set.size < this.perSpace) set.add(name.trim());
  }
  get(space: string): string[] {
    return [...(this.#spaces.get(space) ?? [])];
  }
  drop(space: string): void {
    this.#spaces.delete(space);
  }
}
