// PRIVACY.md §4: the same handle in two groups gets two unlinked IDs, and plan state never crosses between them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ids, memberKeyOf, spaceKeyOf } from '../../src/privacy/ids.js';
import { fakeEngine, makeEnv, makePlan, textIn } from '../runner/helpers.js';

test('same handle in two groups -> different member keys; different salt -> different keys', () => {
  const ids = new Ids('salt-one-0123456789abc');
  const phone = '+16175550134';
  const a = ids.member('imessage-dedicated', 'chat-A', phone);
  const b = ids.member('imessage-dedicated', 'chat-B', phone);
  assert.notEqual(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, memberKeyOf('salt-one-0123456789abc', 'imessage-dedicated', 'chat-A', phone));
  assert.notEqual(a, new Ids('salt-two-0123456789abc').member('imessage-dedicated', 'chat-A', phone));
  assert.notEqual(ids.space('telegram', '-100'), ids.space('sim', '-100'), 'surface is part of the key');
  assert.equal(ids.space('telegram', '-100'), spaceKeyOf('salt-one-0123456789abc', 'telegram', '-100'));
  assert.ok(!a.includes('6175550134'));
});

test('plans are isolated per group through the runner', async () => {
  const engine = fakeEngine((s, ev, ctx) => {
    if (ev.kind === 'message' && /plan/.test(ev.text) && !s.plan) {
      s.plan = makePlan(ctx.newId(), { activity: ev.text.includes('drinks') ? 'drinks' : 'dinner' });
      s.plan.members[ev.from.key] = { key: ev.from.key, status: 'pending', dayPrefs: {}, optionVotes: {}, optInDm: false, optInCall: false, hasDelivery: false, nudgeCount: 0, joinedAt: ctx.now };
    }
  });
  const env = makeEnv({ engine });
  await env.runner.handleInbound(textIn('group-A', 'persona:ana', 'otto plan dinner'));
  await env.runner.handleInbound(textIn('group-B', 'persona:ana', 'otto plan drinks'));
  const a = env.repo.loadGroup(env.ids.space('sim', 'group-A'));
  const b = env.repo.loadGroup(env.ids.space('sim', 'group-B'));
  assert.ok(a?.plan && b?.plan);
  assert.notEqual(a.plan.id, b.plan.id);
  assert.equal(a.plan.activity, 'dinner');
  assert.equal(b.plan.activity, 'drinks');
  const [ka] = Object.keys(a.plan.members);
  const [kb] = Object.keys(b.plan.members);
  assert.notEqual(ka, kb, 'Ana is unlinkable across the two groups');
  assert.ok(!(kb in a.plan.members) && !(ka in b.plan.members));
  // the message events carried different member refs too
  const froms = engine.events.filter((e) => e.kind === 'message').map((e) => (e as { from: { key: string } }).from.key);
  assert.equal(new Set(froms).size, 2);
});
