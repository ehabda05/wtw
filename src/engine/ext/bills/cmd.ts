// Parsed bill commands, shared by the split and itemize parsers. Names are lowercased tokens as typed
// ("me" / "i" are resolved to the sender later); amounts are integer cents.

import type { CustomPart, ExtraSpec } from './split.js';

export type HelpWhy = 'split' | 'itemize' | 'tooBig' | 'badPct' | 'oneName' | 'mismatch' | 'custom' | 'noPrice';

export type BillCmd =
  | {
      kind: 'equal'; base: number; extras: ExtraSpec[]; ways?: number; names: string[]; payer?: string; label?: string;
      /** "between us" / "how much does everyone owe": split among the plan members who are not out. */
      everyone?: boolean;
    }
  | { kind: 'custom'; base: number; extras: ExtraSpec[]; parts: CustomPart[]; payer?: string; label?: string }
  | {
      kind: 'itemized'; label?: string; payer?: string; extras: ExtraSpec[];
      people: Array<{ name: string; cents: number }>; shared: Array<{ cents: number; by?: string[] }>;
    }
  | { kind: 'settle' }
  | { kind: 'tab' }
  | { kind: 'clear' }
  | { kind: 'undo'; explicit: boolean }
  | { kind: 'help'; why: HelpWhy; detail?: string; ways?: number; names?: number };

export function help(why: HelpWhy, more: { detail?: string; ways?: number; names?: number } = {}): BillCmd {
  return { kind: 'help', why, ...more };
}

/** Leading article of a label ("the uber" -> "uber"). */
export const ARTICLE = /^(?:the|our|a|an|my) /;
/** A short label members give a bill ("dinner", "the uber"). */
export const LABEL_RE = /^[a-z][a-z0-9' \-]{0,29}$/;
/** Pronouns that never name a payer ("we paid 40" is not a bill for a person called We). */
export const NOT_PAYERS = new Set(['we', 'they', 'he', 'she', 'someone', 'somebody', 'who', 'it', 'that', 'this']);
