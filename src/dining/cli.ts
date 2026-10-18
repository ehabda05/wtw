// Try the dining agent in a fake group chat (npm run dining). Uses the real Claude agent, so ANTHROPIC_API_KEY
// (from .env) is required. Memory is in-memory unless --db <path>.
//
//   ana: we should get dinner this week     speak as a persona (ana, ben, sam, jo, maya, you); plain text = you
//   /photo ben C:\path\receipt.jpg [caption]   ben sends a real photo (e.g. a receipt)
//   /react ben 👍                           ben reacts to Homi's latest message
//   /notes                                  show Homi's memory notes
//   /quit

import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { DEFAULT_PERSONAS, SimHub, personaName } from '../channels/sim.js';
import { loadConfig } from '../config.js';
import { DiningAgent } from './agent.js';
import { diningEnv } from './boot.js';
import { DiningMemory } from './memory.js';
import { DiningRunner } from './runner.js';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dbIdx = argv.indexOf('--db');
  const config = loadConfig({ sim: true, warn: () => undefined });
  if (!config.anthropicApiKey) {
    process.stderr.write('dining: ANTHROPIC_API_KEY is not set (put it in .env)\n');
    process.exitCode = 1;
    return;
  }
  const env = diningEnv();
  const memory = new DiningMemory(dbIdx >= 0 ? argv[dbIdx + 1] : ':memory:');
  const agent = new DiningAgent({ apiKey: config.anthropicApiKey, model: env.model, city: env.city, tz: config.defaultTz, botName: env.botName });
  const verbose = argv.includes('--verbose');
  const runner = new DiningRunner({
    agent,
    memory,
    debounceMs: 800,
    log: (lvl, msg, f) => {
      if (lvl === 'error' || lvl === 'warn' || verbose) process.stderr.write(`\x1b[2m[${lvl}] ${msg} ${JSON.stringify(f ?? {})}\x1b[0m\n`);
    },
  });
  const hub = new SimHub();
  runner.addAdapter(hub);
  await hub.start((m) => runner.handleInbound(m));
  runner.start(1000);
  const space = hub.createSpace(DEFAULT_PERSONAS).id;

  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });
  hub.onTranscript((e) => {
    if (e.from !== 'homi') return;
    process.stdout.write('\r\x1b[2K');
    if (e.kind === 'react') process.stdout.write(`\x1b[1;36mHomi\x1b[0m reacted ${e.text}\n`);
    else if (e.kind === 'send' || e.kind === 'reply') process.stdout.write(`\x1b[1;36mHomi\x1b[0m  ${e.text.replace(/\n/g, '\n      ')}\n`);
    rl.prompt(true);
  });

  process.stdout.write(`Homi dining sim. Model ${agent.model}. Personas: ${DEFAULT_PERSONAS.join(', ')}. Type "ana: text", /photo, /react, /notes, /quit.\n`);
  // Simulate "Homi was added" so it introduces itself.
  await runner.handleInbound({ surface: 'sim', spaceId: space, isGroup: true, kind: 'added_to_group', msgId: 'added', mentionsAgent: false, at: Date.now() });
  rl.prompt();
  rl.on('line', (raw) => {
    void (async () => {
      const line = raw.trim();
      if (!line) return rl.prompt();
      if (line === '/quit') return rl.close();
      if (line === '/notes') {
        process.stdout.write(`\x1b[33m${memory.chat(`sim|${space}`).notes || '(empty)'}\x1b[0m\n`);
        return rl.prompt();
      }
      let m = /^\/photo\s+(\w+)\s+(\S+)(?:\s+(.*))?$/.exec(line);
      if (m) {
        const [, who, path, caption] = m;
        try {
          const bytes = new Uint8Array(readFileSync(path));
          const mime = /\.png$/i.test(path) ? 'image/png' : /\.webp$/i.test(path) ? 'image/webp' : 'image/jpeg';
          await hub.photoAs(space, who, caption, { bytes, mime });
        } catch (err) {
          process.stdout.write(`could not read ${path}: ${(err as Error).message}\n`);
        }
        return rl.prompt();
      }
      m = /^\/react\s+(\w+)\s+(\S+)$/.exec(line);
      if (m) {
        const target = hub.lastHomiMessage(space)?.ref;
        if (target) await hub.reactAs(space, m[1], m[2], target);
        return rl.prompt();
      }
      const say = /^(\w+):\s*(.+)$/.exec(line);
      const [who, text] = say && (DEFAULT_PERSONAS as readonly string[]).includes(say[1].toLowerCase()) ? [say[1].toLowerCase(), say[2]] : ['you', line];
      await hub.say(space, who, text);
      rl.prompt();
    })().catch((err) => process.stderr.write(`error: ${(err as Error).message}\n`));
  });
  rl.on('close', () => {
    runner.stop();
    memory.close();
    process.stdout.write(`\nbye (${personaName('you')})\n`);
    process.exit(0);
  });
}

main().catch((err: unknown) => {
  process.stderr.write(`dining: ${(err as Error).message}\n`);
  process.exit(1);
});
