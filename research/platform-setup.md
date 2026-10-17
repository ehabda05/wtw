# Platform setup: three group surfaces, DMs, terminal, voice (HackHarvard 2026)

Researched 2026-10-16 (evening, EDT), building on `photon-capabilities.md`. Public sources only; no logins, no accounts.

**Versions read (npm tarballs extracted read-only, never executed):**
- `spectrum-ts@12.11.0`
- `@spectrum-ts/core@12.12.0`
- `@spectrum-ts/imessage@12.11.0`
- `@spectrum-ts/imessage-local@12.11.0`
- `@spectrum-ts/telegram@12.11.0`
- `@photon-ai/imessage-kit@3.0.0`

**Other sources read:**
- GitHub `photon-hq/spectrum-ts` at commit `36754b2` ("release v12.12.0", 2026-10-16). The telegram and imessage-local sources at that commit match the published 12.11.0 code for the parts quoted here.
- Photon 2.0 OpenAPI from `https://api.photon.codes/openapi.json` (info.version 1.0.0, downloaded 2026-10-16).

**Labels used:**
- **[src]**: confirmed in package source.
- **[docs]**: from the vendor's docs.
- **[inference]**: my reasoning; not stated anywhere.

---

## 0. Findings that break or change a planned behaviour

1. **macOS local iMessage needs macOS 26 (Tahoe) or newer.**
   - `@spectrum-ts/imessage-local@12.11.0` depends on `@photon-ai/imessage-kit ^3.0.0`.
   - The v3.0.0 release notes say it requires macOS 26 and has no fallback for macOS 15 or older.
   - The Photon docs do not mention this. Check the teammate's Mac first.
2. **Local iMessage reads the whole Messages account of that Mac.**
   - Every incoming DM and group message for that Apple ID reaches `app.messages`.
   - Messages "from me" are invisible to the agent. That includes anything the account owner types on their own iPhone.
   - So the account owner cannot also be a human member of the planning group.
   - Everything the agent sends appears as sent by that person.
   - Use a separate Apple ID or macOS user for the agent (a human creates it), and allowlist chat IDs.
3. **No "added to group" event on local iMessage or on Telegram via spectrum-ts.**
   - Local: the provider drops every non-text row, including member-added, member-removed, rename, tapbacks and retracts [src].
   - Telegram: the SDK drops `my_chat_member` and `new_chat_members` [src].
   - Only the dedicated cloud line surfaces membership changes (`addMember` / `removeMember` / `leaveSpace`).
   - The portable consent trigger is therefore **first sight of an unknown space** (§D).
4. **Reaction removal is not surfaced anywhere** (cloud iMessage, local iMessage, Telegram).
   - Local iMessage does not surface reactions at all. PR #250 is still an open draft and depends on the open PRs #248 and #249.
   - Do not build "un-vote by removing a reaction". Treat reactions as add-only, or confirm votes by text.
5. **Telegram needs Photon project credentials to receive anything.**
   - Inbound arrives via Photon's Fusor edge (`https://<slug>.spctrm.dev/telegram`, then a WebSocket).
   - Without `projectId` and `projectSecret`, `app.messages` fails with "fusor: streaming via spectrum.messages requires projectId and projectSecret". That ends the **whole** merged stream, terminal included [src].
   - In offline/terminal mode, do not register the Telegram provider.
6. **Telegram reaction targets are stubs** (`{ id: message_id }` only, no content) [src].
   - Keep our own map of `sentMessageId → poll/option`.
   - Reactions need the bot to be an admin, plus a one-time manual `setWebhook` with `allowed_updates` (§C3).
7. **Telegram `space.leave()` and local `space.leave()` / `message.react()` / `message.reply()` silently no-op.**
   - The core turns `UnsupportedError` on the send path into a warning and returns `undefined` [src core `dispatchSend`].
   - They do not throw, so branch on `message.platform` yourself.
   - Telegram leave: call Bot API `leaveChat` directly.
8. **If Photon grants a dedicated line mid-hack, restart the worker.**
   - The SDK's handling of a shared→dedicated plan change is broken until restart (issue #268, fix PR #279 open).
   - New lines appear only at the next token renewal anyway [docs].
9. **Voice: one Photon voice profile can do inbound and outbound on the same SMS number** [docs].
   - Retell's inbound webhook can inject per-caller dynamic variables (§E2).
   - No caller-name (CNAM) control exists in Photon 2.0's docs or OpenAPI.
10. **Retell keeps everything forever by default.**
    - Set `data_storage_setting: "basic_attributes_only"` and `data_storage_retention_days: 1`.
    - Turn off `contact_memory_config` explicitly: new agents default `enable_read` to true.
    - Webhooks still carry the transcript, so our server is what must forget.

---

## A. Dedicated cloud iMessage line (`@spectrum-ts/imessage`)

### A1. `imessage.config()` options: dedicated vs shared

- The config schema is `z.strictObject({ clients: clientEntry | clientEntry[] (optional) })`, where `clientEntry = { address: string, token: string, phone: string }` [src `types.ts`].
- **There is no shared/dedicated flag.** The mode comes from the project's plan.
- At startup the SDK calls `POST https://spectrum.photon.codes/projects/{id}/imessage/tokens` with Basic auth (projectId:projectSecret). The response `type` is `"shared"` or `"dedicated"` [src `createCloudClients`].

**Shared mode:**
- One gRPC client to `imessage.spectrum.photon.codes:443` (override with env `SPECTRUM_IMESSAGE_ADDRESS`).
- Every space has `phone: "shared"`.
- The group-event stream is **not** subscribed (`includeGroupEvents = !shared`) [src].

**Dedicated mode:**
- One gRPC client per line at `<instanceId>.imsg.photon.codes:443`.
- `space.phone` is the line's E.164 number.
- Lines are re-reconciled on token renewal at 80% of TTL.

**Code:**
- Use the empty `imessage.config()` with `Spectrum({ projectId, projectSecret, providers:[…] })`.
- Explicit `clients` only restricts or overrides lines. Their tokens are **not** renewed [docs connection-and-routing].

**Runtime check:**
- `imessage(space).phone === "shared"` means the shared line, so there are no groups.
- With two or more dedicated lines, `space.get(chatGuid)` needs `{ phone }` [docs].

### A2. Learning that the agent was ADDED to a group

**What the docs say** (inbound-group-events):
- Group changes arrive on `app.messages` as `content.type: "addMember"` (`members` = who was added, `message.sender` = who added them, may be `undefined`).
- Also `"removeMember"`, `"leaveSpace"` (sender = leaver), `"rename"` and `"avatar"`.
- **Dedicated only.** Shared and local "do not subscribe to the group-event stream".
- Group events use the same durable catch-up log, so changes made while the app was down are replayed on reconnect.

**What the source does:**
- It drops events whose **actor** is the agent's own line, or that are `isFromMe`. It does not filter on `members` [src `toGroupItem`].

