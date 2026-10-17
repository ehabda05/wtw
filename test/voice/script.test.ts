import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_PROMPT, assertSafeQuestion, buildQuestion, spokenOptions, spokenTime, UnsafeQuestionError } from '../../src/voice/script.js';

test('buildQuestion: three options, spoken weekday + hour', () => {
  assert.equal(
    buildQuestion(['Thu Oct 22 · 7pm', 'Fri Oct 23 · 7pm', 'Sat Oct 24 · 7pm']),
    "Hi, this is Homi calling about your group's plan. Does Thursday at 7, Friday at 7, or Saturday at 7 work for you?",
  );
});

test('buildQuestion: two options read as a choice', () => {
  assert.equal(
    buildQuestion(['Fri Oct 23 · 7pm', 'Sat Oct 24 · 7pm']),
    "Hi, this is Homi calling about your group's plan. Does Friday at 7 or Saturday at 7 work better for you?",
  );
  assert.equal(buildQuestion(['Fri Oct 23 · 7pm'], undefined, { greeting: 'none' }), 'Does Friday at 7 work for you?');
});

test('spoken times: 7:30, noon, midnight, morning, 24h', () => {
  assert.equal(spokenTime('7pm'), '7');
  assert.equal(spokenTime('7:30pm'), '7:30');
  assert.equal(spokenTime('7:05 PM'), '7:05');
  assert.equal(spokenTime('12pm'), 'noon');
  assert.equal(spokenTime('noon'), 'noon');
  assert.equal(spokenTime('12am'), 'midnight');
  assert.equal(spokenTime('10am'), '10 in the morning');
  assert.equal(spokenTime('19:00'), '7');
  assert.equal(spokenTime('09:30'), '9:30 in the morning');
  assert.equal(spokenTime('7'), '7');
  assert.equal(spokenTime('13pm'), undefined);
  assert.deepEqual(spokenOptions(['Sat Oct 24 · noon', 'Sun Oct 25 · 12:30pm', 'Friday, Oct 23, 7:30pm']), [
    'Saturday at noon',
    'Sunday at 12:30',
    'Friday at 7:30',
  ]);
});

test('same weekday twice adds the date; identical labels are deduped', () => {
  assert.deepEqual(spokenOptions(['Fri Oct 23 · 7pm', 'Fri Oct 30 · 7pm', 'Sat Oct 24 · 7pm']), [
    'Friday the 23rd at 7',
    'Friday the 30th at 7',
    'Saturday at 7',
  ]);
  assert.deepEqual(spokenOptions(['Fri Oct 23 · 7pm', 'Fri Oct 23 · 7pm']), ['Friday at 7']);
});

test('unparseable labels fall back to a sanitized label', () => {
  assert.deepEqual(spokenOptions(['next weekend · evening']), ['next weekend, evening']);
});

test('activity: generic words are spoken, free text is dropped', () => {
  assert.match(buildQuestion(['Fri Oct 23 · 7pm'], 'dinner'), /^Hi, this is Homi calling about your group's dinner plan\. /);
  const q = buildQuestion(['Fri Oct 23 · 7pm'], "Sam's birthday at Lucia's");
  assert.ok(!/Sam|Lucia|birthday/.test(q));
  assert.match(q, /your group's plan/);
});

test('inbound greeting', () => {
  assert.match(buildQuestion(['Fri Oct 23 · 7pm'], undefined, { greeting: 'inbound' }), /^Hi, it's Homi, thanks for calling/);
});

test('buildQuestion throws on no options', () => {
  assert.throws(() => buildQuestion([]), /no options/);
  assert.throws(() => buildQuestion(['  ']), /no options/);
});

test('assertSafeQuestion: forbidden names and places, whole word, case-insensitive, without echoing the token', () => {
  const q = buildQuestion(['Thu Oct 22 · 7pm', 'Fri Oct 23 · 7pm']);
  assert.doesNotThrow(() => assertSafeQuestion(q, ['Sam', 'Lucia', "Joe's Pizza", 'Ed', 'Fri Night Crew']));
  assert.throws(() => assertSafeQuestion(`${q} Sam is coming.`, ['sam']), (e: unknown) => {
    assert.ok(e instanceof UnsafeQuestionError);
    assert.ok(!/sam/i.test((e as Error).message));
    return true;
  });
  assert.throws(() => assertSafeQuestion("Does Friday at Joe's Pizza work?", ["joe's pizza"]), UnsafeQuestionError);
  // "Ed" must not match inside "Wednesday"
  assert.doesNotThrow(() => assertSafeQuestion('Does Wednesday at 7 work for you?', ['Ed']));
});

test('assertSafeQuestion: contact data, links, templates, length', () => {
  assert.throws(() => assertSafeQuestion('Call +1 (617) 555-0123 back', []), /phone/);
  assert.throws(() => assertSafeQuestion('Mail sam@example.com', []), /email/);
  assert.throws(() => assertSafeQuestion('See https://x.io', []), /link/);
  assert.throws(() => assertSafeQuestion('Does {{day}} work?', []), /template/);
  assert.throws(() => assertSafeQuestion('x'.repeat(401), []), /too long/);
  assert.throws(() => assertSafeQuestion('  ', []), /empty/);
  assert.doesNotThrow(() => assertSafeQuestion('Does Friday the 23rd at 7:30 or Saturday at 10 in the morning work better for you?', []));
});

test('agent prompt is the CHANNELS.md prompt with {{question}}', () => {
  assert.ok(AGENT_PROMPT.startsWith("You are Homi, calling on behalf of a friend group's plan. Ask exactly: {{question}}."));
  assert.ok(AGENT_PROMPT.includes("Never mention anyone's name or any other plan detail."));
});
