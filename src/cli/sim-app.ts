// Interactive offline demo (npm run sim). Same engine, same runner, same store as production; an in-process group
// chat with personas, a fast-forwardable clock, offline places, and a clearly-labeled simulated phone call.
//
//   ana: dinner next week homi?          speak as a persona (ana, ben, sam, jo, maya, you); plain text = you
//   /react ben ❤️ 2                      react to Homi's option bubble #2 (place bubble #2 while a place vote is open)
//   /react ben ❤️ last                   react to Homi's latest message (or a ref like sim-12)
//   /reply ben 2 works for me            inline reply to option bubble 2
//   /ff 12h                              fast-forward; due jobs (nudges, reminders, purge) fire in order
//   /answer sam friday works             what the simulated call will "hear" from sam
//   /photo jo homi add                   jo shares a (generated) photo with that caption; no caption = not shared
//   /new  /members  /added  /db  /time  /help  /quit
//
// Flags: --script <file>  --out <file.json>  --start <ISO>  --tz <IANA>  --fancy  --db <path>  --verbose

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { createExtHandlers, type ExtHandlerDeps } from '../runner/handlers/index.js';
import { DateTime } from 'luxon';
import { DEFAULT_PERSONAS, SimHub, personaFromHandle, personaHandle, personaName, type TranscriptEntry } from '../channels/sim.js';
import { loadConfig } from '../config.js';
import type { GroupState } from '../engine/types.js';
import { Sealer } from '../privacy/crypto.js';
import { Ids } from '../privacy/ids.js';
import { createLogger, type LogLevel } from '../privacy/logger.js';
import { Retention } from '../privacy/retention.js';
import { FakeClock, parseDuration } from '../runner/clock.js';
import { loadPlacesService, loadVoiceService } from '../runner/load.js';
import { MockVoice, cannedPlaceOptions, createStubPlaces } from '../runner/mocks.js';
import { Runner } from '../runner/runner.js';
import { Scheduler } from '../runner/scheduler.js';
import { loadEngine, type CallRequest, type EngineApi, type VoiceService } from '../runner/services.js';
import { describeSchema, openDatabase, proveNoTextColumns } from '../store/db.js';
import { routerFromEnv } from '../llm/router.js';
import { Repo } from '../store/repo.js';

// ───────────── args ─────────────

interface Args {
  script?: string;
  out?: string;
  start?: string;
  tz?: string;
  db?: string;
  engine?: string;
  fancy: boolean;
  verbose: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { fancy: false, verbose: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => {
      const val = argv[++i];
      if (val === undefined) throw new Error(`${k} needs a value`);
      return val;
    };
    if (k === '--script') a.script = v();
    else if (k === '--out') a.out = v();
    else if (k === '--start') a.start = v();
    else if (k === '--tz') a.tz = v();
    else if (k === '--db') a.db = v();
    else if (k === '--engine') a.engine = v();
    else if (k === '--fancy') a.fancy = true;
    else if (k === '--verbose') a.verbose = true;
    else if (k === '--help' || k === '-h') a.help = true;
    else throw new Error(`unknown flag ${k} (try --help)`);
  }
  return a;
}

// ───────────── colors ─────────────

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const esc = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const c = {
  dim: esc('2'),
  bold: esc('1'),
  homi: esc('1;36'),
  system: esc('33'),
  dm: esc('35'),
  ok: esc('32'),
  err: esc('31'),
};
const PERSONA_COLORS: Record<string, (s: string) => string> = {
  ana: esc('91'),
  ben: esc('92'),
  sam: esc('93'),
  jo: esc('94'),
  maya: esc('95'),
  you: esc('97'),
};
const pc = (p: string) => PERSONA_COLORS[p] ?? esc('37');

const HELP = `
${c.bold('Homi sim')}: an offline group chat. Personas: ${DEFAULT_PERSONAS.join(', ')}.
  ${c.bold('ana: text')}                speak as a persona (plain text speaks as "you")
  ${c.bold('/react ben ❤️ 2')}          react to Homi's option bubble #2 (place bubble while a place vote is open)
  ${c.bold('/react ben 👍 last')}       react to Homi's latest message (or a ref like sim-12)
  ${c.bold('/reply ben 2 works for me')} inline reply to option bubble 2 (or last / sim-12)
  ${c.bold('/ff 12h')}                  fast-forward the clock (30m, 2d, 1h30m); due nudges / reminders / purges fire
  ${c.bold('/answer sam friday works')} what the ${c.system('(simulated)')} phone call hears from sam
  ${c.bold('/photo jo homi add')}       jo shares a generated sample photo with that caption (no caption = not shared)
  ${c.bold('/members')}                 send a roster snapshot   ${c.bold('/added')}  "Homi was added" event
  ${c.bold('/new')}                     start a fresh group chat ${c.bold('/time')}   show the fake clock
  ${c.bold('/db')}                      row counts + proof that no column can hold message text
  ${c.bold('/help')}  ${c.bold('/quit')}
`;

