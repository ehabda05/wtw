// Plan intent vs food intent (HUNGRY_FLOW.md §1). Rules first; the naive-Bayes model is the second stage for
// unaddressed food triggers only.

import { foodScore } from './hungry.js';
import { FOOD_THRESHOLD, pFood } from './classifier.js';
import { detectActivity, hasPlanWords, parseWindow } from './parse.js';
import { isoDay } from './util.js';

/**
 * For an addressed message: 'plan' when it names a future window or plan words ("dinner next week?"),
 * 'food' when it has food points and no window ("where should we eat", "dinner?"), else null.
 * "tonight" with a strong food signal ("where should we eat tonight") is food: the plan is now.
 */
export function planOrFood(body: string, now: number, tz: string): 'plan' | 'food' | null {
  if (/^\s*\/plan\b/i.test(body)) return 'plan';
  const fs = foodScore(body);
  const win = parseWindow(body, now, tz);
  const planWords = hasPlanWords(body);
  if (fs.idiom) return planWords || win ? 'plan' : null;
  // Money talk without a window ("how much does everyone owe for dinner") is a bill question, not a plan.
  if (fs.money && !win) return null;
  const todayOnly = !!win && win.single && !win.explicit && win.days[0] === isoDay(now, tz);
  if (win && !(todayOnly && fs.strong)) return 'plan';
  if (fs.score >= 1 && !planWords) return 'food';
  if (detectActivity(body).named || planWords) return 'plan';
  return null;
}

/** Addressed: >= 1 point, no idiom, no future window. Unaddressed: >= 2 points, no idiom, and P(food) >= 0.6. */
export function foodTrigger(body: string, addressed: boolean, now: number, tz: string): boolean {
  const fs = foodScore(body);
  if (addressed) return fs.score >= 1 && planOrFood(body, now, tz) === 'food';
  return fs.score >= 2 && pFood(body) >= FOOD_THRESHOLD;
}
