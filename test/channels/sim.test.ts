import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PERSONAS, SimHub } from '../../src/channels/sim.js';
import { CAPS, type ChannelInbound } from '../../src/channels/types.js';
import { fakeEngine, makeEnv, makePlan } from '../runner/helpers.js';

test('SimHub implements the adapter contract with sim caps and sim-<n> refs', async () => {
  let t = 1000;
  const hub = new SimHub({ now: () => t });
  const inbound: ChannelInbound[] = [];
  await hub.start(async (m) => void inbound.push(m));
  assert.equal(hub.surface, 'sim');
  assert.deepEqual(hub.caps, CAPS.sim);
  const space = hub.createSpace();
  assert.deepEqual(space.personas, [...DEFAULT_PERSONAS]);
  const r1 = await hub.send(space.id, 'hello');
  const r2 = await hub.reply(space.id, 'u-1', 'reply');
  t = 2000;
  await hub.edit(space.id, r1!, 'hello (edited)');
  await hub.react(space.id, 'u-1', '👍');
  const r3 = await hub.dm('persona:sam', 'psst');
  const r4 = await hub.file(space.id, 'plan.ics', 'text/calendar', 'BEGIN:VCALENDAR', 'Add it');
  await hub.leave(space.id);
  assert.deepEqual([r1, r2, r3, r4], ['sim-1', 'sim-2', 'sim-3', 'sim-4']);
  assert.deepEqual(hub.transcript.map((e) => e.kind), ['send', 'reply', 'edit', 'react', 'dm', 'file', 'leave']);
  assert.equal(hub.entry('sim-1')?.text, 'hello (edited)');
  assert.equal(hub.transcript[4].to, 'sam');
  assert.equal(hub.transcript[2].at, 2000);
  assert.ok(space.left);
  assert.equal(hub.lastOttoMessage(space.id)?.ref, 'sim-4');
});

test('personas speak, react and send roster snapshots as ChannelInbound', async () => {
  const hub = new SimHub({ now: () => 5 });
  const inbound: ChannelInbound[] = [];
  await hub.start(async (m) => void inbound.push(m));
  const s = hub.createSpace(['ana', 'ben']);
  const ref = await hub.say(s.id, 'ana', 'otto dinner?', { replyTo: 'sim-1' });
  await hub.react(s.id, 'ben', '❤️', 'sim-2'); // 4-arg overload = persona reaction
  await hub.members(s.id);
  await hub.addedToGroup(s.id);
  assert.equal(ref, 'u-1');
  assert.deepEqual(inbound.map((m) => m.kind), ['text', 'reaction', 'members', 'added_to_group']);
  assert.deepEqual(inbound[0].from, { handle: 'persona:ana', platformName: 'Ana' });
  assert.equal(inbound[0].replyTo, 'sim-1');
  assert.deepEqual(inbound[1].reaction, { emoji: '❤️', target: 'sim-2' });
  assert.deepEqual(inbound[2].members?.map((u) => u.handle), ['persona:ana', 'persona:ben']);
  assert.ok(inbound.every((m) => m.surface === 'sim' && m.spaceId === s.id && m.isGroup));
  assert.deepEqual(hub.transcript.map((e) => [e.from, e.kind]), [['ana', 'reply'], ['ben', 'react']]);
});

test('end to end through the runner: intro, tagged option bubbles, tapback vote, transcript tags', async () => {
  const engine = fakeEngine((s, ev, ctx) => {
    if (ev.kind === 'message' && /dinner/.test(ev.text) && !s.plan) {
      s.plan = makePlan(ctx.newId());
      return [
        { type: 'send', text: 'When works? Tap a time.', prompting: 'prompted', tag: 'header' },
        { type: 'send', text: 'Thu 7pm', prompting: 'prompted', tag: 'option:1' },
        { type: 'send', text: 'Fri 7pm', prompting: 'prompted', tag: 'option:2' },
      ];
    }
    if (ev.kind === 'sent' && s.plan) {
      const m = /^option:(\d+)$/.exec(ev.tag);
      if (m) s.plan.refs.options[Number(m[1])] = ev.msgRef;
    }
    if (ev.kind === 'reaction' && s.plan) {
      const opt = Object.entries(s.plan.refs.options).find(([, ref]) => ref === ev.target)?.[0];
      if (opt) return [{ type: 'react', to: ev.target, emoji: '👀' }];
    }
  });
  const env = makeEnv({ engine });
  const hub = new SimHub({ now: () => env.clock.now() });
  env.runner.addAdapter(hub);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const runner = env.runner;
  await hub.start((m) => runner.handleInbound(m));
  const s = hub.createSpace();
  await hub.say(s.id, 'ana', 'otto dinner next week?');
  const otto = hub.ottoMessages(s.id);
  assert.deepEqual(otto.map((e) => e.ref), ['sim-1', 'sim-2', 'sim-3', 'sim-4']);
  const plan = env.repo.loadGroup(env.ids.space('sim', s.id))?.plan;
  assert.equal(plan?.refs.options[2], 'sim-4');
  await hub.reactAs(s.id, 'ben', '❤️', plan!.refs.options[2]);
  assert.equal(hub.transcript.at(-1)?.kind, 'react');
  assert.equal(hub.transcript.at(-1)?.from, 'otto');
});
