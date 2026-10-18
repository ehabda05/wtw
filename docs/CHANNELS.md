# Homi on every channel

There is one engine and one plan state machine. Each surface gets a thin adapter that declares its `Capabilities`, and Homi designs for the lowest common denominator (plain text) and enhances where it can.

Every fact here was verified against spectrum-ts 12.11.0 source and Photon docs on 2026-10-16. See `research/photon-capabilities.md` and `research/platform-setup.md`.

## Where Homi can live in a group, ranked

Free Photon projects get **shared** iMessage lines, which can't see or post in group chats. We confirmed this in photon-hq/spectrum-ts#217 and in the Photon 2.0 API error `SHARED_LINE_GROUP_UNSUPPORTED`. So we support five group surfaces and pick whichever Photon gives us:

| # | Surface | Real groups? | What a group member experiences | Biggest limits |
|---|---|---|---|---|
| 1 | **iMessage, dedicated cloud line** (Photon Business, or a hackathon grant) | ✅ | Homi is a contact in the group: blue bubbles, tapbacks as votes, inline replies, typing dots, editable tally | Restart the worker after the line is granted (issue #268). Reaction *removal* is not surfaced. |
| 2 | **iMessage, macOS local** (`@spectrum-ts/imessage-local` on a teammate's Mac) | ✅ existing groups | Same blue bubbles, from a dedicated Apple ID on the Mac | **macOS 26+** only. No reactions in, no inline reply, no leave, no catch-up after a restart. Runs only on that Mac. Probably not a "Photon channel" on its own, so pair it with Telegram or voice. |
| 3 | **Telegram group** (`spectrum-ts/providers/telegram`, through Photon's edge) | ✅ | A bot in the group; @mentions and `/commands`; reactions if the bot is an admin | Privacy mode must be off. No poll answers, no reply-to, no "added" event surfaced. Needs Photon credentials. |
| 4 | **Telegram group via Photon 2.0's managed bot** (`SURFACES=photon2`, `api.photon.codes/v1`) | ❌ receives, can't send | Homi reads the group but can't answer in it | The managed bot receives group messages, but it can't send into groups: Send Message returns `409 SPACE_NOT_SENDABLE`, "Telegram sends require a private chat Space" (verified live 2026-10-17). Use #5 for groups. See "Photon 2.0 chat" below. |
| 5 | **Telegram group, direct Bot API** (`SURFACES=telegram-direct`) | ✅ **verified live 2026-10-17** | A bot in the group; @mentions, "homi …" and `/commands`; inline replies; editable tally; reactions if the bot is an admin | Only a @BotFather token, no Photon project or public URL. This is the surface for Telegram groups. See "Direct Telegram (the surface for groups)" below. |

**Always on, alongside whichever group surface we get:**
- **iMessage DM on the shared line.** Opt-in private check-ins. The member must be registered in the dashboard (free plan: up to 10 users) and must text Homi first.
- **Voice on the Photon 2.0 SMS number.** Opt-in calls for quiet members, plus inbound "call Homi to RSVP". This is our Best Voice Agent entry.
- **Sim** (`npm run sim`). Fully offline: the same engine, personas, a fast-forward clock, offline places and a mock call. This is the venue-Wi-Fi fallback.
- **Terminal** (`SURFACES=terminal`). spectrum-ts's terminal provider with a persona shim. It needs the `tuichat` binary, so pre-cache it.

## How each feature degrades

| Feature | Dedicated iMessage | Local iMessage | Telegram | SMS / plain text | Sim |
|---|---|---|---|---|---|
| Consent intro | first sight (also `addMember` if it fires) | first sight | first sight, or the `?startgroup=` deep link, which posts `/start@bot <token>` | first sight | first sight |
| Mention detection | `mentions[]` metadata + name regex | name regex ("homi") | regex `@<bot_username>` and `/cmd@bot` | name regex | name regex |
| Date options | header + 3 option bubbles; tapback = vote | header + numbered list; reply "1 3" | header + 3 bubbles; reactions if admin, else reply | numbered list; reply numbers | bubbles + reactions |
| Living tally | edit header (15-min edit window), else silent | no edit; `homi where are we at` | edit header | `where are we at` | edit |
| Nudge addressing | inline reply to the member's last message | name if given, else count | name or @handle | name if given, else count | inline reply |
| Roster / headcount | `space.getMembers()` | hashed presence + "we're 6" | hashed presence + "we're 6" | n/a | full |
| Private check-in | DM | DM on the shared line (opt-in, registered) | DM after the member taps `t.me/<bot>?start=…` | n/a | DM |
| Calendar handoff | `.ics` attachment | `.ics` attachment | `.ics` document | text block | `.ics` |
| `homi stop` | `space.leave()` | tombstone + "please remove me" (can't leave) | Bot API `leaveChat` | tombstone | leave |
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
- **Separate Apple ID.** Use a separate Apple ID for Homi. Messages "from me" are invisible to the provider, so the account owner can't also be a member.
- **Allowlist.** Spaces are allowlisted. Chats that never contained a Homi trigger are dropped before logging, and Homi never reads the rest of that account's messages.
- **Inline replies** from members arrive wrapped as `content.type: "reply"`, and the adapter unwraps them.

### Telegram
- **Setup (human, with a Telegram account):**
  1. In @BotFather: `/newbot`, then `/setprivacy` → Disable.
  2. Put the token in `SPECTRUM_TELEGRAM_BOT_TOKEN`.
  3. Add the bot with `https://t.me/<bot>?startgroup=homi`.
  4. Optional: make the bot an admin and run the one-time `setWebhook` with `allowed_updates` including `message_reaction`, so reactions count as votes (see `research/platform-setup.md` §C3).
- **Rate limit:** at most 20 messages per minute per group. The executor paces at 1 message per 3 seconds and honors 429 `retry_after`.
- **Chat ID changes:** a basic group upgraded to a supergroup changes its chat ID, so Homi will see it as new and re-introduce itself. That is acceptable.

### Photon 2.0 chat (Telegram group via Photon's managed bot)

`SURFACES=photon2` runs Homi directly on the Photon 2.0 API (`api.photon.codes/v1`, client `@photon-ai/api` 0.5.0). That is the product the hackathon's "built on Photon 2.0" rule names.

**Status: implemented, not yet run against a live Photon 2.0 project.** It is tested against the published client's types, with a fake client and with the real client over a fake `fetch` (`test/channels/photon2.test.ts`). Code: `src/channels/photon2*.ts`.

**How it works:**
- **Inbound:** it polls List Messages about every 1.5 s, with `direction=received` and oldest first. The cursor is `createdSince` = the newest message seen, minus a 20 s overlap, because Photon says the list is "eventually consistent". Duplicates are dropped by message ID.
  - It starts at boot time, so old history is never replayed.
  - It needs no public URL or webhook.
  - It backs off on errors and honors `Retry-After` on 429.
- **Outbound:** Send Message with a fresh `Idempotency-Key` per message. A retry reuses the key, so it never posts twice. Telegram replies use `parentMessageId`.
- **Sender:** Homi sends as the agent that received the space's messages (`receivedBy`). After a restart, it looks the agent up among the space's participants.
- **Logs:** never message text, handles, phone numbers, IDs or keys.

**Setup (human steps):**
1. Create a Photon 2.0 project at **app.beta.photon.codes**. Don't use app.photon.codes: that is Stable (Spectrum). The project ID starts with `pho_prj_`.
2. In that project, create a **project API key** (`pho_sk_…`). It needs read and write access to messages and spaces, plus `platforms:write`: the API returns the Telegram setup link only to keys with that permission. The secret is shown once.
3. Put both values in `.env` yourself. Never paste keys into a chat.
   ```
   PHOTON2_API_KEY=pho_sk_...
   PHOTON2_PROJECT_ID=pho_prj_...
   # optional, default telegram,sms,imessage
   PHOTON2_PLATFORMS=telegram
   ```
   Don't use `PHOTON_PROJECT_ID`. The Photon CLI uses that name for Stable projects, and Homi ignores it here.
4. Run `npm.cmd run photon2:check`. It prints `OK` and counts only: spaces, spaces per platform, and platform types.
   - 401 or 403: wrong key, a key from another project, or missing permissions.
   - 404: wrong `PHOTON2_PROJECT_ID`.
5. Run `npm.cmd run photon2:telegram`. This starts Photon's free managed Telegram bot connection. No BotFather token is needed: the request body is empty.
   - It prints a **setup link**. Open it on a device signed in to Telegram, then create (or pick) the bot. Telegram asks for its name and username.
   - Re-running it shows the same operation's status, because the Idempotency-Key is the same.
   - Add `-- --wait` to watch until it finishes. Add `-- --fresh` to start over after a failed or cancelled setup.
   - If a setup is already running, the API answers `409 TELEGRAM_PROVISION_IN_PROGRESS`. The script then prints that operation's ID and URL, and its setup link if the key is allowed to see it.
6. Add the bot to your Telegram group: group → Add members → the bot's @username.
   - While privacy mode is on, a bot in a group sees only @mentions, replies to the bot, and /commands.
   - Make the bot a **group admin** so it also sees plain "homi …" messages. Or set `TELEGRAM_BOT_USERNAME=<bot username>` and address it as `@<bot> …`.
   - We don't know yet whether Photon's managed bot lets you change privacy mode in @BotFather.
7. Start Homi. Set `SURFACES=photon2` in `.env`, then run `npm.cmd start`.
   - PowerShell, one-off: `$env:SURFACES="photon2"; npm.cmd start`.
   - bash: `SURFACES=photon2 npm start`.
   - Look for the log line `photon2: polling started`.
8. In the group, type `homi dinner next week?` (or `@<bot> dinner next week?`).

**Capabilities**, from the 0.5.0 contract (`sendMessage` is documented for "text and image messages" only):

| | Telegram (managed bot) | SMS | iMessage |
|---|---|---|---|
| Groups | receives group messages; can't send into them (`409 SPACE_NOT_SENDABLE`, "Telegram sends require a private chat Space", verified live 2026-10-17) | group MMS spaces "converge by participants" (unverified) | dedicated lines only; shared lines are DMs only (`SHARED_LINE_GROUP_UNSUPPORTED`) |
| Reactions in | ❌ not in Telegram's content type | mapped as votes if they arrive; Homi still asks for text replies | ❌ not in iMessage's content type |
| Reactions out, edits, polls, `.ics` files | ❌ | ❌ | ❌ |
| Inline reply | ✅ `parentMessageId` (plain message if refused) | ❌ | ❌ |
| Typing indicator | ✅ `setSpaceTyping` | ❌ | ❌ |
| Photos in (album) | ✅ image attachments up to 10 MB | same | same |
| Leave on `homi stop` | ❌ no API: Homi tombstones the space | same | same |
| DM one member | ❌ not wired (people who text Homi directly do get answers) | same | same |

**Surface mapping:** surfaces are a fixed list in the engine and in the database schema, so Photon 2.0 traffic reuses existing ones:
- Telegram uses `telegram`.
- SMS and iMessage use `imessage-shared` (direct spaces) and `imessage-dedicated` (groups).

So `photon2` can't run next to the Spectrum `telegram` or `imessage` surface for the same platform. Config refuses that combination; narrow it with `PHOTON2_PLATFORMS`.

**SMS group texts: possible, unverified.**
- The project needs an SMS number, and paid usage needs a payment method on the org.
- The API says "campaign eligibility is required unless every recipient is in-network". It also has SMS campaign operations (assign/unassign a line campaign) and a `SMS_CAMPAIGN_NOT_ELIGIBLE` error. For US numbers, expect carrier (10DLC) campaign registration before Homi can text people outside Photon's network.
- Group MMS should arrive as one Space, but we have not seen it work.
- iMessage DMs on a shared line: Homi can reply only in direct spaces, to a person with an active assignment who texted first.

**Unknowns we can only settle against a live project:**
- The exact `space.kind` values. We read "group"/"direct"-like strings, then fall back to the participant count.
- Whether `receivedBy` is set on every message. If it isn't, Homi resolves the sender from the space's participants.
- The text `format` value. We send `"plain"`; the contract types it as a free string.
- Real rate limits. We poll about 40 times a minute.
- Messages the 0.5.0 client can't decode. One would fail the whole page: the poller backs off and keeps retrying, and the fix is upgrading the client.

### Direct Telegram (the surface for groups)

`SURFACES=telegram-direct` talks to the Telegram Bot API directly, with long polling (`getUpdates`). It needs only a @BotFather token: no Photon project, no public URL, no webhook. Code: `src/channels/telegram-direct*.ts`. Tests: `test/channels/telegram-direct.test.ts` (fake `fetch`).

**Verified live (2026-10-17, a private Telegram supergroup with two humans and the bot):** the consent intro when the bot is added; `/start` and "homi what do you know" in a private chat; "homi dinner next week?" and "hey @bot plan dinner for next week" open the date poll; text votes ("fri works") get the 👍 ack and the edited tally header; ❤️ reactions on an option count as votes once `TELEGRAM_REACTIONS=on` and the bot is an admin; "homi where are we at"; "homi split 84 3 ways"; the food flow ("homi where are we eating" → one question → three options → "homi go" locks the place with a maps link); "homi what do you know"; "homi forget". Places came from the offline map because no Google key was set.

**Why:** Photon 2.0's managed Telegram bot receives group messages, but it can't send into groups. Send Message returns `409 SPACE_NOT_SENDABLE` with the detail "Telegram sends require a private chat Space" (verified live 2026-10-17). The spectrum-ts Telegram path above is unverified for group inbound. So the plan for Telegram groups is: Photon 2.0 for SMS and iMessage, this surface for Telegram.

**Setup (human steps):**
1. In @BotFather: `/newbot`, pick a name and a username, and copy the token.
2. In @BotFather: `/setprivacy` → your bot → **Disable**, so the bot sees every group message. Or make the bot a group admin instead. Privacy changes only apply to groups the bot joins afterwards, so remove and re-add it.
3. Put the values in `.env` yourself. Never paste the token into a chat.
   ```
   TELEGRAM_BOT_TOKEN=<token from BotFather>
   SURFACES=photon2,telegram-direct
   PHOTON2_PLATFORMS=sms,imessage
   # optional: read with getMe at startup when unset
   TELEGRAM_BOT_USERNAME=
   # optional: only when the bot is an admin in your groups (Telegram sends reactions to admins only)
   TELEGRAM_REACTIONS=on
   ```
   - If `TELEGRAM_BOT_TOKEN` is unset, `SPECTRUM_TELEGRAM_BOT_TOKEN` is used.
   - Telegram only: `SURFACES=telegram-direct`.
4. Run `npm.cmd run telegram:check`. It prints the bot username, `can_join_groups`, `can_read_all_group_messages` (yes = privacy mode off) and whether a webhook is set. It never prints the token or the webhook URL.
5. Run `npm.cmd start` and look for `telegram-direct: polling started`. Add the bot to the group, then type `homi dinner next week?`. Homi posts its intro the moment it is added; if it does not, the bot is not in the group (see the next step).
6. **Adding the bot, the gotchas we hit live:**
   - Pick the bot by its **full @username**. In Telegram Web (the `/a` client) the "Add members" picker only finds a bot when you type the whole username (`wtw_homi_bot`); typing its display name shows *other people's* bots with the same name. A stranger's bot called "Homi" (`@HomiBot`) exists, and adding it looks identical in the chat ("You added Homi"). Check the username in the member list before promoting anything.
   - The `https://t.me/<bot>?startgroup=...` deep link opens a chat picker on phones and in Telegram Desktop, not in Telegram Web `/a`.
   - To let reactions count as votes, promote the bot to admin with **only "Pin Messages"** (Group → Edit → Administrators → Add admin, untick everything else), then set `TELEGRAM_REACTIONS=on` and restart. Without admin, Telegram does not deliver `message_reaction` updates; text votes still work.
   - If Telegram Web `/a` shows a group with no messages or queues your actions, reload it or use the `/k` client (`web.telegram.org/k/`); the same login works in both. Sanity check from the bot's side: `getChatMember` for the bot in that chat returns `400 chat not found` until the bot has really joined.

**How it works:**
- **Start:** `getMe`, then `deleteWebhook` without dropping pending updates, so polling works even if a webhook was set earlier (for example by the Spectrum path).
- **Inbound:** `getUpdates` long polling (25 s) for `message`, `edited_message` and `message_reaction`, with offset tracking, backoff and 429 `retry_after`. Updates older than 15 minutes before boot are skipped.
- **Mapping:** the same as the Spectrum Telegram adapter (engine surface `telegram`). It also maps reply-to, edits (a corrected reply counts), the bot being added (consent intro), and photos (largest size, up to 10 MB, for the album).
- **Group size:** the Bot API cannot list members, so on the first group event per chat (per process) the adapter calls `getChatMemberCount` and hands the engine the count minus the bot as a head count. Food preferences are optional and trigger a search as soon as one member provides them; the headcount still informs the place-vote majority. A dedicated iMessage line provides the full roster instead.
- **Outbound:** plain-text `sendMessage`, inline replies (`reply_parameters`), `editMessageText` for the tally, `setMessageReaction`, typing, `.ics` files via `sendDocument`, and `leaveChat` on `homi stop`. DMs work only after the member has started the bot. Paced at 1 message per second per chat; 429 `retry_after` is honored.
- **Group upgraded to a supergroup:** the plan follows the new chat ID while Homi runs. After a restart, sends to the old ID are redirected.
- **Config refuses** `telegram` + `telegram-direct`, and `photon2` + `telegram-direct` unless `PHOTON2_PLATFORMS` leaves out `telegram`. Only one process may poll a bot; a second one gets `409`.
- **Not supported:** forum topics (Homi posts in General) and native polls.

### Shared-line iMessage DMs (private check-ins)
- **Opt-in only:** a member says "homi you can DM me" in the group. Homi then says once: "Text me 'hi' at {number} so I can reach you; I'll only use it for this plan."
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
   - Prompt: "You are Homi, calling on behalf of a friend group's plan. Ask exactly: {{question}}. Accept a short answer, repeat it back in one sentence, thank them, and hang up. Never mention anyone's name or any other plan detail."
   - `post_call_analysis_data`: `answer` (string).
   - **Privacy settings:** `data_storage_retention_days: 1` and `contact_memory_config: {enable_read:false, enable_update:false}`.
   - **Storage mode by retrieval mode:**
     - **Poll mode** (laptop or hotspot, no public URL): `data_storage_setting: "everything_except_pii"` with `pii_config` covering `person_name` and `phone_number`, so `get-call` still returns the analysis.
     - **Webhook mode** (deployed): `data_storage_setting: "basic_attributes_only"`. We read the answer from the `call_analyzed` webhook and keep nothing.

**Outbound flow:**
1. Homi announces in the group: "Still need Sam, so I'm giving them a quick call (they said that's ok)."
2. It calls `POST https://api.retellai.com/v2/create-phone-call` with:
   - `from_number` = `PHOTON_VOICE_NUMBER`;
   - `to_number` from the sealed delivery lookup;
   - `retell_llm_dynamic_variables: {question}`, e.g. "Does Friday at 7 or Saturday at 7 work better for you?";
   - `metadata: {callRef}`.
3. The answer is mapped through the same reply grammar used for text, and the group sees: "Sam's in for Fri (by phone). 6 for 6 🎉"

**Inbound flow ("call Homi to RSVP"):**
1. Retell's `inbound_webhook_url` POSTs `from_number`.
2. Homi HMACs it, finds a plan where that member is pending, and returns `dynamic_variables: {question}`. Unknown callers get `{"reject": true}`.
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
- **Photon 2.0 chat (`SURFACES=photon2`):** built directly on the Photon 2.0 API (Telegram managed bot, SMS, iMessage). It counts once it has run against a live Photon 2.0 project, which it hasn't yet.

Local iMessage on its own is probably *not* a Photon channel, so we always pair it with one of the above. We have asked Photon on Discord (NOTES.md, teammate action 1).
