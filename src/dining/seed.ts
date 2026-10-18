// Plants a "last week" dinner into the live memory so the demo can show memory across time (npm run dining:seed).
// Targets the most recently active chat in the memory DB (or --space "<surface>|<id>"). Safe to run twice.

import { DiningMemory } from './memory.js';
import { diningEnv } from './boot.js';

const argv = process.argv.slice(2);
const spaceArg = argv[argv.indexOf('--space') + 1];
const memory = new DiningMemory(diningEnv().dbPath);
const row = spaceArg && argv.includes('--space')
  ? { space_id: spaceArg }
  : (memory.db.prepare('SELECT space_id FROM chats ORDER BY updated_at DESC LIMIT 1').get() as { space_id: string } | undefined);
if (!row) {
  process.stderr.write('dining:seed: no chat in memory yet; send one message in the group first, or pass --space "<surface>|<id>"\n');
  process.exit(1);
}
const key = row.space_id;
const week = 7 * 24 * 3_600_000;
const at = Date.now() - week;
const chat = memory.chat(key);
const names = chat.roster?.length ? chat.roster : ['Ana', 'Ben', 'Sam', 'Jo'];
const [a, b, c] = [names[0], names[1] ?? 'Ben', names[2] ?? 'Sam'];

const label = 'Dumpling House (last week)';
memory.addMessage({ spaceId: key, at, sender: b, role: 'user', text: 'homi split this, i paid. 86.40 total, 3 ways with ana and sam', hasImage: false });
memory.addMessage({ spaceId: key, at: at + 60_000, sender: 'Homi', role: 'homi', text: `Dumpling House, $86.40 paid by ${b}: ${a} pays ${b} $28.80, ${c} pays ${b} $28.80.`, hasImage: false });
memory.record(key, label, [
  { kind: 'debt', from: a, to: b, amount: 28.8 },
  { kind: 'debt', from: c, to: b, amount: 28.8 },
], at + 60_000);
memory.setNotes(
  key,
  `${chat.notes.trim() ? chat.notes.trim() + '\n' : ''}Bill (last week, Dumpling House): paid by ${b}, total $86.40, split 3 ways: ${a} and ${c} owe ${b} $28.80 each (unsettled). ${c} said the dumplings were the best in Cambridge.`,
);
memory.setProcessed(key, memory.lastId(key));
process.stdout.write(`seeded ${key}: ${label}; balances now: ${memory.balancesText(key)}\n`);
memory.close();
