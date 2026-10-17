// A 'headcount' inbound (Telegram's member count minus the bot) becomes an engine headcount event; nothing else.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers.js';

test('headcount inbound -> engine headcount event; zero or missing counts are dropped', async () => {
  const env = makeEnv();
  await env.runner.handleInbound({ surface: 'sim', spaceId: 'g1', isGroup: true, kind: 'headcount', headcount: 2, msgId: 'headcount:g1:1', mentionsAgent: false, at: 0 });
  await env.runner.handleInbound({ surface: 'sim', spaceId: 'g1', isGroup: true, kind: 'headcount', headcount: 0, msgId: 'headcount:g1:2', mentionsAgent: false, at: 0 });
  await env.runner.handleInbound({ surface: 'sim', spaceId: 'g1', isGroup: true, kind: 'headcount', msgId: 'headcount:g1:3', mentionsAgent: false, at: 0 });
  const events = env.engine.events.filter((e) => e.kind !== 'sent'); // the intro's own 'sent' feedback is not an inbound
  assert.deepEqual(events, [{ kind: 'headcount', n: 2 }]);
});
