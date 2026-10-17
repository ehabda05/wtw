import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOUR, Harness, joined, ofType } from './helpers.js';

test('day conflict: immediate prompted bridge; "sat brunch works" adds option 4 with day prefs carried over', () => {
  const h = new Harness({ start: '2026-10-19T18:00:00-04:00' });
  h.say('cal', '@otto dinner thu, fri or sat? 🍝');
  h.say('dee', 'either works for me');
  h.say('ana', "otto I'm Ana");
  h.say('ben', "otto I'm Ben");
  h.say('ana', "fri works, i'm busy thu and sat");
  const q = h.say('ben', "sat works. thu and fri i can't, family stuff");
  const bridge = ofType(q, 'send').find((s) => /can only do/.test(s.text))!;
  assert.equal(bridge.text, 'Ana can only do Fri and Ben only Sat. Could either of you do Fri late or Sat brunch (I\'ll add it)?');
  assert.equal(bridge.prompting, 'prompted');
  assert.deepEqual(h.say('eli', 'sat was so fun last time lmao'), []);
  const add = h.say('ana', 'sat brunch works actually!');
  const bubble = ofType(add, 'send').find((s) => s.tag === 'option:4')!;
  assert.equal(bubble.text, '4 · Sat Oct 24 · 11am');
  const p = h.plan!;
  const o4 = p.options.find((o) => o.id === 4)!;
  assert.equal(o4.time, '11:00');
  // Ben's earlier day-level "sat works" counts for the new Sat option without answering again.
  assert.equal(p.members['k-ben'].dayPrefs['2026-10-24'].vote, 'yes');
  h.say('cal', 'sat brunch works for me 🥞');
  h.react('dee', '❤️', 'option:4');
  h.react('eli', '😂', 'option:1');
  const lock = h.react('eli', '❤️', 'option:4');
  assert.match(joined(lock), /^Sat Oct 24 · 11am it is: 5 in/);
  assert.equal(h.plan!.lockedBy, 'everyone');
  assert.match(joined(h.say('dee', 'otto why sat')), /Sat 11am had 5 yes/);
});

test('time shift: "fri but only after 8:30" proposes Fri 8:30; any yes moves the option', () => {
  const h = new Harness({ start: '2026-10-19T21:00:00-04:00' });
  h.say('nora', '@otto drinks thu, fri or sat? we deserve it');
  h.say('kai', 'fri!!');
  h.say('wes', 'thu works, fri maybe');
  const ask = h.say('sofia', 'fri but only after 8:30');
  assert.match(joined(ask), /Fri works for (everyone|\d+) if we push to 8:30pm\. Want Fri 8:30pm\?/);
  assert.equal(h.plan!.bridge?.kind, 'time_shift');
  const yes = h.say('raf', 'yes fri 8:30 works');
  assert.match(joined(yes), /Moved it: 2 · Fri Oct 23 · 8:30pm\./);
  assert.ok(yes.some((a) => a.type === 'edit' && a.text === '2 · Fri Oct 23 · 8:30pm'));
  const fri = h.plan!.options.find((o) => o.id === 2)!;
  assert.equal(fri.time, '20:30');
  assert.equal(h.plan!.members['k-raf'].dayPrefs['2026-10-23'].vote, 'yes');
});

test('stranded at the deadline: one question inside the lock message; "sat" switches', () => {
  const h = new Harness({ start: '2026-10-17T10:00:00-04:00' });
  h.say('ana', '@otto dinner next week?');
  h.say('ana', "otto we're 5");
  h.say('ben', "otto I'm Ben");
  h.say('ana', 'fri works');
  h.say('jo', 'fri or sat');
  h.say('maya', 'fri works');
  h.say('ben', "sat works, can't do fri");
  const out = h.advance(25 * HOUR);
  const lock = ofType(out, 'send').find((s) => /unless someone says/.test(s.text))!;
  assert.equal(lock.text, 'Fri works for 3 (not Ben); Sat works for 2 including Ben. Fri unless someone says "sat" in the next few hours?');
  assert.equal(h.plan!.bridge?.kind, 'stranded');
  assert.match(joined(h.say('jo', 'sat')), /^Switched: Sat Oct 24 · 7pm it is, 2 in\./);
  assert.equal(h.plan!.chosenOptionId, 3);
});

test('event less than 24h away: no bridge; lock and be kind', () => {
  const h = new Harness({ start: '2026-10-22T09:27:00-04:00' });
  h.say('rina', '@otto dinner tonight, fri or sat?');
  h.say('rina', "otto we're 4");
  h.say('omar', "otto I'm Omar");
  h.say('rina', 'tonight works');
  h.say('gabe', 'tonight works');
  h.say('omar', "fri works, can't do tonight");
  const out = h.advance(5 * HOUR);
  const lock = ofType(out, 'send').find((s) => /it is/.test(s.text))!;
  assert.match(lock.text, /^Thu Oct 22 · 7pm it is: 2 in\. Omar, we'll miss you this time\.$/);
  assert.equal(h.plan!.bridge, undefined);
});
