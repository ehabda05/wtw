// PRIVACY.md §7: logs never contain message text, phone numbers, emails or handles.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SafeError, captureLogs, createLogger, sanitize } from '../../src/privacy/logger.js';
import { createStubPlaces } from '../../src/runner/mocks.js';
import type { PlacesService } from '../../src/runner/services.js';
import { fakeEngine, makeEnv, makePlan, textIn } from '../runner/helpers.js';

test('drops sensitive keys anywhere and scrubs every string', () => {
  const lines: string[] = [];
  const log = createLogger({ level: 'debug', sink: (l) => lines.push(l) });
  log.info('user +1 (617) 555-0134 wrote', {
    text: 'secret',
    content: 'secret',
    handle: 'persona:ana',
    phone: '+16175550134',
    address: '1 Main St',
    name: 'Ana',
    email: 'a@b.co',
    to: '+16175550134',
    from_number: '+16175550134',
    to_number: '+16175550134',
    nested: { Text: 'secret', ok: 'mail ana@example.com', list: ['call 617-555-0134'] },
    count: 3,
  });
  assert.equal(lines.length, 1);
  const rec = JSON.parse(lines[0]);
  assert.equal(rec.msg, 'user [phone] wrote');
  for (const k of ['text', 'content', 'handle', 'phone', 'address', 'name', 'email', 'to', 'from_number', 'to_number']) {
    assert.ok(!(k in rec), `${k} dropped`);
  }
  assert.deepEqual(rec.nested, { ok: 'mail [email]', list: ['call [phone]'] });
  assert.equal(rec.count, 3);
  assert.ok(!lines[0].includes('secret') && !lines[0].includes('555'));
});

test('foreign error messages are omitted (they can echo chat text); our SafeError messages are kept, redacted', () => {
  const foreign = Object.assign(new Error('send "see you friday" to +1 617 555 0134 failed'), { status: 400, code: 'E_HTTP' });
  const out = sanitize({ err: foreign }) as { err: Record<string, unknown> };
  assert.deepEqual(out.err, { name: 'Error', code: 'E_HTTP', status: 400 });
  const safe = sanitize({ err: new SafeError('telegram leaveChat returned HTTP 403 for +16175550134') }) as { err: Record<string, unknown> };
  assert.equal(safe.err.message, 'telegram leaveChat returned HTTP 403 for [number]');
});

test('level filtering and child bindings', () => {
  const lines: string[] = [];
  const log = createLogger({ level: 'warn', sink: (l) => lines.push(l) }).child({ mod: 'x' });
  log.debug('d');
  log.info('i');
  log.warn('w');
  log.error('e');
  assert.deepEqual(lines.map((l) => JSON.parse(l).level), ['warn', 'error']);
  assert.equal(JSON.parse(lines[0]).mod, 'x');
  const silent: string[] = [];
  createLogger({ level: 'silent', sink: (l) => silent.push(l) }).error('nope');
  assert.equal(silent.length, 0);
});

test('captureLogs hook captures loggers without an explicit sink', () => {
  const cap = captureLogs();
  try {
    createLogger({ level: 'info' }).info('hello', { phone: '+16175550134' });
  } finally {
    cap.restore();
  }
  assert.equal(cap.lines.length, 1);
  assert.ok(!cap.lines[0].includes('6175550134'));
});

test('runner end-to-end: injected phone / email / text / handle never reach a log line', async () => {
  const PHONE = '+1 (617) 555-0134';
  const EMAIL = 'zeb.secret@example.com';
  const TEXT = 'secret dinner at the Zebulon place';
  const HANDLE = 'persona:zebulon-handle';
  const SPACE = 'chat-secret-9876543';
  const engine = fakeEngine((s, ev, ctx) => {
    if (ev.kind !== 'message') return;
    s.plan = s.plan ?? makePlan(ctx.newId(), { neighborhood: 'Harvard Square' });
    // A careless engine that echoes everything back: the runner/executor must still not log it.
    return [
      { type: 'send', text: `${ev.text} ${PHONE} ${EMAIL}`, prompting: 'prompted', tag: `echo` },
      { type: 'reply', to: ev.msgRef, text: `${TEXT} ${PHONE}`, prompting: 'prompted' },
      { type: 'lookup_places', requestId: 'rq1', query: { cuisines: ['thai'], diet: [], near: `${TEXT} ${EMAIL}` } },
      { type: 'remember_handle', member: ev.from.key, planId: s.plan.id },
      { type: 'dm', member: ev.from.key, text: `${TEXT} ${PHONE}` },
      { type: 'call', member: ev.from.key, question: `${TEXT}?`, options: ['a'], callRef: 'c1' },
    ];
  });
  const failingPlaces: PlacesService = {
    async search(q) {
      throw new Error(`lookup failed for ${q.near} ${PHONE}`);
    },
    async weather() {
      return null;
    },
  };
  const env = makeEnv({ engine, places: failingPlaces, logLevel: 'debug' });
  env.adapter.failWith = new Error(`HTTP 400 for "${TEXT}" to ${PHONE} / ${EMAIL} / ${HANDLE} in ${SPACE}`);
  const cap = captureLogs();
  try {
    await env.runner.handleInbound(textIn(SPACE, HANDLE, `otto ${TEXT} call ${PHONE} or ${EMAIL}`, { from: { handle: HANDLE, platformName: 'Zebulon' } }));
    void createStubPlaces;
  } finally {
    cap.restore();
  }
  const all = [...env.lines, ...cap.lines].join('\n');
  assert.ok(env.lines.length > 3, 'the pipeline did log (at debug)');
  for (const secret of ['6175550134', '555-0134', '(617)', EMAIL, 'zeb.secret', 'Zebulon', 'zebulon-handle', TEXT, 'secret dinner', 'Harvard Square', '9876543', SPACE]) {
    assert.ok(!all.includes(secret), `log leaked "${secret}"`);
  }
  // every line is valid JSON
  for (const l of env.lines) JSON.parse(l);
});
