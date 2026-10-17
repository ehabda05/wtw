import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAPS } from '../../src/channels/types.js';
import type { Action, EngineEvent } from '../../src/engine/types.js';
import { MockVoice } from '../../src/runner/mocks.js';
import { Runner } from '../../src/runner/runner.js';
import type { PlacesService } from '../../src/runner/services.js';
import { INTRO, RecordingAdapter, fakeEngine, makeEnv, makePlan, textIn } from './helpers.js';

const kinds = (evs: EngineEvent[]) => evs.filter((e) => e.kind !== 'sent').map((e) => e.kind);
const nonSent = (evs: EngineEvent[]) => evs.filter((e) => e.kind !== 'sent');

test('dedupe: the same platform message id is processed once', async () => {
  const env = makeEnv();
  const m = textIn('g1', 'persona:ana', 'hello');
  await env.runner.handleInbound(m);
  await env.runner.handleInbound({ ...m });
  await env.runner.handleInbound({ ...m, text: 'replayed after reconnect' });
  assert.deepEqual(kinds(env.engine.events), ['message']);
  assert.equal(env.repo.counts().seen, 1);
  // same msgId in another space is a different message
  await env.runner.handleInbound({ ...m, spaceId: 'g2' });
  assert.equal(nonSent(env.engine.events).length, 2);
});

test('intro is sent exactly once per space (first sight), state persists between events', async () => {
  const env = makeEnv();
  for (const t of ['hi all', 'homi dinner?', 'whatever']) await env.runner.handleInbound(textIn('g1', 'persona:ana', t));
  assert.deepEqual(env.adapter.sends(), [INTRO]);
  await env.runner.handleInbound(textIn('g2', 'persona:ana', 'hi'));
  assert.deepEqual(env.adapter.sends(), [INTRO, INTRO]);
  assert.equal(env.repo.loadGroup(env.ids.space('sim', 'g1'))?.space.introSent, true);
});

test('muted (tombstoned) spaces are dropped silently', async () => {
  const env = makeEnv();
  env.repo.tombstone(env.ids.space('sim', 'g1'), 'sim');
  await env.runner.handleInbound(textIn('g1', 'persona:ana', 'homi hello?'));
  assert.equal(env.engine.events.length, 0);
  assert.equal(env.adapter.calls.length, 0);
});

test('addressed: platform mention, detectAddressed, or a reply to a Homi message (LRU or plan.refs)', async () => {
  const engine = fakeEngine((s, ev, ctx) => {
    if (ev.kind === 'message' && ev.text === 'make plan') {
      s.plan = makePlan(ctx.newId(), { refs: { options: { 2: 'opt-ref-2' }, placeOptions: {} } });
    }
  });
  const env = makeEnv({ engine });
  const lastMsg = () => env.engine.events.filter((e) => e.kind === 'message').at(-1) as { addressed: boolean; replyTo?: string };
  const addressedOf = () => lastMsg().addressed;
  await env.runner.handleInbound(textIn('g1', 'persona:ana', 'hey', { mentionsAgent: true }));
  assert.equal(addressedOf(), true);
  await env.runner.handleInbound(textIn('g1', 'persona:ana', 'homi when?'));
  assert.equal(addressedOf(), true);
  await env.runner.handleInbound(textIn('g1', 'persona:ana', 'lol'));
  assert.equal(addressedOf(), false);
  assert.equal(env.adapter.sends()[0], INTRO); // Homi's first message got ref r-1
  await env.runner.handleInbound(textIn('g1', 'persona:ben', 'works for me', { replyTo: 'r-1' })); // r-1 = the intro Homi sent
  assert.equal(addressedOf(), true);
  await env.runner.handleInbound(textIn('g1', 'persona:ben', 'nah', { replyTo: 'someone-elses-msg' }));
  assert.equal(addressedOf(), false);
  await env.runner.handleInbound(textIn('g1', 'persona:ben', 'make plan'));
  // a fresh runner (empty LRU, e.g. after restart) still recognizes refs stored on the plan
  const runner2 = new Runner({ engine, repo: env.repo, ids: env.ids, clock: env.clock, config: { retentionHours: 24, quietHours: [23, 9], defaultTz: 'UTC' }, adapters: [env.adapter] });
  await runner2.handleInbound(textIn('g1', 'persona:jo', 'this one', { replyTo: 'opt-ref-2' }));
  assert.equal(addressedOf(), true);
  assert.equal(lastMsg().replyTo, 'opt-ref-2');
});

