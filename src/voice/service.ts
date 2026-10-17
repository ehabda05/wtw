// VoiceService: the runner's only entry point for calls (docs/ARCHITECTURE.md, Voice path).
//
// Modes
// - mock:    no network. After a short delay, reports setScriptedAnswer's text (default "Friday works")
//            with simulated: true, so the transcript can label it "(simulated call)".
// - poll:    create-phone-call, then get-call every 4 s for up to 4 min until call_analysis appears.
//            Needs no public URL (laptop / hotspot). Agent storage: everything_except_pii + pii_config.
// - webhook: create-phone-call; the answer arrives on call_analyzed via handleWebhook. Keeps an
//            in-memory map callRef → { planId, member } (never a phone number) for 30 min.
//            Agent storage: basic_attributes_only.
//
// Privacy (PRIVACY.md §10): the call carries only { question } as a dynamic variable and { callRef }
// as metadata. Phone numbers, transcripts and answers are never logged. Transcripts are deleted from
// parsed responses as soon as the answer is extracted.

import { handleInbound as handleInboundWebhook, type HttpReply } from './inbound.js';
import { createRetellClient, isE164, RetellError, type RetellClient } from './retell.js';
import { assertSafeQuestion, buildQuestion } from './script.js';
import { getHeader, parseWebhook, SIGNATURE_HEADER, verifySignature } from './webhook.js';

export type VoiceMode = 'mock' | 'poll' | 'webhook';

