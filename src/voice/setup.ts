// One-time Retell setup for Homi's voice agent. A teammate runs it with their own key in .env:
//
//   node --import tsx src/voice/setup.ts [--dry-run] [--mode poll|webhook] [--webhook-url https://…/voice/retell]
//        [--bind-number] [--inbound-webhook-url https://…/voice/inbound] [--voice-id retell-Cimo] [--model …] [--create]
//
// Creates a Retell LLM + agent (or updates them when RETELL_AGENT_ID is set) and prints the agent id.
// --dry-run prints the exact JSON requests and calls nothing. The API key is never printed, and the
// phone number is never printed (dry-run shows a placeholder in the path).
//
// Endpoints and fields verified 2026-10-16 against docs.retellai.com and retell-sdk@6.2.7 types:
//   POST  /create-retell-llm             https://docs.retellai.com/api-references/create-retell-llm  (201, llm_id)
//         general_prompt, begin_message, start_speaker ('agent'|'user'), default_dynamic_variables,
//         general_tools [{ type: 'end_call', name, description }], model_temperature, model
//   PATCH /update-retell-llm/{llm_id}    https://docs.retellai.com/api-references/update-retell-llm  (200)
//   POST  /create-agent                  https://docs.retellai.com/api-references/create-agent       (201, agent_id)
//         response_engine { type: 'retell-llm', llm_id } and voice_id are required (example voice 'retell-Cimo');
//         data_storage_setting everything|everything_except_pii|basic_attributes_only;
//         data_storage_retention_days 1..730; pii_config { mode: 'post_call', categories[] };
//         contact_memory_config { enable_read, enable_update }; opt_in_signed_url;
//         post_call_analysis_data [{ type: 'string', name, description, examples? }];
//         webhook_url (null removes), webhook_events; max_call_duration_ms ≥ 60000; end_call_after_silence_ms ≥ 10000
//   GET   /get-agent/{agent_id}          https://docs.retellai.com/api-references/get-agent          (response_engine.llm_id)
//   PATCH /update-agent/{agent_id}       https://docs.retellai.com/api-references/update-agent       ("latest draft version")
//   PATCH /update-phone-number/{E.164}   https://docs.retellai.com/api-references/update-phone-number
//         inbound_agents / outbound_agents [{ agent_id, weight (sum 1), agent_version: n|'latest'|'latest_published'|tag }],
//         inbound_webhook_url
// Privacy settings: docs.retellai.com/accounts/privacy-disable, /accounts/data-retention (research/platform-setup.md §E1).

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRetellClient, encodePathSegment, isE164, RetellError } from './retell.js';
import { AGENT_PROMPT, ANSWER_FIELD_DESCRIPTION, BEGIN_MESSAGE, DEFAULT_TEST_QUESTION } from './script.js';

export type SetupMode = 'poll' | 'webhook';

export interface SetupOptions {
  mode: SetupMode;
  dryRun: boolean;
  /** Agent-level webhook for call_analyzed (webhook mode). */
  webhookUrl?: string;
  /** Per-number inbound webhook ("call Homi to RSVP"). Applied only with bindNumber. */
  inboundWebhookUrl?: string;
  bindNumber: boolean;
  phoneNumber?: string;
  voiceId: string;
  model?: string;
  agentName: string;
  /** Existing agent to update. Undefined → create. */
  agentId?: string;
}

export const DEFAULT_VOICE_ID = 'retell-Cimo'; // the create-agent docs' example voice; TODO(verify) it suits a US-English caller
export const PII_CATEGORIES = ['person_name', 'phone_number', 'address', 'email'] as const;

