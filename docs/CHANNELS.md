# Otto on every channel

There is one engine and one plan state machine. Each surface gets a thin adapter that declares its `Capabilities`, and Otto designs for the lowest common denominator (plain text) and enhances where it can.

Every fact here was verified against spectrum-ts 12.11.0 source and Photon docs on 2026-10-16. See `research/photon-capabilities.md` and `research/platform-setup.md`.

## Where Otto can live in a group, ranked

Free Photon projects get **shared** iMessage lines, which can't see or post in group chats. We confirmed this in photon-hq/spectrum-ts#217 and in the Photon 2.0 API error `SHARED_LINE_GROUP_UNSUPPORTED`. So we support three group surfaces and pick whichever Photon gives us:

| # | Surface | Real groups? | What a group member experiences | Biggest limits |
|---|---|---|---|---|
| 1 | **iMessage, dedicated cloud line** (Photon Business, or a hackathon grant) | ✅ | Otto is a contact in the group: blue bubbles, tapbacks as votes, inline replies, typing dots, editable tally | Restart the worker after the line is granted (issue #268). Reaction *removal* is not surfaced. |
| 2 | **iMessage, macOS local** (`@spectrum-ts/imessage-local` on a teammate's Mac) | ✅ existing groups | Same blue bubbles, from a dedicated Apple ID on the Mac | **macOS 26+** only. No reactions in, no inline reply, no leave, no catch-up after a restart. Runs only on that Mac. Probably not a "Photon channel" on its own, so pair it with Telegram or voice. |
| 3 | **Telegram group** (`spectrum-ts/providers/telegram`, through Photon's edge) | ✅ | A bot in the group; @mentions and `/commands`; reactions if the bot is an admin | Privacy mode must be off. No poll answers, no reply-to, no "added" event surfaced. Needs Photon credentials. |

**Always on, alongside whichever group surface we get:**
- **iMessage DM on the shared line.** Opt-in private check-ins. The member must be registered in the dashboard (free plan: up to 10 users) and must text Otto first.
- **Voice on the Photon 2.0 SMS number.** Opt-in calls for quiet members, plus inbound "call Otto to RSVP". This is our Best Voice Agent entry.
- **Sim** (`npm run sim`). Fully offline: the same engine, personas, a fast-forward clock, offline places and a mock call. This is the venue-Wi-Fi fallback.
- **Terminal** (`SURFACES=terminal`). spectrum-ts's terminal provider with a persona shim. It needs the `tuichat` binary, so pre-cache it.

## How each feature degrades

| Feature | Dedicated iMessage | Local iMessage | Telegram | SMS / plain text | Sim |
|---|---|---|---|---|---|
| Consent intro | first sight (also `addMember` if it fires) | first sight | first sight, or the `?startgroup=` deep link, which posts `/start@bot <token>` | first sight | first sight |
| Mention detection | `mentions[]` metadata + name regex | name regex ("otto") | regex `@<bot_username>` and `/cmd@bot` | name regex | name regex |
| Date options | header + 3 option bubbles; tapback = vote | header + numbered list; reply "1 3" | header + 3 bubbles; reactions if admin, else reply | numbered list; reply numbers | bubbles + reactions |
| Living tally | edit header (15-min edit window), else silent | no edit; `otto where are we at` | edit header | `where are we at` | edit |
| Nudge addressing | inline reply to the member's last message | name if given, else count | name or @handle | name if given, else count | inline reply |
| Roster / headcount | `space.getMembers()` | hashed presence + "we're 6" | hashed presence + "we're 6" | n/a | full |
| Private check-in | DM | DM on the shared line (opt-in, registered) | DM after the member taps `t.me/<bot>?start=…` | n/a | DM |
| Calendar handoff | `.ics` attachment | `.ics` attachment | `.ics` document | text block | `.ics` |
| `otto stop` | `space.leave()` | tombstone + "please remove me" (can't leave) | Bot API `leaveChat` | tombstone | leave |
| Typing indicator | ✅ | no-op | ✅ (5s) | n/a | ✅ |

Unsupported calls in spectrum-ts often **silently no-op**, for example `reply`, `react` and `leave` on local and Telegram. So the executor branches on `Capabilities` and never trusts a call to throw.

## Channel-specific behavior

### iMessage, dedicated cloud line
- **Config:** `Spectrum({ projectId, projectSecret, providers: [imessage.config()] })`. The mode (shared or dedicated) comes from the project plan.
  - Check at boot: `imessage(space).phone !== "shared"`.
- **Reactions:** arrive as `content.type: "reaction"` with the full target message. Tapback mapping: ❤️ 👍 ‼️ mean yes, 👎 means no, ❓ means maybe, 😂 is ignored.
- **Watchdog:** issue #263 (stream stall on reaction-target lookup). If inbound text stops for 10 minutes while sends still succeed, restart the stream.

### iMessage, macOS local
- **Requirements:**
  - macOS 26+, Bun (preferred) or Node 22.
  - Full Disk Access for the terminal.
  - Messages.app running, and the Automation prompt accepted.
  - The Mac kept awake (`caffeinate -dims`).
- **Separate Apple ID.** Use a separate Apple ID for Otto. Messages "from me" are invisible to the provider, so the account owner can't also be a member.
- **Allowlist.** Spaces are allowlisted. Chats that never contained an Otto trigger are dropped before logging, and Otto never reads the rest of that account's messages.
- **Inline replies** from members arrive wrapped as `content.type: "reply"`, and the adapter unwraps them.

### Telegram
- **Setup (human, with a Telegram account):**
  1. In @BotFather: `/newbot`, then `/setprivacy` → Disable.
  2. Put the token in `SPECTRUM_TELEGRAM_BOT_TOKEN`.
  3. Add the bot with `https://t.me/<bot>?startgroup=otto`.
  4. Optional: make the bot an admin and run the one-time `setWebhook` with `allowed_updates` including `message_reaction`, so reactions count as votes (see `research/platform-setup.md` §C3).
- **Rate limit:** at most 20 messages per minute per group. The executor paces at 1 message per 3 seconds and honors 429 `retry_after`.
- **Chat ID changes:** a basic group upgraded to a supergroup changes its chat ID, so Otto will see it as new and re-introduce itself. That is acceptable.

### Shared-line iMessage DMs (private check-ins)
- **Opt-in only:** a member says "otto you can DM me" in the group. Otto then says once: "Text me 'hi' at {number} so I can reach you; I'll only use it for this plan."
- **Group sees it:** every DM is announced in the group (PRIVACY.md §6).
- **Deliverability:** no links in the first DM and at most 2 follow-ups.

### Voice: Photon 2.0 SMS number → SIP/TLS → Retell

**Why this shape:** Photon's guidelines say phone calls run on an SMS number, not iMessage. Retell is one of Photon's four official voice cookbooks, and it hosts speech-to-text, the LLM and text-to-speech, so we run no SIP or RTP ourselves. That matters because Render and Railway accept no inbound UDP.

**Setup (human steps marked):**
1. **[human, app.beta.photon.codes]**
   - Add a payment method. Outbound returns `402` without one.
   - Buy a US SMS number.
   - Voice → SIP profile, with media encryption on **Auto**.
   - Outbound: SHA-256 digest → copy the username and the one-time password.
   - Inbound: `sips:sip.retellai.com`, TLS.
2. **[human, Retell]**
   - Phone Numbers → Connect via SIP trunking. Enter the E.164 number, termination `sip.photon.codes:5061`, the Photon username and password, and TLS.
   - Mark an API key as the **Webhook Key** and put it in `RETELL_API_KEY`.
3. **Create the agent** (we script this in `src/voice/setup.ts`):
   - Prompt: "You are Otto, calling on behalf of a friend group's plan. Ask exactly: {{question}}. Accept a short answer, repeat it back in one sentence, thank them, and hang up. Never mention anyone's name or any other plan detail."
   - `post_call_analysis_data`: `answer` (string).
   - **Privacy settings:** `data_storage_retention_days: 1` and `contact_memory_config: {enable_read:false, enable_update:false}`.
   - **Storage mode by retrieval mode:**
     - **Poll mode** (laptop or hotspot, no public URL): `data_storage_setting: "everything_except_pii"` with `pii_config` covering `person_name` and `phone_number`, so `get-call` still returns the analysis.
     - **Webhook mode** (deployed): `data_storage_setting: "basic_attributes_only"`. We read the answer from the `call_analyzed` webhook and keep nothing.

**Outbound flow:**
1. Otto announces in the group: "Still need Sam, so I'm giving them a quick call (they said that's ok)."
2. It calls `POST https://api.retellai.com/v2/create-phone-call` with:
   - `from_number` = `PHOTON_VOICE_NUMBER`;
   - `to_number` from the sealed delivery lookup;
   - `retell_llm_dynamic_variables: {question}`, e.g. "Does Friday at 7 or Saturday at 7 work better for you?";
   - `metadata: {callRef}`.
3. The answer is mapped through the same reply grammar used for text, and the group sees: "Sam's in for Fri (by phone). 6 for 6 🎉"

**Inbound flow ("call Otto to RSVP"):**
1. Retell's `inbound_webhook_url` POSTs `from_number`.
2. Otto HMACs it, finds a plan where that member is pending, and returns `dynamic_variables: {question}`. Unknown callers get `{"reject": true}`.
3. This needs webhook mode (a public URL).

**Principle 10 (PRIVACY.md):** calls carry only the open question and the answer.

**Fallbacks:**
- If Retell fails Saturday's go/no-go, use the ElevenLabs cookbook (same Photon credentials).
- If both fail, `VOICE_MODE=mock` plays a clearly labeled simulated call in the sim, and the demo uses the recorded call.

### Email digest (planned, not built)
Photon 2.0 supports email with a verified domain. A daily digest variant ("Plans this week: …") would suit groups that live in email. We did not build it, because it needs domain DNS we can't set up from the venue.

### WhatsApp Business (planned, not built)
spectrum-ts's WhatsApp Business provider is **1:1 only** (`space.create([a,b])` throws). It could carry private check-ins, but not the group itself.

## Prize eligibility

Photon's rule is "built on Photon 2.0 and live on at least one Photon channel". Our setup qualifies on the following:
- **Telegram:** goes through Photon's edge, so it is clearly a Photon channel.
- **Shared-line iMessage DMs:** a Photon iMessage channel.
- **Voice:** Photon 2.0's SIP on an SMS number.
- **Dedicated iMessage:** included if granted.

Local iMessage on its own is probably *not* a Photon channel, so we always pair it with one of the above. We have asked Photon on Discord (NOTES.md, teammate action 1).
