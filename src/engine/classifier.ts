// The "small local model" (PRIVACY.md §3 stage 2): a multinomial naive-Bayes intent classifier over unigrams
// and bigrams, trained once at module load from classifier-data.ts. Deterministic, a few KB of counts, no
// network. Used as the second-stage check for UNADDRESSED food triggers (HUNGRY_FLOW.md §1 rule 2).

import { TRAINING, type IntentClass } from './classifier-data.js';
import { normText } from './util.js';

const CLASSES: IntentClass[] = ['food', 'plan', 'chatter'];

export function tokenize(text: string): string[] {
  const words = normText(text)
    .replace(/[^a-z0-9'?\s]/g, ' ')
    .replace(/\?/g, ' ? ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.replace(/^'+|'+$/g, '').replace(/'/g, ''));
  const out = [...words];
  for (let i = 0; i + 1 < words.length; i++) out.push(`${words[i]}_${words[i + 1]}`);
  return out;
}

interface Model {
  counts: Record<IntentClass, Map<string, number>>;
  totals: Record<IntentClass, number>;
  vocab: Set<string>;
}

function train(data: Array<[IntentClass, string]>): Model {
  const counts = { food: new Map(), plan: new Map(), chatter: new Map() } as Record<IntentClass, Map<string, number>>;
  const totals = { food: 0, plan: 0, chatter: 0 } as Record<IntentClass, number>;
  const vocab = new Set<string>();
  for (const [cls, text] of data) {
    for (const tok of tokenize(text)) {
      counts[cls].set(tok, (counts[cls].get(tok) ?? 0) + 1);
      totals[cls]++;
      vocab.add(tok);
    }
  }
  return { counts, totals, vocab };
}

const MODEL = train(TRAINING);

/** Class probabilities (uniform priors, Laplace smoothing). Unknown tokens are skipped. */
export function predict(text: string): Record<IntentClass, number> {
  const toks = tokenize(text).filter((t) => MODEL.vocab.has(t));
  const V = MODEL.vocab.size;
  const logp: Record<IntentClass, number> = { food: 0, plan: 0, chatter: 0 };
  for (const c of CLASSES) {
    for (const t of toks) logp[c] += Math.log(((MODEL.counts[c].get(t) ?? 0) + 1) / (MODEL.totals[c] + V));
  }
  const max = Math.max(...CLASSES.map((c) => logp[c]));
  const exp = CLASSES.map((c) => Math.exp(logp[c] - max));
  const z = exp.reduce((a, b) => a + b, 0);
  return { food: exp[0] / z, plan: exp[1] / z, chatter: exp[2] / z };
}

/** P(food) for the unaddressed trigger gate (threshold 0.6). */
export function pFood(text: string): number {
  return predict(text).food;
}

export const FOOD_THRESHOLD = 0.6;