export interface PlaceCallRequest {
  /** Raw E.164 number from the sealed delivery lookup. Used once, never stored or logged. */
  to: string;
  question: string;
  /** Option labels, e.g. "Fri Oct 23 · 7pm". When present, the spoken question is rebuilt from them. */
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

export interface VoiceService {
  placeCall(req: PlaceCallRequest): Promise<void>;
  onResult(cb: (r: CallResult) => void): void;
  handleWebhook?(rawBody: string, headers: Record<string, string>): Promise<{ status: number; body: string }>;
  handleInbound?(rawBody: string, headers: Record<string, string>): Promise<{ status: number; body: string }>;
  setScriptedAnswer?(member: string, answer: string): void;
}

export interface VoiceConfig {
  mode: VoiceMode;
  retellApiKey?: string;
  agentId?: string;
  /** Optional override_agent_version (number, "latest", or a tag). TODO(verify) which version calls use without it. */
  agentVersion?: string | number;
  /** Photon 2.0 SMS number (E.164), imported into Retell over SIP. */
  fromNumber?: string;
  baseUrl?: string;
  pollIntervalMs?: number;   // default 4000
  pollTimeoutMs?: number;    // default 240000
  pendingTtlMs?: number;     // webhook mode, default 30 min
  mockDelayMs?: number;      // default 1500
  /** Words that must never be spoken (member names, place, group name). Checked on every call. */
  forbiddenTokens?: () => string[];
}

export interface InboundCallTarget {
  question: string;
  callRef: string;
  /** If given, the call_analyzed result for this inbound call is reported through onResult. */
  planId?: string;
  member?: string;
}

export interface VoiceDeps {
  now(): number;
  scheduleTimeout?(fn: () => void, ms: number): unknown;
  fetch?: typeof fetch;
  /** Inbound "call Otto to RSVP" lookup (webhook mode). Without it every inbound call is rejected. */
  lookupByPhone?(phone: string): Promise<InboundCallTarget | null>;
  /** Redacted operational log. Lines never contain numbers, names, questions or answers. */
  log?(line: string): void;
}

export const DEFAULT_MOCK_ANSWER = 'Friday works';
const POLL_INTERVAL_MS = 4_000;
const POLL_TIMEOUT_MS = 4 * 60_000;
const PENDING_TTL_MS = 30 * 60_000;
const ENDED_GRACE_MS = 60_000;
const MAX_CONSECUTIVE_POLL_ERRORS = 5;
const MAX_WEBHOOK_BYTES = 1024 * 1024;

/** Read the voice config from env (VOICE_MODE, RETELL_API_KEY, RETELL_AGENT_ID, PHOTON_VOICE_NUMBER, RETELL_AGENT_VERSION). */
export function voiceConfigFromEnv(env: Record<string, string | undefined> = process.env): VoiceConfig {
  const raw = (env['VOICE_MODE'] ?? 'mock').trim().toLowerCase();
  const mode: VoiceMode = raw === 'poll' || raw === 'webhook' ? raw : 'mock';
  const v = env['RETELL_AGENT_VERSION']?.trim();
  return {
    mode,
    retellApiKey: env['RETELL_API_KEY'] || undefined,
    agentId: env['RETELL_AGENT_ID'] || undefined,
    fromNumber: env['PHOTON_VOICE_NUMBER'] || undefined,
    agentVersion: v ? (/^\d+$/.test(v) ? Number(v) : v) : undefined,
  };
}

/** Short opaque tag for logs (callRefs are already opaque; this keeps lines short). */
function tag(callRef: string): string {
  return callRef.length > 8 ? `${callRef.slice(0, 8)}…` : callRef;
}

function describeError(e: unknown): string {
  if (e instanceof RetellError) return e.message; // already redacted, no numbers
  return (e as { name?: string } | null)?.name ?? 'error';
}

export function createVoiceService(config: VoiceConfig, deps: VoiceDeps): VoiceService {
  const listeners: Array<(r: CallResult) => void> = [];
  const log = deps.log ?? ((line: string) => console.warn(`[voice] ${line}`));
  const schedule = (fn: () => void, ms: number, background = false): void => {
    if (deps.scheduleTimeout) {
      deps.scheduleTimeout(fn, ms);
      return;
    }
    const t = setTimeout(fn, ms);
    if (background) t.unref?.();
  };
  const sleep = (ms: number) => new Promise<void>((resolve) => schedule(resolve, ms));

  function emit(r: CallResult): void {
    for (const cb of listeners) {
      try {
        cb(r);
      } catch (e) {
        log(`onResult listener threw: ${describeError(e)}`);
      }
    }
  }

  /** The words actually spoken. Rebuilt from options when we have them; always safety-checked. */
  function spokenQuestion(req: PlaceCallRequest): string {
    const q = req.options && req.options.length > 0 ? buildQuestion(req.options) : req.question;
    assertSafeQuestion(q, config.forbiddenTokens ? config.forbiddenTokens() : []);
    return q;
  }

  const base = { onResult: (cb: (r: CallResult) => void) => void listeners.push(cb) };

  // ─────────────── mock ───────────────
  if (config.mode === 'mock') {
    const scripted = new Map<string, string>();
    return {
      ...base,
      setScriptedAnswer(member: string, answer: string) {
        scripted.set(member, answer);
      },
      async placeCall(req: PlaceCallRequest) {
        let ok = true;
        try {
          spokenQuestion(req);
        } catch (e) {
          log(`mock call ${tag(req.callRef)} refused: ${describeError(e)}`);
          ok = false;
        }
        const answerText = ok ? scripted.get(req.member) ?? DEFAULT_MOCK_ANSWER : undefined;
        schedule(() => emit({ planId: req.planId, member: req.member, answerText, ok, simulated: true }), config.mockDelayMs ?? 1_500);
      },
    };
  }

  // ─────────────── poll / webhook: real calls ───────────────
  if (!config.retellApiKey) throw new Error(`VOICE_MODE=${config.mode} needs RETELL_API_KEY`);
  if (!config.fromNumber || !isE164(config.fromNumber)) throw new Error(`VOICE_MODE=${config.mode} needs PHOTON_VOICE_NUMBER in E.164`);
  const client: RetellClient = createRetellClient({ apiKey: config.retellApiKey, baseUrl: config.baseUrl, fetch: deps.fetch });
  const fromNumber = config.fromNumber;
  const apiKey = config.retellApiKey;

  async function dial(req: PlaceCallRequest): Promise<string | undefined> {
    let question: string;
    try {
      question = spokenQuestion(req);
    } catch (e) {
      log(`call ${tag(req.callRef)} refused: ${describeError(e)}`);
      return undefined;
    }
    if (!isE164(req.to)) {
      log(`call ${tag(req.callRef)} refused: destination is not E.164`);
      return undefined;
    }
    try {
      const { callId } = await client.createPhoneCall({
        fromNumber,
        toNumber: req.to,
        dynamicVariables: { question },
        metadata: { callRef: req.callRef },
        agentId: config.agentId,
        agentVersion: config.agentVersion,
      });
      log(`call ${tag(req.callRef)} placed`);
      return callId;
    } catch (e) {
      log(`call ${tag(req.callRef)} failed to start: ${describeError(e)}`);
      return undefined;
    }
  }

  // ─────────────── poll ───────────────
  if (config.mode === 'poll') {
    const interval = config.pollIntervalMs ?? POLL_INTERVAL_MS;
    const timeout = config.pollTimeoutMs ?? POLL_TIMEOUT_MS;

    async function pollUntilAnalyzed(callId: string, req: PlaceCallRequest): Promise<void> {
      const deadline = deps.now() + timeout;
      let endedAt: number | undefined;
      let errors = 0;
      for (;;) {
        await sleep(interval);
        try {
          const info = await client.getCall(callId);
          errors = 0;
          if (info.analysis) {
            const answerText = info.analysis.answer;
            const ok = answerText !== undefined && info.analysis.inVoicemail !== true;
            log(`call ${tag(req.callRef)} analyzed (${ok ? 'answered' : 'no answer'})`);
            emit({ planId: req.planId, member: req.member, answerText: ok ? answerText : undefined, ok });
            return;
          }
          if (info.ended && endedAt === undefined) endedAt = deps.now();
          if (endedAt !== undefined && deps.now() - endedAt > ENDED_GRACE_MS) {
            log(`call ${tag(req.callRef)} ended without analysis (${info.status})`);
            break;
          }
        } catch (e) {
          errors++;
          const fatal = e instanceof RetellError && (e.status === 401 || e.status === 403);
          if (fatal || errors >= MAX_CONSECUTIVE_POLL_ERRORS) {
            log(`call ${tag(req.callRef)} polling stopped: ${describeError(e)}`);
            break;
          }
        }
        if (deps.now() >= deadline) {
          log(`call ${tag(req.callRef)} timed out waiting for analysis`);
          break;
        }
      }
      emit({ planId: req.planId, member: req.member, ok: false });
    }

    return {
      ...base,
      async placeCall(req: PlaceCallRequest) {
        const callId = await dial(req);
        if (!callId) {
          emit({ planId: req.planId, member: req.member, ok: false });
          return;
        }
        // Background: placeCall resolves once the call is dialing; the result arrives via onResult.
        void pollUntilAnalyzed(callId, req).catch((e) => {
          log(`call ${tag(req.callRef)} poll crashed: ${describeError(e)}`);
          emit({ planId: req.planId, member: req.member, ok: false });
        });
      },
    };
  }

  // ─────────────── webhook ───────────────
  const ttl = config.pendingTtlMs ?? PENDING_TTL_MS;
  // inbound: the member called us, so an expiry is not reported as a failed call.
  const pending = new Map<string, { planId: string; member: string; expiresAt: number; inbound: boolean }>();

  function expire(callRef: string): void {
    const p = pending.get(callRef);
    if (!p) return;
    pending.delete(callRef);
    log(`call ${tag(callRef)} expired without a webhook`);
    if (!p.inbound) emit({ planId: p.planId, member: p.member, ok: false });
  }

  function track(callRef: string, planId: string, member: string, inbound = false): void {
    const expiresAt = deps.now() + ttl;
    pending.set(callRef, { planId, member, expiresAt, inbound });
    schedule(() => {
      if (pending.get(callRef)?.expiresAt === expiresAt) expire(callRef);
    }, ttl, true);
  }

  function sweep(): void {
    const now = deps.now();
    for (const [ref, p] of pending) if (p.expiresAt <= now) expire(ref);
  }

  return {
    ...base,
    async placeCall(req: PlaceCallRequest) {
      // Track before dialing so a fast webhook can't race the map insert.
      track(req.callRef, req.planId, req.member);
      const callId = await dial(req);
      if (!callId) {
        pending.delete(req.callRef);
        emit({ planId: req.planId, member: req.member, ok: false });
      }
    },

    async handleWebhook(rawBody: string, headers: Record<string, string>): Promise<HttpReply> {
      if (typeof rawBody !== 'string' || Buffer.byteLength(rawBody, 'utf8') > MAX_WEBHOOK_BYTES) {
        return { status: 413, body: '' };
      }
      if (!verifySignature(rawBody, apiKey, getHeader(headers, SIGNATURE_HEADER), deps.now())) {
        log('webhook rejected: bad signature');
        return { status: 401, body: '' };
      }
      const parsed = parseWebhook(rawBody);
      if (parsed.kind === 'invalid') return { status: 400, body: '' };
      if (parsed.kind === 'ignored') return { status: 200, body: '' };
      sweep();
      const p = parsed.callRef ? pending.get(parsed.callRef) : undefined;
      if (!p || !parsed.callRef) return { status: 200, body: '' }; // unknown, expired, or a retried delivery
      pending.delete(parsed.callRef);
      log(`call ${tag(parsed.callRef)} analyzed (${parsed.ok ? 'answered' : 'no answer'})`);
      // An inbound caller who gave no answer is not a failed outreach: report only real answers.
      if (parsed.ok || !p.inbound) {
        emit({ planId: p.planId, member: p.member, answerText: parsed.ok ? parsed.answer : undefined, ok: parsed.ok });
      }
      return { status: 200, body: '' };
    },

    async handleInbound(rawBody: string, headers: Record<string, string>): Promise<HttpReply> {
      return handleInboundWebhook(rawBody, headers, {
        apiKey,
        now: deps.now,
        lookupByPhone: async (phone) => {
          if (!deps.lookupByPhone) return null;
          const t = await deps.lookupByPhone(phone);
          if (!t) return null;
          if (t.planId && t.member) track(t.callRef, t.planId, t.member, true);
          return { question: t.question, callRef: t.callRef };
        },
      });
    },
  };
}