**Not documented:**
- Whether Photon's backend emits `group.changed` / `participantAdded` to a line when that line itself is added by someone else.
- If it does, it would arrive as `addMember` with `members` including `imessage(space).phone`.
- **Treat this as an optional fast path, not the trigger.** Use first-sight (§D).
- If our agent creates the group itself (`space.create([...])`, dedicated only), we already know.

### A3. `space.leave()`

- Sugar for `space.send(leaveSpace())`, which calls `remote.groups.leave(chatGuid)`. Group-only; fire-and-forget [src].
- On a DM it raises `UnsupportedError`, which the core turns into a warning (no throw).

### A4. `space.getMembers()`

- Calls `remote.chats.get(chatGuid).participants`, minus the agent's own number.
- Returns `{ id: address, address, country, service }[]`. Typed extras via `imessage(app).getMembers(space)` [src, docs group-membership].
- On a DM, shared mode or local it **throws** `UnsupportedError` (it is an action, not a send).

### A5. Mentions (inbound)

- Access with `imessage.is(message)`, then `message.mentions: readonly { address, start, length }[]`.
- Offsets are **UTF-16 offsets into `message.nativeText`**, not into `content.text` [docs message-metadata; src `mentionSchema`].
- Synthetic events (group changes, read receipts) may omit metadata.
- **[inference]** Whether iPhone users can @-mention a Photon line depends on Apple contact behaviour. Also match the agent's name in the text as a fallback.

### A6. Reactions (tapbacks)

**Inbound shape:**
- `content = { type: "reaction", emoji, target: Message }`. The target is the **full resolved message** (from a 1,000-entry cache or `client.messages.get`).
- `sender = { id: actor.address }`; `id = "<targetGuid>:reaction:<seq>[:<partIndex>]"` [src `toReactionMessages`].
- Tapback kinds map to emoji: love ❤️, like 👍, dislike 👎, laugh 😂, emphasize ‼️, question ❓. Custom emoji tapbacks pass through.

**Dropped:**
- Sticker reactions.
- Reactions with no actor or an unresolvable target.
- The agent's own reactions.

**Removal is NOT surfaced:**
- Only `message.reactionAdded` is mapped. Other `message.*` events are "consumed without mapping" [src].
- PR #248 ("surface reaction removal events") has been open since 2026-09-08.
- **Workaround [inference, untested]:** before tallying, re-read the target with `space.getMessage(id)` and check `imessage` metadata `appliedReactions[]`, which reflects the current state.

