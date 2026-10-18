// HOMI_LLM_FIRST=on (docs/PRIVACY.md §3): Claude reads every ADDRESSED message first, through the same repair router
// and the same redaction, except exact commands and availability replies the local parser already understands.
// Its rewrite wins whenever the engine gives it a real answer; otherwise the local result stands. Default: off, and
// the router is then only a repair for generic fallbacks (test/runner/repair.test.ts).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES as T } from '../../src/engine/templates.js';
import type { Action, EngineEvent } from '../../src/engine/types.js';
import type { RepairFn, RepairRequest } from '../../src/llm/router.js';
import { fakeEngine, makeEnv, makePlan, textIn, type FakeEngine } from './helpers.js';

const SPLIT = '$120.00 split 5 ways: $24.00 each.';

/** Knows the canonical split and a dumb "echo"; everything else is the generic fallback. */
function engine(): FakeEngine {
  const e = fakeEngine((_s, ev): Action[] => {
    if (ev.kind !== 'message') return [];
    if (/^homi split 120 5 ways$/i.test(ev.text)) return [{ type: 'send', text: SPLIT, prompting: 'prompted' }];
    if (/^homi echo /i.test(ev.text)) return [{ type: 'send', text: `ok: ${ev.text}`, prompting: 'prompted' }];
    // Like the real engine: unaddressed chatter gets silence, addressed unknowns get the generic fallback.
    if (!ev.addressed) return [];
    return [{ type: 'send', text: T.unknown(), prompting: 'prompted' }];
  });
  // The local reads the runner trusts without asking the model.
  e.stripAddress = (t: string) => t.replace(/^\s*@?homi[,:]?\s*/i, '').trim();
  e.parseCommand = (body: string) => (/^split \d+ \d+ ways$/i.test(body) ? { kind: 'split' } : null);
  return e;
}

function router(answer: (req: RepairRequest) => string | null) {
  const calls: RepairRequest[] = [];
  const repair: RepairFn = async (req) => {
    calls.push(req);
    const r = answer(req);
    return r === null ? null : { rewrite: r };
  };
  return { calls, repair };
}

const messages = (evs: EngineEvent[]) => evs.filter((e) => e.kind === 'message');

test('llmFirst: Claude reads an addressed message before the engine answers, and its command wins', async () => {
  const r = router(() => 'homi split 120 5 ways');
  const env = makeEnv({ engine: engine(), runnerDeps: { repairWithLlm: r.repair, llmFirst: true } });
  // Locally this would be a perfectly good (non-generic) "echo" answer; Claude-first still gets the say.
  await env.runner.handleInbound(textIn('g1', 'persona:ana', 'homi echo how much do we each owe for the 120'));
  const sends = env.adapter.sends();
  assert.ok(sends.includes(SPLIT), sends.join(' | '));
  assert.ok(!sends.some((s) => s.startsWith('ok: ')), 'the local answer was sent although Claude had a better one');
  assert.equal(r.calls.length, 1);
  assert.match(env.lines.join('\n'), /llm repair used: yes.*"mode":"first"/);
});

test('llmFirst: exact commands and open-poll votes skip the model; unaddressed chatter never reaches it', async () => {
  const r = router(() => 'homi echo should not happen');
  const env = makeEnv({ engine: engine(), runnerDeps: { repairWithLlm: r.repair, llmFirst: true } });
  await env.runner.handleInbound(textIn('g1', 'persona:ana', 'homi split 120 5 ways'));
  assert.equal(r.calls.length, 0);
  assert.ok(env.adapter.sends().includes(SPLIT));
  await env.runner.handleInbound(textIn('g1', 'persona:ben', 'lol who is paying'));
  assert.equal(r.calls.length, 0);
  await env.runner.handleInbound(textIn('g1', 'persona:ben', 'homi help'));
  assert.equal(r.calls.length, 0, '"homi help" is answered locally');
});

