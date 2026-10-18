// Boot for HOMI_MODE=dining: config -> memory -> agent -> runner -> chat adapters (iMessage first, then the rest).
// Same adapters as the legacy engine (src/index.ts), none of the engine, scheduler, voice or sealed store.

import { ImessageCloudBinding, LocalImessageAdapter } from '../channels/imessage.js';
import { createPhoton2Adapters } from '../channels/photon2.js';
import { SpectrumHub } from '../channels/spectrum.js';
import { TelegramAdapter } from '../channels/telegram.js';
import { createTelegramDirectAdapters } from '../channels/telegram-direct.js';
import { TerminalAdapter } from '../channels/terminal.js';
import type { ChannelAdapter } from '../channels/types.js';
import type { Config } from '../config.js';
import { createLogger, type Logger } from '../privacy/logger.js';
import { DiningAgent } from './agent.js';
import { DiningMemory } from './memory.js';
import { DiningRunner, type DiningLog } from './runner.js';

export interface DiningEnv {
  model?: string;
  city?: string;
  botName?: string;
  dbPath: string;
}

export function diningEnv(env: NodeJS.ProcessEnv = process.env): DiningEnv {
  const s = (k: string) => env[k]?.trim() || undefined;
  return { model: s('HOMI_DINING_MODEL'), city: s('HOMI_CITY'), botName: s('HOMI_NAME'), dbPath: s('HOMI_DINING_DB') ?? './data/homi-dining.db' };
}

/** 'dining' unless HOMI_MODE=legacy; without an Anthropic key the dining mode cannot run, so legacy is used. */
export function diningMode(env: NodeJS.ProcessEnv = process.env): boolean {
  const mode = (env.HOMI_MODE ?? '').trim().toLowerCase();
  if (mode === 'legacy' || mode === 'engine') return false;
  return !!env.ANTHROPIC_API_KEY?.trim();
}

/** Plain stderr logger: in dining mode the transcript may be logged (LOG_LEVEL=debug shows replies and notes). */
export function diningLogger(level: string): DiningLog {
  const order: Record<string, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
  const min = order[level] ?? 20;
  return (lvl, msg, fields) => {
    if (order[lvl] < min) return;
    const f = { ...fields };
    if (lvl !== 'debug' && min > 10) {
      delete f.notes;
    }
    process.stderr.write(`${JSON.stringify({ t: new Date().toISOString(), level: lvl, msg, ...f })}\n`);
  };
}

export async function bootDining(config: Config, logger: Logger): Promise<{ stop(): Promise<void> }> {
  const env = diningEnv();
  const log = diningLogger(config.logLevel);
  const memory = new DiningMemory(env.dbPath);
  const agent = new DiningAgent({ apiKey: config.anthropicApiKey!, model: env.model, city: env.city, tz: config.defaultTz, botName: env.botName });
  agent.warm();
  const runner = new DiningRunner({ agent, memory, log, botName: env.botName });

  const hub = new SpectrumHub({ config, logger: logger.child({ mod: 'spectrum' }) });
  const adapters: ChannelAdapter[] = [];
  for (const s of config.surfaces) {
    switch (s) {
      case 'imessage':
        hub.register(new ImessageCloudBinding({ config, logger: logger.child({ mod: 'imessage' }) }));
        break;
      case 'imessage-local':
        hub.register(
          new LocalImessageAdapter({
            logger: logger.child({ mod: 'imessage-local' }),
            isKnown: (spaceId) => memory.hasChat(`imessage-local|${spaceId}`),
            isTrigger: (text) => new RegExp(`\\b${env.botName ?? 'homi'}\\b`, 'i').test(text),
          }),
        );
        break;
      case 'telegram':
        hub.register(new TelegramAdapter({ config, logger: logger.child({ mod: 'telegram' }) }));
        break;
      case 'telegram-direct':
        adapters.push(...createTelegramDirectAdapters(config, logger.child({ mod: 'telegram-direct' })));
        break;
      case 'terminal':
        hub.register(new TerminalAdapter(logger.child({ mod: 'terminal' })));
        break;
      case 'photon2':
        adapters.push(...(await createPhoton2Adapters(config, logger.child({ mod: 'photon2' }))));
        break;
      case 'sim':
        log('info', 'dining: the sim surface is the CLI; run: npm run dining');
        break;
    }
  }
  for (const b of hub.bindings) adapters.push(...b.adapters());
  for (const a of adapters) {
    runner.addAdapter(a);
    await a.start((m) => runner.handleInbound(m));
  }
  await hub.start();
  runner.start();

  log('info', 'homi started (dining mode)', {
    surfaces: config.surfaces,
    model: agent.model,
    city: env.city ?? 'Cambridge, Massachusetts',
    memory: env.dbPath,
  });

  return {
    async stop() {
      runner.stop();
      await hub.stop().catch(() => undefined);
      for (const a of adapters) await a.stop().catch(() => undefined);
      await Promise.race([runner.whenIdle(), new Promise((r) => setTimeout(r, 5000))]);
      memory.close();
    },
  };
}

export { createLogger };
