import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES, TEMPLATE_SAMPLES, countSentences } from '../../src/engine/index.js';
import { FRAGMENT_TEMPLATES } from '../../src/engine/templates.js';

test('countSentences: terminals, decimals, urls, abbreviations, fragments', () => {
  assert.equal(countSentences('Hi. There.'), 2);
  assert.equal(countSentences('$28.50 each for 5 people (tip not included).'), 1);
  assert.equal(countSentences('Tasty Thai it is: 1234 Mass Ave https://maps.example/?q=a.b 🍜'), 1);
  assert.equal(countSentences('1 · Tasty Thai · ~$ (est.) · open now'), 1);
  assert.equal(countSentences('Deleted everything for this chat. Bye 👋'), 2);
  assert.equal(countSentences('One. Two! Three?'), 3);
  assert.equal(countSentences('Details: docs/PRIVACY.md.'), 1);
  assert.equal(countSentences('🎉'), 0);
});

test('every template, rendered with every sample, is at most two sentences', () => {
  const rendered: string[] = [];
  for (const [name, samples] of Object.entries(TEMPLATE_SAMPLES)) {
    const fn = (TEMPLATES as Record<string, (...a: unknown[]) => string>)[name];
    assert.ok(fn, `template ${name} exists`);
    assert.ok(samples.length > 0, `template ${name} has samples`);
    for (const args of samples as unknown[][]) {
      const text = fn(...args);
      rendered.push(text);
      assert.ok(text.trim().length > 0, `${name} renders`);
      assert.ok(countSentences(text) <= 2, `${name} has ${countSentences(text)} sentences: ${text}`);
    }
  }
  assert.ok(rendered.length >= 100);
});

test('every template has samples (no copy escapes the linter)', () => {
  assert.deepEqual(Object.keys(TEMPLATE_SAMPLES).sort(), Object.keys(TEMPLATES).sort());
});

test('bubbles are single fragments', () => {
  for (const name of FRAGMENT_TEMPLATES) {
    for (const args of TEMPLATE_SAMPLES[name] as unknown[][]) {
      const text = (TEMPLATES[name] as (...a: unknown[]) => string)(...args);
      assert.equal(countSentences(text), 1, text);
      assert.ok(!/[.!?]$/.test(text), `${name} is a fragment: ${text}`);
    }
  }
});

test('tone dial: nudges and deadline lock change with tone; privacy copy does not take a tone', () => {
  const p = { k: 4, n: 6, who: 'Sam', deadline: 'tomorrow 10am', day: 2, hasHave: 'has' as const, how: 'tap' as const };
  const g = TEMPLATES.nudgeCollective('gentle', p);
  const n = TEMPLATES.nudgeCollective('normal', p);
  const r = TEMPLATES.nudgeCollective('ruthless', p);
  assert.match(g, /No rush/);
  assert.equal(n, '4 of 6 have picked. Still need Sam; I\'m locking it in tomorrow 10am.');
  assert.match(r, /Day 2: Sam has said nothing\. The group waits; I lock tomorrow 10am regardless\./);
  assert.match(TEMPLATES.lockDeadline('ruthless', { label: 'Fri', yes: 4, maybe: 0, absent: 'Yuki' }), /Time's up: Fri it is, and Yuki will hear about this\./);
  assert.equal(TEMPLATES.privacy.length, 1);
});

test('intro matches PRIVACY.md §1', () => {
  assert.equal(
    TEMPLATES.intro({ hours: 24 }),
    `Hi, I'm Homi 👋 When a plan is active, I look for plan-related messages, so you don't have to mention me each time. If hosted AI or live place search is enabled, configured providers may process relevant text or a location you share; I keep plan details, not chat history, delete the plan 24h after the event, and remove everything on "homi stop".`,
  );
});

test('date options use the agreed numbered date and time format', () => {
  assert.equal(TEMPLATES.optionBubble({ id: 1, label: 'Fri Oct 23, 7pm' }), '1. Fri Oct 23, 7pm');
  assert.equal(TEMPLATES.optionBubble({ id: 2, label: 'Sat Oct 24, 7pm' }), '2. Sat Oct 24, 7pm');
});
