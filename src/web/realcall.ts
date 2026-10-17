// Optional REAL phone calls in the web demo: when WEB_REAL_CALLS names personas and phone numbers
// (e.g. WEB_REAL_CALLS=sam=+16175551234), Homi's check-in call to that persona rings the real phone through
// Photon 2.0 (SIP) + Retell, using the voice settings from .env (docs/VOICE_SETUP.md). Everything else in the
// demo stays simulated. Poll mode is used so the laptop needs no public URL. Numbers are never logged.

import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { createVoiceService, voiceConfigFromEnv, type VoiceService } from '../voice/index.js';

export interface RealCallBridge {
  service: VoiceService;
  /** persona -> E.164 number */
  numbers: Map<string, string>;
}

const E164 = /^\+[1-9]\d{7,14}$/;

/** Voice vars from the environment, with .env filling anything unset (the web demo otherwise ignores .env). */
export function voiceEnv(env: NodeJS.ProcessEnv = process.env, dotEnvPath = '.env'): Record<string, string | undefined> {
  const file: Record<string, string> = existsSync(dotEnvPath) ? (parseEnv(readFileSync(dotEnvPath, 'utf8')) as Record<string, string>) : {};
  const keys = ['WEB_REAL_CALLS', 'VOICE_MODE', 'RETELL_API_KEY', 'RETELL_AGENT_ID', 'RETELL_AGENT_VERSION', 'PHOTON_VOICE_NUMBER'];
  const out: Record<string, string | undefined> = {};
  for (const k of keys) out[k] = env[k] || file[k] || undefined;
  return out;
}

/** "sam=+16175551234, jo=+16175550000" -> Map. Invalid entries are reported, never echoed. */
export function parseRealCalls(spec: string | undefined): { numbers: Map<string, string>; invalid: string[] } {
  const numbers = new Map<string, string>();
  const invalid: string[] = [];
  for (const part of (spec ?? '').split(/[,;]/)) {
    const [p, n] = part.split('=').map((x) => x?.trim() ?? '');
    if (!p && !n) continue;
    const persona = p.toLowerCase();
    if (/^[a-z]{1,20}$/.test(persona) && E164.test(n)) numbers.set(persona, n);
    else invalid.push(persona || '(blank)');
  }
  return { numbers, invalid };
}

export interface RealCallSetup {
  bridge: RealCallBridge | null;
  /** Human-readable startup notes (no numbers, no keys). */
  notes: string[];
}

export function realCallsFromEnv(env: NodeJS.ProcessEnv = process.env, dotEnvPath = '.env'): RealCallSetup {
  const v = voiceEnv(env, dotEnvPath);
  if (!v.WEB_REAL_CALLS) return { bridge: null, notes: [] };
  const { numbers, invalid } = parseRealCalls(v.WEB_REAL_CALLS);
  const notes: string[] = [];
  if (invalid.length) notes.push(`WEB_REAL_CALLS: ignored ${invalid.join(', ')} (use persona=+1XXXXXXXXXX)`);
  if (!numbers.size) return { bridge: null, notes };
  const missing = ['RETELL_API_KEY', 'RETELL_AGENT_ID', 'PHOTON_VOICE_NUMBER'].filter((k) => !v[k as keyof typeof v]);
  if (missing.length) {
    notes.push(`Real calls OFF: set ${missing.join(', ')} in .env (docs/VOICE_SETUP.md). Calls stay simulated.`);
    return { bridge: null, notes };
  }
  try {
    const cfg = { ...voiceConfigFromEnv(v), mode: 'poll' as const };
    const service = createVoiceService(cfg, { now: () => Date.now(), log: (line) => process.stderr.write(`[voice] ${line}\n`) });
    notes.push(`Real calls ON for: ${[...numbers.keys()].join(', ')} (Photon 2.0 + Retell). Everyone else is simulated.`);
    return { bridge: { service, numbers }, notes };
  } catch (e) {
    notes.push(`Real calls OFF: ${(e as Error).message}. Calls stay simulated.`);
    return { bridge: null, notes };
  }
}
