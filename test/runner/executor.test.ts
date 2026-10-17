// Executor pairs: every Action type -> the adapter / store call it must produce, per Capabilities.
// Also: private actions (dm / call) keep their announcing group send, in order (PRIVACY.md §6).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAPS } from '../../src/channels/types.js';
import type { Action, Capabilities, GroupState } from '../../src/engine/types.js';
import { Executor, type ExecContext } from '../../src/runner/executor.js';
import { MockVoice, createStubPlaces } from '../../src/runner/mocks.js';
import { RecordingAdapter, makeEnv, makePlan } from './helpers.js';

function setup(caps: Capabilities = CAPS.sim) {
  const env = makeEnv({ caps });
  const adapter = new RecordingAdapter(caps);
  const voice = new MockVoice({ delayMs: 0 });
  const places = createStubPlaces([{ id: 1, name: 'Tasty Thai', source: 'osm' }]);
  const exec = new Executor({ repo: env.repo, places, voice, logger: env.logger });
  const spaceKey = env.ids.space(caps.surface, 'chat');
  const state: GroupState = {
    space: { spaceKey, introSent: true, tone: 'normal', tz: 'UTC', notice: false, muted: false },
    plan: makePlan('plan-1'),
  };
  env.repo.saveGroup(state, { surface: caps.surface, spaceId: 'chat' });
  const ctx: ExecContext = { spaceKey, surface: caps.surface, spaceId: 'chat', adapter, state, now: 1234 };
  return { env, adapter, voice, places, exec, ctx, spaceKey };
}

const send = (text: string, tag?: string): Action => ({ type: 'send', text, prompting: 'prompted', ...(tag ? { tag } : {}) });

test('pairs on a full-featured surface (sim)', async () => {
  const { exec, ctx, adapter, env, spaceKey } = setup(CAPS.sim);
  env.repo.delivery.put('m'.repeat(64).replace(/m/g, 'a'), 'plan-1', 'persona:sam');
  const sam = 'a'.repeat(64);
  const actions: Action[] = [
    send('hello', 'greet'),
    { type: 'reply', to: 'u-1', text: 'got it', prompting: 'prompted', tag: 'ack' },
    { type: 'edit', target: 'r-1', text: 'hello (edited)' },
    { type: 'react', to: 'u-1', emoji: '👍' },
    { type: 'file', name: 'plan.ics', mime: 'text/calendar', content: 'BEGIN:VCALENDAR', caption: 'Add it', prompting: 'prompted' },
    { type: 'poll', question: 'Which?', options: ['Fri', 'Sat'], prompting: 'prompted', tag: 'poll' },
    { type: 'dm', member: sam, text: 'psst' },
    { type: 'schedule', key: 'plan-1:remind:day', job: 'remind_day', at: 5000, planId: 'plan-1', payload: { optionId: 1 } },
    { type: 'schedule', key: 'plan-1:nudge', job: 'availability_nudge', at: 6000, planId: 'plan-1' },
    { type: 'cancel', keyPrefix: 'plan-1:nudge' },
  ];
  const out = await exec.execute(actions, ctx);
  assert.deepEqual(adapter.methods(), ['send', 'reply', 'edit', 'react', 'file', 'send', 'dm']);
  assert.equal(adapter.calls[5].args[1], 'Which?\n1. Fri\n2. Sat', 'no native polls: numbered text');
  assert.deepEqual(adapter.calls[6].args, ['persona:sam', 'psst']);
  assert.deepEqual(
    out.followUps.map((e) => (e.kind === 'sent' ? `${e.tag}=${e.msgRef}@${e.at}` : e.kind)),
    ['greet=r-1@1234', 'ack=r-2@1234', 'poll=r-4@1234'],
  );
  assert.deepEqual(env.repo.jobs.list().map((j) => [j.jobKey, j.kind, j.dueAt, j.payload]), [['plan-1:remind:day', 'remind_day', 5000, { optionId: 1 }]]);
  assert.equal(out.left, false);
  void spaceKey;
});

test('pairs degrade on macOS local iMessage (no reply / edit / react / leave / dm)', async () => {
  const { exec, ctx, adapter, env, spaceKey } = setup(CAPS['imessage-local']);
  const out = await exec.execute(
    [
      { type: 'reply', to: 'u-1', text: 'got it', prompting: 'prompted' },
      { type: 'edit', target: 'r-1', text: 'x' },
      { type: 'react', to: 'u-1', emoji: '👍' },
      { type: 'dm', member: 'a'.repeat(64), text: 'psst' },
      send('Deleted everything; please remove me from this chat.'),
      { type: 'leave' },
    ],
    ctx,
  );
  assert.deepEqual(adapter.methods(), ['send', 'send']);
  assert.equal(out.left, true);
  assert.equal(env.repo.isMuted(spaceKey), true, 'cannot leave: tombstoned');
});

