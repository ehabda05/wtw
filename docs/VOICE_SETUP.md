# Voice setup: Photon 2.0 SMS number → SIP/TLS → Retell

This is the step-by-step for teammates. The design lives in `docs/CHANNELS.md` (Voice) and `docs/PRIVACY.md` §10. The vendor facts come from `research/platform-setup.md` §E–F and `research/photon-capabilities.md` §7, all verified 2026-10-16.

`[HUMAN]` marks a step that needs a person logged into a dashboard. Everything else runs from a terminal.

```
Otto worker ──HTTPS──► Retell API (create-phone-call / get-call)
                         │  hosted STT + LLM + TTS
                         ▼
                Retell SIP ──TLS 5061──► sip.photon.codes ──► phone network ──► member's phone
member calls the Photon number ──► Photon inbound ──► sips:sip.retellai.com ──► Retell ──► /voice/inbound webhook
```

The call carries only the open question, e.g. "Does Friday at 7 or Saturday at 7 work better for you?", plus an opaque `callRef`. It never carries names, the place or the group name.

---

## 1. Photon 2.0 (app.beta.photon.codes)

1. **[HUMAN]** Add a payment method. Without one, outbound voice returns `402 ENTITLEMENT_REQUIRED` (NOTES.md, item 3, is the team decision).
2. **[HUMAN]** Buy a **US SMS number**: Lines → Add SMS number, about $2/mo. Write it down in E.164 (`+1…`).
3. **[HUMAN]** Voice → Set up default → **SIP** → Create profile. Leave **Media encryption = Auto**.
4. **[HUMAN]** Set up **outbound calls**:
   - Choose digest algorithm **SHA-256**, then click **Enable outbound**.
   - Copy the **username** and the **password**. The password is shown once, so store it in your password manager, never in chat.
   - Note the SIP host `sip.photon.codes` and TLS port `5061`. Ignore "Authentication realm".
5. **[HUMAN]** Set up **inbound calls** (needed for "call Otto to RSVP"):
   - SIP address `sip:sip.retellai.com;transport=tls`. Photon shows it as `sips:sip.retellai.com`.
   - Transport **TLS**. Leave username and password empty.

## 2. Retell (dashboard.retellai.com)

1. **[HUMAN]** Create an account. Pay-as-you-go includes $10 of credit, which is about 75–140 test minutes.
2. **[HUMAN]** Phone Numbers → **+** → **Connect to your number via SIP trunking**, and fill in:
   - Phone number: the Photon SMS number, with "Format to E.164" on
   - Termination URI: `sip.photon.codes:5061`
   - SIP trunk user name / password: the Photon outbound pair from step 1.4
   - Outbound transport: **TLS**
3. **[HUMAN]** Click **Test SIP Connection**. It sends an OPTIONS request, and it must pass.
4. **[HUMAN]** Settings → API Keys: pick one key and click **Set as Webhook Key**. Only that key verifies `X-Retell-Signature`, so use it as `RETELL_API_KEY`.

## 3. Environment (`.env`, never committed)

| Var | Example | Notes |
|---|---|---|
| `VOICE_MODE` | `poll` | `mock` (offline sim), `poll` (laptop or hotspot, no public URL), `webhook` (deployed worker) |
| `PHOTON_VOICE_NUMBER` | `+1617…` | E.164 |
| `RETELL_API_KEY` | `key_…` | the **Webhook Key** from step 2.4 |
| `RETELL_AGENT_ID` | `agent_…` | printed by `setup.ts`. When set, `setup.ts` updates the agent instead of creating a new one |
| `RETELL_AGENT_VERSION` | *(empty)* | optional `override_agent_version` on each call (`latest`, a number, or a tag) |
| `RETELL_WEBHOOK_URL` | `https://<worker>/voice/retell` | webhook mode only; or pass `--webhook-url` |
| `RETELL_INBOUND_WEBHOOK_URL` | `https://<worker>/voice/inbound` | inbound RSVP; or pass `--inbound-webhook-url` |
| `RETELL_VOICE_ID` | `retell-Cimo` | optional; pick a voice in the dashboard |

The last four are not in `.env.example` yet. Add them there when you touch that file.

## 4. Create the agent: `src/voice/setup.ts`

Always look at the JSON first. A dry run calls nothing and never prints the key or the number:

```sh
node --import tsx src/voice/setup.ts --dry-run --mode poll
```

Then run it for real:

```sh
# laptop / hotspot demo (no public URL)
node --import tsx src/voice/setup.ts --mode poll --bind-number

# deployed worker
node --import tsx src/voice/setup.ts --mode webhook \
  --webhook-url https://<worker>/voice/retell \
  --bind-number --inbound-webhook-url https://<worker>/voice/inbound
```

Copy the printed `RETELL_AGENT_ID=…` line into `.env`. If you run it again with that set, it updates the same LLM and agent. Pass `--create` to force a new one.

What the script creates:

- **Retell LLM** (`POST /create-retell-llm`):
  - The CHANNELS.md prompt (`src/voice/script.ts` `AGENT_PROMPT`). It contains `{{question}}`.
  - `begin_message: "{{question}}"`, so the agent opens with the question.
  - `start_speaker: "agent"`, plus an `end_call` tool and temperature 0.
  - A default question, used only for dashboard test calls.
