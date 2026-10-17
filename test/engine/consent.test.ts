import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES as T } from '../../src/engine/index.js';
import { Harness, joined, ofType, texts } from './helpers.js';

const START = '2026-10-17T10:00:00-04:00';

test('PRIVACY §1: the first event of any kind gets the intro once, prompted; chatter gets nothing', () => {
  const h = new Harness({ start: START });
  const first = h.say('maya', 'guys we never hang out anymore');
  assert.deepEqual(texts(first), [T.intro({ hours: 24 })]);
  assert.equal(ofType(first, 'send')[0].prompting, 'prompted');
  assert.equal(h.state.space.introSent, true);
  for (const m of ['lol same', 'where are we eating tonight', 'fri works for me', 'this lecture is eating me alive', "I'm out"])
    assert.deepEqual(h.say('ben', m), [], m);
  assert.deepEqual(h.apply({ kind: 'reaction', from: { key: 'k-jo' }, emoji: '❤️', target: 'x' }), []);
  assert.deepEqual(h.apply({ kind: 'member_seen', from: { key: 'k-jo' } }), []);
  assert.equal(h.plan, null);
});

test('added_to_group triggers the same single intro', () => {
  const h = new Harness({ start: START });
  assert.equal(texts(h.apply({ kind: 'added_to_group' })).length, 1);
  assert.deepEqual(h.apply({ kind: 'added_to_group' }), []);
  assert.deepEqual(h.say('ana', 'hi all'), []);
});

test('before a plan: privacy, what do you know, help and plan/food triggers answer when addressed', () => {
  const h = new Harness({ start: START });
  const p = h.say('kofi', 'otto privacy');
  assert.equal(texts(p).length, 2);
  assert.equal(texts(p)[1], T.privacy({ hours: 24 }));
  assert.match(joined(h.say('kofi', 'otto what do you know')), /settings only .* and no plan/);
  assert.equal(joined(h.say('kofi', 'otto')), T.help());
  assert.match(joined(h.say('ana', '@otto dinner next week?')), /Dinner, next week/);
});

test('otto stop: purge + leave where the channel can leave', () => {
  const h = new Harness({ start: START });
  h.say('ana', '@otto dinner next week?');
  const planId = h.plan!.id;
  const out = h.say('ben', 'otto stop');
  assert.ok(out.some((a) => a.type === 'purge' && a.planId === planId));
  assert.ok(out.some((a) => a.type === 'cancel' && a.keyPrefix === `${planId}:`));
  assert.ok(out.some((a) => a.type === 'leave'));
  assert.equal(joined(out), T.stopLeave());
  assert.equal(h.plan, null);
  assert.equal(h.state.space.introSent, false, 'settings row is deleted too');
});

test('otto stop where Otto cannot leave: tombstone + "please remove me", then total silence', () => {
  const h = new Harness({ start: START, surface: 'imessage-local' });
  h.say('ana', '@otto dinner next week?');
  const out = h.say('ben', 'otto stop');
  assert.ok(out.some((a) => a.type === 'tombstone'));
  assert.ok(!out.some((a) => a.type === 'leave'));
  assert.match(joined(out), /please remove me/);
  assert.equal(h.state.space.muted, true);
  assert.deepEqual(h.say('ana', '@otto dinner next week?'), []);
  assert.deepEqual(h.apply({ kind: 'added_to_group' }), []);
});

test('otto forget deletes the plan and stays; jobs are cancelled', () => {
  const h = new Harness({ start: START });
  h.say('ana', '@otto dinner next week?');
  assert.ok(h.jobs.size > 0);
  const out = h.say('jo', 'otto forget');
  assert.equal(joined(out), T.forgetDone());
  assert.equal(h.plan, null);
  assert.equal(h.jobs.size, 0);
  assert.ok(!out.some((a) => a.type === 'leave'));
  assert.equal(joined(h.say('jo', 'otto forget')), T.forgetNothing());
});
