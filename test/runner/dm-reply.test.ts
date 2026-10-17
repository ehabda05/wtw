// Demo quorum, runner side: group speakers' handles are sealed (remember_handle), the quorum DM goes out through
// the adapter, and a private reply from that handle is routed back to the plan as the member's own vote.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAPS } from '../../src/channels/types.js';
import { loadEngine } from '../../src/runner/services.js';
import { makeEnv, textIn } from './helpers.js';

const Q = { dmAfterMs: 30_000, replyMs: 15_000, minYes: 2 };

test('quorum DM round trip: handle sealed on the group message, DM sent at 30 s, private "yes" routed to the plan', async () => {
  const engine = (await loadEngine()) as never;
  const env = makeEnv({ engine, caps: CAPS.telegram, quorum: Q });
  const group = (handle: string, text: string) => textIn('g1', handle, text, { surface: 'telegram' });
  await env.runner.handleInbound({ surface: 'telegram', spaceId: 'g1', isGroup: true, kind: 'headcount', headcount: 2, msgId: 'hc', mentionsAgent: false, at: 0 });
  await env.runner.handleInbound(group('r1', 'homi dinner friday 7pm'));
  await env.runner.handleInbound(group('r1', 'homi 1'));
  await env.runner.handleInbound(group('c1', 'hey all'));
  const spaceKey = env.ids.space('telegram', 'g1');
  const charlie = env.ids.member('telegram', 'g1', 'c1');
  const planId = env.repo.loadGroup(spaceKey)!.plan!.id;
  assert.equal(env.repo.delivery.get(charlie, planId), 'c1', 'the group speaker is reachable privately');

  // 30 s: the scheduler would fire quorum_dm; drive it through dispatch like the scheduler does.
  await env.clock.advance(30_000);
  await env.runner.dispatch(spaceKey, { kind: 'timer', job: 'quorum_dm', planId });
  const dm = env.adapter.calls.find((c) => c.method === 'dm');
  assert.ok(dm, 'a DM went out');
  assert.equal(dm!.args[0], 'c1');
  assert.match(String(dm!.args[1]), /does 1 · Fri Oct 23 · 7pm work for you/);

  // Charlie answers in the private chat: routed to the plan, thanked in the DM, never treated as a new DM space.
  await env.runner.handleInbound({ surface: 'telegram', spaceId: 'c1', isGroup: false, kind: 'text', from: { handle: 'c1', platformName: 'Charlie' }, text: 'yes', msgId: 'p1', mentionsAgent: true, at: 0 });
  const plan = env.repo.loadGroup(spaceKey)!.plan!;
  assert.equal(plan.members[charlie].status, 'answered');
  assert.equal(plan.state, 'collecting_details', 'two yes out of two: locked');
  assert.ok(env.adapter.calls.some((c) => c.method === 'dm' && c.args[0] === 'c1' && /Got it, thanks/.test(String(c.args[1]))));
  assert.equal(env.repo.hasSpace(env.ids.space('telegram', 'c1')), false, 'no DM space was created for the reply');
  assert.ok(!env.lines.join('\n').includes('yes'), 'the reply text never reaches the logs');
});