// ───────────── app ─────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
    return;
  }
  const interactive = !args.script;
  const notices: string[] = [];
  const config = loadConfig({ sim: true, warn: (m) => notices.push(m) });
  if (args.tz) {
    if (!DateTime.local().setZone(args.tz).isValid) throw new Error(`unknown time zone ${args.tz}`);
    config.defaultTz = args.tz;
  }
  const tz = config.defaultTz;
  const start = args.start ? DateTime.fromISO(args.start, { zone: tz }) : DateTime.now();
  if (!start.isValid) throw new Error(`bad --start ${args.start} (use ISO, e.g. 2026-10-17T10:00)`);

  const level: LogLevel = args.verbose ? 'info' : 'warn';
  const logger = createLogger({ level, sink: (line) => process.stderr.write(c.dim(line) + '\n') });

  const clock = new FakeClock(start.toMillis());
  const db = openDatabase(args.db ?? ':memory:');
  const repo = new Repo(db, new Sealer(config.dataKey), { now: () => clock.now(), logger });
  const ids = new Ids(config.idSalt);

  let engine: EngineApi;
  try {
    if (args.engine) {
      const mod = (await import(pathToFileURL(resolve(args.engine)).href)) as EngineApi;
      engine = { applyEvent: mod.applyEvent, newGroupState: mod.newGroupState, detectAddressed: mod.detectAddressed };
    } else {
      engine = await loadEngine();
    }
  } catch (err) {
    process.stderr.write(c.err(`sim: the engine could not be loaded (${(err as Error).message}).\n`));
    process.exitCode = 1;
    return;
  }

  const places = await loadPlacesService(config, logger, () => createStubPlaces(cannedPlaceOptions()));
  const mockFallback = new MockVoice({ delayMs: 2000 });
  const voiceLoaded = await loadVoiceService(
    { ...config, voice: { ...config.voice, mode: 'mock' } },
    { now: () => clock.now(), mockDelayMs: 2000, scheduleTimeout: (fn, ms) => setTimeout(fn, ms) },
    logger,
    () => mockFallback,
  );
  const voice = voiceLoaded.service as VoiceService & { setScriptedAnswer?(member: string, answer: string): void };

  // ── transcript printing ──
  const fmtTime = (t: number) => DateTime.fromMillis(t, { zone: tz }).toFormat('ccc HH:mm');
  let current = '';
  const tty = !!process.stdout.isTTY;
  const print = (s: string) => {
    if (interactive && rl && tty) {
      process.stdout.write('\r\x1b[2K');
      process.stdout.write(s + '\n');
      rl.prompt(true);
    } else {
      process.stdout.write(s + '\n');
    }
  };
  const hub = new SimHub({
    now: () => clock.now(),
    beforeHomiMessage: args.fancy
      ? async () => {
          if (!process.stdout.isTTY) return;
          for (let i = 0; i < 3; i++) {
            process.stdout.write(`\r\x1b[2K${c.dim('  Homi is typing' + '.'.repeat(i + 1))}`);
            await new Promise((r) => setTimeout(r, 220));
          }
          process.stdout.write('\r\x1b[2K');
        }
      : undefined,
  });

  const render = (e: TranscriptEntry): string | null => {
    const time = c.dim(`[${fmtTime(e.at)}]`);
    const ref = e.ref && e.from === 'homi' ? c.dim(` #${e.ref}`) : '';
    const target = e.target ? hub.entry(e.target) : undefined;
    const targetLabel = target ? `${target.from === 'homi' ? 'Homi' : personaName(target.from)} "${trunc(target.text, 28)}"` : e.target;
    if (e.from === 'homi') {
      switch (e.kind) {
        case 'send':
          return `${time} ${c.homi('Homi')}  ${e.text}${ref}`;
        case 'reply':
          return `${time} ${c.homi('Homi')} ${c.dim(`↪ ${targetLabel}`)}\n         ${e.text}${ref}`;
        case 'dm':
          return `${time} ${c.dm(`Homi → ${personaName(e.to ?? '?')} (private DM)`)}  ${e.text}${ref}`;
        case 'file':
          return `${time} ${c.homi('Homi')}  📎 ${e.text}${ref}`;
        case 'edit':
          return `${time} ${c.homi('Homi')} ${c.dim(`✎ edited #${e.target}`)}  ${e.text}`;
        case 'react':
          return `${time} ${c.homi('Homi')} reacted ${e.text} to ${targetLabel}`;
        case 'leave':
          return `${time} ${c.system('Homi left the group')}`;
        default:
          return `${time} ${c.homi('Homi')}  ${e.text}`;
      }
    }
    if (e.from === 'system') return `${time} ${c.system(e.text)}`;
    const who = pc(e.from)(personaName(e.from));
    if (e.kind === 'react') return `${time} ${who} reacted ${e.text} to ${targetLabel}`;
    if (e.kind === 'reply') return `${time} ${who} ${c.dim(`↪ ${targetLabel}`)}\n         ${e.text}`;
    return `${time} ${who}  ${e.text}`;
  };
  hub.onTranscript((e) => {
    const s = render(e);
    if (s) print(s);
  });

  // ── voice wrapper: labels the simulated call, tracks pending calls for scripts ──
  let pendingCalls = 0;
  let callWaiters: (() => void)[] = [];
  const spaceOfPlan = (planId: string) => {
    const k = repo.spaceForPlan(planId);
    return (k && repo.getRouting(k)?.spaceId) || current;
  };
  const trackedVoice: VoiceService = {
    async placeCall(req: CallRequest) {
      pendingCalls++;
      const who = personaName(personaFromHandle(req.to) ?? 'member');
      hub.system(spaceOfPlan(req.planId), `📞 (simulated call) Homi is calling ${who}: "${req.question}"`, 'call', { to: personaFromHandle(req.to) });
      try {
        await voice.placeCall(req);
      } catch (err) {
        pendingCalls--;
        throw err;
      }
    },
    onResult: (cb) => voice.onResult(cb),
  };

  // Extension handlers (travel, pledges, album). Album photos are sealed with the sim's key into a temp folder
  // that is deleted on exit; no PUBLIC_BASE_URL, so album links are labeled demo links.
  const albumDir = mkdtempSync(join(tmpdir(), 'homi-sim-'));
  const extDeps: ExtHandlerDeps & { dataKey: Buffer } = {
    dataDir: albumDir,
    dataKey: config.dataKey,
    paymentsProvider: config.paymentsProvider,
    travelProvider: config.travelProvider,
    now: () => clock.now(),
  };
  const ext = createExtHandlers(extDeps);
  const cleanupAlbums = () => rmSync(albumDir, { recursive: true, force: true });

  // Optional LLM repair router: HOMI_LLM=on (or DISABLE_HOSTED_LLM=false) AND ANTHROPIC_API_KEY; off otherwise.
  const llm = routerFromEnv();

  const runner = new Runner({
    engine,
    repo,
    ids,
    clock,
    config,
    logger,
    places: places.service,
    voice: trackedVoice,
    onSent: (info) => hub.annotate(info.msgRef, info.tag),
    handlers: ext.handlers,
    photoStore: ext.photoStore,
    repairWithLlm: llm.repair ?? undefined,
    llmFirst: llm.first,
    extraNames: DEFAULT_PERSONAS.map(personaName),
  });
  voice.onResult((r) => {
    void (async () => {
      try {
        const sid = spaceOfPlan(r.planId);
        const label = r.ok ? `answered: "${r.answerText ?? ''}"` : 'did not pick up';
        hub.system(sid, `📞 (simulated call) ${label}`, 'call');
        await runner.handleCallResult(r);
      } finally {
        pendingCalls = Math.max(0, pendingCalls - 1);
        if (pendingCalls === 0) for (const w of callWaiters.splice(0)) w();
      }
    })();
  });
  runner.addAdapter(hub);
  await hub.start((m) => runner.handleInbound(m));

  const scheduler = new Scheduler({ repo, runner, clock, retention: new Retention(repo, logger), logger });
  scheduler.start();

  current = hub.createSpace(DEFAULT_PERSONAS).id;
  const spaceKey = () => ids.space('sim', current);

  const settle = async (waitCalls: boolean) => {
    await runner.whenIdle();
    if (waitCalls && pendingCalls > 0) {
      await new Promise<void>((r) => callWaiters.push(r));
      await runner.whenIdle();
    }
    await scheduler.tick();
    await runner.whenIdle();
  };

  // ── target resolution for /react and /reply ──
  const resolveTarget = (spec: string): string | undefined => {
    if (spec === 'last') return hub.lastHomiMessage(current)?.ref;
    if (/^(sim|u)-\d+$/.test(spec)) return spec;
    const n = Number(spec.replace(/^#/, ''));
    if (!Number.isInteger(n) || n < 1) return undefined;
    const state: GroupState | null = repo.loadGroup(spaceKey());
    const plan = state?.plan;
    if (plan) {
      const placeVote = plan.hungry && plan.hungry.phase === 'voting';
      const place = plan.refs?.placeOptions?.[n];
      const option = plan.refs?.options?.[n];
      if (placeVote && place) return place;
      if (option) return option;
      if (place) return place;
    }
    // Fallback: a Homi message whose engine tag ends with the number (e.g. "option:2").
    const tagged = hub
      .homiMessages(current)
      .reverse()
      .find((e) => e.tag && new RegExp(`(^|\\D)${n}$`).test(e.tag));
    return tagged?.ref;
  };

  const personaOk = (p: string) => hub.spaces.get(current)?.personas.includes(p) ?? false;

  const handleLine = async (raw: string): Promise<boolean> => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return true;
    if (line.startsWith('/')) {
      const [cmd, ...rest] = line.split(/\s+/);
      switch (cmd.toLowerCase()) {
        case '/help':
          process.stdout.write(HELP);
          return true;
        case '/quit':
        case '/exit':
          return false;
        case '/time':
          print(c.dim(`⏱  ${DateTime.fromMillis(clock.now(), { zone: tz }).toFormat("cccc d LLL yyyy, HH:mm ZZZZ")}`));
          return true;
        case '/new': {
          current = hub.createSpace(DEFAULT_PERSONAS).id;
          print(c.system(`── new group ${current} (${DEFAULT_PERSONAS.join(', ')}) ──`));
          return true;
        }
        case '/ff': {
          const ms = parseDuration(rest.join(''));
          await clock.advance(ms);
          await settle(!interactive);
          print(c.dim(`⏩ +${rest.join('')} → ${DateTime.fromMillis(clock.now(), { zone: tz }).toFormat('ccc d LLL HH:mm')}`));
          return true;
        }
        case '/answer': {
          const [p, ...words] = rest;
          if (!p || words.length === 0) throw new Error('usage: /answer sam friday works');
          const answer = words.join(' ');
          const memberKey = ids.member('sim', current, personaHandle(p.toLowerCase()));
          voice.setScriptedAnswer?.(memberKey, answer);
          mockFallback.setAnswer(personaHandle(p.toLowerCase()), answer);
          print(c.dim(`📞 if Homi calls ${personaName(p.toLowerCase())}, they will say: "${answer}"`));
          return true;
        }
        case '/react': {
          const [p, emoji, spec = 'last'] = rest;
          if (!p || !emoji) throw new Error('usage: /react ben ❤️ 2');
          if (!personaOk(p.toLowerCase())) throw new Error(`unknown persona ${p}`);
          const target = resolveTarget(spec);
          if (!target) throw new Error(`no Homi message "${spec}" to react to`);
          await hub.reactAs(current, p.toLowerCase(), emoji, target);
          await settle(!interactive);
          return true;
        }
        case '/reply': {
          const [p, spec, ...words] = rest;
          if (!p || !spec || words.length === 0) throw new Error('usage: /reply ben 2 works for me');
          if (!personaOk(p.toLowerCase())) throw new Error(`unknown persona ${p}`);
          const target = resolveTarget(spec);
          if (!target) throw new Error(`no Homi message "${spec}" to reply to`);
          await hub.say(current, p.toLowerCase(), words.join(' '), { replyTo: target });
          await settle(!interactive);
          return true;
        }
        case '/photo': {
          const [p, ...words] = rest;
          if (!p) throw new Error('usage: /photo jo homi add');
          if (!personaOk(p.toLowerCase())) throw new Error(`unknown persona ${p}`);
          await hub.photoAs(current, p.toLowerCase(), words.join(' ') || undefined);
          await settle(!interactive);
          return true;
        }
        case '/members':
          await hub.members(current);
          await settle(!interactive);
          print(c.dim(`👥 roster snapshot sent (${hub.spaces.get(current)?.personas.length ?? 0} members)`));
          return true;
        case '/added':
          await hub.addedToGroup(current);
          await settle(!interactive);
          return true;
        case '/db': {
          const counts = repo.counts();
          print(c.bold('rows: ') + Object.entries(counts).map(([t, n]) => `${t} ${n}`).join(' · '));
          const proof = proveNoTextColumns(db);
          const schema = describeSchema(db);
          for (const [table, cols] of Object.entries(schema)) {
            const parts = cols.map((col) => {
              const p = proof.find((x) => x.table === table && x.column === col.name);
              const mark = p?.rejected ? c.ok('✓') : c.err('✗');
              return `${col.name}:${col.type.toLowerCase()}${mark}`;
            });
            print(`  ${c.bold(table.padEnd(8))} ${parts.join('  ')}`);
          }
          const rejected = proof.filter((p) => p.rejected).length;
          const verdict = rejected === proof.length ? c.ok('no column can hold message text') : c.err('A COLUMN ACCEPTED TEXT');
          print(`  tried to store a chat message in every column: ${rejected}/${proof.length} rejected → ${verdict}`);
          return true;
        }
        default:
          throw new Error(`unknown command ${cmd} (try /help)`);
      }
    }
    const m = /^([A-Za-z]+):\s+([\s\S]+)$/.exec(line);
    let persona = 'you';
    let text = line;
    if (m && personaOk(m[1].toLowerCase())) {
      persona = m[1].toLowerCase();
      text = m[2];
    }
    await hub.say(current, persona, text);
    await settle(!interactive);
    return true;
  };

  const writeOut = () => {
    if (!args.out) return;
    const doc = {
      meta: {
        product: 'Homi',
        generatedBy: 'npm run sim',
        start: start.toISO(),
        tz,
        simulatedCalls: true,
        places: places.real ? 'src/places (offline snapshot)' : 'canned stub',
      },
      transcript: hub.transcript.map((e) => ({
        ...e,
        iso: DateTime.fromMillis(e.at, { zone: tz }).toISO(),
        file: e.file ? { name: e.file.name, mime: e.file.mime } : undefined,
      })),
    };
    writeFileSync(args.out, JSON.stringify(doc, null, 2));
    process.stderr.write(c.dim(`transcript written to ${args.out}\n`));
  };

  const banner = () => {
    process.stdout.write(
      `${c.homi('Homi sim')} ${c.dim(`· group ${current} · ${DEFAULT_PERSONAS.join(', ')} · ${DateTime.fromMillis(clock.now(), { zone: tz }).toFormat('ccc d LLL HH:mm')} ${tz}`)}\n` +
        c.dim(`places: ${places.real ? 'offline OSM snapshot' : 'canned stub'} · voice: simulated · data: in memory${config.ephemeralKeys ? ', ephemeral keys' : ''} · /help\n`) +
        c.dim(`${llm.note}\n`),
    );
  };

  let rl: ReturnType<typeof createInterface> | undefined;
  if (!interactive) {
    banner();
    const lines = readFileSync(args.script!, 'utf8').split(/\r?\n/);
    for (const l of lines) {
      if (!l.trim() || l.trim().startsWith('#')) continue;
      try {
        if (!(await handleLine(l))) break;
      } catch (err) {
        process.stdout.write(c.err(`! ${(err as Error).message}\n`));
      }
    }
    await settle(true);
    writeOut();
    scheduler.stop();
    db.close();
    cleanupAlbums();
    return;
  }

  banner();
  rl = createInterface({ input: process.stdin, output: process.stdout, prompt: tty ? c.dim('› ') : '', terminal: tty });
  if (tty) rl.prompt();
  let queue = Promise.resolve();
  let closed = false;
  const finish = () => {
    if (closed) return;
    closed = true;
    writeOut();
    scheduler.stop();
    try {
      db.close();
      cleanupAlbums();
    } catch {
      /* ignore */
    }
    process.exit(0);
  };
  rl.on('line', (l) => {
    queue = queue.then(async () => {
      if (closed) return;
      // Re-render the typed persona line with colors (the raw input line is cleared first).
      if (tty && l.trim() && !l.trim().startsWith('/')) process.stdout.write('\x1b[1A\x1b[2K');
      try {
        if (!(await handleLine(l))) {
          rl?.close();
          return;
        }
      } catch (err) {
        print(c.err(`! ${(err as Error).message}`));
      }
      if (tty) rl?.prompt();
    });
  });
  rl.on('close', () => void queue.then(finish));
  process.on('SIGINT', finish);
}

function trunc(s: string, n: number): string {
  const one = s.replace(/\s+/g, ' ');
  return one.length > n ? one.slice(0, n - 1) + '…' : one;
}

main().catch((err: unknown) => {
  process.stderr.write(`sim: ${(err as Error).message}\n`);
  process.exit(1);
});
