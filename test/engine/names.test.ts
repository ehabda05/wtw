// Names survive the plan: "homi I'm Ana" is kept with the chat's settings (SpaceSettings.names), so the next plan
// greets Ana by name without asking again. "homi forget" deletes the plan and keeps the names; "homi stop" deletes all.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness, joined } from './helpers.js';

const START = '2026-10-17T10:00:00-04:00';

test('a name given before any plan is remembered, carried into the next plans, and gone after "homi stop"', () => {
  const h = new Harness({ start: START, surface: 'telegram' });
  assert.match(joined(h.say('ana', "homi I'm Ana")), /Hi Ana 👋 I'll remember that/);
  assert.equal(h.state.space.names?.['k-ana'], 'Ana');

  h.say('riad', 'homi dinner next week?');
  h.say('ana', 'fri works');
  assert.equal(h.plan!.members['k-ana'].name, 'Ana', 'the new plan already knows Ana');
  h.say('ben', "homi I'm Ben");
  assert.equal(h.state.space.names?.['k-ben'], 'Ben');

  // forget deletes the plan, not the names
  h.say('riad', 'homi forget');
  assert.equal(h.plan, null);
  h.say('riad', 'homi dinner next week?');
  h.say('ben', 'sat works');
  assert.equal(h.plan!.members['k-ben'].name, 'Ben');
  const dump = joined(h.say('riad', 'homi what do you know'));
  assert.match(dump, /names Ana, Ben/);
  assert.match(dump, /names I know: .*Ben/);

  // stop deletes everything
  h.say('riad', 'homi stop');
  assert.equal(h.state.space.names, undefined);
});