const USAGE = `Usage: node --import tsx src/voice/setup.ts [options]
  --dry-run                    print the JSON requests, call nothing
  --mode poll|webhook          storage + retrieval mode (default: VOICE_MODE if poll/webhook, else poll)
  --webhook-url URL            agent webhook for call_analyzed (required for webhook mode; env RETELL_WEBHOOK_URL)
  --bind-number                bind PHOTON_VOICE_NUMBER (inbound + outbound) to this agent
  --inbound-webhook-url URL    with --bind-number: per-number inbound webhook (env RETELL_INBOUND_WEBHOOK_URL)
  --voice-id ID                Retell voice (default ${DEFAULT_VOICE_ID}; env RETELL_VOICE_ID)
  --model NAME                 Retell LLM model (default: Retell's default)
  --create                     create a new agent even if RETELL_AGENT_ID is set
Env: RETELL_API_KEY (required unless --dry-run), RETELL_AGENT_ID (update instead of create), PHOTON_VOICE_NUMBER.`;

function isHttpsUrl(u: string): boolean {
  try {
    return new URL(u).protocol === 'https:';
  } catch {
    return false;
  }
}

export function parseSetupArgs(argv: string[], env: Record<string, string | undefined>): SetupOptions | { error: string } | { help: true } {
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) return { error: `unexpected argument: ${a}` };
    const eq = a.indexOf('=');
    if (eq > 0) flags.set(a.slice(2, eq), a.slice(eq + 1));
    else if (['dry-run', 'bind-number', 'create', 'help'].includes(a.slice(2))) flags.set(a.slice(2), true);
    else {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) return { error: `${a} needs a value` };
      flags.set(a.slice(2), v);
      i++;
    }
  }
  const known = ['dry-run', 'bind-number', 'create', 'help', 'mode', 'webhook-url', 'inbound-webhook-url', 'voice-id', 'model'];
  for (const k of flags.keys()) if (!known.includes(k)) return { error: `unknown option --${k}` };
  if (flags.has('help')) return { help: true };

  const str = (k: string) => (typeof flags.get(k) === 'string' ? (flags.get(k) as string) : undefined);
  const envMode = env['VOICE_MODE']?.trim().toLowerCase();
  const modeRaw = str('mode') ?? (envMode === 'webhook' || envMode === 'poll' ? envMode : 'poll');
  if (modeRaw !== 'poll' && modeRaw !== 'webhook') return { error: `--mode must be poll or webhook` };
  const mode = modeRaw as SetupMode;

  const webhookUrl = str('webhook-url') ?? (env['RETELL_WEBHOOK_URL'] || undefined);
  const inboundWebhookUrl = str('inbound-webhook-url') ?? (env['RETELL_INBOUND_WEBHOOK_URL'] || undefined);
  if (webhookUrl && !isHttpsUrl(webhookUrl)) return { error: '--webhook-url must be an https URL' };
  if (inboundWebhookUrl && !isHttpsUrl(inboundWebhookUrl)) return { error: '--inbound-webhook-url must be an https URL' };
  if (mode === 'webhook' && !webhookUrl) return { error: 'webhook mode needs --webhook-url (https://<worker>/voice/retell)' };

  const bindNumber = flags.get('bind-number') === true;
  const phoneNumber = env['PHOTON_VOICE_NUMBER'] || undefined;
  if (bindNumber && (!phoneNumber || !isE164(phoneNumber))) return { error: '--bind-number needs PHOTON_VOICE_NUMBER in E.164 (+1…)' };
  if (inboundWebhookUrl && !bindNumber) return { error: '--inbound-webhook-url is applied to the number: add --bind-number' };

  return {
    mode,
    dryRun: flags.get('dry-run') === true,
    webhookUrl: mode === 'webhook' ? webhookUrl : undefined,
    inboundWebhookUrl,
    bindNumber,
    phoneNumber,
    voiceId: str('voice-id') ?? (env['RETELL_VOICE_ID'] || DEFAULT_VOICE_ID),
    model: str('model'),
    agentName: 'Homi',
    agentId: flags.get('create') === true ? undefined : env['RETELL_AGENT_ID'] || undefined,
  };
}

