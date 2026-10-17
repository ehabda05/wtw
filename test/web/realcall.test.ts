import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRealCalls, realCallsFromEnv } from '../../src/web/realcall.js';
import { DemoVoice } from '../../src/web/voice.js';
import { FakeClock } from '../../src/runner/clock.js';
import type { CallRequest, CallResult, VoiceService } from '../../src/runner/services.js';

test('WEB_REAL_CALLS parsing keeps valid persona=E.164 pairs only', () => {
  const r = parseRealCalls('sam=+16175550123, jo=617-555-0000; Maya = +447700900123');
  assert.deepEqual([...r.numbers.entries()], [['sam', '+16175550123'], ['maya', '+447700900123']]);
  assert.deepEqual(r.invalid, ['jo']);
});

test('real calls stay off (simulated) without the voice keys, and say why without echoing numbers', () => {
  const r = realCallsFromEnv({ WEB_REAL_CALLS: 'sam=+16175550123' } as NodeJS.ProcessEnv, 'no-such.env');
  assert.equal(r.bridge, null);
  assert.match(r.notes.join(' '), /RETELL_API_KEY/);
  assert.ok(!r.notes.join(' ').includes('555'));
});

test('a call to a mapped persona goes to the real service with the real number; others stay mocked', async () => {
  const placed: CallRequest[] = [];
  const listeners: ((r: CallResult) => void)[] = [];
  const fake: VoiceService = {
    async placeCall(req) {
      placed.push(req);
    },
    onResult(cb) {
      listeners.push(cb);
    },
  };
  const clock = new FakeClock(Date.parse('2026-10-17T22:00:00-04:00'));
  const voice = new DemoVoice(clock, 2000, { service: fake, numbers: new Map([['sam', '+16175550123']]) });
  const results: CallResult[] = [];
  voice.onResult((r) => void results.push(r));
  const views: string[] = [];
  voice.onCall = (c) => views.push(`${c.persona}:${c.state}:${c.real ? 'real' : 'sim'}`);

  await voice.placeCall({ to: 'persona:sam', question: 'Does Friday at 7 work?', options: [], callRef: 'c1', planId: 'p1', member: 'm-sam' });
  assert.equal(placed.length, 1);
  assert.equal(placed[0].to, '+16175550123');
  assert.equal(voice.pendingReal, 1);
  const settled = voice.whenRealSettled();
  for (const l of listeners) l({ planId: 'p1', member: 'm-sam', answerText: 'friday works', ok: true, simulated: false });
  await settled;
  assert.equal(voice.pendingReal, 0);
  assert.deepEqual(results.map((r) => [r.member, r.ok, r.simulated]), [['m-sam', true, false]]);
  assert.deepEqual(views, ['sam:ringing:real', 'sam:answered:real']);

  // Jo has no real number: the call is simulated (it waits for an answer typed in the browser).
  await voice.placeCall({ to: 'persona:jo', question: 'Does Friday at 7 work?', options: [], callRef: 'c2', planId: 'p1', member: 'm-jo' });
  assert.equal(placed.length, 1);
  assert.ok(voice.isRinging('jo'));
});