- **Agent** (`POST /create-agent`):
  - `post_call_analysis_data: [{type:"string", name:"answer", …}]`
  - `data_storage_retention_days: 1`
  - `contact_memory_config: {enable_read:false, enable_update:false}`
  - `opt_in_signed_url: true`
  - Calls are capped at 2 minutes.
  - Storage depends on the mode:
    - **poll:** `data_storage_setting: "everything_except_pii"` and `pii_config: {mode:"post_call", categories:["person_name","phone_number","address","email"]}`. Storage stays on so that `get-call` can still return the analysis.
    - **webhook:** `data_storage_setting: "basic_attributes_only"`, plus `webhook_url` and `webhook_events: ["call_analyzed"]`. Only the one event we need is sent.
- **`--bind-number`** (`PATCH /update-phone-number/{number}`): binds the agent as both the inbound and the outbound agent (`agent_version: "latest"`), and sets `inbound_webhook_url` if one is given.
  - **[HUMAN] alternative:** in Retell Phone Numbers, set the **Inbound Call Agent** and **Outbound Call Agent** to "Otto" and paste the inbound webhook URL.

How to describe the privacy setup honestly: "Retell is configured to keep only basic call attributes, for 1 day." Do not say "nothing is stored" (research §E7).

## 5. Wiring in the runner

```ts
import { createVoiceService, voiceConfigFromEnv } from './voice/index.js';
const voice = createVoiceService(voiceConfigFromEnv(), { now: Date.now, lookupByPhone /* webhook mode, optional */ });
voice.onResult((r) => /* feed { kind: 'call_result', ...r } to the engine */);
```

- **`POST /voice/retell`:** call `voice.handleWebhook(rawBody, headers)` and return its status and body.
- **`POST /voice/inbound`:** call `voice.handleInbound(rawBody, headers)`. It must answer within 10 s, and the lookup is capped at 7 s.
- Pass the **raw** request body string. A re-serialized JSON body fails the signature check.
- If you allowlist by IP, Retell's egress IP is `100.20.5.228`.

## 6. Go / no-go (owner: voice lead), from research/photon-capabilities.md §7

**By Fri 23:00**
- [ ] **[HUMAN]** The SMS number appears under Photon Voice → Lines.
- [ ] **[HUMAN]** Outbound is enabled without a 402.
- [ ] **[HUMAN]** The Retell import is saved, and Test SIP Connection passes.
- [ ] `setup.ts` has run and `RETELL_AGENT_ID` is in `.env`.

**Test A (by Sat 10:00): [HUMAN]** In the Retell dashboard, use **Make an outbound call** to a teammate's phone. Pass if all of these hold:
- the phone rings within 15 s and shows the Photon number;
- audio works both ways;
- the agent asks the default test question, repeats the answer back and hangs up;
- Retell Call History shows the call ended with `call_analysis.custom_analysis_data.answer` filled in;
- Photon Voice → Recent calls lists the call.

**Test B (by Sat 12:00):** run it on the worker in the mode we will demo.
- Run with `VOICE_MODE=poll` (laptop) or `webhook` (deployed). The opted-in teammate stays quiet until Otto calls.
- The answer must be posted into the group, e.g. "Sam's in for Fri (by phone)".
- Do this **twice**. Both runs must pass.
- For inbound: the teammate calls the Photon number and hears the open question. A number that is not opted in is rejected.

**GO** if Test B passes 2 of 2 by 12:00.

**NO-GO triggers:**
- A 402, or a blocked number purchase, that Photon has not fixed by 12:00.
- SIP 401/403/407 loops that persist after trying MD5 digest and TCP 5060.
- One-way audio that toggling media encryption (Required or Disabled) does not fix.

**On NO-GO:**
1. Spend one hour on the ElevenLabs cookbook with the same Photon credentials.
2. If that also fails, set `VOICE_MODE=mock`. The sim then plays a clearly labelled "(simulated call)", and the demo uses the recorded Test A call.

## 7. Troubleshooting

| Symptom | Likely cause |
|---|---|
| `Retell POST /v2/create-phone-call failed: http 402` | No payment method or credit, either in Photon (402 on SIP) or in Retell |
| Webhook returns 401 | The key isn't the Webhook Key, the body was re-serialized, or the server clock is more than 5 min off |
| The agent says "curly brace question" | No `question` dynamic variable reached the call. Check the `retell_llm_dynamic_variables` path, or check the inbound webhook response |
| Calls ring but no answer is reported in poll mode | The agent is in `basic_attributes_only`. Rerun setup with `--mode poll` |
| An inbound call is always rejected | Photon may not pass the real caller ID (see open items), or the member hasn't opted in or isn't pending |

## Open items (TODO(verify))

- **Phone-number versions.** Does a phone number bound with `agent_version: "latest"`, or a `create-phone-call` with only `override_agent_id`, run the draft that `update-agent` just edited? The Retell docs say drafts "can be attached", but publishing is a separate step (`POST /publish-agent-version/{agent_id}`). If Test A runs an old prompt, publish in the dashboard and re-select the version on the number.
- **Caller ID.** Does Photon forward the real caller E.164 in SIP From, so that `from_number` identifies the member on inbound?
- **Analysis under `basic_attributes_only`.** Is `call_analysis` still stored? We don't depend on it: webhook mode reads the answer from the webhook.
- **Default voice.** Does `retell-Cimo` (the create-agent docs example) suit the call? Pick a voice in the dashboard if not.