/** Retell LLM (the "brain"): CHANNELS.md prompt, the question as the first utterance, an end_call tool. */
export function buildLlmBody(o: Pick<SetupOptions, 'model'>): Record<string, unknown> {
  const body: Record<string, unknown> = {
    start_speaker: 'agent',
    begin_message: BEGIN_MESSAGE,
    general_prompt: AGENT_PROMPT,
    default_dynamic_variables: { question: DEFAULT_TEST_QUESTION },
    general_tools: [
      {
        type: 'end_call',
        name: 'end_call',
        description: 'Hang up after repeating the answer back and saying thanks, when the person asks to stop, or on voicemail.',
      },
    ],
    model_temperature: 0,
  };
  if (o.model) body['model'] = o.model;
  return body;
}

/** Agent: voice + privacy. Storage mode follows the retrieval mode (docs/CHANNELS.md, Voice). */
export function buildAgentBody(o: SetupOptions, llmId?: string): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (llmId !== undefined) body['response_engine'] = { type: 'retell-llm', llm_id: llmId };
  Object.assign(body, {
    voice_id: o.voiceId,
    agent_name: o.agentName,
    language: 'en-US',
    // Privacy (PRIVACY.md §10, research/platform-setup.md §E1)
    data_storage_setting: o.mode === 'poll' ? 'everything_except_pii' : 'basic_attributes_only',
    data_storage_retention_days: 1,
    contact_memory_config: { enable_read: false, enable_update: false },
    opt_in_signed_url: true,
    post_call_analysis_data: [
      {
        type: 'string',
        name: 'answer',
        description: ANSWER_FIELD_DESCRIPTION,
        examples: ['Friday works', 'Saturday at 7', 'none work'],
      },
    ],
    // One question, one answer: keep calls short.
    max_call_duration_ms: 120_000,
    end_call_after_silence_ms: 20_000,
  });
  if (o.mode === 'poll') {
    // get-call must still return call_analysis, so storage stays on, with PII scrubbed post-call.
    body['pii_config'] = { mode: 'post_call', categories: [...PII_CATEGORIES] };
    body['webhook_url'] = null;
  } else {
    body['webhook_url'] = o.webhookUrl;
    body['webhook_events'] = ['call_analyzed']; // the only event we need; fewer payloads carrying numbers/transcripts
  }
  return body;
}

export function buildPhoneNumberBody(o: SetupOptions, agentId: string): Record<string, unknown> {
  const binding = [{ agent_id: agentId, weight: 1, agent_version: 'latest' }]; // TODO(verify) 'latest' serves the draft we just wrote
  const body: Record<string, unknown> = { inbound_agents: binding, outbound_agents: binding };
  if (o.inboundWebhookUrl) body['inbound_webhook_url'] = o.inboundWebhookUrl;
  return body;
}

interface PlannedRequest {
  method: 'GET' | 'POST' | 'PATCH';
  path: string;
  body?: Record<string, unknown>;
}

const NUMBER_PLACEHOLDER = '<PHOTON_VOICE_NUMBER>';

export function planRequests(o: SetupOptions): { action: 'create' | 'update'; requests: PlannedRequest[] } {
  const requests: PlannedRequest[] = [];
  const agentRef = o.agentId ?? '<agent_id from create-agent>';
  if (o.agentId) {
    requests.push({ method: 'GET', path: `/get-agent/${o.agentId}` });
    requests.push({ method: 'PATCH', path: '/update-retell-llm/<response_engine.llm_id from get-agent>', body: buildLlmBody(o) });
    requests.push({ method: 'PATCH', path: `/update-agent/${o.agentId}`, body: buildAgentBody(o) });
  } else {
    requests.push({ method: 'POST', path: '/create-retell-llm', body: buildLlmBody(o) });
    requests.push({ method: 'POST', path: '/create-agent', body: buildAgentBody(o, '<llm_id from create-retell-llm>') });
  }
  if (o.bindNumber) requests.push({ method: 'PATCH', path: `/update-phone-number/${NUMBER_PLACEHOLDER}`, body: buildPhoneNumberBody(o, agentRef) });
  return { action: o.agentId ? 'update' : 'create', requests };
}

