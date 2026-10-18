// npm run llm:check: one-minute check that the optional Claude fallback works with the key in .env.
// Sends three made-up messages (no real names or numbers) through the same redacted router the app uses and
// prints what each became and how long it took. Costs a fraction of a cent. Never prints the key.

import { routerFromEnv } from '../llm/router.js';
import { LLM_MODEL } from '../llm/redacted.js';

const CONTEXT = {
  planState: 'collecting_availability',
  options: ['Thu Oct 22, 7pm', 'Fri Oct 23, 7pm', 'Sat Oct 24, 7pm'],
  members: 5,
  openFlows: [] as string[],
};

const SAMPLES = [
  "homi wait who's actually coming so far",
  'homi can u break down the 84 dollar uber between the 3 of us',
  'homi honestly whatever day most people can do is fine by me',
];

async function main(): Promise<void> {
  const setup = routerFromEnv();
  console.log(setup.note);
  if (!setup.repair) {
    console.log('Set HOMI_LLM=on and ANTHROPIC_API_KEY=... in .env, then run this again.');
    process.exitCode = 1;
    return;
  }
  console.log(`model: ${process.env.HOMI_LLM_MODEL?.trim() || LLM_MODEL}`);
  console.log('(the first call also loads the Claude library; Homi does that at startup)');
  let ok = 0;
  for (const text of SAMPLES) {
    const t0 = Date.now();
    const r = await setup.repair({ text, knownNames: [], context: CONTEXT }, AbortSignal.timeout(15000));
    const ms = Date.now() - t0;
    if (r) ok++;
    console.log(`${r ? '✓' : '✗'} ${String(ms).padStart(5)} ms  "${text}" → ${r ? `"${r.rewrite}"` : 'no answer (error, timeout, refusal or no fitting command)'}`);
  }
  console.log(ok ? `Claude fallback works (${ok}/${SAMPLES.length} rewritten). Homi uses it only when its rules don't understand.` : 'No rewrites: check the key, your API credit, and your network.');
  if (!ok) process.exitCode = 1;
}

void main();
