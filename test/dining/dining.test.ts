// Dining agent: exact split math, memory, and the runner's batching/silence/notes behavior with a fake Claude.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SimHub } from '../../src/channels/sim.js';
import { DiningAgent, buildUserContent, type Client } from '../../src/dining/agent.js';
import { DiningMemory } from '../../src/dining/memory.js';
import { DiningRunner } from '../../src/dining/runner.js';
import { splitBill } from '../../src/dining/split.js';

test('split_bill: itemized with shared items, tax and tip add up to the cent', () => {
  const r = splitBill({
    people: ['Ana', 'Ben', 'Sam'],
    items: [
      { name: 'ramen', price: 16.5, shared_by: ['Ana'] },
      { name: 'spicy miso', price: 17.5, shared_by: ['Ben'] },
      { name: 'katsu', price: 19, shared_by: ['Sam'] },
      { name: 'edamame', price: 6, shared_by: [] },
      { name: 'gyoza', price: 8, shared_by: ['Ana', 'Ben'] },
    ],
    tax: { percent: 7 },
    tip: { percent: 20 },
    paid_by: 'Ben',
  });
  assert.equal(r.subtotal, '$67.00');
  assert.equal(r.total, '$85.09');
  const sum = Object.values(r.shares).reduce((a, s) => a + Math.round(Number(s.slice(1)) * 100), 0);
  assert.equal(sum, 8509);
  assert.equal(r.transfers.length, 2);
  assert.ok(r.transfers.every((t) => t.includes('pays Ben')));
});

test('split_bill: even split of a plain total', () => {
  const r = splitBill({ people: ['a', 'b', 'c', 'd'], total: 86.4, tip: { percent: 18 } });
  assert.equal(r.total, '$101.95');
  assert.deepEqual(Object.values(r.shares).sort(), ['$25.48', '$25.49', '$25.49', '$25.49']);
});

test('memory: transcript, images, notes, follow-ups, forget', () => {
  const m = new DiningMemory();
  const key = 'sim|g1';
  m.chat(key, 'sim', true);
  const id1 = m.addMessage({ spaceId: key, at: 1, sender: 'Ana', role: 'user', text: 'hi', msgId: 'u-1', hasImage: false });
  const id2 = m.addMessage({ spaceId: key, at: 2, sender: 'Ben', role: 'user', text: 'receipt', msgId: 'u-2', hasImage: true }, { mime: 'image/png', bytes: new Uint8Array([1, 2, 3]) });
  assert.deepEqual(m.recent(key).map((x) => x.id), [id1, id2]);
  assert.equal(m.images(key, [id2])[0].bytes.length, 3);
  assert.equal(m.since(key, id1).length, 1);
  m.setNotes(key, 'Plan: Friday');
  m.setFollowUp(key, 100, 'nudge jo');
  assert.equal(m.dueFollowUps(99).length, 0);
  assert.equal(m.dueFollowUps(100)[0].followUpNote, 'nudge jo');
  assert.equal(m.chat(key).notes, 'Plan: Friday');
  assert.ok(m.firstTime('x', 1) && !m.firstTime('x', 2));
  m.forget(key);
  assert.equal(m.recent(key).length, 0);
  assert.equal(m.chat(key).notes, '');
  m.close();
});

/** A fake Claude: scripted tool calls then a final text. */
function fakeClient(script: (msgs: unknown[]) => { text?: string; tools?: { name: string; input: unknown }[] }): Client & { calls: number } {
  const c = {
    calls: 0,
    beta: {
      messages: {
        create: async (params: { messages: unknown[] }) => {
          if (params.messages.length === 1) c.calls++; // agent runs, not tool-loop round trips
          const last = params.messages[params.messages.length - 1] as { role: string; content: unknown };
          const afterTools = last.role === 'user' && Array.isArray(last.content) && (last.content as { type: string }[]).every((b) => b.type === 'tool_result');
          const step = afterTools ? { text: script(params.messages).text } : script(params.messages);
          const content: unknown[] = [];
          if (step.text) content.push({ type: 'text', text: step.text });
          for (const [i, t] of (afterTools ? [] : step.tools ?? []).entries()) content.push({ type: 'tool_use', id: `t${i}`, name: t.name, input: t.input });
          return { stop_reason: afterTools || !step.tools?.length ? 'end_turn' : 'tool_use', content };
        },
      },
    },
  };
  return c as unknown as Client & { calls: number };
}

