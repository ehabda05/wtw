// Public surface of the voice module. The runner imports createVoiceService + VoiceService from here.
export {
  createVoiceService,
  voiceConfigFromEnv,
  DEFAULT_MOCK_ANSWER,
  type VoiceService,
  type VoiceConfig,
  type VoiceDeps,
  type VoiceMode,
  type PlaceCallRequest,
  type CallResult,
  type InboundCallTarget,
} from './service.js';
export { buildQuestion, spokenOptions, spokenTime, assertSafeQuestion, UnsafeQuestionError, AGENT_PROMPT, BEGIN_MESSAGE } from './script.js';
export { verifySignature, signPayload, parseWebhook, SIGNATURE_HEADER, type ParsedWebhook } from './webhook.js';
export { handleInbound, type InboundDeps, type InboundLookupResult, type HttpReply } from './inbound.js';
export { createRetellClient, RetellError, type RetellClient, type CallInfo } from './retell.js';
