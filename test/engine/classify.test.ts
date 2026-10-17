import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../../src/engine/index.js';
import { Harness, TZ } from './helpers.js';

test('classify without a plan: plan trigger, addressed food, silent-but-semantic food, idioms, commands', () => {
  const now = Date.parse('2026-10-17T18:30:00-04:00');
  assert.equal(classify('@otto dinner next week?', null, now, TZ).intent, 'plan');
  assert.equal(classify('@otto dinner next week?', null, now, TZ).window, 'next week');
  assert.deepEqual([classify('@otto where should we eat', null, now, TZ).intent, classify('@otto where should we eat', null, now, TZ).food], ['food', true]);
  const silent = classify("ok i'm actually starving, where are we eating", null, now, TZ);
  assert.deepEqual([silent.intent, silent.food], ['chatter', true]);
  const idiom = classify('this lecture is eating me alive i swear', null, now, TZ);
  assert.deepEqual([idiom.intent, idiom.food, idiom.foodScore], ['chatter', false, 0]);
  assert.equal(classify('otto privacy', null, now, TZ).intent, 'command');
});

test('classify in context: votes, food answers, place votes, veto', () => {
  const h = new Harness({ start: '2026-10-17T10:00:00-04:00' });
  h.say('ana', '@otto dinner next week?');
  assert.equal(classify('fri or sat works', h.plan, h.now, TZ).intent, 'vote');
  assert.equal(classify('lol fri was wild', h.plan, h.now, TZ).intent, 'chatter');
  h.say('ben', 'fri works');
  h.say('ana', 'fri works');
  h.say('maya', 'otto find food');
  assert.deepEqual([classify('thai or pho but cheap pls', h.plan, h.now, TZ).intent, classify('thai', h.plan, h.now, TZ).food], ['food_answer', true]);
  h.say('ana', 'otto go, thai, harvard sq');
  h.places([{ id: 1, name: 'Tasty Thai', cuisine: 'thai', source: 'osm', walkMinutes: 3, openAtPlanTime: true }]);
  const pv = classify('1 looks good', h.plan, h.now, TZ);
  assert.deepEqual([pv.intent, pv.food, pv.placeVote], ['vote', true, 1]);
  h.say('ana', '1');
  assert.equal(h.plan!.state, 'confirmed');
  assert.equal(classify("can't do friday anymore", h.plan, h.now, TZ, { from: 'k-ben' }).intent, 'veto');
  assert.equal(classify('cannot wait for friday', h.plan, h.now, TZ, { from: 'k-ben' }).intent, 'chatter');
});