**Known bug** (issue #263, open):
- The reaction-target lookup has no timeout. One unanswered lookup stalls every later message on the ordered stream.
- Mitigation: health-check that inbound text keeps flowing, and restart on a stall.

**Outbound:**
- `message.react(Emoji.laugh)` sends a native tapback.
- The returned message can be `unsend()`-ed to remove it [docs].

### A7. Other notes

- **Quotas:** 5,000 messages per server per day, and 50 new conversations per line per day [docs].
- **Read receipts:** reliable in DMs only [prior research].
- **Contact card:** if the project profile flag `imessageSynced` is on, the SDK automatically shares the agent's contact card (name and photo) in chats, at most once per chat per 24 h [src comments].

---

## B. macOS local iMessage (`@spectrum-ts/imessage-local`)

### B1. Package, import, config

**Install** (it is NOT in the batteries-included `spectrum-ts`):
```sh
bun add spectrum-ts @spectrum-ts/imessage-local
```

**Use:**
```ts
import { Spectrum } from "spectrum-ts";
import { localIMessage } from "@spectrum-ts/imessage-local";

const app = await Spectrum({ providers: [localIMessage.config()] });
```

- The config schema is an empty `z.object({})`.
- Platform id is `"local_imessage"`, so check `message.platform === "local_imessage"`.
- Narrow with `localIMessage(...)` [src, docs].
- Only install it on the Mac; docs say not to install it in a cloud deployment.

### B2. Requirements

| Requirement | Value | Source |
|---|---|---|
| OS | **macOS 26 (Tahoe) or newer** (imessage-kit v3 targets the macOS 26 chat.db schema only) | imessage-kit v3.0.0 GitHub release notes (2026-04-20) |
| Runtime | Node.js ≥ 20 (uses optional native `better-sqlite3`; install it explicitly if optional deps are skipped) **or** Bun ≥ 1.0 (built-in SQLite). **Prefer Bun on the Mac** to avoid a native build. | imessage-kit README; spectrum troubleshooting |
| Permissions | **Full Disk Access** for the terminal/IDE/binary running the app (System Settings → Privacy & Security). Restart the terminal afterwards. | docs; imessage-kit README |
| Messages | The macOS user is signed into Messages (iMessage working). **Messages.app must be running**, or sends fail with "Messages app is not running". | docs; src `assertMessagesAppRunning` |
| Automation | Sends run `osascript` (`tell application "Messages"`). **[inference]** macOS will show a one-time Automation prompt ("… wants to control Messages") that a human must accept on the Mac. | src |
| Photon credentials | **None.** It is fully local and makes no Photon calls. | docs ("does not require project credentials"); src |

**Does it count as a "Photon channel"?**
- **[inference]** Probably not on its own: no Photon project, line or traffic is involved.
- Pair it with a real Photon surface (Telegram via Fusor, the shared-line iMessage DMs, or Photon 2.0 voice), and ask Photon.

### B3. Running alongside other providers in one `Spectrum()`

- **Yes.** Platform ids are unique (`local_imessage`, `imessage`, `telegram`, `terminal`). The docs explicitly allow cloud and local iMessage in one instance.
- **Caveat:** adding `telegram.config()` requires `projectId` and `projectSecret`, or the merged stream errors (§0.5).
- **Caveat [inference]:** the process must then run on the Mac, which must stay awake (`caffeinate -dims`) and online for the whole demo.

### B4. Detecting new groups or being added

**Not possible through the provider:**
- `toMessages` returns `[]` when `message.reaction !== null`, `message.kind !== "text"` (this covers `memberAdded`, `memberRemoved`, `nameChanged` and `groupAction`) or `retractedAt !== null` [src `inbound.ts`].
- A new group becomes visible only when someone other than the account posts text in it.
- `space.id` is the chat GUID (`any;+;chat…` for groups on macOS 26; `any;-;<address>` for DMs).
- `sender.id` is the sender's handle (phone or email).
- `space.phone` is `""`.

**Possible out-of-band [inference, untested]:**
- `@photon-ai/imessage-kit` is already installed. A separate `new IMessageSDK().listChats({ kind: "group", sortBy: "recent" })` poll could detect newly appearing groups.
- That reads more of the personal database. Only do it on a dedicated agent account.

### B5. Reactions, replies, typing, leave

| Action | Behaviour | Source |
|---|---|---|
| Inbound reactions | **Dropped.** PR #250 "surface local inbound events" is still an **open draft** (last updated 2026-09-09). It depends on #248 and #249, both open. | src; GitHub API |
| Outbound reaction (`message.react`) | `UnsupportedError("react")`; warn-and-skip, returns `undefined` | src |
| Outbound reply (`message.reply`) | Unsupported, so a silent no-op. **Use `space.send`.** | src; docs |
| Inbound replies | Wrapped as `content.type: "reply"` with a stub target `{ id, content: custom{ imessage_type: "reply-target", stub: true } }`. **The planner must unwrap `reply.content`.** | src `wrapReply` |
| Typing | Accepted as a no-op | src; docs |
| Leave group | `UnsupportedError("leaveSpace")`; warn-and-skip | src |
| `getMembers`, `getDisplayName` | **Throw** `UnsupportedError` | src |
| Edit, unsend, read receipts, effects, polls | Unsupported | src |
| Send | Text, attachments and contacts via AppleScript. Returns a synthetic record with a random UUID id, so there is no real message id to correlate later reactions. | src `synthRecord` |

### B6. Gotchas

- **Watcher model:** `fs.watch` on `~/Library/Messages/chat.db-wal`, falling back to a directory watch on WAL rotation. It reads rows in batches of 100 by ROWID [src].
  - It is event-driven, with no fixed polling interval, so latency should be roughly sub-second **[inference; not measured]**.
- **No catch-up after downtime:** on start, `lastRowId = MAX(ROWID)`. Anything that arrived while the process was down is skipped [src].
- **Send timing:** default `sendTimeout` is 30 s per AppleScript call and `maxConcurrentSends` is 10. Multi-attachment sends are paced at about 500 ms between files [imessage-kit README].
- **Privacy:** see §0.2. Filter by an allowlist of `space.id` **before** logging or sending anything to the LLM.

---

## C. Telegram via spectrum-ts (`@spectrum-ts/telegram@12.11.0`)

### C1. Setup and configuration

- Import: `import { telegram } from "spectrum-ts/providers/telegram"`. It is included in `spectrum-ts`.
- Config: `telegram.config({ botToken, webhookSecret?, baseUrl? })`.

| Option | Env fallback | Notes |
|---|---|---|
| `botToken` | `SPECTRUM_TELEGRAM_BOT_TOKEN` | Must match `^\d+:[A-Za-z0-9_-]+$` |
| `webhookSecret` | `SPECTRUM_TELEGRAM_WEBHOOK_SECRET` | Optional; 1–256 characters `[A-Za-z0-9_-]` |
| `baseUrl` | `SPECTRUM_TELEGRAM_BASE_URL` | Defaults to `https://api.telegram.org` |

- **The bot token lives in our env or code.** The docs show it in `telegram.config`, not in the dashboard [docs telegram/setup; src].
- Whether the Photon dashboard also needs Telegram toggled on is **unverified**. The core only logs a warning when a platform is enabled in the dashboard but not registered.

**Photon infrastructure used [src]:**

1. **Webhook registration.** On startup, with `projectId` and `projectSecret`, the core calls `GET /projects/{id}/` and gets the project `slug`.
   - The provider's `ensureWebhook` sets the Telegram webhook to `https://<slug>.spctrm.dev/telegram` (domain override: env `SPECTRUM_SUPER_WEBHOOK`).
   - It only calls `setWebhook` when the current URL differs, passing `secret_token` if `webhookSecret` is set.
   - It never passes `allowed_updates`.
2. **Inbound delivery.** Telegram POSTs to Photon's Fusor edge, which pushes events over `wss://fusor-ws.spectrum.photon.codes/v1/subscribe` (bearer from `POST /projects/{id}/fusor/token`) into `app.messages`.
3. **Outbound.** Our process calls `api.telegram.org` directly with the bot token. Photon is not in the outbound path.
4. **Without credentials.** Registration is skipped ("local/direct mode"), and `app.messages` errors because Fusor needs credentials.
   - Direct mode would need our own HTTP endpoint and `app.webhook(...)`. Not explored.

**[inference]** Telegram allows one webhook per bot. Two teammates running the app against **different** Photon projects with the same bot token will steal each other's webhook. Use one bot per environment.

### C2. Group privacy mode (BotFather)

Telegram rules [core.telegram.org/bots/features#privacy-mode; bots/faq]:
- Privacy mode is on by default.
- With it on, the bot sees only commands addressed to it, replies to it, and similar.
- Bot **admins** and bots with privacy **off** receive all messages, except those from other bots.
- The change takes effect only after the bot is **re-added** to the group.

Steps:
1. **[HUMAN, Telegram account]** In @BotFather: `/newbot` and copy the token.
2. **[HUMAN]** In @BotFather: `/setprivacy` → choose the bot → **Disable**.
3. **[HUMAN]** Optional, if we want inbound reactions: `/setjoingroups` → Enable (default on).
4. **[HUMAN]** Add the bot to the group. If it was added before step 2, remove and re-add it.
5. **[HUMAN]** For reactions: promote the bot to **admin**.
   - Telegram requires admin for `message_reaction`.
   - **[inference]** Toggling off every individual admin right should still count as admin; not verified.

### C3. Reactions: enabling `message_reaction`

Telegram rules [Bot API `Update`, `setWebhook`]:
- `message_reaction` is only sent if the bot is an admin **and** it is listed in `allowed_updates`.
- The default (an empty list) excludes `chat_member`, `message_reaction` and `message_reaction_count`.
- If `allowed_updates` is not specified, the previous setting is kept.

**The SDK never sets `allowed_updates`.** One-time fix by any teammate who has the token:
1. Start the app once, so `ensureWebhook` registers the URL.
2. `GET https://api.telegram.org/bot<TOKEN>/getWebhookInfo` and copy `result.url` (`https://<slug>.spctrm.dev/telegram`).
3. `POST https://api.telegram.org/bot<TOKEN>/setWebhook` with this body:
   ```json
   {"url":"<same url>","allowed_updates":["message","channel_post","message_reaction","my_chat_member"],"secret_token":"<same as webhookSecret, if set>"}
   ```
   - Because the URL is unchanged, the SDK will not overwrite it on later restarts [src `ensureWebhook`].

**Inbound shape [src `fromReaction`]:**
- `content = reaction { emoji, target: { id: String(message_id), content: custom{ telegram: "reaction-target" } } }`. The target is a **stub only**.
- `sender = { id: String(user.id), handle?: username }`.
- `id = "reaction:<chat>:<msg>:<date>:<actor>:<emoji>"`.
- Only `type: "emoji"` reactions count. Custom and paid reactions are ignored.
- On a change, the newly added emoji is reported.

**Not surfaced:**
- **Removal:** `new_reaction` with no emoji, so it is dropped.
- Anonymous group reactions (`message_reaction_count`).

**Outbound:**
- `setMessageReaction` accepts only Telegram's default set of 74 emoji. Unknown emoji raise `UnsupportedError`, which is warned and skipped.
- The set includes 👍 👎 ❤ 🔥 🎉 🤔 🙏 👌 💯 🤝 👀 🏆. **It does not include ✅.**

### C4. Learning the bot was added to a group

**What Telegram sends:**
- `my_chat_member`: "The bot's chat member status was updated in a chat."
- A `new_chat_members` service message ("the bot itself may be one of these members").
- All bots receive service messages regardless of privacy mode [Bot API; bots FAQ].

**What the SDK surfaces: neither.**
- `handleMessages` maps only `message` / `channel_post` with text or media, plus `message_reaction`.
- Membership changes, edits, callback queries and polls "are ignored" [src comment].
- Service messages have no text, so `messageToContent` returns `[]` and they are dropped.

**Usable trigger: the "add to group" deep link** [core.telegram.org/bots/features#deep-linking].
- Share `https://t.me/<bot_username>?startgroup=<token>`.
- When a member uses it to add the bot, the group receives the **text** `/start@<bot_username> <token>`.
- It is a command addressed to the bot, so it is delivered even with privacy mode on, and the SDK surfaces it as `text`.
- Otherwise: first message seen in an unknown negative `space.id`.

### C5. Mention detection

- The SDK passes only `msg.text` (or the caption). **`entities` are dropped** and `reply_to_message` is not mapped [src].
- Detect mentions with a case-insensitive regex on the text: `@<bot_username>\b` and `/<cmd>@<bot_username>`.
- "Reply to the bot" cannot be detected through the SDK.
- `sender.handle` is the user's @username, if they have one. `sender.id` is the numeric user id.

### C6. Leaving a chat

- `space.leave()` sends `leaveSpace`, which raises `UnsupportedError`, so it is a **silent no-op** [src].
- **Recommended:** call Telegram directly with `POST https://api.telegram.org/bot<TOKEN>/leaveChat {"chat_id": <id>}` (returns `True`) [Bot API].
- `space.send(custom({ method: "leaveChat", params: {} }))` would reach the Bot API, because the SDK injects `chat_id`. But the result `true` has no `message_id`, so the SDK fabricates a record with id `"undefined"` [src `sendContent`]. **Untested**; prefer the direct call.

### C7. Sending to a user privately

- Bots cannot start conversations: a user must add the bot to a group or message it first [core.telegram.org/bots].
- Opt-in flow:
  1. Share `https://t.me/<bot>?start=<opaque_token>`.
  2. The user taps **Start**.
  3. The private chat receives `/start <opaque_token>`, surfaced as text with `space.id === sender.id` (positive).
- Later DMs:
  ```ts
  const tg = telegram(app);
  await tg.space.create(await tg.user(userId)); // userId is a string
  ```
  Space creation works only for a single user [docs; src].
- Never put PII in the start payload (64-character limit).

### C8. Other Telegram facts

- **No member list:** `getMembers()` is not implemented and throws. The Bot API has no "list members" method, only `getChatAdministrators`, `getChatMemberCount` and `getChatMember`. **Build the roster from observed senders.**
- **Typing:** `sendChatAction("typing")` lasts 5 s or less; `stopTyping` is a no-op [src; Bot API].
- **Edits:** inbound edits are not surfaced [src]. The docs say "send and receive", but 12.11.0 has no inbound mapping.
- **Streaming text:** works only in private chats (drafts) [src].
- **Group id change:** if a basic group is upgraded to a supergroup, the chat id changes (`migrate_to_chat_id`, not surfaced). The group then looks new, so expect a second intro.
- **Rate limits** (core.telegram.org/bots/faq, "My bot is hitting limits"):
  - In a single chat, avoid more than 1 message per second; short bursts are allowed, then 429.
  - In a group, a bot cannot send more than 20 messages per minute.
  - Bulk notifications top out at about 30 messages per second.
  - **Design:** batch replies, never send more than about 1 message every 3 s per group, and back off on 429 (`retry_after`).

---

## D. Consent intro: portability and the single rule

| Surface | Native "added" signal reachable from spectrum-ts | Best trigger |
|---|---|---|
| Dedicated cloud iMessage | `addMember` group event; whether it fires for the agent's own addition is unverified. Group creation by us is known locally. | `addMember` containing `imessage(space).phone` (fast path) **or** first sight |
| Local iMessage | None (non-text rows dropped) | First sight: first inbound text from an unknown `space.id` |
| Telegram | None (`my_chat_member` / service messages dropped). The `?startgroup=` deep link produces a `/start@bot <token>` text. | `/start@bot` text (fast path) **or** first sight |
| iMessage DM (shared line) | n/a. The user must text first. | First inbound message in that DM |
| Terminal | n/a | First message per `space.id` (demo) |

**Recommended single rule: first sight of an unknown space.**

```
key = `${message.platform}:${space.id}` + (imessage dedicated && multiple lines ? `:${imessage(space).phone}` : "")
on ANY inbound event (text, reaction, addMember, reply…) where space is a group/DM not in consentStore:
  1. Do not log, persist, or send the triggering content to the LLM
     (inspect it only for an explicit opt-in/stop keyword).
  2. Send the one-time intro with space.send(...) (never message.reply; it no-ops on local and Telegram):
     what the bot does, what it stores, "reply STOP / /stop to remove me".
  3. Write consentStore[key] = { introSentAt, status: "pending" } BEFORE sending,
     so retries and catch-up replays cannot double-send.
  4. Stay passive (no reading, summarising or LLM calls) until a member opts in
     (e.g. "ok", or /start@bot), or proceed after the intro if the team accepts implied consent.
```

**Why first sight wins:**
- It is the only signal all three surfaces deliver.
- It also covers the dedicated line's undocumented self-add case.
- It covers Telegram supergroup migration and catch-up replays.

**Gaps:**
- A group that never speaks never gets an intro. That is acceptable: we also never read it.
- On local iMessage, the account owner's own messages are invisible, so they cannot trigger it.

---

## E. Retell (voice) and ElevenLabs fallback

Sources were fetched 2026-10-16. Field names were checked in `docs.retellai.com/api-references/create-agent.md` (OpenAPI YAML).

### E1. Storage and privacy settings on the agent

**`data_storage_setting`** (enum; default `"everything"`). It replaces the deprecated `opt_out_sensitive_data_storage`. Values:
- `everything`: transcripts, recordings and logs stored.
- `everything_except_pii`: stored with PII removed per `pii_config`.
- `basic_attributes_only`: "no transcripts/recordings/logs". Get-call later omits them.

**Stored by default** (docs accounts/privacy-disable):
- Call logs, transcripts and recordings.
- Inbound caller ID and outbound callee ID.
- Knowledge-base retrieval logs.
- Dynamic variables and metadata.

**Webhooks still deliver sensitive data when storage is opted out:**
- "You will continue to receive webhook events", including transcript and recording.
- The recording link expires 10 minutes after the webhook.

**`data_storage_retention_days`:**
- Integer 1–730; `null` or unset means kept forever (the default).
- Deletion is daily and permanent.
- It applies under any storage mode [create-agent; accounts/data-retention].

**`pii_config`:**
- Shape: `{ mode: "post_call", categories: [...] }`.
- Categories: `person_name`, `address`, `email`, `phone_number`, `ssn`, `passport`, `driver_license`, `credit_card`, `bank_account`, `password`, `pin`, `medical_id`, `date_of_birth`, `customer_account_number`.
- Scrubbing covers the transcript, the recording (beeped; `scrubbed_recording_url`), public logs, dynamic variables, metadata, call analysis and tool calls.
- Pricing lists "PII Removal +$0.01/min".

**`contact_memory_config`:**
- Shape: `{ enable_update, enable_read }`.
- New agents default to `enable_update: false` and `enable_read: true`. Updating memory requires storing data.
- **Set both to false.**

**`opt_in_signed_url`** (boolean): makes public log and recording URLs signed and expiring (default 24 h, `signed_url_expiration_ms`).

**Recommended agent settings:**
```json
{
  "data_storage_setting": "basic_attributes_only",
  "data_storage_retention_days": 1,
  "contact_memory_config": { "enable_update": false, "enable_read": false },
  "opt_in_signed_url": true,
  "webhook_url": "https://<worker>/voice/retell",
  "webhook_events": ["call_ended", "call_analyzed"],
  "post_call_analysis_data": [
    { "type": "string", "name": "answer", "description": "The member's answer to {{question}}, one short phrase." }
  ]
}
```

### E2. Inbound call webhook (per-caller dynamic variables)

**Where:**
- It is configured **per phone number**, as `inbound_webhook_url` on `PATCH /update-phone-number/{phone_number}` or in the dashboard.
- It "works for numbers you've purchased or imported", so it covers the Photon number imported over SIP.
- It does not apply to dial-to-SIP-URI calls [docs features/inbound-call-webhook].

**Request (POST from Retell):**
```json
{"event":"call_inbound","event_timestamp":1780012672105,
 "call_inbound":{"call_id":"call_…","agent_id":"agent_…","agent_version":1,
  "from_number":"+1…","to_number":"+1…","custom_sip_headers":{}}}
```
- `call_id` is preallocated and stable across retries. Dedupe on `event` + `call_id`.

**Response (2xx JSON; every field optional):**
```json
{"call_inbound":{"dynamic_variables":{"member_name":"…","question":"…"},
 "metadata":{"planId":"…"},"override_agent_id":"…","override_agent_version":1,
 "agent_override":{"agent":{…}}}}
```
- Reject a call with only `{"call_inbound":{"reject":true}}`.
- `agent_override.agent` may even set `data_storage_setting`, `pii_config` and `post_call_analysis_data` per call.

**Timeout and failure:**
- 10 s per attempt, retried up to 2 times with exponential backoff (3 attempts in total). The call keeps ringing meanwhile.
- If every attempt fails, the call goes to the number's inbound agent if one is set; otherwise it is disconnected.

**Our use:**
- Look up `from_number` in our opt-in table.
- Return the open question for that member, or `reject:true` for unknown callers.
- **[unverified]** That Photon passes the real caller E.164 in the SIP From header so that `from_number` is meaningful.

### E3. Webhook signature verification

- Header: `X-Retell-Signature`, formatted `v=<timestamp_ms>,d=<hex>`.
- `d` is HMAC-SHA256 over the **raw body** concatenated with the timestamp, keyed with the API key.
- SDK helper: `Retell.verify(rawBody, process.env.RETELL_API_KEY, signature)` (Node `retell-sdk`) or `retell.verify(...)` (Python).
- Only the API key carrying the **webhook badge** works. Set it in Settings → API Keys → "Set as Webhook Key".
- Retell's egress IP for allowlisting is `100.20.5.228` [docs features/secure-webhook].
- Applies to `call_inbound` and to the call-event webhooks.

### E4. API authentication

- `Authorization: Bearer <RETELL_API_KEY>` against base URL `https://api.retellai.com` [docs api-references/overview].

### E5. Post-call analysis

**Defining fields:**
- `post_call_analysis_data` is an array of items typed `string`, `enum` (needs `choices`), `boolean` or `number`. Each needs `type`, `name` and `description`.
- Optional per item: `required`, `examples`, `conditional_prompt`.
- `post_call_analysis_model` defaults to `gpt-5.6-terra` per the schema description; the schema example is `gpt-4.1-mini` [create-agent].

**Where results land:**
- Payload is `{ event, call }`. Results are in **`call.call_analysis.custom_analysis_data`**, keyed by field name.
- Built-in fields: `call_summary`, `in_voicemail`, `user_sentiment`, `call_successful`.
- **`call_ended` excludes `call_analysis`**, so listen for `call_analyzed` [docs features/post-call-analysis-consumption].

**Events and delivery:**
- `webhook_events` defaults to `call_started`, `call_ended` and `call_analyzed`. `transcript_updated` and the `transfer_*` events also exist.
- `webhook_timeout_ms` defaults to 10000.
- Delivery is retried up to 3 times if no 2xx arrives (backoff not specified).

### E6. Pricing and free credit

From retellai.com/pricing, fetched 2026-10-16:

**Plan:**
- Pay-as-you-go comes with **"$10 in free credits"** and 20 free concurrent calls.
- Extra concurrency costs $8 per concurrent call per month.
- The trial credit is granted once per email [delegated read of docs accounts/billing; not re-checked].

**Per-minute rates:**
- Voice infrastructure: $0.055.
- Retell platform voices (TTS): $0.015; other voices up to $0.10.
- LLM examples: GPT 5 nano $0.0016, Gemini 3.5 Flash $0.048, Claude 5.5 Sonnet $0.064.

**Telephony and add-ons:**
- **"No Charge for Sip Trunking/Custom Telephony"**, so the Photon number costs nothing extra in Retell.
- PII Removal: +$0.01/min.
- Branded Call: +$0.10 per outbound call (Retell numbers).

**Estimate:**
- About **$0.07–0.13 per minute** in Retell, plus Photon voice at $0.013/min (prior research).
- The $10 credit covers roughly 75–140 test minutes.

### E7. Retell data retention policy

- **Product default:** kept forever until `data_storage_retention_days` is set [docs].
- **Privacy policy** (Last Updated July 20, 2026):
  - No fixed period. For customer data, "our customer determines the retention period."
  - It lists using data "to train the artificial intelligence models that support our Services".
  - No AI-training opt-out is described, and it does not clearly say whether customer call content is used.
  - **Flag for the privacy claim:** say "Retell is configured to store only basic attributes for 1 day". Do not claim "nothing is stored".
- **Compliance** (delegated read of docs general/compliance; not re-checked by me):
  - HIPAA, SOC 2 Type 1 and Type 2, GDPR.
  - Self-serve BAA and DPA.
  - No "zero data retention" mode is documented.

### E8. ElevenLabs Agents fallback

**`platform_settings.privacy` on the agent** [elevenlabs.io/docs agents create API]:
- `record_voice` (default true)
- `retention_days` (-1 means no limit)
- `delete_transcript_and_pii`
- `delete_audio`
- `apply_to_existing_conversations`
- `zero_retention_mode`
- `conversation_history_redaction` (enterprise)

**Zero Retention Mode, per agent** (docs eleven-agents/customization/privacy/zrm, fetched by me):
- No recordings.
- No transcripts or metadata containing PII stored after the call.
- Data must be taken from **post-call webhooks**.

**ZRM is enterprise-only:** the workspace-level ZRM page is titled "Zero Retention Mode (Enterprise)" and says "Enterprise customers can use Zero Retention Mode."
- Whether the per-agent toggle works on non-enterprise plans is **unverified**. Assume it does not.

**Workable non-enterprise setting:** `record_voice:false`, `retention_days:1`, `delete_transcript_and_pii:true`, `delete_audio:true`.

**Post-call webhook** (delegated read):
- Header `ElevenLabs-Signature`; SDK `webhooks.constructEvent`.
- Event types: `post_call_transcription`, `post_call_audio`, `call_initiation_failure`.
- Retries are off by default.

**Free tier:** 15 agent minutes [delegated read of elevenlabs.io/pricing/agents].

---

## F. Photon 2.0: both call directions on one profile, and caller ID

**Both directions: yes.**
- A Voice profile has independent **Inbound calls** (destination SIP URI plus optional credentials) and **Outbound calls** (digest credentials) sections.
- "Configure incoming calls, outgoing calls, or both; each direction is independent." [docs beta/cookbooks/voice/retell].
- OpenAPI `VoiceProfileConfiguration = { inbound: SipInboundConfiguration | null, outbound: SipOutboundConfiguration | null }`.
- Revoking outbound leaves the "inbound destination" in place [OpenAPI `DELETE …/voice/profiles/{profileId}/outbound`].
- Calls carry `direction: "inbound" | "outbound"`.
- **Retell side:** the imported number has separate **Inbound Call Agent** and **Outbound Call Agent** selectors. Leaving one at None disables that direction.
- Set Photon inbound to `sips:sip.retellai.com` (TLS) and Retell's termination URI to `sip.photon.codes:5061`.
- The profile's media encryption (Auto or Required) applies to both directions.

**Caller-ID name (CNAM): no control found.**
- Photon 2.0 docs and the OpenAPI have no CNAM, caller-name or display-name field for voice. A grep of the 2.5 MB spec found display names only for WhatsApp senders and email.
- The callee sees the Photon number.
- Retell's "Branded Call" add-on is for Retell-purchased US numbers. A search result says it is applied for in the Retell dashboard. Whether it applies to imported SIP numbers is unconfirmed.
- **Design:** before calling, send a text heads-up ("Planner bot will call from +1…") and share a contact card.

---

## G. Does Telegram on Photon 2.0 (`api.photon.codes`) support group spaces?

**Docs silent**, with weak schema hints only (OpenAPI downloaded 2026-10-16):
- `POST /v1/projects/{id}/platforms/telegram/bots` "Starts a free managed Telegram bot connection". You open `detail.setupUrl` to create the bot in Telegram, then poll.
  - There is no BotFather token, privacy-mode or admin control in the API.
- `TelegramSpace = { id, kind: string (free text), participantIds[], details: {} }`. There is no group-specific field.
- `TelegramMessageContent` is text, attachment, voice or group (multi-part) only. **No reaction and no participants-update content.**
- `TelegramUser.handle` pattern `^([1-9][0-9]{0,15}|chat:-?[1-9][0-9]{0,15})$`.
  - The `chat:-<id>` form suggests a negative (group) chat id can be addressed as a pseudo-user.
  - This is a hint that groups exist in the model, not documentation.
- No beta guide page for Telegram exists in `photon.codes/docs/llms.txt`.
- **Conclusion:** use spectrum-ts Telegram (§C) for groups. Ask Photon whether the managed bot can join groups with privacy off.

---

## Event matrix: what we need, and how each surface delivers it

As of spectrum-ts 12.11.0 / core 12.12.0. The terminal column is from prior research.

| Event we need | Dedicated cloud iMessage | macOS local iMessage | Telegram (spectrum-ts) | Terminal (offline) |
|---|---|---|---|---|
| **Added to group** | `content.type:"addMember"` (members, sender = adder) on dedicated only. **Whether it fires for our own addition is unverified.** Use first sight. | **Not delivered** (memberAdded rows dropped). First text in an unknown `space.id`. | **Not delivered** (`my_chat_member` / `new_chat_members` dropped). `?startgroup=` gives a `/start@bot <token>` **text**, or first sight. | n/a. New chat via Ctrl+N; first message. |
| **Member message** | `text` / `attachment` / `voice` / `reply{content,target}`; `sender.id` = phone or email; `space.type:"group"` | `text` / `attachment` / `voice` / `contact`, replies wrapped as `reply` with a stub target; `sender.id` = handle. **The account owner's own messages are invisible.** | `text` / attachment / voice (caption becomes text; multi-part becomes `group`); `sender.id` = numeric id, `handle` = username. Needs privacy off or admin. | `text`; sender always `terminal-user` (persona shim) |
| **Mention of the agent** | `imessage(msg).mentions[{address,start,length}]` (UTF-16 into `nativeText`), plus a name match in text | Not surfaced. Match the agent name in text. | Entities dropped. Regex `@bot_username` / `/cmd@bot_username` on text. | Text match |
| **Reaction add** | `reaction{emoji, target: full Message}`; sender = reactor; 6 tapbacks mapped to emoji; stickers dropped | **Not delivered** (PR #250 draft) | `reaction{emoji, target: stub {id}}`. Only if the bot is **admin** and `message_reaction` is in `allowed_updates` (manual `setWebhook`). Emoji only. | Delivered (per prior research) |
| **Reaction remove** | **Not delivered** (PR #248 open). Workaround: refetch `appliedReactions`. | Not delivered | **Not delivered** (empty `new_reaction` dropped) | Not verified |
| **Member left** | `leaveSpace` (sender = leaver), or `removeMember{members}` when removed by someone | Not delivered | Not delivered (`left_chat_member` dropped) | n/a |
| **Agent removed** | **[inference]** Possibly `removeMember` containing our phone; unverified. Sends then fail. | Not delivered. Sends may fail or go nowhere (unverified). | Not delivered (`my_chat_member` dropped). Detect via send error 403 (bot was kicked) **[inference: standard Bot API error]**. | n/a |

---

## Setup checklists

`[HUMAN]` means a person with the relevant account must do the step. Everything else can be done by a developer from code or a terminal.

### 0. Common: Spectrum (Stable) project

1. **[HUMAN, Photon account]** Create a project at `app.photon.codes`. Copy the **Project ID** and **Project Secret** into env as `SPECTRUM_PROJECT_ID` and `SPECTRUM_PROJECT_SECRET`.
2. Pin the versions: `spectrum-ts@12.11.0` (core 12.12.0 is also published; do not mix mid-hack).
3. Write one worker that loops over `app.messages`.
   - Normalize to `{platform, spaceKey, senderId, text, kind}`.
   - Unwrap `reply` content.
   - Apply the consent store (§D) before anything else.
4. Handle SIGTERM by calling `app.stop()`. Run exactly one replica.

### 1. Dedicated cloud iMessage line

1. **[HUMAN, Photon]** Ask Photon to provision a dedicated line on the project (Business plan, or a hackathon grant).
   - Verify in the dashboard that the line shows a phone number.
2. **Restart the worker** after provisioning (issue #268/#279; new lines are picked up only at token renewal).
3. Use the code `Spectrum({ projectId, projectSecret, providers:[imessage.config()] })`.
   - On boot, log `imessage(space).phone` from the first inbound message. It must not be `"shared"`.
4. **[HUMAN, iPhone]** A member creates an iMessage group with the line's number, or the agent creates it with `imessage(app).space.create([alice, bob])`.
5. Test that a member message arrives with `space.type === "group"`, and that `space.getMembers()` returns the roster.
6. Test a tapback to the agent's message. It arrives as `reaction`; removal will not.
7. Test `space.leave()` on a throwaway group.
8. Watch for stalls (issue #263). If text stops while the stream is "healthy", restart.

### 2. macOS local iMessage

1. **[HUMAN]** Confirm the Mac runs **macOS 26 Tahoe or newer** (Apple menu → About This Mac). If not, local is out (imessage-kit v3).
2. **[HUMAN, Apple account]** Best: create or use a **separate Apple ID** and macOS user for the agent, and sign into Messages with it. Otherwise the owner's personal messages flow in, and the owner can't be a group member.
3. **[HUMAN, on the Mac]** Grant **Full Disk Access** to the terminal or IDE (System Settings → Privacy & Security → Full Disk Access). Restart the terminal.
4. **[HUMAN, on the Mac]** Keep **Messages.app open**. Accept the Automation prompt ("… wants to control Messages") on the first send.
5. Install Bun (≥ 1.0) and run `bun add spectrum-ts@12.11.0 @spectrum-ts/imessage-local@12.11.0`.
6. Use the code `Spectrum({ providers:[localIMessage.config(), terminal.config()] })`.
   - Add `projectId` and `projectSecret` plus `telegram.config()` only if you also want Telegram in this process.
7. Keep the Mac awake: `caffeinate -dims`, with power connected.
8. **[HUMAN, iPhone]** A member adds the agent's Apple ID to an iMessage group and sends a message. The agent's intro should follow (first sight).
9. **Allowlist:** ignore every `space.id` not in the consent store, and log nothing from those spaces.
10. Remember the limits:
    - No catch-up after a restart.
    - No reactions.
    - No `reply`.
    - No member list.

### 3. Telegram group

1. **[HUMAN, Telegram account]** In @BotFather:
   - `/newbot`, then copy the token into `SPECTRUM_TELEGRAM_BOT_TOKEN`.
   - `/setprivacy` → **Disable**.
   - Note the bot's `@username`.
2. Generate a webhook secret (e.g. 32 random `[A-Za-z0-9_-]` characters) into `SPECTRUM_TELEGRAM_WEBHOOK_SECRET`. Optional but recommended.
3. Use the code `Spectrum({ projectId, projectSecret, providers:[telegram.config({ botToken })] })` and start it once.
   - Confirm that `getWebhookInfo` shows `https://<slug>.spctrm.dev/telegram`.
4. **[HUMAN, Telegram]** Create the group and add the bot with `https://t.me/<bot>?startgroup=hello`. The group receives the `/start@<bot> hello` text, which triggers the intro.
5. **[HUMAN, Telegram]** If inbound reactions are wanted, promote the bot to **admin**.
6. If reactions are wanted, run the one-time `setWebhook` with the same URL, `allowed_updates` including `message_reaction`, and the same `secret_token` (§C3).
7. Test:
   - A member message arrives.
   - An `@bot` mention is detected by regex.
   - A 👍 reaction on the bot's message arrives (if admin).
   - `leaveChat` via a direct Bot API call works on a throwaway group.
8. Rate-limit outbound to at most 20 messages per minute per group (aim for 1 per 3 s), and honour 429 `retry_after`.
9. Private check-ins: share `https://t.me/<bot>?start=<opaque>`. The member taps Start, then the bot can DM them.

### 4. iMessage DMs on the shared line (opt-in check-ins)

1. **[HUMAN, Photon]** Register each participant's phone or email as a project **user** in the dashboard. Free plan: up to 10 users. Otherwise you get "Target not allowed for this project".
2. **[HUMAN, each participant]** Text the agent first. Each person may see a different pool number.
3. In code, the same `imessage.config()` applies. The DM space has `type:"dm"` and `phone:"shared"`.
4. Respect deliverability: no links in the first message, at most 2–3 follow-ups, no bursts.

### 5. Terminal (offline)

1. `Spectrum({ providers:[terminal.config()] })` only. **Do not** include `telegram.config()` without credentials.
2. Pre-download tuichat v0.1.4 on good Wi-Fi, or set `TUICHAT_BINARY`.
3. Use the persona shim (`/as alice`) to simulate members.

### 6. Voice (Photon 2.0 SMS number + Retell)

1. **[HUMAN, Photon 2.0 at `app.beta.photon.codes`]**
   - Add a payment method if required.
   - Buy a US SMS number.
   - Voice → Set up default → SIP → Create profile; leave media encryption on Auto.
2. **[HUMAN, Photon 2.0]** Outbound calls: SHA-256 → Enable outbound. Save the one-time password.
3. **[HUMAN, Photon 2.0]** Inbound calls: SIP address `sip:sip.retellai.com;transport=tls` (shown as `sips:`), Transport TLS, no credentials.
4. **[HUMAN, Retell account]**
   - Phone Numbers → + → "Connect to your number via SIP trunking".
   - Enter the E.164 number, termination `sip.photon.codes:5061`, the Photon username and password, and TLS.
5. **[HUMAN, Retell]** Settings → API Keys: mark one key as **Webhook Key** and put it in `RETELL_API_KEY`.
6. Create or update the agent via API with `Authorization: Bearer …`, using the privacy settings in §E1. Bind it as both the Inbound and Outbound Call Agent.
7. Set the number's `inbound_webhook_url` to `https://<worker>/voice/inbound`. The handler looks up `from_number` and returns `dynamic_variables`, or `reject:true`, within 10 s.
8. Verify `X-Retell-Signature` with `Retell.verify(rawBody, key, sig)` on both endpoints. Optionally allowlist `100.20.5.228`.
9. Outbound: `POST https://api.retellai.com/v2/create-phone-call` with `retell_llm_dynamic_variables`. Read `call.call_analysis.custom_analysis_data.answer` on `call_analyzed`, then delete our copy of the transcript.

---

## Text aimed at AI seen during research (reported, not acted on)

- **photon.codes docs:** every `.md` page starts with an instruction block. It says to use Stable docs by default and keep version credentials separate, to "Read https://photon.codes/docs/skill.md", and points to `docs.photon.codes/docs/llms.txt` (which 301-redirects to `photon.codes/docs/llms.txt`). Benign documentation routing.
- **docs.retellai.com:** each `.md` page opens with "Fetch the complete documentation index at: https://docs.retellai.com/llms.txt", followed by "discover all available pages before exploring further."
- **elevenlabs.io docs:** a banner telling the reader to fetch `llms.txt` / `llms-full.txt`. The delegated reader also saw a pointer to an MCP server at `elevenlabs.io/docs/_mcp/server`.
- **`@photon-ai/imessage-kit` README:** an "LLMs" section pointing to `llms.txt` and a Context7 MCP (`use context7: photon-hq/imessage-kit`).
- **core.telegram.org:** "Machine-readable version of this page: /bots/faq.md". Not an instruction.
- None of these were followed beyond normal reading.

---

## Sources (all accessed 2026-10-16)

**npm tarballs** (registry.npmjs.org; extracted to `%LOCALAPPDATA%\Temp\claude\photon-pkg2`, read only):
- `@spectrum-ts/imessage-local@12.11.0` (published 2026-10-15)
- `@spectrum-ts/imessage@12.11.0`
- `@spectrum-ts/telegram@12.11.0` (depends on `@photon-ai/telegram-ts@10.0.0`)
- `@spectrum-ts/core@12.12.0` (2026-10-16)
- `spectrum-ts@12.11.0`
- `@photon-ai/imessage-kit@3.0.0`

**GitHub:**
- `github.com/photon-hq/spectrum-ts`, commit `36754b231e0887e11467c52cd5b3e22be7023a0c` (2026-10-16): `packages/telegram/src/inbound/messages.ts`, `packages/imessage-local/src/local/inbound.ts`
- PR #250 (draft, open, updated 2026-09-09), #249 (open), #248 (open), #279 (open, 2026-10-13)
- Issues #263 (open, 2026-10-07), #268, #287
- `github.com/photon-hq/imessage-kit` releases: v3.0.0 (2026-04-20) release notes

**Photon docs (Stable)**, `photon.codes/docs/…md`:
- `spectrum-ts/providers/imessage`
- `…/imessage/connection-and-routing`
- `…/imessage/messaging-features` and its subpages: `/inbound-group-events`, `/group-membership`, `/tapback-reactions`, `/message-metadata`
- `spectrum-ts/reactions-and-replies`, `spectrum-ts/spaces-and-users`, `spectrum-ts/getting-started`, `spectrum-ts/messages`
- `spectrum-ts/providers/telegram`, `/telegram/setup`, `/telegram/conversations-and-features`
- `llms.txt`, `llms-full.txt` (troubleshooting and imessage-kit sections)

**Photon docs (Beta / Photon 2.0):**
- `photon.codes/docs/beta/cookbooks/voice/retell.md`
- `photon.codes/docs/beta/get-started/voice.md`
- `photon.codes/docs/beta/messaging/index.md`
- `https://api.photon.codes/openapi.json` (info.version 1.0.0)

**Telegram:**
- `core.telegram.org/bots/api`: Update (`my_chat_member`, `message_reaction`, `message_reaction_count`), Message (`new_chat_members`, `left_chat_member`, `migrate_to_chat_id`), `setWebhook` `allowed_updates`, `leaveChat`, `getChatMemberCount`, `getChatAdministrators`, `sendChatAction`. "Recent changes" shows Bot API 10.3 (Aug 24, 2026).
- `core.telegram.org/bots/faq`: what messages a bot gets; "My bot is hitting limits".
- `core.telegram.org/bots/features`: privacy mode, `/setprivacy`, deep linking (`?start=`, `?startgroup=`).
- `core.telegram.org/bots`: bots can't start conversations.

**Retell:**
- `docs.retellai.com/api-references/create-agent.md`, `/update-phone-number.md`, `/overview.md`
- `docs.retellai.com/accounts/privacy-disable.md`, `/accounts/data-retention.md`
- `docs.retellai.com/features/inbound-call-webhook.md`, `/features/secure-webhook.md`, `/features/post-call-analysis-consumption.md`
- `www.retellai.com/pricing`
- `www.retellai.com/legal/privacy-policy` (Last Updated July 20, 2026)
- Delegated reads, not re-checked by me: `docs.retellai.com/accounts/billing.md`, `/general/compliance.md`, `/features/webhook-overview.md`, `/features/post-call-analysis-overview.md`
- Search results only: `retellai.com/features/branded-call-id`; community.retellai.com threads #490 and #1908 (community, not official)

**ElevenLabs:**
- `elevenlabs.io/docs/eleven-agents/customization/privacy/zrm.md`
- `elevenlabs.io/docs/eleven-api/resources/zero-retention-mode` (title "(Enterprise)")
- Delegated reads: `elevenlabs.io/docs/eleven-agents/api-reference/agents/create.md`, `…/privacy/retention.md`, `…/privacy/audio-saving.md`, `…/workflows/post-call-webhooks.md`, `elevenlabs.io/pricing/agents`

---

## Could not verify

**Cloud iMessage (dedicated):**
- Whether a dedicated line receives an `addMember` event (or any group event) when **it** is added by another member, or a `removeMember` when it is removed. Both are undocumented. Test on a real dedicated line.
- Whether the `appliedReactions` refetch works as a reaction-removal workaround.
- Whether iPhone users can @-mention a Photon line so that `mentions[]` is populated.

**Local iMessage:**
- Actual end-to-end latency (WAL watch plus AppleScript), and whether the Automation prompt appears. Not tested; no Mac available.
- What happens when local iMessage sends to a group the account was removed from.
- Whether a local-iMessage-only app counts as "live on a Photon channel" for the prize.

**Telegram:**
- Whether the Photon Stable dashboard needs a Telegram platform toggle for Fusor to forward updates.
- Whether an admin bot with every individual right switched off still receives `message_reaction`.
- That `custom({method:"leaveChat"})` completes without throwing.
- That the bot receives 403 on send after being removed (standard Bot API behaviour, not tested here).
- Photon 2.0 managed Telegram bot: group support, privacy mode and admin status.

**Retell and ElevenLabs:**
- Whether Photon forwards the real caller's E.164 in SIP From, so that Retell's `from_number` identifies the member.
- Whether Retell `call_analysis` is still stored under `basic_attributes_only`.
- Whether webhooks carry scrubbed or raw data under `everything_except_pii`.
- Whether the PII add-on fee applies whenever `pii_config` has categories.
- Whether Retell trains models on customer call content. The policy is ambiguous; it needs legal reading.
- Whether ElevenLabs per-agent ZRM works outside Enterprise.
- ElevenLabs signature format and timestamp tolerance.

**CNAM / caller name:**
- Any caller-name control for the Photon SMS number, and whether Retell Branded Call applies to imported SIP numbers.
