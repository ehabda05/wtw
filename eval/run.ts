// Eval harness: replays the blind-written fixtures (eval/fixtures/*.json, format in eval/FORMAT.md) through the
// REAL stack: sim adapter → runner → engine → sealed SQLite store → scheduler on a fake clock, with offline
// places and a scripted mock call. Measures what README.md reports and writes eval/results.json + eval/RESULTS.md.
//
//   npm run eval            (all fixtures)
//   npm run eval -- 03      (fixtures whose id starts with 03)

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DateTime } from 'luxon';
import { SimHub, personaHandle } from '../src/channels/sim.js';
import { loadConfig } from '../src/config.js';
import type { Action, EngineEvent, GroupState, Option, Plan, Vote } from '../src/engine/types.js';
import { Sealer } from '../src/privacy/crypto.js';
import { Ids } from '../src/privacy/ids.js';
import { createLogger } from '../src/privacy/logger.js';
import { Retention } from '../src/privacy/retention.js';
import { FakeClock, parseDuration } from '../src/runner/clock.js';
import { loadPlacesService } from '../src/runner/load.js';
import { MockVoice, cannedPlaceOptions, createStubPlaces } from '../src/runner/mocks.js';
import { Runner } from '../src/runner/runner.js';
import { Scheduler } from '../src/runner/scheduler.js';
import { loadEngine, type EngineApi } from '../src/runner/services.js';
import { openDatabase } from '../src/store/db.js';
import { Repo } from '../src/store/repo.js';

const here = dirname(fileURLToPath(import.meta.url));
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
type Weekday = (typeof WEEKDAYS)[number];
type LabelVote = Vote | 'unknown';

interface Step {
  t?: string;
  from?: string;
  text?: string;
  label?: { intent: string; food: boolean; votes?: Partial<Record<Weekday, LabelVote>>; placeVote?: number };
  react?: { emoji: string; option: number; set?: 'date' | 'place' };
  ff?: string;
  answer?: { from: string; text: string };
  places?: string;
}
interface Fixture {
  id: string;
  title: string;
  tz: string;
  start: string;
  members: { id: string; name: string }[];
  steps: Step[];
  expect: {
    finalDay: Weekday | null;
    lockedBy: string | null;
    place: { cuisineAnyOf: string[]; priceMax: number } | null;
    hungryTriggered: boolean;
    maxUnpromptedPer12h: number;
    otherChecks: string[];
  };
}

interface EngineExtras {
  parseAvailability?: (text: string, options: Option[], tz: string) => {
    dayPrefs?: Record<string, { vote: Vote }>;
    optionVotes?: Record<number, Vote>;
    matched?: boolean;
  };
  classify?: (text: string, plan: Plan | null, now: number, tz: string) => { intent: string; foodScore?: number };
}

const weekdayOf = (isoDay: string, tz: string): Weekday =>
  WEEKDAYS[DateTime.fromISO(isoDay, { zone: tz }).weekday - 1];
const weekdayAt = (ms: number, tz: string): Weekday => WEEKDAYS[DateTime.fromMillis(ms, { zone: tz }).weekday - 1];

