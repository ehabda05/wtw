// The gated hosted-LLM availability fallback (docs/PRIVACY.md §3) runs only for addressed messages that the local
// parser could not read. Commands such as "homi go" or "homi status" are never availability replies, even when they
// do not apply in the current plan state: live in a Telegram group (2026-10-17) the LLM read "homi go" as "every
// option works" and the tally jumped to Thu 1 · Fri 1 · Sat 1.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAvailability, parseCommand, stripAddress } from '../../src/engine/index.js';
import type { EngineEvent, Option } from '../../src/engine/types.js';
import { fakeEngine, makeEnv, makePlan, textIn } from './helpers.js';

const OPTIONS: Option[] = [
  { id: 1, startsAt: Date.UTC(2026, 9, 22, 23), day: '2026-10-22', time: '19:00', label: 'Thu Oct 22 · 7pm' },
  { id: 2, startsAt: Date.UTC(2026, 9, 23, 23), day: '2026-10-23', time: '19:00', label: 'Fri Oct 23 · 7pm' },
  { id: 3, startsAt: Date.UTC(2026, 9, 24, 23), day: '2026-10-24', time: '19:00', label: 'Sat Oct 24 · 7pm' },
];

function envWithOpenPoll(llmCalls: string[]) {
  const engine = fakeEngine((s, ev, ctx) => {
    if (ev.kind === 'message' && ev.text === 'make plan') s.plan = makePlan(ctx.newId(), { options: OPTIONS });
  });
  // The real parsers decide whether the fallback is needed; the fake engine only records events.
  engine.parseAvailability = parseAvailability;
  engine.parseCommand = parseCommand;
  engine.stripAddress = stripAddress;
  const env = makeEnv({
    engine,
    runnerDeps: {
      hostedLlm: async (text) => {
        llmCalls.push(text);
        return { optionIds: [1, 2, 3], vote: 'yes' };
      },
    },
  });
  return env;
}

const lastMessage = (events: EngineEvent[]) => events.filter((e) => e.kind === 'message').at(-1) as Extract<EngineEvent, { kind: 'message' }>;

test('LLM availability fallback: commands are skipped, unparsed replies still go through', async () => {
  const llmCalls: string[] = [];
  const env = envWithOpenPoll(llmCalls);
  await env.runner.handleInbound(textIn('g1', 'persona:ana', 'make plan'));

  // Local parser wins: no LLM call, no llmVote.
  await env.runner.handleInbound(textIn('g1', 'persona:ana', 'homi fri works'));
  assert.deepEqual(llmCalls, []);
  assert.equal(lastMessage(env.engine.events).llmVote, undefined);

  // Commands (even ones that do not apply yet) never reach the LLM.
  for (const text of ['homi go', 'homi status', 'homi split 84 3 ways', 'homi where are we at', '/go@wtw_homi_bot']) {
    await env.runner.handleInbound(textIn('g1', 'persona:ben', text));
    assert.deepEqual(llmCalls, [], `${text} must not be sent to the LLM`);
    assert.equal(lastMessage(env.engine.events).llmVote, undefined, `${text} must not carry an llmVote`);
  }

  // A free-form reply the local parser cannot read still uses the fallback.
  await env.runner.handleInbound(textIn('g1', 'persona:jo', 'homi depends on when my sister lands'));
  assert.equal(llmCalls.length, 1);
  assert.deepEqual(lastMessage(env.engine.events).llmVote, { optionIds: [1, 2, 3], vote: 'yes' });

  // Unaddressed chatter never reaches the LLM.
  await env.runner.handleInbound(textIn('g1', 'persona:jo', 'lol go team'));
  assert.equal(llmCalls.length, 1);
});