test('inbound kinds map to engine events with hashed member refs only', async () => {
  const env = makeEnv();
  const base = { surface: 'sim' as const, spaceId: 'g1', isGroup: true, mentionsAgent: false, at: 0 };
  await env.runner.handleInbound({ ...base, kind: 'added_to_group', msgId: 'a1' });
  await env.runner.handleInbound({ ...base, kind: 'reaction', msgId: 'x1', from: { handle: 'persona:ben' }, reaction: { emoji: '❤️', target: 'r-1' } });
  await env.runner.handleInbound({ ...base, kind: 'poll_vote', msgId: 'x2', from: { handle: 'persona:ben' }, poll: { pollId: 'p-1', optionIndexes: [0, 2] } });
  await env.runner.handleInbound({ ...base, kind: 'members', msgId: 'x3', members: [{ handle: '+16175550134', platformName: 'Sam' }, { handle: 'persona:jo', platformName: '+1 617 555 0199' }] });
  await env.runner.handleInbound({ ...base, kind: 'other', msgId: 'x4', from: { handle: 'persona:maya' } });
  assert.deepEqual(kinds(env.engine.events), ['added_to_group', 'reaction', 'poll_vote', 'members_snapshot', 'member_seen']);
  const evs = nonSent(env.engine.events);
  const snap = evs[3] as { members: { key: string; platformName?: string }[] };
  assert.equal(snap.members[0].key, env.ids.member('sim', 'g1', '+16175550134'));
  assert.equal(snap.members[0].platformName, 'Sam');
  assert.equal(snap.members[1].platformName, undefined, 'a phone-number-like platform name is dropped');
  const json = JSON.stringify(evs);
  assert.ok(!json.includes('6175550134') && !json.includes('persona:'), 'no raw handle reaches the engine');
  const r = evs[1] as { emoji: string; target: string };
  assert.deepEqual([r.emoji, r.target], ['❤️', 'r-1']);
});

test('per-space mutex: a group\'s events are strictly sequential', async () => {
  const timeline: string[] = [];
  class SlowAdapter extends RecordingAdapter {
    override async send(spaceId: string, text: string) {
      timeline.push(`send-start:${text}`);
      await new Promise((r) => setTimeout(r, 15));
      timeline.push(`send-end:${text}`);
      return super.send(spaceId, text);
    }
  }
  const engine = fakeEngine((_s, ev) => {
    if (ev.kind === 'message') {
      timeline.push(`apply:${ev.text}`);
      return [{ type: 'send', text: `ack ${ev.text}`, prompting: 'prompted' }];
    }
  });
  const env = makeEnv({ engine });
  const slow = new SlowAdapter(CAPS.sim);
  env.runner.addAdapter(slow);
  await Promise.all([
    env.runner.handleInbound(textIn('g1', 'persona:ana', 'one')),
    env.runner.handleInbound(textIn('g1', 'persona:ben', 'two')),
  ]);
  const i2 = timeline.indexOf('apply:two');
  const lastOneSend = timeline.lastIndexOf('send-end:ack one');
  assert.ok(lastOneSend >= 0 && i2 > lastOneSend, timeline.join(' | '));
});

test('tagged sends feed back a sent event with the platform ref', async () => {
  const engine = fakeEngine((s, ev, ctx) => {
    if (ev.kind === 'message' && ev.text === 'go') {
      s.plan = makePlan(ctx.newId());
      return [
        { type: 'send', text: 'header', prompting: 'prompted', tag: 'header' },
        { type: 'send', text: 'Fri 7pm', prompting: 'prompted', tag: 'option:1' },
      ];
    }
    if (ev.kind === 'sent' && s.plan) {
      if (ev.tag === 'header') s.plan.refs.header = ev.msgRef;
      const m = /^option:(\d+)$/.exec(ev.tag);
      if (m) s.plan.refs.options[Number(m[1])] = ev.msgRef;
    }
  });
  const env = makeEnv({ engine });
  await env.runner.handleInbound(textIn('g1', 'persona:ana', 'go'));
  const sent = env.engine.events.filter((e) => e.kind === 'sent') as { tag: string; msgRef: string; at: number }[];
  assert.deepEqual(sent.map((s) => s.tag), ['intro', 'header', 'option:1']);
  assert.equal(sent[2].msgRef, 'r-3');
  assert.equal(sent[2].at, env.clock.now());
  const plan = env.repo.loadGroup(env.ids.space('sim', 'g1'))?.plan;
  assert.equal(plan?.refs.header, 'r-2');
  assert.equal(plan?.refs.options[1], 'r-3');
});

test('typing indicator wraps addressed messages only, where supported', async () => {
  const env = makeEnv();
  await env.runner.handleInbound(textIn('g1', 'persona:ana', 'just chatting'));
  assert.ok(!env.adapter.methods().includes('typing'));
  await env.runner.handleInbound(textIn('g1', 'persona:ana', 'homi you there?'));
  const t = env.adapter.calls.filter((c) => c.method === 'typing').map((c) => c.args[1]);
  assert.deepEqual(t, [true, false]);
  const local = makeEnv({ caps: CAPS['imessage-local'] });
  await local.runner.handleInbound(textIn('g1', 'h', 'homi hi', { surface: 'imessage-local' }));
  assert.ok(!local.adapter.methods().includes('typing'));
});