test('files fall back to the caption where attachments are unsupported (terminal)', async () => {
  const { exec, ctx, adapter } = setup(CAPS.terminal);
  await exec.execute([{ type: 'file', name: 'plan.ics', mime: 'text/calendar', content: 'BEGIN', caption: 'Fri 7pm at Tasty Thai', prompting: 'prompted' }], ctx);
  assert.deepEqual(adapter.calls.map((c) => [c.method, c.args[1]]), [['send', 'Fri 7pm at Tasty Thai']]);
});

test('leave where supported deletes the space; actions after it are skipped', async () => {
  const { exec, ctx, adapter, env, spaceKey } = setup(CAPS.sim);
  const out = await exec.execute([send('bye'), { type: 'leave' }, send('ghost')], ctx);
  assert.deepEqual(adapter.methods(), ['send', 'leave']);
  assert.equal(out.left, true);
  assert.equal(env.repo.hasSpace(spaceKey), false);
});

test('a failed leave (e.g. Telegram 403) falls back to a tombstone, so stop always works', async () => {
  const { exec, ctx, adapter, env, spaceKey } = setup(CAPS.telegram);
  adapter.leave = async () => {
    throw new Error('HTTP 403');
  };
  const out = await exec.execute([{ type: 'leave' }], ctx);
  assert.equal(out.left, true);
  assert.equal(env.repo.isMuted(spaceKey), true);
});

test('tombstone and purge', async () => {
  const { exec, ctx, env, spaceKey } = setup(CAPS.telegram);
  env.repo.jobs.upsert({ key: 'plan-1:purge', planId: 'plan-1', kind: 'purge', dueAt: 1 });
  await exec.execute([{ type: 'purge', planId: 'plan-1' }], ctx);
  assert.equal(env.repo.counts().plans, 0);
  assert.equal(env.repo.counts().jobs, 0);
  const out = await exec.execute([{ type: 'tombstone' }], ctx);
  assert.equal(out.left, true);
  assert.equal(env.repo.isMuted(spaceKey), true);
});

test('lookups feed places_result / weather_result back', async () => {
  const { exec, ctx, places } = setup();
  const out = await exec.execute(
    [
      { type: 'lookup_places', requestId: 'q1', query: { cuisines: ['thai'], diet: [], near: 'Harvard Square' } },
      { type: 'lookup_weather', requestId: 'q2', near: 'Harvard Square', at: 0 },
    ],
    ctx,
  );
  assert.deepEqual(out.followUps, [
    { kind: 'places_result', requestId: 'q1', options: [{ id: 1, name: 'Tasty Thai', source: 'osm' }], source: 'stub' },
    { kind: 'weather_result', requestId: 'q2', rainLikely: false },
  ]);
  assert.equal(places.queries.length, 1);
});

test('dm / call keep their announcing group send, in order; missing handle -> skipped (call reports failure)', async () => {
  const { exec, ctx, adapter, voice, env } = setup();
  const sam = 'b'.repeat(64);
  const out1 = await exec.execute(
    [send("Still need Sam, so I'm giving them a quick call (they said that's ok)."), { type: 'call', member: sam, question: 'Fri or Sat?', options: ['Fri', 'Sat'], callRef: 'c1' }],
    ctx,
  );
  assert.deepEqual(adapter.methods(), ['send']);
  assert.equal(voice.calls.length, 0);
  assert.deepEqual(out1.followUps, [{ kind: 'call_result', planId: 'plan-1', member: sam, ok: false }]);
  assert.ok(env.lines.some((l) => l.includes('call skipped')));

  env.repo.delivery.put(sam, 'plan-1', '+16175550134');
  await exec.execute(
    [send('I checked in with Sam privately.'), { type: 'dm', member: sam, text: 'Fri or Sat?' }, { type: 'call', member: sam, question: 'Fri or Sat?', options: ['Fri', 'Sat'], callRef: 'c2' }],
    ctx,
  );
  assert.deepEqual(adapter.methods(), ['send', 'send', 'dm']);
  assert.equal(voice.calls.length, 1);
  assert.equal(voice.calls[0].callRef, 'c2');
  assert.ok(!env.lines.join('\n').includes('6175550134'));
});

test('a failing adapter call does not stop later actions', async () => {
  const { exec, ctx, adapter, env } = setup();
  adapter.failWith = new Error('network down');
  const out = await exec.execute([send('a', 't1'), { type: 'schedule', key: 'plan-1:x', job: 'purge', at: 1, planId: 'plan-1' }], ctx);
  assert.equal(out.followUps.length, 0);
  assert.equal(env.repo.jobs.list().length, 1);
});
