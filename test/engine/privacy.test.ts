import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOUR, Harness, fakePlaces } from './helpers.js';

/** A long, realistic conversation. Returns the harness and every message string members typed. */
function conversation(): { h: Harness; said: string[] } {
  const h = new Harness({ start: '2026-10-17T10:00:00-04:00' });
  const said: string[] = [];
  const say = (who: string, text: string) => {
    said.push(text);
    h.say(who, text);
  };
  say('maya', 'guys we have not hung out in like three weeks');
  say('ana', '@otto dinner next week? my treat for the birthday');
  say('sam', "otto I'm Sam");
  say('sam', 'otto you can call me, i never check this chat');
  say('ben', 'friday works for me, saturday is my cousins wedding');
  say('jo', 'honestly either works, I am free all week');
  say('ana', 'fri works, i have a midterm thursday morning');
  say('maya', 'lol friday was wild last time we went out');
  say('ben', 'my number is 617-555-0134 if anyone needs a ride');
  say('ben', 'otto note parking: behind the building on Oxford St');
  h.advance(14 * HOUR);
  say('maya', "ok I'm starving where are we eating tonight");
  say('ana', 'thai sounds amazing tbh, the place near the square');
  say('ben', 'something cheap please, I am broke until payday');
  say('jo', 'harvard square is easiest for everyone I think');
  say('jo', 'otto go');
  h.places(fakePlaces());
  say('ana', '1 looks good to me honestly');
  say('ben', '1 for sure, love that place');
  say('jo', "otto we're going to Tasty Thai");
  say('ana', 'cannot wait for friday everyone, it will be fun');
  return { h, said };
}

test('GroupState never contains message text (except plan data members handed to Otto)', () => {
  const { h, said } = conversation();
  const json = JSON.stringify(h.state).toLowerCase();
  const givenAsPlanData = new Set(["otto I'm Sam", 'otto note parking: behind the building on Oxford St', "otto we're going to Tasty Thai"]);
  for (const text of said) {
    if (givenAsPlanData.has(text) || text.length < 8) continue;
    assert.ok(!json.includes(text.toLowerCase()), `state contains: ${text}`);
  }
  assert.ok(!json.includes('617'), 'no phone numbers');
  assert.ok(!json.includes('cousins wedding') && !json.includes('midterm'), 'no fragments of chatter');
  // The plan data the members explicitly gave Otto is there:
  assert.ok(json.includes('"name":"sam"'));
  assert.ok(json.includes('behind the building on oxford st'));
  assert.ok(json.includes('tasty thai'));
});

test('multi-group isolation: the same member key in two groups gets two independent plans', () => {
  const a = new Harness({ start: '2026-10-17T10:00:00-04:00', spaceKey: 'group-a' });
  const b = new Harness({ start: '2026-10-17T10:00:00-04:00', spaceKey: 'group-b' });
  a.say('ana', '@otto dinner next week?');
  a.say('ana', 'fri works');
  b.say('ana', '@otto drinks this weekend?');
  assert.equal(a.plan!.activity, 'dinner');
  assert.equal(b.plan!.activity, 'drinks');
  assert.equal(a.plan!.members['k-ana'].status, 'answered');
  assert.equal(b.plan!.members['k-ana'].status, 'pending');
  a.say('ana', 'otto forget');
  assert.equal(a.plan, null);
  assert.notEqual(b.plan, null);
  assert.equal(b.state.space.spaceKey, 'group-b');
});

test('determinism: the same inputs give the same states and actions', () => {
  const one = conversation();
  const two = conversation();
  assert.deepEqual(one.h.state, two.h.state);
  assert.deepEqual(one.h.log, two.h.log);
});

test('purity: applyEvent does not mutate the input state', () => {
  const h = new Harness({ start: '2026-10-17T10:00:00-04:00' });
  h.say('ana', '@otto dinner next week?');
  const before = JSON.stringify(h.state);
  const snapshot = h.state;
  h.say('ben', 'fri works');
  assert.equal(JSON.stringify(snapshot), before);
});
