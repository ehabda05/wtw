// Interfaces for the I/O services the runner drives. Real implementations live in src/places and src/voice
// (written separately); they are injected so tests and the sim can use fakes (src/runner/mocks.ts).

import type { ApplyEvent, GroupState, PlaceOption, PlacesQuery } from '../engine/types.js';

export interface PlacesService {
  search(query: PlacesQuery): Promise<{ options: PlaceOption[]; source: string }>;
  weather(near: string, at: number): Promise<{ rainLikely: boolean; summary?: string } | null>;
}

export interface CallRequest {
  /** Raw E.164 / handle from the sealed delivery lookup. In memory only. */
  to: string;
  question: string;
  options: string[];
  callRef: string;
  planId: string;
  member: string;
}

export interface CallResult {
  planId: string;
  member: string;
  answerText?: string;
  ok: boolean;
  simulated?: boolean;
}

export interface HttpReply {
  status: number;
  body: string;
}

export interface VoiceService {
  placeCall(req: CallRequest): Promise<void>;
  onResult(cb: (r: CallResult) => void): void;
  handleWebhook?(rawBody: string, headers: Record<string, string>): Promise<HttpReply>;
  handleInbound?(rawBody: string, headers: Record<string, string>): Promise<HttpReply>;
}

/** The pure engine, injected so runner tests do not depend on engine progress. */
export interface EngineApi {
  applyEvent: ApplyEvent;
  newGroupState(spaceKey: string, tz: string): GroupState;
  detectAddressed(text: string): boolean;
  /** Optional: lets the runner decide whether the gated hosted-LLM fallback is needed (docs/PRIVACY.md §3). */
  parseAvailability?(text: string, options: import('../engine/types.js').Option[], tz: string): { matched?: boolean };
  /** Optional: "homi go", "homi status", ... are commands, never availability, so the LLM fallback skips them. */
  parseCommand?(body: string): unknown;
  stripAddress?(text: string): string;
}

// Variable specifier: the engine is written in parallel; this keeps the infrastructure typecheck independent of
// its progress. The shape is validated at runtime and typed by the contract (ApplyEvent in engine/types.ts).
const ENGINE_MODULE = '../engine/index.js';

/** Load the real engine (src/engine/index.ts). */
export async function loadEngine(): Promise<EngineApi> {
  const mod = (await import(ENGINE_MODULE)) as Partial<EngineApi>;
  if (typeof mod.applyEvent !== 'function' || typeof mod.newGroupState !== 'function' || typeof mod.detectAddressed !== 'function') {
    throw new Error('src/engine/index.ts must export applyEvent, newGroupState and detectAddressed');
  }
  const api: EngineApi = { applyEvent: mod.applyEvent, newGroupState: mod.newGroupState, detectAddressed: mod.detectAddressed };
  if (typeof mod.parseAvailability === 'function') api.parseAvailability = mod.parseAvailability;
  if (typeof mod.parseCommand === 'function') api.parseCommand = mod.parseCommand;
  if (typeof mod.stripAddress === 'function') api.stripAddress = mod.stripAddress;
  return api;
}