export interface SetupIO {
  out(line: string): void;
  err(line: string): void;
  fetch?: typeof fetch;
}

/** Returns the process exit code. */
export async function runSetup(argv: string[], env: Record<string, string | undefined>, io: SetupIO): Promise<number> {
  const parsed = parseSetupArgs(argv, env);
  if ('help' in parsed) {
    io.out(USAGE);
    return 0;
  }
  if ('error' in parsed) {
    io.err(`setup: ${parsed.error}\n${USAGE}`);
    return 2;
  }
  const o = parsed;

  if (o.dryRun) {
    const plan = planRequests(o);
    io.out(JSON.stringify({ dryRun: true, mode: o.mode, action: plan.action, requests: plan.requests }, null, 2));
    return 0;
  }

  const apiKey = env['RETELL_API_KEY'];
  if (!apiKey) {
    io.err('setup: RETELL_API_KEY is not set (put the key marked "Webhook Key" in .env)');
    return 2;
  }
  const client = createRetellClient({ apiKey, fetch: io.fetch, timeoutMs: 30_000 });

  try {
    let agentId: string;
    let llmId: string;
    if (o.agentId) {
      const agent = await client.request<Record<string, unknown>>('GET', `/get-agent/${encodePathSegment(o.agentId)}`, undefined, { label: 'GET /get-agent/:agent_id' });
      const engine = agent?.['response_engine'] as Record<string, unknown> | undefined;
      if (!engine || engine['type'] !== 'retell-llm' || typeof engine['llm_id'] !== 'string') {
        io.err('setup: RETELL_AGENT_ID does not use a Retell LLM response engine; run with --create');
        return 1;
      }
      llmId = engine['llm_id'] as string;
      await client.request('PATCH', `/update-retell-llm/${encodePathSegment(llmId)}`, buildLlmBody(o), { label: 'PATCH /update-retell-llm/:llm_id' });
      await client.request('PATCH', `/update-agent/${encodePathSegment(o.agentId)}`, buildAgentBody(o), { label: 'PATCH /update-agent/:agent_id' });
      agentId = o.agentId;
      io.out(`Updated Retell LLM ${llmId} and agent ${agentId} (${o.mode} mode).`);
    } else {
      const llm = await client.request<Record<string, unknown>>('POST', '/create-retell-llm', buildLlmBody(o));
      if (typeof llm?.['llm_id'] !== 'string') throw new RetellError('invalid_response', 'POST /create-retell-llm');
      llmId = llm['llm_id'] as string;
      const agent = await client.request<Record<string, unknown>>('POST', '/create-agent', buildAgentBody(o, llmId));
      if (typeof agent?.['agent_id'] !== 'string') throw new RetellError('invalid_response', 'POST /create-agent');
      agentId = agent['agent_id'] as string;
      io.out(`Created Retell LLM ${llmId} and agent ${agentId} (${o.mode} mode).`);
    }

    if (o.bindNumber && o.phoneNumber) {
      await client.request('PATCH', `/update-phone-number/${encodePathSegment(o.phoneNumber)}`, buildPhoneNumberBody(o, agentId), {
        label: 'PATCH /update-phone-number/:number',
      });
      io.out(`Bound the Photon number to the agent (inbound + outbound${o.inboundWebhookUrl ? ', inbound webhook set' : ''}).`);
    }

    io.out(`RETELL_AGENT_ID=${agentId}`);
    if (!o.agentId) io.out('Add the line above to .env.');
    return 0;
  } catch (e) {
    io.err(`setup: ${e instanceof RetellError ? e.message : 'unexpected error'}`);
    return 1;
  }
}

function isMain(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  const a = pathToFileURL(resolve(entry)).href;
  const b = import.meta.url;
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

if (isMain()) {
  try {
    process.loadEnvFile('.env');
  } catch {
    /* no .env: rely on the real environment */
  }
  runSetup(process.argv.slice(2), process.env, {
    out: (l) => console.log(l),
    err: (l) => console.error(l),
  }).then((code) => {
    process.exitCode = code;
  });
}
