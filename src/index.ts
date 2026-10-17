// Boot: config -> store -> places -> voice -> engine -> runner -> adapters (SURFACES) -> scheduler -> http.
// One process, one replica, outbound connections only (docs/ARCHITECTURE.md principle 4).

import type { Server } from 'node:http';
import { SimHub } from './channels/sim.js';
import { ImessageCloudBinding, LocalImessageAdapter } from './channels/imessage.js';
import { SpectrumHub } from './channels/spectrum.js';
import { TelegramAdapter } from './channels/telegram.js';
import { TerminalAdapter } from './channels/terminal.js';
import type { ChannelAdapter } from './channels/types.js';
import { loadConfig } from './config.js';
import { startHttpServer } from './http/server.js';
import { Sealer } from './privacy/crypto.js';
import { Ids } from './privacy/ids.js';
import { createLogger } from './privacy/logger.js';
import { Retention } from './privacy/retention.js';
import { OffsetClock, SystemClock } from './runner/clock.js';
import { classifyAvailability, isEnabled as hostedLlmEnabled } from './llm/redacted.js';
import { loadPlacesService, loadVoiceService, makeInboundLookup } from './runner/load.js';
import { Runner } from './runner/runner.js';
import { Scheduler } from './runner/scheduler.js';
import { loadEngine } from './runner/services.js';
import { openDatabase } from './store/db.js';
import { Repo } from './store/repo.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({ level: config.logLevel });
  const log = logger.child({ mod: 'boot' });

  const clock = config.demoMode ? new OffsetClock() : new SystemClock();
  let scheduler: Scheduler | undefined;
  const llmCfg = { disableHostedLlm: config.disableHostedLlm, apiKey: config.anthropicApiKey };
  const db = openDatabase(config.dbPath);
  const repo = new Repo(db, new Sealer(config.dataKey), { now: () => clock.now(), logger: logger.child({ mod: 'repo' }) });
  const ids = new Ids(config.idSalt);

  const places = await loadPlacesService(config, logger.child({ mod: 'places' }));
  let buildQuestion: Parameters<typeof makeInboundLookup>[1];
  const voice = await loadVoiceService(
    config,
    { now: () => clock.now(), lookupByPhone: (phone) => makeInboundLookup(repo, buildQuestion)(phone) },
    logger.child({ mod: 'voice' }),
  );
  buildQuestion = voice.buildQuestion;
  const engine = await loadEngine();

  const runner = new Runner({
    engine,
    repo,
    ids,
    clock,
    config,
    logger: logger.child({ mod: 'runner' }),
    places: places.service,
    voice: voice.service,
    demo: config.demoMode
      ? {
          fastForward: async (ms: number) => {
            (clock as OffsetClock).shift(ms);
            await scheduler?.tick();
          },
        }
      : undefined,
    hostedLlm: hostedLlmEnabled(llmCfg) ? (text, labels, names) => classifyAvailability(llmCfg, text, labels, names) : undefined,
  });
  voice.service.onResult((r) => void runner.handleCallResult(r));

  const hub = new SpectrumHub({ config, logger: logger.child({ mod: 'spectrum' }) });
  const adapters: ChannelAdapter[] = [];
  for (const s of config.surfaces) {
    switch (s) {
      case 'sim':
        adapters.push(new SimHub({ now: () => clock.now() }));
        log.info('sim surface registered; for the interactive simulator run: npm run sim');
        break;
      case 'terminal':
        hub.register(new TerminalAdapter(logger.child({ mod: 'terminal' })));
        break;
      case 'telegram':
        hub.register(new TelegramAdapter({ config, logger: logger.child({ mod: 'telegram' }) }));
        break;
      case 'imessage':
        hub.register(new ImessageCloudBinding({ config, logger: logger.child({ mod: 'imessage' }) }));
        break;
      case 'imessage-local':
        hub.register(
          new LocalImessageAdapter({
            logger: logger.child({ mod: 'imessage-local' }),
            isKnown: (spaceId) => repo.hasSpace(ids.space('imessage-local', spaceId)),
            isTrigger: (text) => engine.detectAddressed(text),
          }),
        );
        break;
    }
  }
  for (const b of hub.bindings) adapters.push(...b.adapters());
  for (const a of adapters) {
    runner.addAdapter(a);
    await a.start((m) => runner.handleInbound(m));
  }
  await hub.start();

  scheduler = new Scheduler({ repo, runner, clock, retention: new Retention(repo, logger.child({ mod: 'retention' })), logger: logger.child({ mod: 'scheduler' }) });
  scheduler.start();

  let server: Server | undefined;
  try {
    server = await startHttpServer(config.port, {
      voice: voice.service,
      logger: logger.child({ mod: 'http' }),
      health: () => ({ surfaces: config.surfaces, voice: voice.real ? config.voice.mode : 'mock', places: places.real ? config.places.provider : 'stub' }),
    });
  } catch (err) {
    log.error('http: could not listen', { port: config.port, err });
  }

  log.info('otto started', {
    surfaces: config.surfaces,
    port: config.port,
    voice: voice.real ? config.voice.mode : 'mock (fallback)',
    places: places.real ? config.places.provider : 'stub (fallback)',
    hostedLlm: !config.disableHostedLlm && !!config.anthropicApiKey,
    ephemeralKeys: config.ephemeralKeys,
  });

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info('shutting down', { signal });
    scheduler.stop();
    await hub.stop().catch(() => undefined);
    for (const a of adapters) await a.stop().catch(() => undefined);
    await Promise.race([runner.whenIdle(), new Promise((r) => setTimeout(r, 5000))]);
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
    try {
      db.close();
    } catch {
      /* already closed */
    }
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  // Boot errors are config / setup problems; print the message only (never env values).
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`otto: failed to start: ${msg}\n`);
  process.exit(1);
});
