import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES as T } from '../../src/engine/templates.js';
import type { Action, EngineEvent } from '../../src/engine/types.js';
import { buildRepairPrompt, type RepairFn, type RepairRequest } from '../../src/llm/router.js';
import { loadEngine } from '../../src/runner/services.js';
import { fakeEngine, makeEnv, textIn, type FakeEngine } from './helpers.js';

const SPLIT = '$120.00 split 5 ways: $24.00 each.';

/** Understands only the canonical split; any other message gets the generic fallback (addressed or not). */
function billsEngine(): FakeEngine {
  return fakeEngine((_s, ev): Action[] => {
    if (ev.kind !== 'message') return [];
    if (/^homi split 120 5 ways$/i.test(ev.text)) return [{ type: 'send', text: SPLIT, prompting: 'prompted' }];
    if (/^homi echo /i.test(ev.text)) return [{ type: 'send', text: `ok: ${ev.text}`, prompting: 'prompted' }];
    return [{ type: 'send', text: T.unknown(), prompting: 'prompted' }];
  });
}

function fakeRouter(answer: (req: RepairRequest) => string | null | Promise<string | null>) {
  const calls: RepairRequest[] = [];
  const repair: RepairFn = async (req) => {
    calls.push(req);
    const r = await answer(req);
    return r === null ? null : { rewrite: r };
  };
  return { calls, repair };
}

const messages = (evs: EngineEvent[]) => evs.filter((e) => e.kind === 'message');

test('an addressed message that only got a generic fallback is repaired once; the generic reply is never sent', async () => {
  const router = fakeRouter(() => 'homi split 120 5 ways');
  const env = makeEnv({ engine: billsEngine(), runnerDeps: { repairWithLlm: router.repair } });
  await env.runner.handleInbound(textIn('g1', 'persona:ana', 'homi how much do we each owe, it was 120'));
  const sends = env.adapter.sends();
  assert.ok(sends.includes(SPLIT), sends.join(' | '));
  assert.ok(!sends.includes(T.unknown()));
  assert.equal(router.calls.length, 1);
  assert.equal(router.calls[0].text, 'homi how much do we each owe, it was 120');
  assert.ok(router.calls[0].knownNames.includes('ana'));
  // Both runs saw the same msgRef; the second run started from the pre-event state (intro sent once).
  const evs = messages(env.engine.events) as Extract<EngineEvent, { kind: 'message' }>[];
  assert.equal(evs.length, 2);
  assert.equal(evs[0].msgRef, evs[1].msgRef);
  assert.equal(evs[1].text, 'homi split 120 5 ways');
  assert.equal(sends.filter((s) => s.startsWith("Hi, I'm Homi")).length, 1);
  // Logs carry only "used: yes", never the text.
  const log = env.lines.join('\n');
  assert.match(log, /llm repair used: yes/);
  assert.ok(!/owe|split 120/.test(log), 'message text leaked into logs');
});

test('unaddressed chatter never reaches the router, even when the engine would answer generically', async () => {
  const router = fakeRouter(() => 'homi split 120 5 ways');
  const env = makeEnv({ engine: billsEngine(), runnerDeps: { repairWithLlm: router.repair } });
  await env.runner.handleInbound(textIn('g1', 'persona:ana', 'how much do we each owe, it was 120'));
  assert.equal(router.calls.length, 0);
  assert.ok(env.adapter.sends().includes(T.unknown()));
});

test('one repair max: a rewrite that is still generic keeps the original reply', async () => {
  const router = fakeRouter(() => 'homi what is this');
  const env = makeEnv({ engine: billsEngine(), runnerDeps: { repairWithLlm: router.repair } });
  await env.runner.handleInbound(textIn('g1', 'persona:ana', 'homi qwerty'));
  assert.equal(router.calls.length, 1);
  assert.equal(messages(env.engine.events).length, 2);
  assert.deepEqual(env.adapter.sends().filter((s) => s === T.unknown()).length, 1);
  assert.match(env.lines.join('\n'), /llm repair used: no.*still_generic/);
});

test('timeout, errors and null answers keep the original reply', async () => {
  let aborted = false;
  const slow: RepairFn = (_req, signal) =>
    new Promise((resolve) => signal?.addEventListener('abort', () => ((aborted = true), resolve({ rewrite: 'homi split 120 5 ways' }))));
  for (const repair of [slow, fakeRouter(() => null).repair, fakeRouter(() => Promise.reject(new Error('boom'))).repair]) {
    const env = makeEnv({ engine: billsEngine(), runnerDeps: { repairWithLlm: repair, repairTimeoutMs: 30 } });
    await env.runner.handleInbound(textIn('g1', 'persona:ana', 'homi how much do we each owe, it was 120'));
    const sends = env.adapter.sends();
    assert.ok(sends.includes(T.unknown()));
    assert.ok(!sends.includes(SPLIT));
  }
  assert.ok(aborted, 'the timed-out call was aborted');
});