const PHONE = /(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;

interface FixtureResult {
  id: string;
  title: string;
  voteCells: number;
  voteCellsCorrect: number;
  voteMessages: number;
  voteMessagesExact: number;
  foodTP: number;
  foodFP: number;
  foodFN: number;
  foodTN: number;
  intentCorrect: number;
  intentTotal: number;
  finalDay: { expected: Weekday | null; actual: Weekday | null; ok: boolean };
  lockedBy: { expected: string | null; actual: string | null; ok: boolean };
  hungry: { expected: boolean; actual: boolean; ok: boolean };
  place: { expected: Fixture['expect']['place']; actual: { name: string; cuisine?: string; priceBand?: number } | null; ok: boolean | null };
  unprompted: number;
  maxUnpromptedIn12h: number;
  unpromptedOk: boolean;
  quietHourViolations: number;
  logLines: number;
  logLeaks: number;
  dbPlaintextLeaks: number;
  homiMessages: number;
  errors: string[];
}

async function runFixture(fx: Fixture, engine: EngineApi, extras: EngineExtras): Promise<FixtureResult> {
  const tz = fx.tz;
  const config = loadConfig({ sim: true, env: { DEFAULT_TZ: tz }, warn: () => {} });
  config.defaultTz = tz;
  const start = DateTime.fromISO(fx.start, { setZone: true });
  const clock = new FakeClock(start.toMillis());
  const lines: string[] = [];
  const logger = createLogger({ level: 'debug', sink: (l) => lines.push(l) });
  const db = openDatabase(':memory:');
  const repo = new Repo(db, new Sealer(config.dataKey), { now: () => clock.now(), logger });
  const ids = new Ids(config.idSalt);

  // Wrap the engine so every decision is auditable (prompting, lock reason, places, purges).
  const decisions: { at: number; event: EngineEvent; actions: Action[]; before: GroupState; after: GroupState }[] = [];
  const wrapped: EngineApi = {
    ...engine,
    applyEvent: (state, event, ctx) => {
      const r = engine.applyEvent(state, event, ctx);
      decisions.push({ at: ctx.now, event, actions: r.actions, before: state, after: r.state });
      return r;
    },
  };

  const places = await loadPlacesService(config, logger, () => createStubPlaces(cannedPlaceOptions()));
  const voice = new MockVoice({ clock, delayMs: 30_000, defaultAnswer: 'yes that works' });
  const hub = new SimHub({ now: () => clock.now() });
  const runner = new Runner({ engine: wrapped, repo, ids, clock, config, logger, places: places.service, voice });
  voice.onResult((r) => runner.handleCallResult(r));
  runner.addAdapter(hub);
  await hub.start((m) => runner.handleInbound(m));
  const scheduler = new Scheduler({ repo, runner, clock, retention: new Retention(repo, logger), logger });
  scheduler.start();

  const personas = fx.members.map((m) => m.id);
  const space = hub.createSpace(personas).id;
  const spaceKey = ids.space('sim', space);
  const settle = async () => {
    await runner.whenIdle();
    await scheduler.tick();
    await runner.whenIdle();
  };
  const plan = (): Plan | null => repo.loadGroup(spaceKey)?.plan ?? null;

  const res: FixtureResult = {
    id: fx.id, title: fx.title, voteCells: 0, voteCellsCorrect: 0, voteMessages: 0, voteMessagesExact: 0,
    foodTP: 0, foodFP: 0, foodFN: 0, foodTN: 0, intentCorrect: 0, intentTotal: 0,
    finalDay: { expected: fx.expect.finalDay, actual: null, ok: false },
    lockedBy: { expected: fx.expect.lockedBy, actual: null, ok: false },
    hungry: { expected: fx.expect.hungryTriggered, actual: false, ok: false },
    place: { expected: fx.expect.place, actual: null, ok: null },
    unprompted: 0, maxUnpromptedIn12h: 0, unpromptedOk: true, quietHourViolations: 0,
    logLines: 0, logLeaks: 0, dbPlaintextLeaks: 0, homiMessages: 0, errors: [],
  };

  const texts: string[] = [];
  for (const step of fx.steps) {
    try {
      if (step.t) {
        const ms = parseDuration(step.t.replace(/^\+/, ''));
        if (ms > 0) await clock.advance(ms);
        await settle();
      }
      if (step.ff) {
        await clock.advance(parseDuration(step.ff));
        await settle();
        continue;
      }
      if (step.answer) {
        voice.setAnswer(personaHandle(step.answer.from), step.answer.text);
        continue;
      }
      if (step.places) continue;
      if (step.react && step.from) {
        const p = plan();
        const set = step.react.set ?? 'date';
        const target = set === 'place' ? p?.refs.placeOptions?.[step.react.option] : p?.refs.options?.[step.react.option];
        if (!target) {
          res.errors.push(`no ${set} bubble #${step.react.option} to react to`);
          continue;
        }
        await hub.reactAs(space, step.from, step.react.emoji, target);
        await settle();
        continue;
      }
      if (step.text !== undefined && step.from) {
        texts.push(step.text);
        const p = plan();
        const label = step.label;
        // Per-message date reading, against the options open right now.
        if (label?.votes && extras.parseAvailability && p && p.options.length > 0) {
          const open = p.options.filter((o) => !o.removed);
          const parsed = extras.parseAvailability(step.text, open, tz);
          const byDay = new Map<Weekday, LabelVote>();
          for (const o of open) {
            const wd = weekdayOf(o.day, tz);
            const v: LabelVote = parsed.optionVotes?.[o.id] ?? parsed.dayPrefs?.[o.day]?.vote ?? 'unknown';
            if (!byDay.has(wd) || byDay.get(wd) === 'unknown') byDay.set(wd, v);
          }
          let exact = true;
          let scored = 0;
          for (const [wd, expected] of Object.entries(label.votes) as [Weekday, LabelVote][]) {
            if (!byDay.has(wd)) continue; // day not proposed (yet): not scorable
            scored++;
            res.voteCells++;
            if (byDay.get(wd) === expected) res.voteCellsCorrect++;
            else exact = false;
          }
          if (scored > 0) {
            res.voteMessages++;
            if (exact) res.voteMessagesExact++;
          }
        }
        // Food intent and overall intent, as the engine would classify this message in context.
        if (label && extras.classify) {
          const cls = extras.classify(step.text, p, clock.now(), tz);
          const placeVoting = p?.hungry?.phase === 'voting';
          const predFood = cls.intent === 'food' || cls.intent === 'food_answer' || (placeVoting && cls.intent === 'vote' && label.placeVote !== undefined);
          if (label.food && predFood) res.foodTP++;
          else if (!label.food && predFood) res.foodFP++;
          else if (label.food && !predFood) res.foodFN++;
          else res.foodTN++;
          res.intentTotal++;
          if (cls.intent === label.intent) res.intentCorrect++;
        }
        await hub.say(space, step.from, step.text);
        await settle();
      }
    } catch (err) {
      res.errors.push(`${step.from ?? ''} ${step.text ?? step.ff ?? ''}: ${(err as Error).message}`);
    }
  }
  if (voice.pending() > 0) {
    await clock.advance(60_000);
    await settle();
  }

  // ── outcomes from the decision log ──
  let finalDay: Weekday | null = null;
  let lockedBy: string | null = null;
  let hungry = false;
  let place: Plan['place'] | undefined;
  const unpromptedTimes: number[] = [];
  for (const d of decisions) {
    const b = d.before.plan;
    const a = d.after.plan;
    if (a && (a.state === 'collecting_place' || a.hungry)) hungry = true;
    if (a?.place) place = a.place;
    const wasOpen = b && (b.state === 'collecting_availability');
    const nowChosen = a && a.chosenOptionId !== undefined && a.state !== 'collecting_availability';
    if (wasOpen && nowChosen && b.chosenOptionId === undefined) {
      if (d.event.kind === 'timer' && d.event.job === 'availability_deadline') lockedBy = 'deadline';
      else if (a.forcedBy) lockedBy = 'forced';
      else if (a.threshold) lockedBy = 'threshold';
      else lockedBy = 'everyone';
    }
    if (a && (a.state === 'confirmed' || a.state === 'reminded' || a.state === 'completed') && a.eventAt) {
      finalDay = weekdayAt(a.eventAt, tz);
    }
    const userPurge = d.actions.some((x) => x.type === 'purge') && !(d.event.kind === 'timer' && (d.event.job === 'purge' || d.event.job === 'dates_abandon'));
    if (userPurge) finalDay = null;
    const sends = d.actions.filter((x) => (x.type === 'send' || x.type === 'reply' || x.type === 'poll' || x.type === 'file'));
    if (sends.some((x) => 'prompting' in x && x.prompting === 'unprompted')) unpromptedTimes.push(d.at);
    res.homiMessages += sends.length;
  }
  res.unprompted = unpromptedTimes.length;
  for (const t of unpromptedTimes) {
    const n = unpromptedTimes.filter((u) => u >= t && u < t + 12 * 3_600_000).length;
    res.maxUnpromptedIn12h = Math.max(res.maxUnpromptedIn12h, n);
    const h = DateTime.fromMillis(t, { zone: tz }).hour;
    if (h >= 23 || h < 9) res.quietHourViolations++;
  }
  res.unpromptedOk = res.maxUnpromptedIn12h <= fx.expect.maxUnpromptedPer12h && res.quietHourViolations === 0;
  res.finalDay.actual = finalDay;
  res.finalDay.ok = finalDay === fx.expect.finalDay;
  res.lockedBy.actual = lockedBy;
  res.lockedBy.ok = lockedBy === fx.expect.lockedBy;
  res.hungry.actual = hungry;
  res.hungry.ok = hungry === fx.expect.hungryTriggered;
  if (place) res.place.actual = { name: place.name, cuisine: place.cuisine, priceBand: place.priceBand };
  if (fx.expect.place) {
    const cuisines = (place?.cuisine ?? '').split(/[;,]/).map((s) => s.trim().toLowerCase());
    res.place.ok = !!place && cuisines.some((c) => fx.expect.place!.cuisineAnyOf.includes(c)) && (place.priceBand ?? 9) <= fx.expect.place.priceMax;
  } else {
    res.place.ok = null;
  }

  // ── privacy: logs and database must never contain message text, phone numbers, emails or raw handles ──
  // Needles are exact: every fixture message (>= 8 chars), every phone number / email that appears in one (in its
  // written form AND digits-only), and the sim's raw handle prefix. (A generic "10 digits" pattern would flag every
  // epoch-millisecond timestamp column, so it is not used.)
  const needles = new Set<string>();
  for (const t of texts) {
    if (t.trim().length >= 8) needles.add(t.toLowerCase());
    for (const m of t.matchAll(new RegExp(PHONE, 'g'))) {
      needles.add(m[0].toLowerCase());
      needles.add(m[0].replace(/\D/g, ''));
    }
    for (const m of t.matchAll(new RegExp(EMAIL, 'g'))) needles.add(m[0].toLowerCase());
  }
  needles.add('persona:');
  const leaks = (s: string) => [...needles].some((n) => s.includes(n));
  res.logLines = lines.length;
  for (const line of lines) if (leaks(line.toLowerCase())) res.logLeaks++;
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]) {
    for (const row of db.prepare(`SELECT * FROM "${name}"`).all() as Record<string, unknown>[]) {
      for (const v of Object.values(row)) {
        if (typeof v === 'number' || typeof v === 'bigint' || v === null) continue;
        const s = (v instanceof Uint8Array ? Buffer.from(v).toString('latin1') : String(v)).toLowerCase();
        if (leaks(s)) res.dbPlaintextLeaks++;
      }
    }
  }

  scheduler.stop();
  db.close();
  return res;
}