test('llmFirst: when Claude passes (null) or its rewrite is still generic, the local answer stands', async () => {
  for (const [answer, expectGeneric] of [
    [() => null, false],
    [() => 'homi what is this', false],
  ] as const) {
    const r = router(answer);
    const env = makeEnv({ engine: engine(), runnerDeps: { repairWithLlm: r.repair, llmFirst: true } });
    await env.runner.handleInbound(textIn('g1', 'persona:ana', 'homi echo hi there'));
    assert.equal(r.calls.length, 1);
    const sends = env.adapter.sends();
    assert.ok(sends.includes('ok: homi echo hi there'), sends.join(' | '));
    assert.equal(sends.includes(T.unknown()), expectGeneric);
  }
  // Truly unknown input still gets exactly one generic reply (never zero, never two).
  const r = router(() => null);
  const env = makeEnv({ engine: engine(), runnerDeps: { repairWithLlm: r.repair, llmFirst: true } });
  await env.runner.handleInbound(textIn('g1', 'persona:ana', 'homi qwerty'));
  assert.equal(env.adapter.sends().filter((s) => s === T.unknown()).length, 1);
  assert.equal(messages(env.engine.events).length, 1);
});

test('default (llmFirst off): a good local answer is never second-guessed', async () => {
  const r = router(() => 'homi split 120 5 ways');
  const env = makeEnv({ engine: engine(), runnerDeps: { repairWithLlm: r.repair } });
  await env.runner.handleInbound(textIn('g1', 'persona:ana', 'homi echo how much do we each owe for the 120'));
  assert.equal(r.calls.length, 0);
  assert.ok(env.adapter.sends().some((s) => s.startsWith('ok: ')));
});

test('llmFirst listens to unaddressed plan talk while a plan is open, but only acts on plan commands', async () => {
  const seen: string[] = [];
  const r = router((req) => {
    seen.push(req.text);
    return /uber/.test(req.text) ? 'homi split 120 5 ways' : 'homi echo wednesday works';
  });
  const planEngine = engine();
  const base = planEngine.applyEvent;
  planEngine.applyEvent = (s, ev, ctx) => {
    const out = base(s, ev, ctx);
    if (ev.kind === 'message' && ev.text === 'make plan') out.state.plan = makePlan(ctx.newId());
    return out;
  };
  const env = makeEnv({ engine: planEngine, runnerDeps: { repairWithLlm: r.repair, llmFirst: true } });
  // No plan yet: unaddressed chatter is never sent, even with day words.
  await env.runner.handleInbound(textIn('g1', 'persona:ana', 'wednesday would be better honestly'));
  assert.deepEqual(seen, []);
  await env.runner.handleInbound(textIn('g1', 'persona:ana', 'make plan'));
  // Plan open + plan talk: sent (redacted by the real router), rewrite accepted, answered.
  await env.runner.handleInbound(textIn('g1', 'persona:ben', 'i was thinking wednesday tbh'));
  assert.deepEqual(seen, ['i was thinking wednesday tbh']);
  assert.ok(env.adapter.sends().includes('ok: homi echo wednesday works'));
  assert.match(env.lines.join('\n'), /llm listen used: yes/);
  // Plan open but no plan talk: not sent.
  await env.runner.handleInbound(textIn('g1', 'persona:ben', 'lol who is paying'));
  assert.equal(seen.length, 1);
  // Plan talk whose rewrite is money: ignored (money is never acted on from an unaddressed message).
  await env.runner.handleInbound(textIn('g1', 'persona:jo', 'the uber works out to 120 for 5 tonight'));
  assert.equal(seen.length, 2);
  assert.ok(!env.adapter.sends().includes(SPLIT));
  assert.match(env.lines.join('\n'), /llm listen used: no.*not_plan_talk/);
});

test('llmFirst without a router is simply off', async () => {
  const env = makeEnv({ engine: engine(), runnerDeps: { llmFirst: true } });
  await env.runner.handleInbound(textIn('g1', 'persona:ana', 'homi echo hi'));
  assert.ok(env.adapter.sends().includes('ok: homi echo hi'));
});

test('simple profile: while the poll is open, any unaddressed message the engine ignored goes to Claude', async () => {
  const r = router(() => 'homi echo all work');
  const planEngine = engine();
  const base = planEngine.applyEvent;
  planEngine.applyEvent = (s, ev, ctx) => {
    const out = base(s, ev, ctx);
    if (ev.kind === 'message' && ev.text === 'make plan') out.state.plan = makePlan(ctx.newId());
    return out;
  };
  const env = makeEnv({ engine: planEngine, simple: true, runnerDeps: { repairWithLlm: r.repair, llmFirst: true } });
  await env.runner.handleInbound(textIn('g1', 'persona:ana', 'make plan'));
  await env.runner.handleInbound(textIn('g1', 'persona:ben', 'honestly whenever is fine by me'));
  assert.equal(r.calls.length, 1, 'no day/time words, but the poll is open and the demo listens to everything');
  assert.ok(env.adapter.sends().includes('ok: homi echo all work'));
});
