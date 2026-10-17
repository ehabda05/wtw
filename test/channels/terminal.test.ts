import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTerminal, parsePersonaLine } from '../../src/channels/terminal.js';

test('persona shim parsing', () => {
  assert.deepEqual(parsePersonaLine('ana: hello there'), { persona: 'ana', text: 'hello there' });
  assert.deepEqual(parsePersonaLine('Ben:  otto dinner?'), { persona: 'ben', text: 'otto dinner?' });
  assert.deepEqual(parsePersonaLine('just text'), { persona: 'you', text: 'just text' });
  assert.deepEqual(parsePersonaLine('just text', 'maya'), { persona: 'maya', text: 'just text' });
  assert.deepEqual(parsePersonaLine('otto: what do you know'), { persona: 'you', text: 'otto: what do you know' }, 'otto is not a persona');
  assert.deepEqual(parsePersonaLine('see https://x.y/z'), { persona: 'you', text: 'see https://x.y/z' });
  assert.deepEqual(parsePersonaLine('/as Sam'), { persona: 'sam', text: '', switchedTo: 'sam' });
});

test('normalizeTerminal: persona handle, reply-to, reactions use the current persona, /as switches', () => {
  const st = { persona: 'you' };
  const space = { id: 'chat-1' };
  const ts = new Date(1000);
  const a = normalizeTerminal(space, { id: 'm1', content: { type: 'text', text: 'ana: otto plan dinner' }, sender: { id: 'terminal-user' }, timestamp: ts, replyTo: { messageId: 'o-3' } }, st);
  assert.deepEqual(a, {
    surface: 'terminal',
    spaceId: 'chat-1',
    isGroup: true,
    msgId: 'm1',
    mentionsAgent: false,
    at: 1000,
    kind: 'text',
    from: { handle: 'persona:ana', platformName: 'Ana' },
    text: 'otto plan dinner',
    replyTo: 'o-3',
  });
  assert.equal(normalizeTerminal(space, { id: 'm2', content: { type: 'text', text: '/as ben' } }, st), null);
  assert.equal(st.persona, 'ben');
  const r = normalizeTerminal(space, { id: 'reaction:o-1:👍:t', content: { type: 'reaction', emoji: '👍', target: { id: 'o-1' } } }, st);
  assert.equal(r?.kind, 'reaction');
  assert.deepEqual(r?.reaction, { emoji: '👍', target: 'o-1' });
  assert.equal(r?.from?.handle, 'persona:ben');
});
