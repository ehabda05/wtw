// Guarded loaders for the separately-written places and voice modules. Boot never fails because one of them is
// missing or broken: places falls back to a stub, voice to the clearly-labeled mock.

import { randomUUID } from 'node:crypto';
import type { Config } from '../config.js';
import { SafeError, silentLogger, type Logger } from '../privacy/logger.js';
import type { Repo } from '../store/repo.js';
import { createMockVoice, createStubPlaces } from './mocks.js';
import type { PlacesService, VoiceService } from './services.js';

// Variable specifiers: resolved at runtime only, so this file typechecks whatever state those modules are in.
const PLACES_MODULE = '../places/index.js';
const VOICE_MODULE = '../voice/index.js';

export async function loadPlacesService(
  config: Config,
  logger: Logger = silentLogger,
  fallback: () => PlacesService = () => createStubPlaces(),
): Promise<{ service: PlacesService; real: boolean }> {
  try {
    const mod = (await import(PLACES_MODULE)) as {
      createPlacesService?: (c: { provider?: 'offline' | 'google'; apiKey?: string }) => PlacesService;
    };
    if (typeof mod.createPlacesService !== 'function') throw new SafeError('createPlacesService not exported');
    const provider = config.places.provider.toLowerCase() === 'google' && config.places.apiKey ? 'google' : 'offline';
    const service = mod.createPlacesService({ provider, ...(provider === 'google' ? { apiKey: config.places.apiKey } : {}) });
    if (!service || typeof service.search !== 'function') throw new SafeError('createPlacesService returned no service');
    return { service, real: true };
  } catch (err) {
    logger.warn('places: real module unavailable, using stub', { err });
    return { service: fallback(), real: false };
  }
}

export interface InboundCallTarget {
  question: string;
  callRef: string;
  planId?: string;
  member?: string;
}

export interface VoiceLoadDeps {
  now: () => number;
  /** Timer used by the voice module (mock delay, poll sleeps). Default: real setTimeout. */
  scheduleTimeout?: (fn: () => void, ms: number) => unknown;
  /** Inbound "call Otto to RSVP" lookup (webhook mode). */
  lookupByPhone?: (phone: string) => Promise<InboundCallTarget | null>;
  /** Mock-mode answer delay. */
  mockDelayMs?: number;
}

export async function loadVoiceService(
  config: Config,
  deps: VoiceLoadDeps,
  logger: Logger = silentLogger,
  fallback: () => VoiceService = () => createMockVoice(),
): Promise<{ service: VoiceService; real: boolean; buildQuestion?: (options: string[], activity?: string, o?: { greeting?: string }) => string }> {
  try {
    const mod = (await import(VOICE_MODULE)) as {
      createVoiceService?: (c: Record<string, unknown>, d: Record<string, unknown>) => VoiceService;
      buildQuestion?: (options: string[], activity?: string, o?: { greeting?: string }) => string;
    };
    if (typeof mod.createVoiceService !== 'function') throw new SafeError('createVoiceService not exported');
    const vconf = {
      mode: config.voice.mode,
      retellApiKey: config.voice.retellApiKey,
      agentId: config.voice.retellAgentId,
      fromNumber: config.voice.photonNumber,
      ...(deps.mockDelayMs !== undefined ? { mockDelayMs: deps.mockDelayMs } : {}),
    };
    const vdeps = {
      now: deps.now,
      ...(deps.scheduleTimeout ? { scheduleTimeout: deps.scheduleTimeout } : {}),
      ...(deps.lookupByPhone ? { lookupByPhone: deps.lookupByPhone } : {}),
      log: (line: string) => logger.info(`voice: ${line}`),
    };
    const service = mod.createVoiceService(vconf, vdeps);
    if (!service || typeof service.placeCall !== 'function' || typeof service.onResult !== 'function') {
      throw new SafeError('createVoiceService returned no service');
    }
    return { service, real: true, buildQuestion: mod.buildQuestion };
  } catch (err) {
    logger.warn('voice: real module unavailable, using mock (calls are simulated)', { err });
    return { service: fallback(), real: false };
  }
}

/**
 * Inbound "call Otto to RSVP": find a live plan where the caller (matched against sealed delivery handles) is still
 * pending, and return only the open question. Unknown callers get null (the voice module rejects them).
 */
export function makeInboundLookup(
  repo: Repo,
  buildQuestion?: (options: string[], activity?: string, o?: { greeting?: string }) => string,
): (phone: string) => Promise<InboundCallTarget | null> {
  return async (phone: string) => {
    for (const { memberKey, planId } of repo.delivery.findByHandle(phone)) {
      const spaceKey = repo.spaceForPlan(planId);
      if (!spaceKey) continue;
      const state = repo.loadGroup(spaceKey);
      const plan = state?.plan;
      if (!plan || plan.id !== planId || plan.state !== 'collecting_availability') continue;
      const member = plan.members[memberKey];
      if (!member || member.status !== 'pending' || !member.optInCall) continue;
      const labels = plan.options.filter((o) => !o.removed).map((o) => o.label);
      if (labels.length === 0) continue;
      let question: string;
      try {
        question = buildQuestion ? buildQuestion(labels, plan.activity, { greeting: 'inbound' }) : `Which works for you: ${labels.join(', or ')}?`;
      } catch {
        question = `Which works for you: ${labels.join(', or ')}?`;
      }
      return { question, callRef: randomUUID(), planId, member: memberKey };
    }
    return null;
  };
}
