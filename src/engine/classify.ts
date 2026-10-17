// classify(): what Homi would make of one message in context, without changing anything. Used by the eval
// harness for intent accuracy and food precision/recall. `food` is semantic (eval/FORMAT.md): true for real
// intent to eat together, a food answer, or a restaurant vote, even when Homi must stay silent (no plan).

import type { Plan } from './types.js';
import type { Command, EngineHungry, EnginePlan } from './model.js';
import { FOOD_THRESHOLD, pFood } from './classifier.js';
import { foodScore, hasTaste, parseTaste } from './hungry.js';
import { foodTrigger, planOrFood } from './intent.js';
import { UNADDRESSED_COMMANDS, detectActivity, detectAddressed, isVeto, parseAvailability, parseCommand, parseWindow, stripAddress } from './parse.js';
import { effectiveVote } from './schedule.js';
import { placeRef } from './plan/place.js';

export type Intent = 'command' | 'plan' | 'food' | 'vote' | 'food_answer' | 'veto' | 'chatter';

export interface Classification {
  intent: Intent;
  command?: Command;
  /** Lexicon points after idiom cancellation (HUNGRY_FLOW §1). */
  foodScore: number;
  /** Naive-Bayes P(food). */
  pFood: number;
  /** Semantic food intent (see header). */
  food: boolean;
  addressed: boolean;
  window?: string;
  activity?: string;
  /** For a restaurant vote in the hungry flow. */
  placeVote?: number;
}

export interface ClassifyOpts {
  addressed?: boolean;
  notice?: boolean;
  replyTo?: string;
  /** Sender, for veto ("from a yes voter"). */
  from?: string;
}

export function classify(text: string, plan: Plan | null, now: number, tz: string, opts: ClassifyOpts = {}): Classification {
  const addressed = opts.addressed ?? detectAddressed(text);
  const body = stripAddress(text);
  const fs = foodScore(body);
  const pf = pFood(body);
  const win = parseWindow(body, now, tz);
  const act = detectActivity(body);
  const semanticFood = addressed ? foodTrigger(body, true, now, tz) : fs.score >= 2 && pf >= FOOD_THRESHOLD;
  const base = { foodScore: fs.score, pFood: pf, addressed, window: win?.label, activity: act.named ? act.activity : undefined };
  const out = (intent: Intent, food: boolean, extra: Partial<Classification> = {}): Classification => ({ ...base, intent, food, ...extra });
  const p = plan as EnginePlan | null;
  const h = p?.hungry as EngineHungry | undefined;

  const cmd = parseCommand(body);
  if (cmd && (addressed || UNADDRESSED_COMMANDS.has(cmd.kind))) {
    if (cmd.kind === 'food') return out('food', true, { command: cmd });
    if (cmd.kind === 'plan') return out(p ? 'command' : 'plan', false, { command: cmd });
    if (cmd.kind === 'go') return out('command', p?.state === 'collecting_place', { command: cmd });
    if (cmd.kind === 'tz' && p?.state === 'collecting_place' && h?.phase === 'asking' && hasTaste(parseTaste(body))) return out('food_answer', true);
    if (cmd.kind !== 'yes' && cmd.kind !== 'no') return out('command', false, { command: cmd });
  }
  if (!p) {
    if (addressed) {
      const k = planOrFood(body, now, tz);
      if (k === 'plan') return out('plan', false);
      if (k === 'food') return out('food', true);
    }
    return out('chatter', semanticFood);
  }
  if (p.state === 'collecting_place' && h) {
    if (h.phase === 'asking' && hasTaste(parseTaste(body))) return out('food_answer', true);
    if (h.phase === 'voting') {
      const id = placeRef(body, h.options);
      if (id !== undefined) return out('vote', true, { placeVote: id });
    }
  }
  const dateOpen = p.state === 'collecting_availability' || (p.state === 'collecting_place' && p.stack.includes('collecting_availability'));
  if (dateOpen) {
    const parsed = parseAvailability(body, p.options, tz, { now, addressed });
    if (parsed.matched && (addressed || parsed.voteLike)) return out('vote', false);
  }
  if ((p.state === 'confirmed' || p.state === 'reminded') && opts.from) {
    const chosen = p.options.find((o) => o.id === p.chosenOptionId);
    const m = p.members[opts.from];
    if (chosen && m && effectiveVote(m, chosen) === 'yes' && isVeto(body, chosen, p.activity, tz, now, addressed)) return out('veto', false);
  }
  if (p.state !== 'collecting_place' && foodTrigger(body, addressed, now, tz)) return out('food', true);
  if (addressed && planOrFood(body, now, tz) === 'plan') return out('plan', false);
  return out('chatter', semanticFood);
}