test('runner: a burst of messages becomes one agent call; silence and notes are honored', async () => {
  const seen: string[] = [];
  const client = fakeClient((msgs) => {
    const first = (msgs[0] as { content: { type: string; text?: string }[] }).content.map((b) => b.text ?? '').join('\n');
    if (msgs.length === 1) seen.push(first);
    if (first.includes('NEW MESSAGES') && first.includes('lol')) return { tools: [{ name: 'stay_silent', input: { reason: 'banter' } }, { name: 'react', input: { emoji: '👍' } }] };
    return { text: 'Friday 7:30 at Santouka? 👍 if in', tools: [{ name: 'save_notes', input: { notes: 'Plan: Fri 7:30 Santouka' } }] };
  });
  const memory = new DiningMemory();
  const agent = new DiningAgent({ apiKey: 'k' }, client);
  const runner = new DiningRunner({ agent, memory, debounceMs: 30, addressedDebounceMs: 10 });
  const hub = new SimHub();
  runner.addAdapter(hub);
  await hub.start((m) => runner.handleInbound(m));
  const space = hub.createSpace().id;

  await hub.say(space, 'ana', 'dinner this week?');
  await hub.say(space, 'ben', 'yes pls, ramen');
  await hub.say(space, 'sam', 'homi find us a spot friday');
  await runner.whenIdle();
  assert.equal(client.calls, 1, 'one call for the burst');
  assert.ok(seen[0].includes('Ana: dinner this week?') && seen[0].includes('Sam: homi find us a spot friday'));
  const homi = hub.transcript.filter((e) => e.from === 'homi' && e.kind === 'send');
  assert.equal(homi.length, 1);
  assert.equal(homi[0].text, 'Friday 7:30 at Santouka? 👍 if in');
  assert.equal(memory.chat(`sim|${space}`).notes, 'Plan: Fri 7:30 Santouka');

  await hub.say(space, 'jo', 'lol');
  await runner.whenIdle();
  assert.equal(client.calls, 2);
  assert.equal(hub.transcript.filter((e) => e.from === 'homi' && e.kind === 'send').length, 1, 'stayed silent');
  assert.equal(hub.transcript.filter((e) => e.from === 'homi' && e.kind === 'react').length, 1, 'reacted instead');
  // The second call saw the first exchange as history and the notes.
  assert.ok(seen[1].includes('Plan: Fri 7:30 Santouka') && seen[1].includes('YOU: Friday 7:30 at Santouka'));
  runner.stop();
  memory.close();
});

test('buildUserContent attaches photos to their messages', () => {
  const blocks = buildUserContent(
    {
      surface: 'sim', isGroup: true, notes: '', history: [], now: 0,
      fresh: [{ id: 5, spaceId: 'x', at: 0, sender: 'Ben', role: 'user', text: 'split this', hasImage: true }],
      images: [{ msgId: 5, mime: 'image/png', bytes: new Uint8Array([1]), at: 0 }],
    },
    'UTC',
  );
  assert.equal(blocks.filter((b) => b.type === 'image').length, 1);
  assert.ok(blocks.some((b) => b.type === 'text' && b.text.includes('Ben: split this [photo attached]')));
});

test('silence gate: banter in a group never reaches the model; a food question does', async () => {
  const client = fakeClient(() => ({ tools: [{ name: 'stay_silent', input: { reason: 'x' } }] }));
  const memory = new DiningMemory();
  const runner = new DiningRunner({ agent: new DiningAgent({ apiKey: 'k' }, client), memory, debounceMs: 10, addressedDebounceMs: 5, openWindowMs: 0 });
  const hub = new SimHub();
  runner.addAdapter(hub);
  await hub.start((m) => runner.handleInbound(m));
  const space = hub.createSpace().id;
  await hub.say(space, 'ana', 'lmaooo did you see that');
  await hub.say(space, 'ben', 'bro no way 💀');
  await runner.whenIdle();
  assert.equal(client.calls, 0, 'banter is remembered but the model is not consulted');
  assert.equal(memory.recent(`sim|${space}`).length, 2);
  await hub.say(space, 'sam', 'ok but where are we eating friday');
  await runner.whenIdle();
  assert.equal(client.calls, 1);
  runner.stop();
  memory.close();
});