function pct(n: number, d: number): string {
  return d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(1)}%`;
}

async function main() {
  const filter = process.argv[2];
  const dir = join(here, 'fixtures');
  const files = readdirSync(dir).filter((f) => f.endsWith('.json') && (!filter || f.startsWith(filter))).sort();
  const engine = await loadEngine();
  const engineModule = '../src/engine/index.js';
  const extras = (await import(engineModule)) as EngineExtras;
  const results: FixtureResult[] = [];
  for (const f of files) {
    const fx = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Fixture;
    results.push(await runFixture(fx, engine, extras));
  }
  const sum = (k: keyof FixtureResult) => results.reduce((s, r) => s + (r[k] as number), 0);
  const placeChecks = results.filter((r) => r.place.ok !== null);
  const totals = {
    fixtures: results.length,
    dateCellAccuracy: pct(sum('voteCellsCorrect'), sum('voteCells')),
    dateCells: sum('voteCells'),
    dateMessageExact: pct(sum('voteMessagesExact'), sum('voteMessages')),
    dateMessages: sum('voteMessages'),
    finalDateCorrect: `${results.filter((r) => r.finalDay.ok).length}/${results.length}`,
    lockReasonCorrect: `${results.filter((r) => r.lockedBy.ok).length}/${results.length}`,
    foodPrecision: pct(sum('foodTP'), sum('foodTP') + sum('foodFP')),
    foodRecall: pct(sum('foodTP'), sum('foodTP') + sum('foodFN')),
    foodMessages: sum('foodTP') + sum('foodFP') + sum('foodFN') + sum('foodTN'),
    intentAccuracy: pct(sum('intentCorrect'), sum('intentTotal')),
    hungryTriggerCorrect: `${results.filter((r) => r.hungry.ok).length}/${results.length}`,
    placeMatch: `${placeChecks.filter((r) => r.place.ok).length}/${placeChecks.length}`,
    unpromptedMessages: sum('unprompted'),
    noiseBudgetRespected: `${results.filter((r) => r.unpromptedOk).length}/${results.length}`,
    quietHourViolations: sum('quietHourViolations'),
    logLinesScanned: sum('logLines'),
    logLeaks: sum('logLeaks'),
    dbPlaintextLeaks: sum('dbPlaintextLeaks'),
    harnessErrors: results.reduce((s, r) => s + r.errors.length, 0),
  };
  writeFileSync(join(here, 'results.json'), JSON.stringify({ generatedAt: new Date().toISOString(), totals, results }, null, 2));

  const md: string[] = [];
  md.push('| Metric | Result |', '|---|---|');
  md.push(`| Date replies: per-day votes read correctly | **${totals.dateCellAccuracy}** (${totals.dateCells} day-cells in ${totals.dateMessages} messages) |`);
  md.push(`| Date replies: whole message exactly right | ${totals.dateMessageExact} |`);
  md.push(`| Correct final date | **${totals.finalDateCorrect}** fixtures |`);
  md.push(`| Correct lock reason (everyone / deadline / threshold / forced) | ${totals.lockReasonCorrect} |`);
  md.push(`| Food-intent precision / recall | **${totals.foodPrecision} / ${totals.foodRecall}** (${totals.foodMessages} labeled messages) |`);
  md.push(`| Hungry flow triggered exactly when it should | ${totals.hungryTriggerCorrect} |`);
  md.push(`| Recommendation matches stated cuisine and budget | ${totals.placeMatch} |`);
  md.push(`| Message intent accuracy (7 classes) | ${totals.intentAccuracy} |`);
  md.push(`| Unprompted group messages sent (all fixtures) | ${totals.unpromptedMessages}; noise budget respected in ${totals.noiseBudgetRespected}; quiet-hour violations ${totals.quietHourViolations} |`);
  md.push(`| Log lines with message text, phone numbers, emails or handles | **${totals.logLeaks}** of ${totals.logLinesScanned} |`);
  md.push(`| Database values containing plaintext message text or numbers | **${totals.dbPlaintextLeaks}** |`);
  md.push('', '| Fixture | Final date | Lock | Hungry | Place | Unprompted (max/12h) | Date cells | Errors |', '|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    const mark = (ok: boolean | null) => (ok === null ? '–' : ok ? '✓' : '✗');
    md.push(
      `| ${r.id} | ${mark(r.finalDay.ok)} ${r.finalDay.actual ?? 'none'} | ${mark(r.lockedBy.ok)} ${r.lockedBy.actual ?? 'none'} | ${mark(r.hungry.ok)} | ${mark(r.place.ok)} ${r.place.actual?.name ?? ''} | ${r.unprompted} (${r.maxUnpromptedIn12h}) | ${r.voteCellsCorrect}/${r.voteCells} | ${r.errors.length} |`,
    );
  }
  writeFileSync(join(here, 'RESULTS.md'), md.join('\n') + '\n');
  process.stdout.write(md.join('\n') + '\n');
  for (const r of results) for (const e of r.errors) process.stdout.write(`! ${r.id}: ${e}\n`);
}

main().catch((err) => {
  process.stderr.write(`eval: ${(err as Error).stack ?? err}\n`);
  process.exit(1);
});