test('no repair without a router (no key), for good answers, or for an explicit "homi help"', async () => {
  const off = makeEnv({ engine: billsEngine() });
  await off.runner.handleInbound(textIn('g1', 'persona:ana', 'homi how much do we each owe, it was 120'));
  assert.equal(messages(off.engine.events).length, 1);
  assert.ok(off.adapter.sends().includes(T.unknown()));

  const router = fakeRouter(() => 'homi split 120 5 ways');
  const env = makeEnv({ engine: billsEngine(), runnerDeps: { repairWithLlm: router.repair } });
  await env.runner.handleInbound(textIn('g1', 'persona:ana', 'homi split 120 5 ways'));
  await env.runner.handleInbound(textIn('g1', 'persona:ana', 'homi help'));
  assert.equal(router.calls.length, 0);
});

test('[name] placeholders in the rewrite are restored from the original text', async () => {
  const router = fakeRouter((req) => {
    assert.ok(req.knownNames.includes('Jo') && req.knownNames.includes('Ana'), 'extra names are passed for redaction');
    // What a model would see, and answer with the snippet's own placeholders.
    const snippet = buildRepairPrompt(req).redacted;
    const m = /^homi (\[name\d\]) got the uber 23\.40, split w (\[name\d\]) and me$/.exec(snippet);
    assert.ok(m, snippet);
    return `homi echo ${m[1]} paid 23.40, split ${m[2]} ${m[1]} me`;
  });
  const env = makeEnv({ engine: billsEngine(), runnerDeps: { repairWithLlm: router.repair, extraNames: ['Jo', 'Ana'] } });
  await env.runner.handleInbound(textIn('g1', 'persona:you', 'homi jo got the uber 23.40, split w ana and me'));
  const sends = env.adapter.sends();
  assert.ok(sends.includes('ok: homi echo jo paid 23.40, split ana jo me'), sends.join(' | '));
});

test('real engine: a message it cannot parse becomes the bills reply via the (fake) router', async () => {
  const generics = [T.unknown(), T.help(), T.alreadyPlan()];
  const real = await loadEngine();
  for (const text of ['homi blorp glorp the frobnicator', 'homi how much do we each owe, it was 120']) {
    const router = fakeRouter(() => 'homi split 120 5 ways');
    const env = makeEnv({ engine: { ...real, events: [], ctxs: [] }, runnerDeps: { repairWithLlm: router.repair } });
    await env.runner.handleInbound(textIn('g1', 'persona:ana', text));
    const sends = env.adapter.sends();
    for (const g of generics) assert.ok(!sends.includes(g), `generic reply sent for "${text}"`);
    assert.ok(router.calls.length <= 1);
    // The engine may learn the second phrasing natively; when it doesn't, the repair must have produced the split.
    if (router.calls.length === 1) assert.ok(sends.some((s) => /\$120(\.00)? split 5 ways/.test(s)), sends.join(' | '));
    if (text.includes('blorp')) assert.equal(router.calls.length, 1);
  }
});

test('silence and a stray note lookup also count as "Homi did not understand"', async () => {
  const { onlyGenericFallback } = await import('../../src/runner/repair.js');
  const pre = { plan: undefined, space: {} } as never;
  const send = (text: string): Action => ({ type: 'send', text } as Action);
  // Nothing at all for someone who addressed Homi.
  assert.equal(onlyGenericFallback([], pre), true);
  assert.equal(onlyGenericFallback([{ type: 'schedule' } as Action], pre), true);
  // "whats the damage per person" fell into the note lookup.
  assert.equal(onlyGenericFallback([send(T.noteMissing({ key: 'damage per person' }))], pre), true);
  // A real answer, a reaction or a lookup is not repaired.
  assert.equal(onlyGenericFallback([send(T.noteFound({ key: 'parking', value: 'behind the building' }))], pre), false);
  assert.equal(onlyGenericFallback([{ type: 'react', msgRef: 'm1', emoji: '👍' } as unknown as Action], pre), false);
  assert.equal(onlyGenericFallback([send('Dinner $120.00 split 5 ways: $24.00 each.')], pre), false);
});

test('"no plan yet" replies also go to the repair router', async () => {
  const { onlyGenericFallback } = await import('../../src/runner/repair.js');
  const pre = { plan: undefined, space: {} } as never;
  assert.equal(onlyGenericFallback([{ type: 'send', text: T.needPlan() } as Action], pre), true);
  assert.equal(onlyGenericFallback([{ type: 'send', text: T.statusNone() } as Action], pre), true);
});