test('remember_handle seals the CURRENT sender only; dm and call use the sealed handle', async () => {
  const voice = new MockVoice({ delayMs: 0 });
  let samKey = '';
  const engine = fakeEngine((s, ev) => {
    if (ev.kind !== 'message') return;
    s.plan = s.plan ?? makePlan('plan-1');
    if (ev.text === 'homi you can call me') {
      return [
        { type: 'remember_handle', member: ev.from.key, planId: 'plan-1' },
        { type: 'remember_handle', member: 'f'.repeat(64), planId: 'plan-1' }, // someone else: refused
      ];
    }
    if (ev.text === 'nudge') {
      return [
        { type: 'send', text: 'Checking in with Sam privately.', prompting: 'unprompted' },
        { type: 'dm', member: samKey, text: 'Fri or Sat?' },
        { type: 'call', member: samKey, question: 'Fri or Sat?', options: ['Fri', 'Sat'], callRef: 'cr-1' },
      ] as Action[];
    }
  });
  const env = makeEnv({ engine, voice });
  samKey = env.ids.member('sim', 'g1', '+16175550134');
  await env.runner.handleInbound(textIn('g1', '+16175550134', 'homi you can call me', { from: { handle: '+16175550134' } }));
  assert.equal(env.repo.delivery.get(samKey, 'plan-1'), '+16175550134');
  assert.equal(env.repo.counts().delivery, 1, 'the other member was not stored');

  voice.onResult((r) => void env.runner.handleCallResult(r));
  await env.runner.handleInbound(textIn('g1', 'persona:ana', 'nudge'));
  const dm = env.adapter.calls.find((c) => c.method === 'dm');
  assert.deepEqual(dm?.args, ['+16175550134', 'Fri or Sat?']);
  assert.equal(voice.calls.length, 1);
  assert.equal(voice.calls[0].to, '+16175550134');
  assert.equal(voice.calls[0].planId, 'plan-1');
  await voice.settled();
  await env.runner.whenIdle();
  const cr = env.engine.events.find((e) => e.kind === 'call_result') as { ok: boolean; simulated?: boolean; member: string };
  assert.ok(cr && cr.ok && cr.simulated);
  assert.equal(cr.member, samKey);
});

test('places lookups time out after the budget and still feed a places_result', async () => {
  const never: PlacesService = { search: () => new Promise(() => undefined), weather: () => new Promise(() => undefined) };
  const engine = fakeEngine((_s, ev) => {
    if (ev.kind === 'message' && ev.text === 'food') {
      return [
        { type: 'lookup_places', requestId: 'rq-1', query: { cuisines: ['thai'], diet: [], near: 'Harvard Square' } },
        { type: 'lookup_weather', requestId: 'rq-2', near: 'Harvard Square', at: 0 },
      ];
    }
  });
  const env = makeEnv({ engine, places: never, placesTimeoutMs: 30 });
  await env.runner.handleInbound(textIn('g1', 'persona:ana', 'food'));
  const pr = env.engine.events.find((e) => e.kind === 'places_result') as { requestId: string; options: unknown[]; source: string };
  assert.deepEqual(pr, { kind: 'places_result', requestId: 'rq-1', options: [], source: 'timeout' });
  const wr = env.engine.events.find((e) => e.kind === 'weather_result') as { rainLikely: boolean };
  assert.equal(wr.rainLikely, false);
});

test('stop: leave where possible (space deleted), tombstone elsewhere (then ignored forever)', async () => {
  const stopEngine = () =>
    fakeEngine((s, ev) => {
      if (ev.kind === 'message' && ev.text === 'homi stop') {
        s.plan = null;
        return [{ type: 'send', text: 'Deleted everything. Bye!', prompting: 'prompted' }, { type: 'leave' }, { type: 'send', text: 'never sent', prompting: 'prompted' }];
      }
    });
  const env = makeEnv({ engine: stopEngine() });
  await env.runner.handleInbound(textIn('g1', 'persona:ana', 'homi stop'));
  assert.deepEqual(env.adapter.methods().filter((m) => m !== 'typing').slice(-2), ['send', 'leave']);
  assert.equal(env.adapter.methods().at(-1), 'leave', 'no typing-off after leaving');
  assert.ok(!env.adapter.sends().includes('never sent'));
  assert.equal(env.repo.hasSpace(env.ids.space('sim', 'g1')), false);

  const local = makeEnv({ engine: stopEngine(), caps: CAPS['imessage-local'] });
  const m = (t: string) => textIn('chat-l', 'h1', t, { surface: 'imessage-local' });
  await local.runner.handleInbound(m('homi stop'));
  assert.ok(!local.adapter.methods().includes('leave'));
  const sk = local.ids.space('imessage-local', 'chat-l');
  assert.equal(local.repo.isMuted(sk), true);
  const before = local.engine.events.length;
  await local.runner.handleInbound(m('homi are you there'));
  assert.equal(local.engine.events.length, before, 'tombstoned chat is ignored');
});

test('engine errors are contained and logged without content', async () => {
  const engine = fakeEngine(() => {
    throw new Error('boom with text "secret plan" +16175550134');
  });
  const env = makeEnv({ engine });
  await env.runner.handleInbound(textIn('g1', 'persona:ana', 'secret plan'));
  const errLine = env.lines.find((l) => l.includes('inbound failed'));
  assert.ok(errLine);
  assert.ok(!errLine.includes('secret') && !errLine.includes('6175550134'));
});
