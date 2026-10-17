# Photon capabilities: verified research (HackHarvard 2026, Photon 2.0 track)

Researched 2026-10-16 from public docs, the photon-hq GitHub repos, published npm tarballs (read only, never executed) and the hackathon Notion page. I did not log in to any dashboard.

Versions inspected: `spectrum-ts@12.11.0` (pins `@spectrum-ts/core@12.11.0`), `@spectrum-ts/core@12.12.0`, `@spectrum-ts/imessage|terminal|telegram|whatsapp-business|hono@12.11.0`, `@photon-ai/api@0.5.0`. GitHub `photon-hq/spectrum-ts` HEAD is `36754b2` ("release v12.12.0", 2026-10-16). The terminal provider downloads `tuichat` v0.1.4 by default.

---

## 0. TL;DR: read this first

1. **There are two Photon products. Our plan straddles both.**
   - **Stable "Spectrum"**: the `spectrum-ts` SDK, the `app.photon.codes` dashboard, `spectrum.photon.codes`, and project ID + secret auth.
   - **"Photon 2.0" (public beta, launched 2026-10-15)**: the `app.beta.photon.codes` dashboard, an HTTP API at `api.photon.codes/v1`, the `@photon-ai/api` client, `pho_prj_` project IDs and bearer API keys. SMS, email and Voice profiles exist only here.
   - The hackathon prize requires a project "built on Photon 2.0 and live on at least one Photon channel". Yet the same guidelines link the old dashboard (`app.photon.codes/dashboard`) and the `spectrum-ts` docs.
   - `spectrum-ts` source only talks to `spectrum.photon.codes`, `*.imsg.photon.codes` and `fusor-ws.spectrum.photon.codes`. It never calls `api.photon.codes`.
   - **Ask Photon at the workshop whether a spectrum-ts app on a Spectrum project qualifies** (questions in section 3).
2. **iMessage group chat is not available on a free project.**
   - Free and Pro projects get shared-pool lines. A Photon maintainer closed issue #217 saying a shared line does not emit text from existing groups: "this is a limitation of Shared Line".
   - The Photon 2.0 API also says a shared iMessage line "sends only in direct Spaces" and defines error `SHARED_LINE_GROUP_UNSUPPORTED`.
   - Group chat needs a dedicated line: Business plan, $250 per line per month.
3. **Voice on Photon 2.0 does not work the way the brief says.**
   - It runs on an **SMS number** (or a WhatsApp number or dedicated iMessage line, never a shared iMessage line).
   - Server is `sip.photon.codes`: TLS on 5061, UDP/TCP on 5060.
   - Credentials are a per-Voice-profile username plus a one-time password, using SHA-256 digest (MD5 is a legacy option). They are not the project ID and secret.
   - Media encryption is "Auto" (SRTP when available).
   - Call events (`call.started`, `call.ringing`, `call.answered`, `call.connected`, DTMF, `call.ended`) exist as webhook/Socket.IO events.
   - Enabling outbound calling needs a payment method on the org, or it fails with **402 ENTITLEMENT_REQUIRED**.
4. **Voice pick: Retell hosted agent ← Photon 2.0 SMS number over SIP/TLS**, following Photon's Retell cookbook. ElevenLabs is the one-hour fallback.
   - We need zero SIP/RTP infrastructure, which matters because Render and Railway accept no inbound UDP.
   - One HTTPS call places the call. The answer comes back as a post-call webhook.
5. **Architecture: one always-on worker running the `app.messages` loop** for spectrum-ts. For Photon 2.0, use the equivalent Socket.IO subscription with a cursor.
   - Webhooks carry inbound messages only, so you still need an SDK or API client to reply.
   - Webhook retries end after about 30 s and there is no dead-letter queue.
   - Typing, edits, read receipts and poll votes are not delivered by webhook.
6. **Most practical group surface for a free project: a Telegram group.** `spectrum-ts` supports existing Telegram groups via `space.get(chatId)`.
   - Turn bot privacy mode off in BotFather, or make the bot an admin, so it sees all messages.
   - For reaction events the bot must be an admin and `message_reaction` must be in `allowed_updates`.
   - Keep the terminal provider as the offline demo. It has one fixed sender (`"terminal-user"`), so we need a persona shim.

---

## 1. The two-product problem (context for everything below)

| | Stable: Spectrum | Beta: Photon 2.0 |
|---|---|---|
| Dashboard | `app.photon.codes` | `app.beta.photon.codes` (linked from `photon.codes/beta` → "Continue to Photon 2.0") |
| Runtime API | `spectrum-ts` SDK (gRPC + WebSocket); management REST at `spectrum.photon.codes` (Basic auth) | REST `https://api.photon.codes/v1` (Bearer `pho_sk_`/`pho_ask_`/JWT), Socket.IO events, Standard-Webhooks destinations |
| Client | `spectrum-ts`, `@spectrum-ts/*` | `@photon-ai/api@0.5.0` (Node ≥22): `listMessages`, `sendMessage`, `getMessage`, `markMessageRead`, `createOrGetSpace`, `listSpaces`, `getSpace`, `createOrGetUser`, `setSpaceTyping`, `createWebhookDestination` |
| Channels | iMessage (cloud and local), WhatsApp Business, Telegram, Slack (npm), terminal, voice (SIP on iMessage lines) | iMessage, SMS, (RCS: docs silent; no separate platform enum), WhatsApp (personal) and WhatsApp Business, Telegram, email, voice (SIP on SMS/WA/dedicated lines) |
| Free tier | Free: managed shared number, up to 10 users, SMS/RCS fallback, Telegram (pricing page) | Free: $0 base, 25 shared iMessage assignments, 1 email domain, pay-as-you-go usage; blog says "$100 in free credit" |

The llms.txt docs index says to choose one version and never mix the two contracts (photon.codes/docs/llms.txt). Our hybrid (spectrum-ts for chat, Photon 2.0 for SMS and voice) is therefore two separate integrations with two credential sets.

**Recommended code structure:** keep the planner core transport-agnostic, with input `{platform, spaceId, senderId, text, ts, kind}` and output actions. Write thin adapters:
- (a) spectrum-ts: terminal, Telegram, Stable iMessage DM
- (b) Photon 2.0 API: SMS, iMessage DM, voice call events

Then the eligibility answer from Photon cannot sink us.

---

## 2. Fact check

| # | Claim (gathered Oct 16) | Status | Source / correction |
|---|---|---|---|
| 1 | Beta free; sign up at app.photon.codes/dashboard, create project, add channels; no promo code | **CHANGED (partly)** | The Notion guidelines say exactly this, but the Photon 2.0 beta dashboard is **app.beta.photon.codes** (photon.codes/beta, docs/beta/get-started/project). "Free" means a $0 base fee plus paid usage. The blog promises $100 free credit. A payment method is needed before paid features (docs/beta/billing), and outbound voice returns 402 without one (OpenAPI `PUT …/voice/profiles/{id}/outbound`). The Notion link `photon.co/beta` points to a GoDaddy for-sale parked domain; use photon.codes/beta. |
| 2 | SDK spectrum-ts (TS 5+); `npm install spectrum-ts` or `@spectrum-ts/core` + per-platform packages | **CONFIRMED** (TS 5 or 6) | docs/spectrum-ts/getting-started. Caveat: this SDK targets Stable Spectrum, not the Photon 2.0 API (see §1). |
| 3 | Primitives Message, Space, User, Platform provider; inbound is a `[space, message]` tuple | **CONFIRMED** | getting-started, messages; core d.ts `readonly messages: AsyncIterable<[Space, Message]>` |
| 4 | PROJECT_ID / SECRET_KEY; env `SPECTRUM_PROJECT_ID`, `SPECTRUM_PROJECT_SECRET`; provider fields from `SPECTRUM_<PLATFORM>_<FIELD>` | **CONFIRMED** (Stable) | getting-started. Photon 2.0 instead uses `pho_prj_…` plus a bearer API key with scopes `project:read`, `project:write`, `platforms:*`. |
| 5 | Minimal app code | **CONFIRMED** | getting-started "Run your first app" (identical) |
| 6 | Instance API: messages, send, responding, webhook, stop; message.reply; message.platform; providers merge | **CONFIRMED** + additions | core d.ts also has `app.edit(message, content)` and `options.flattenGroups`. `webhook()` has Request and raw overloads. |
| 7 | Terminal needs no creds: `terminal.config()` | **CONFIRMED** + caveat | On first run it downloads the `tuichat` binary from GitHub Releases. Sender is always `"terminal-user"` (tuichat PROTOCOL.md). |
| 8 | Webhooks: HMAC-SHA256 over `v0:<ts>:<rawBody>`, 5-min window, `webhookSecret`/`SPECTRUM_WEBHOOK_SECRET`; Hono/Express/Elysia adapters; at-least-once; dedupe `message.id`; raw body | **CONFIRMED** + additions | docs/spectrum-ts/webhooks, docs/webhooks/*. Also `@spectrum-ts/fastify` on npm. Inbound only, with no HTTP send API. HTTPS public URLs only, no redirects. Six attempts within about 30 s, then dropped (no DLQ). Typing, edits, poll votes and read receipts are not delivered. Inbound replies arrive as plain `text` (no thread link). The quickstart example names its env var `SPECTRUM_SIGNING_SECRET`, while the SDK reads `SPECTRUM_WEBHOOK_SECRET`. |
| 9a | Groups: read/reply in existing groups works on cloud lines | **CHANGED** | True only on **dedicated** lines. On shared-pool (Free/Pro) lines, group text is not emitted (GitHub issue #217, closed by the maintainer as a shared-line limitation). Photon 2.0: shared line sends only in direct spaces (`SHARED_LINE_GROUP_UNSUPPORTED`). |
| 9b | Creating groups and receiving group events need a dedicated line | **CONFIRMED** | connection-and-routing, inbound-group-events |
| 9c | Local macOS package has no groups or typing | **CHANGED** | Local *can* read and reply in **existing** DMs and group chats. It cannot create groups. Typing is accepted as a no-op (providers/imessage feature table). |
| 10 | Cloud iMessage: typing, streaming text, reactions, replies, edits, unsend, read receipts, effects | **CONFIRMED** | providers/imessage feature table. Inbound read receipts are reliable only in DMs. Rename, avatar and membership are dedicated-only. |
| 11 | `{ logLevel }`, token redaction; telemetry opt-in `telemetry: true` to Photon OTLP | **CONFIRMED** | getting-started. Source default endpoint is `https://otlp.photon.codes`. `LOG_LEVEL` env also works. |
| 12a | Voice is SIP-only; no `voice.config()`, no call events in `app.messages`, no webhooks, no SDK call control | **CONFIRMED for Stable / CHANGED for Photon 2.0** | Stable providers/voice: webhooks and SDK call control "coming soon". Photon 2.0 OpenAPI has `call.started|ringing|answered|connected|dtmf|ended` events (source `voice.photon`) via webhooks and Socket.IO. |
| 12b | Outbound: `sip.spectrum.photon.codes` TLS 5061, user = project ID, password = project secret | **CONFIRMED for Stable (+ TCP 5060 allowed) / CHANGED for Photon 2.0** | Photon 2.0 uses `sip.photon.codes`, UDP/TCP 5060 and TLS 5061. Username and password are generated per Voice profile (password shown once). Digest is SHA-256 (recommended) or MD5. |
| 12c | Inbound: register `sips:`/`sip:` route in dashboard | **CONFIRMED** (both; Photon 2.0 calls it Voice profile → Inbound calls → SIP address + Transport + optional username/password) | inbound-calls; beta cookbooks |
| 12d | Audio is RTP, not SRTP | **CONFIRMED for Stable / CHANGED for Photon 2.0** | Stable: G.711 RTP only. Photon 2.0: Media encryption "Auto" negotiates SRTP over TLS when supported; "Require encrypted calls" is optional. |
| 12e | iMessage lines only, not WhatsApp | **CONFIRMED for Stable / CHANGED for Photon 2.0** | Photon 2.0 cookbooks need an "eligible **SMS number**, **WhatsApp number**, or **dedicated iMessage line**. Shared iMessage assignments do not support Voice." The Notion guidelines say to build voice on SMS. |
| 12f | Business profile registration optional for testing | **CONFIRMED** (Stable) / docs silent for Photon 2.0 | outbound-calls. Photon 2.0 has 10DLC for SMS *messaging* instead. |
| 13 | A `voice()` builder sends an audio recording in a message | **CONFIRMED** | core d.ts: `voice(input: string \| Buffer \| URL, options?: { mimeType?: string; name?: string; duration?: number }): ContentBuilder`. Degrades to an audio attachment where voice notes are unsupported. Photon 2.0 API has `SendVoiceContent { type:"voice", attachmentId }`. |
| 14 | Channels: iMessage, WhatsApp, SMS, RCS, Telegram, phone calls (brief's product list) | **CHANGED for spectrum-ts** | spectrum-ts has providers for iMessage (cloud/local), WhatsApp Business, Telegram, Slack and terminal only. It has **no SMS, RCS, email or voice provider**. SMS/RCS appear there only as iMessage fallback (`user.service`). In Photon 2.0, SMS and email are API platforms. |

---

## 3. Group chat feasibility per channel (free hackathon project)

**Bottom line: a free project gets shared iMessage lines, not a dedicated one.**
- Stable pricing: Free and Pro are "Managed Shared". Photon 2.0 plans: Free and Pro use "shared iMessage assignments", and dedicated lines are "Not available" except on Business.
- The Notion guidelines say "Calls and group chat on iMessage both need a dedicated iMessage line".

| Channel (free project) | Bot in a group? | Label | Evidence |
|---|---|---|---|
| iMessage, shared line (Stable Free) | **No**. No group creation, no group events, and text from existing groups is not emitted. | CONFIRMED | connection-and-routing line model; issue #217 maintainer reply (2026-07-26) |
| iMessage, shared assignment (Photon 2.0 Free) | **No**. Sends only in direct spaces, only to a peer with an active assignment who messaged first. | CONFIRMED | OpenAPI `POST /v1/projects/{id}/messages` description; problem `SHARED_LINE_GROUP_UNSUPPORTED` (422) |
| iMessage, dedicated line (Business $250/line/mo) | Yes: create, read, reply, members, rename, leave, group events | CONFIRMED (not free) | group-membership, inbound-group-events, plans |
| iMessage local (macOS `@spectrum-ts/imessage-local`) | Read and reply in **existing** groups; cannot create | CONFIRMED | providers/imessage feature table. Needs a Mac signed in to Messages with Full Disk Access. Not usable from Windows/Render, and not a Photon cloud channel, so it may not satisfy "live on a Photon channel". |
| Telegram (spectrum-ts) | Yes for **existing** groups the bot was added to. Bots cannot create groups or start chats. | CONFIRMED (SDK) | telegram/conversations-and-features; telegram dist (`space.get(chatId)`, negative chat IDs) |
| Telegram (Photon 2.0 managed bot) | Docs silent on group delivery. API "kind" is a free string; Telegram content union has text/attachment/voice/group only (no reactions). | DOCS SILENT | OpenAPI `POST …/platforms/telegram/bots` ("free managed Telegram bot connection") |
| WhatsApp Business (spectrum-ts) | **No**, 1:1 only; `space.create([a,b])` throws | CONFIRMED | providers/whatsapp-business |
| WhatsApp personal (Photon 2.0 assignments/dedicated) | Schema has `space.participants.update` content and group spaces, but no doc says shared WA assignments can join groups; free availability unknown | DOCS SILENT | OpenAPI `/platforms/whatsapp/assignments`, `WhatsappMessageContent` |
| SMS / group MMS (Photon 2.0) | API mentions "SMS groups converge by participants" and has a participants-update content type. Sending needs "campaign eligibility … unless every recipient is in-network" (10DLC: $20 registration plus $15/mo, carrier review). | API CONFIRMS CONCEPT; FREE-TIER USABILITY DOCS SILENT | OpenAPI `POST …/spaces`, `POST …/messages`; beta/billing |
| RCS | No RCS platform in the Photon 2.0 enum (`sms`, `email`, `whatsapp`, `whatsapp_business`, `imessage`, `telegram`). Stable mentions RCS only as iMessage fallback. | DOCS SILENT | OpenAPI `Platform` enum; best-practices/imessage-deliverability |
| Email (Photon 2.0) | Multi-recipient threads (To/Cc) are possible ("A new email key creates a new thread") | CONFIRMED (concept) | OpenAPI `POST …/spaces`; beta/get-started/email (needs domain DNS) |
| Voice | N/A (1:1 calls) | n/a | |
| Terminal | Many chats, one human (`terminal-user`) | CONFIRMED | tuichat PROTOCOL.md |

**Product implication.**
- Use a **Telegram group** as the live group surface.
- Use **iMessage DMs** for 1:1 nudges to quiet members. Each member must be registered/assigned and must text the agent first.
- Use **voice on the SMS number**.
- Ask Photon for a temporary dedicated iMessage line. If they grant one, iMessage groups become available.

**Exact questions for the 4–5 PM workshop and Discord:**
1. Does a `spectrum-ts` app on a Spectrum Cloud project (`app.photon.codes`, project ID + secret) count as "built on Photon 2.0"? Or must the project live on `app.beta.photon.codes` and use `api.photon.codes/v1`? Will `spectrum-ts` support `pho_prj_` projects or API keys this weekend?
2. Can hackathon teams get a temporary **dedicated iMessage line** (or credits that cover one) for group chat? How and by when?
3. Is issue #217 still true on the Photon 2.0 engine, i.e. can a shared line never see or post in an existing iMessage group?
4. Photon 2.0 Telegram: does the managed bot receive **group** messages? Can we turn privacy mode off or make it an admin? Do group messages arrive as one Space with many `participantIds`?
5. SMS groups (group MMS) on a free project: allowed without a 10DLC campaign? What exactly is an "in-network" recipient? Is there a hackathon test mode?
6. With the $100 credit, is a **payment method still required** to buy an SMS number and enable outbound voice (`402 ENTITLEMENT_REQUIRED`)?
7. WhatsApp personal assignments: available on Free? Can they join groups?
8. RCS: is it under `sms`, and does group RCS work?
9. Message retention (see GitHub issue #287): how long is content stored? Can we delete messages or spaces via API? Can retention be zero? Are call recordings or transcripts stored?
10. Voice: is SHA-256 digest proven with Retell and LiveKit, or should we pick MD5? Do `call.*` events include any transcript?
11. What are the Photon 2.0 API rate limits (req/s), and the daily caps per shared assignment?
12. Will judges accept a terminal-mode fallback demo if venue Wi-Fi fails?
13. Which Discord should we use? We found four invite links (§ Sources).

---

## 4. Capability matrix

Key: Y = supported, N = not supported, DS = docs silent, (src) = confirmed from npm source.

| Capability | iMessage cloud **shared** (Free) | iMessage cloud **dedicated** | iMessage **local** macOS | WhatsApp Business | SMS / RCS | Telegram (spectrum-ts) | Email | Voice | Terminal |
|---|---|---|---|---|---|---|---|---|---|
| Join existing group | N (#217) | Y | Y (existing only) | N (1:1 only) | P2.0 API concept; 10DLC | Y (bot added by a human) | Multi-recipient thread (P2.0) | n/a | n/a (multi-chat, 1 human) |
| Sender per message | Y `sender.id` E.164/email; `service` iMessage/SMS/RCS | Y | Y | Y (WA contact id) | Y (P2.0 `sentBy`) | Y `sender.id` user id + `handle` (src) | Y (P2.0) | n/a | Y, always `terminal-user` |
| Mention a member (outbound) | N builder; plain "@name" text | N builder; inbound `mentions` metadata only | N | DS | DS | Via `custom({method:"sendMessage", params:{…entities}})` Bot API passthrough (src; untested) | n/a | n/a | N |
| DM one member | Y, only registered users who texted first (allowlist) | Y | Y | Y (24h-window rules are Meta's; not covered here) | Y (P2.0; 10DLC) | Only if the user started the bot | Y | Y (call) | Y (new chat) |
| React | Y (tapback aliases) | Y | N | Y | P2.0 schema has reaction | Y (allowed emoji set) | n/a | n/a | Y |
| Inline/threaded reply | Y | Y | N | Y | DS | Y | n/a | n/a | Y |
| Edit sent message | Y (edit window) | Y | N | DS (src default throws) | P2.0 `text.update` | Y | n/a | n/a | DS |
| Typing indicator | Y | Y | No-op | No-op (src; PR #272 open) | P2.0 typing content | Y (send) | n/a | n/a | Y |
| Receive reactions as events | Y (`content.type:"reaction"`) | Y | DS (PR #250 open) | Y | DS | Only if bot is **admin** and `allowed_updates` includes `message_reaction` (SDK does not set it) | n/a | n/a | Y |
| Attachments | Y | Y | Y | Y | MMS (P2.0) | Y | Y | n/a | Y (drag-drop) |
| Send voice note | Y `voice()` | Y | DS | DS (degrades to audio) | P2.0 `voice` content | Y (`sendVoice`, src) | n/a | n/a | Y (protocol `voice`) |
| `space.getMembers()` | N | Y | N | N (1:1) | P2.0 `participantIds` | N (not implemented) | P2.0 | n/a | N |
| `space.leave()` | N | Y | N | n/a | DS | `UnsupportedError` (custom `leaveChat`: untested) | n/a | n/a | N |

**Voice row** (Photon 2.0): SIP only, on an SMS/WA/dedicated number. Inbound and outbound calls. Events via webhook/Socket.IO. Not in `app.messages`.

---

## 5. Inbound message shape

### 5.1 spectrum-ts (from `@spectrum-ts/core` d.ts, abridged)

```ts
interface User { readonly __platform: string; readonly id: string; readonly kind?: "agent"; }
interface Message<TPlatform extends string = string, TSender extends User = User, TSpace extends Space = Space> {
  content: Content; direction: "inbound" | "outbound"; readonly id: string; platform: TPlatform;
  sender: TSender | undefined; space: TSpace; timestamp: Date;
  edit(c: ContentInput): Promise<void>; react(r: string): Promise<(Message & { content: Reaction }) | undefined>;
  read(): Promise<void>; reply(c: ContentInput): Promise<Message | undefined>; unsend(): Promise<void>;
}
interface Space { readonly __platform: string; readonly id: string;
  getMembers(): Promise<User[]>; getMessage(id: string): Promise<Message | undefined>;
  getDisplayName(): Promise<string | undefined>; add(u: MemberInput): Promise<void>; remove(u: MemberInput): Promise<void>;
  leave(): Promise<void>; rename(n: string): Promise<void>; read(m: Message): Promise<void>;
  send(c: ContentInput): Promise<Message | undefined>; startTyping(): Promise<void>; stopTyping(): Promise<void>;
  responding<T>(fn: () => T | Promise<T>): Promise<T>; edit(...); unsend(...); avatar(...); getAvatar(); }
type SpectrumInstance = { readonly messages: AsyncIterable<[Space, Message]>; stop(); send(space, ...c); edit(msg, c);
  responding(space, fn); webhook(req: Request, h): Promise<Response>; webhook(raw, h): Promise<WebhookRawResult>; }
```

**`content.type` union** (messages page): `text`, `markdown` (outbound), `attachment`, `voice`, `contact`, `richlink`, `effect`, `reaction {emoji, target: Message}`, `poll`, `poll_option`, `group {items}`, `rename`, `avatar`, `addMember {members}`, `removeMember {members}`, `leaveSpace`, `reply {content, target}`, `edit`, `unsend`, `read {target}`, `typing`, `streamText`, `app`, `custom {raw}`.

**Platform extras** (reach them via narrowing such as `imessage(space)` or `imessage.is(message)`):
- **iMessage space:** `{ id, type: "dm" | "group", phone }`. `phone` is the literal `"shared"` on pooled lines (webhooks/events).
- **iMessage user/sender:** `{ address?, country?, service?: "iMessage" | "SMS" | "RCS" | "unknown" }`.
- **iMessage message metadata:** `isDelivered`, `sendErrorCode`, `dateRead`, `nativeText`, `mentions[{address,start,length}]`, `appliedReactions`, and more (message-metadata page; imessage d.ts).
- **Telegram:** `sender = { id: String(from.id), handle?: username, isMe: false }`; `space.id = String(chat.id)`, negative for groups (src).
- **Terminal:** `sender.id = "terminal-user"`; optional `replyTo: { messageId }`; reaction IDs look like `reaction:<msgId>:<emoji>:<ts>` (src).

**Group membership** is not on `Message`. Call `space.getMembers()`, which works on dedicated iMessage groups only.

**Reply-to:** use the `reply` content arm or the terminal `replyTo` extra. On webhooks, inbound replies arrive as plain `text`.

**Timestamps:** `message.timestamp` is the platform send time. Read receipts carry the reader's time.

### 5.2 Stable webhook wire body (docs/webhooks/events)

`{ event:"messages", space:{id, platform, type?, phone?}, message:{ id:"spc-msg-<uuid>" | composite, platform, direction:"inbound", timestamp:ISO, sender:{id, platform}, space:{…}, content } }`

- Headers: `X-Spectrum-Event`, `X-Spectrum-Webhook-Id`, `X-Spectrum-Timestamp`, `X-Spectrum-Signature: v0=<hex>`.
- Reaction `target` is a slim ref: `{id, platform, timestamp, sender?, contentPreview?}`.

### 5.3 Photon 2.0 API Message (OpenAPI, abridged)

`{ id, platform, status: "received" | "accepted" | "dispatched" | "delivered" | "failed", content, sentBy: UserSnapshot, receivedBy?, addressedTo?, space: SpaceSnapshot{ id, kind, participantIds[], platform, details }, parentMessageId?, timestamps, createdAt, metadata }`

Content unions per platform:
- **iMessage:** text, attachment, `message.read`, `space.typing.update`, group. No reaction in the schema today.
- **SMS and WhatsApp:** add `text.update`, voice, reaction `{action:"add"|"remove", reaction}`, `message.delete`, `space.participants.update`, poll*.
- **Telegram:** text, attachment, voice, group.

---

## 6. Architecture: webhook vs `app.messages` loop (Render / Railway)

**Decision: run one always-on worker process with the `for await (const [space, message] of app.messages)` loop.** Expose a tiny HTTP server in the same process for health checks and the Retell webhook.

What `app.messages` holds open (verified in npm source):
- **iMessage cloud:** a gRPC server stream per line to `<instance>.imsg.photon.codes:443` (shared mode uses `imessage.spectrum.photon.codes:443`). It is a resumable ordered stream with sequence-cursor catch-up after reconnects (`catchUpEvents`, `resumableOrderedStream`).
  - The cursor lives in process memory; I found no persistence across restarts.
  - Tokens are renewed at 80% of TTL.
- **Fusor providers (Telegram):** a WebSocket to `wss://fusor-ws.spectrum.photon.codes/v1/subscribe` with auto-reconnect. The Telegram webhook itself is registered to `https://<project-slug>.spctrm.dev/telegram`.
- **Terminal:** a local TCP JSON-RPC link to the spawned tuichat process.

Why the loop and not webhooks:
1. A reply needs a live SDK instance anyway. Webhooks deliver inbound only: "there is no public HTTP 'send a message' endpoint today".
2. The worker makes only **outbound** connections. Render and Railway need no public webhook route and no HTTPS/redirect pitfalls.
3. Webhook delivery is about 6 attempts over roughly 30 s with no DLQ, so events are lost if our dyno restarts. The loop has catch-up on reconnect.
4. Webhooks omit typing, edits, read receipts and poll votes. Inbound replies lose their thread link.
5. A conversational agent (debouncing, cancellation) is easier in one process, as Photon's own best-practices pipeline shows.

Deployment notes:
- Run **exactly one** replica. Two replicas would each consume the stream, and SDK-level fan-out semantics are DOCS SILENT.
- Pick a plan that does not sleep.
- Call `app.stop()` on SIGTERM. Since 12.10 the SDK no longer installs signal handlers (custom-events-and-lifecycle).
- Requires a Node ≥22 or Bun runtime (gRPC). Edge or worker isolates are not supported.
- **Templates:** Photon lists **no Render or Railway templates**. Only Vercel appears (Chat SDK and eve integrations). `create-spectrum-project` scaffolds an echo app (`npm create spectrum-project@latest`).
- **Photon 2.0 equivalent:** a Socket.IO client from the same worker. Connect to `io("https://api.photon.codes", { path: "/v1/projects/<id>/events/ws", transports:["websocket"], extraHeaders:{Authorization:"Bearer …"} })`, then `emit("subscribe", { startSeq })`. Persist `seq` only after a delivery is handled; replay is limited to retained history (docs/beta/websocket/*). It is outbound-only and carries the same event objects as webhooks, including `call.*` events.

---

## 7. Voice stack decision

| Option | Fit with Photon | Verdict |
|---|---|---|
| **Retell** (custom telephony) | Official Photon cookbook. TLS outbound, digest user/pass, SRTP over TLS optional, codecs PCMU/PCMA/G.722. Outbound via `POST https://api.retellai.com/v2/create-phone-call` with `from_number`/`to_number` in E.164, plus optional `retell_llm_dynamic_variables`, `metadata`, `idempotency_key`. Post-call `call_analysis` with custom fields via agent webhook events (`call_started`, `call_ended`, `call_analyzed`). | **PICK**: fully hosted STT+LLM+TTS; nothing to run on Windows; one HTTPS call to dial; structured answer arrives by webhook |
| **ElevenLabs Agents** | Official Photon cookbook and Photon 2.0's default "Build a voice agent" path. TLS 5061, Media Encryption Disabled/Allowed/Required, SIP trunk username/password, G.711/G.722. Outbound: `POST https://api.elevenlabs.io/v1/convai/sip-trunk/outbound-call` with `agent_id`, `agent_phone_number_id`, `to_number`. | **Fallback** (same Photon credentials; about 1 h switch) |
| **LiveKit Cloud + Agents** | Official Photon cookbook. Outbound trunk `{ address:"sip.photon.codes:5061", transport:"SIP_TRANSPORT_TLS", numbers:["+1PHOTON"], authUsername, authPassword, mediaEncryption:"SIP_MEDIA_ENCRYPT_ALLOW" }`. The Photon cookbook puts host:port in Address. LiveKit's own page shows no port example. Media encryption is off by default, which is required for Stable Spectrum's RTP-only voice. Call via `lk sip participant create` or the SIP participant API. | Works, but needs a deployed agent worker plus STT/TTS/LLM providers. More moving parts. Use only if we want custom turn-taking. |
| **Vapi BYO SIP** | Not in Photon cookbooks. `byo-sip-trunk` credential with `gateways[{ip}]` (hostname shown in example) and `outboundAuthenticationPlan {authUsername, authPassword}`. TLS/port and SRTP not documented on that page. | Skip |
| **Twilio** (cookbook) | Calls API with `To=sip:+E164@sip.photon.codes:5061;transport=tls;secure=true`, `From=+1PHOTON`, `SipAuthUsername`, `SipAuthPassword`, and inline TwiML. | Viable "dumb" fallback: TwiML `<Say>` plus speech `<Gather>` gives one question and one answer with no AI vendor. Twilio trial limits not verified. |
| **Asterisk/PJSIP, drachtio/jambonz** | Possible on a VPS | **Reject**: RTP needs inbound UDP. Railway is TCP/HTTP only (docs: TCP Proxy) and Render offers HTTPS only (community staff). Windows dev is painful. |

### Exact config (Photon 2.0 + Retell), from docs/beta/cookbooks/voice/retell

**Photon (`app.beta.photon.codes`):**
1. Add an **SMS number**. Local US number at $2/mo; via API `POST /v1/projects/{id}/platforms/sms/numbers` with `countryCode:"US"` and optional `areaCode`, plus an Idempotency-Key. A payment method may be required.
2. **Voice → Set up default → SIP → Create profile**. Leave Media encryption on **Auto**.
3. **Outbound calls:**
   - Choose Digest algorithm **SHA-256**, then **Enable outbound**.
   - Save the password; it is shown once and can be rotated.
   - Copy **Username**, the **SIP connection** host (`sip.photon.codes`) and the **TLS port 5061**.
   - "Authentication realm" can differ; ignore it for Retell.
4. Optional, inbound: SIP address `sip:sip.retellai.com;transport=tls`. It is auto-reformatted to `sips:sip.retellai.com`. Transport TLS, username and password empty.

**Retell:**
5. Phone Numbers → **+** → "Connect to your number via SIP trunking". Fill in:
   - **Phone Number:** the Photon SMS number in E.164, with Format to E.164 on.
   - **Termination URI:** `sip.photon.codes:5061` (copy from your profile).
   - **SIP Trunk User Name / Password:** the Photon outbound pair.
   - **Outbound Transport:** TLS.
6. Agent: a single-prompt agent.
   - Prompt: "Ask {{question}}. Confirm the answer in one sentence. Hang up."
   - Post-call analysis field: `answer` (text).
   - Agent `webhook_url`: `https://<our-worker>/voice/retell`.
   - Bind it as the **Outbound Call Agent** on the imported number.
7. Dial from our server with `POST https://api.retellai.com/v2/create-phone-call` and body `{ from_number:"+1PHOTON", to_number:"+1MEMBER", retell_llm_dynamic_variables:{ question:"Friday or Saturday for dinner?" }, metadata:{ planId }, idempotency_key:"<planId>-<memberId>" }`.
8. Capture the answer from the `call_analyzed` webhook (`call.call_analysis` custom data plus `transcript`). Post it to the group.
   - The Retell auth header format and webhook signature scheme were not read this session: check the Retell docs before coding.

**Number format and caller ID:**
- Request-URI/To is `sip:+<E.164>@sip.photon.codes[:5061];transport=tls`, from the Twilio cookbook `To=sip:${RECIPIENT_NUMBER}@${PHOTON_SIP_SERVER};transport=tls;secure=true`.
- `From` must be the Photon number in E.164. Photon authorizes it against the profile's outbound credentials.
- Caller ID is the Photon (SMS) number (LiveKit and Retell cookbooks).
- Stable Spectrum differs: From must be an iMessage line owned by the project, otherwise 403. Dial in full international format, e.g. `+14155550123`.

**Voice-note fallback:**
- spectrum-ts: `await space.send(voice(buffer, { name:"q.m4a", mimeType:"audio/mp4", duration: 6 }))`. `ffmpeg-static` is an optional peer dependency used for transcoding.
- Photon 2.0 API: upload an attachment (`POST /v1/projects/{id}/attachments`), then send `{ type:"voice", attachmentId }`.
- The answer comes back as text, or as an inbound voice/attachment that we transcribe ourselves.

### Saturday-noon go/no-go (owner: voice lead)

- **By Fri 23:00:**
  - SMS number visible under Voice → Lines.
  - Outbound enabled without a 402 error.
  - Retell import saved, and "Test SIP Connection" (OPTIONS) passes.
- **Test A (by Sat 10:00):** Retell dashboard "Make an outbound call" to a teammate.
  - Pass if: phone rings in under 15 s, shows the Photon number, two-way audio, the agent asks the question, and Retell Call History shows ended with `call_analysis` populated.
  - Photon Voice → Recent calls shows the call.
- **Test B (by Sat 12:00):** our Render/Railway worker calls `create-phone-call`. The `call_analyzed` webhook lands, and the answer is posted into the Telegram or terminal group. Pass 2 of 2 runs.
- **GO** if Test B passes 2/2 by 12:00. **NO-GO triggers:**
  - 402 ENTITLEMENT_REQUIRED, or SMS number purchase blocked, with no fix from Photon by 12:00.
  - SIP 401/403/407 loops after trying MD5 digest and TCP 5060.
  - One-way audio that "Media encryption Required/Disabled" toggles do not fix.
- **On NO-GO:**
  - Spend one hour on the ElevenLabs cookbook with the same Photon credentials.
  - If that also fails, ship the voice-note fallback and say in the demo that live calling is wired but blocked.

---

## 8. Answers 1–8 and extra questions

**1. What a free hackathon project gets.**
- **Photon 2.0 Free:** $0 base fee, 25 shared iMessage assignments, 1 email domain, no included SMS/voice/email allowance.
  - Usage rates: SMS $0.01/part, voice $0.013/min US/CA, email $0.001.
  - Local US number $2/mo. Telegram and WhatsApp Business sends carry no per-message fee. No dedicated iMessage lines.
  - The blog promises $100 free credit; the billing API mentions "welcome credit".
  - Paid usage requires a payment method (docs/beta/plans-and-billing, docs/beta/billing).
- **Stable Spectrum Free:** managed shared number, up to 10 users, unlimited daily messages with Auto Scale, RCS/SMS fallback, Telegram, "Group Messaging API: Limited" (photon.codes/pricing).
  - Shared lines only message users registered in the dashboard ("Target not allowed for this project").
  - Quotas: 5,000 msgs/server/day and 50 new conversations/line/day.
- **How many lines:** shared-pool assignments only, a different pool number per end user. No project-owned line.

**2. Capability matrix:** see §4.

**3. Message shape:** see §5.

**4. Webhook vs loop:** see §6. Choose the loop (or Socket.IO on Photon 2.0). Photon lists no Render or Railway templates.

**5. Voice:** see §7.

**6. Idempotency, rate limits, failures, SMS fallback.**
- **Idempotency:**
  - Webhooks: dedupe on `X-Spectrum-Webhook-Id + message.id`; the same ID survives retries.
  - SDK iMessage stream: dedupes live vs catch-up by sequence, and gRPC sends use `autoIdempotency: true, retry: true` (src).
  - `space.send` has no app-level idempotency key (DS). Best-practices recommend our own `clientGuid` and a resume cursor.
  - Photon 2.0: an `Idempotency-Key` header is required on writes. Errors include `IDEMPOTENCY_KEY_REUSED` (422) and `IDEMPOTENCY_REQUEST_IN_PROGRESS` (409).
- **Rate limits:**
  - Spectrum management API: 5 req/s/project, then 429.
  - iMessage: 5,000 outbound/server/day (hard limit) and 50 new conversations/line/day. Bursts of 100+ get lines flagged.
  - Photon 2.0: `RATE_LIMITED` (429) on any endpoint; numbers are DS. Also `SHARED_LINE_CAP_EXCEEDED` and `SHARED_LINE_POOL_EXHAUSTED`.
- **Failures:**
  - Unsupported actions throw `UnsupportedError`.
  - `message.reply()` **no-ops** where threads are unsupported. It is not downgraded, so use `space.send` when delivery matters.
  - iMessage `sendErrorCode` and `isDelivered` are available via `imessage.is(msg)`.
  - Photon 2.0 messages move through `accepted → dispatched → delivered | failed`, with matching events. 202 means accepted, not delivered.
- **SMS fallback:**
  - Pricing lists "RCS and SMS fallback" on all Stable tiers. The deliverability doc says fallback traffic is filtered by carriers.
  - `user.service` reports `iMessage`/`SMS`/`RCS`.
  - Whether fallback is automatic, can be disabled, or works on shared lines: DS.
  - In Photon 2.0, SMS is its own platform and needs a 10DLC campaign unless recipients are "in-network".

**7. What Photon retains.**
- **Privacy policy (updated 2026-09-25):** covers account, usage, device and **log data ("API call logs")**. Data is kept "as long as your account is active or as necessary". It is deleted or anonymized within 30 days of account deletion. The policy says nothing specific about relayed message content; GitHub issue #287 (open, 2026-10-15) asks exactly this.
- **Terms of Service:**
  - "Customer Data" explicitly includes Message Content.
  - Photon may process it to provide the service and to derive Usage and Aggregated (de-identified) Data. That derived data may be used to "train, fine-tune" Photon ML models.
  - After termination there is a 30-day export window, after which Photon may delete; backups may retain data.
  - Betas are for internal evaluation only, with no warranty and a $50 liability cap.
- **Product evidence that content is stored server-side:**
  - Photon 2.0 lists historical messages (`GET /messages`, counts) and has a SQL metrics API, API logs with "recorded request and response information", and stored verification codes ("filtered OTP").
  - Stable keeps attachments fetchable by GUID and a "durable catch-up log".
  - No message-deletion API is documented. `message.delete` is an unsend to recipients.
- **Implication for "forgets everything":** claim only that *our* app deletes its state. The transport provider retains data under its own policy.

**8. Terminal provider offline.**
- `Spectrum({ providers: [terminal.config()] })` needs no credentials.
- The **first run downloads** `tuichat-windows-x64.exe` (v0.1.4) from GitHub and caches it at `%LOCALAPPDATA%\tuichat\v0.1.4\`. Pre-warm it on venue Wi-Fi, or set `TUICHAT_BINARY` to a local copy (src). Windows x64 is supported.
- Multiple chats: Ctrl+N creates `chat-2`, `chat-3`, …; programmatic `terminal(app).space.get("plan-demo")`.
- **The sender cannot be set.** It is always `"terminal-user"`. Options for simulating a group:
  - (a) a persona shim: register `/as` with `terminal.config({ commands:[{name:"/as"}] })`, or parse a `alice: …` prefix. The shim rewrites `senderId` before the planner core.
  - (b) a custom provider via `definePlatform` (docs/spectrum-ts/custom-platforms).
- `getMembers` is not implemented, so keep a local roster in demo mode.
- The LLM also needs an offline path: a rules or local-model fallback.
- Non-TTY mode pipes stdin and works for scripted demos and tests.

**Extra questions.**
- **Mention a member:**
  - No outbound mention builder exists in spectrum-ts. Send plain "@Name".
  - Native iMessage mentions arrive inbound only, as `mentions[{address,start,length}]` metadata.
  - Telegram: a `custom({ method:"sendMessage", params:{ text, entities:[{type:"text_mention", offset, length, user:{id}}] } })` passthrough, with `chat_id` injected by the SDK (src; untested).
- **Reactions:**
  - They arrive as a normal `Message` with `content.type === "reaction"`, `content.emoji` and `content.target`. On webhooks the target is a slim ref, and `sender` is who reacted.
  - iMessage reaction **removal** is not surfaced yet (PR #248 open).
- **`space.members`:** the method is `space.getMembers(): Promise<User[]>` (excludes the agent). Typed extras come from `imessage(app).getMembers(space)`. Dedicated iMessage groups only. Photon 2.0 uses `space.participantIds`.
- **Leave a group:**
  - `space.leave()` (sugar for `send(leaveSpace())`) works on dedicated iMessage groups only.
  - Telegram throws `UnsupportedError`. `custom({method:"leaveChat"})` should reach the Bot API but may error afterwards, because the SDK expects a `message_id` (src).

---

## 9. Risks (numbered, highest first)

1. **Eligibility and product mismatch.**
   - What: the prize needs "built on Photon 2.0". Photon 2.0 is the `api.photon.codes` platform; spectrum-ts talks to Spectrum.
   - Mitigation: transport-agnostic core plus two adapters; ask at the workshop (Q1).
2. **No iMessage groups on free shared lines** (CONFIRMED by a maintainer).
   - What: our core use case is group planning.
   - Mitigation: Telegram group as the group surface; iMessage DMs for nudges; request a dedicated line.
3. **Payment method and compliance gates.**
   - What: outbound voice returns 402 without a payment method. The SMS number costs $2/mo. SMS *texting* needs 10DLC ($20 plus $15/mo, with carrier review) unless recipients are "in-network".
   - Mitigation: get a card on the org on Friday (user action), and use SMS for voice only.
4. **Shared-line onboarding friction.**
   - What: every judge or member must be registered (Stable allowlist, 10 users) or assigned (Photon 2.0, 25 seats) and must **text first**. Each person sees a different pool number.
   - Mitigation: pre-register the team, use `sms:` deep links, keep the demo inbound-first.
5. **Venue network failure.**
   - What: tuichat downloads on first run; the LLM and Photon are cloud services.
   - Mitigation: pre-cache tuichat, add an offline LLM fallback, use the persona shim.
6. **Telegram group visibility.**
   - What: privacy mode hides non-command messages (set `/setprivacy` *before* adding the bot, or re-add it). Reaction events need admin plus `allowed_updates` that include `message_reaction`; the SDK's `setWebhook` omits it, though Telegram keeps a previously set value. Bots cannot DM users who never started them.
7. **Webhook loss and blind spots.** Six attempts over about 30 s, no DLQ, HTTPS-only, no redirects, inbound-only, no typing or read events. Mitigation: use the loop or Socket.IO.
8. **Privacy claim exposure.**
   - What: Photon stores message content server-side (API lists messages, logs). The terms allow ML training on de-identified derived data. No deletion API exists, and the beta terms give no warranty.
   - Mitigation: phrase it as "we forget"; don't promise end-to-end forgetting.
9. **Hosting.**
   - What: Render and Railway accept no inbound UDP, which kills self-hosted SIP/RTP. Running two replicas of the loop may double-process.
   - Mitigation: hosted voice vendor and a single worker.
10. **Moving target.**
    - What: Photon 2.0 launched 2026-10-15. Beta "Messaging" docs say "being rewritten". spectrum-ts released twice this week.
    - Mitigation: pin `spectrum-ts@12.11.0` and `@photon-ai/api@0.5.0`; don't upgrade mid-hack.
11. **Deliverability.**
    - What: no links or media in a first message; at most 2–3 follow-ups to non-responders; no bursts; 50 new conversations/line/day; off-hours sends look automated.
    - Mitigation: the "nudge quiet members" logic must pace itself.
12. **Read receipts are unreliable in groups and off by default on devices.** Mitigation: detect "quiet" members by message activity, not read receipts.
13. **Doc contradictions to keep in mind.**
    - Webhook overview says "in-order per project", but the delivery page says no per-space ordering.
    - Webhook docs say there is no "get space by id", but the SDK has `space.get(id)`.
    - The local-iMessage group claim differs between pages.
    - The Notion page encourages "Photon iMessage group chat" while its own Requirements say groups need a dedicated line.

---

## 10. Text aimed at AI that I saw (reported, not acted on)

- **photon.codes/docs/llms.txt, llms-full.txt, skill.md, and an "Agent Instructions" block on every `.md` page:**
  - Tells agents to use Stable by default, keep packages and credentials within one version, state the version used, and pass `version` on MCP searches.
  - Benign documentation routing. I used it only as a factual description of the two products.
- **Retell docs:** a header telling AI readers to fetch `llms.txt` and "discover all available pages before exploring further".
- **ElevenLabs docs:** a pointer to `llms.txt` and `llms-full.txt`.
- **Vapi docs:** notes to AI clients about `.md` URLs and an MCP server.
- **LiveKit docs:** a footer pointer to `llms.txt`.
- **`create-spectrum-project` README (not aimed at me):**
  - The scaffolder writes `AGENTS.md` and `CLAUDE.md` into new projects.
  - It offers to star the repo and follow the org through an authenticated `gh` CLI.
  - Be aware if a teammate runs it.
- **Security-relevant non-AI finding:** the Notion link `photon.co/beta` goes to a GoDaddy "for sale" parked domain. Do not enter credentials there.

---

## 11. Sources (all accessed 2026-10-16)

**Photon docs: Stable**
- https://photon.codes/docs/llms.txt
- https://photon.codes/docs/llms-full.txt
- https://photon.codes/docs/skill.md
- https://photon.codes/docs/spectrum-ts/introduction
- https://photon.codes/docs/spectrum-ts/getting-started
- https://photon.codes/docs/spectrum-ts/messages
- https://photon.codes/docs/spectrum-ts/spaces-and-users
- https://photon.codes/docs/spectrum-ts/reactions-and-replies
- https://photon.codes/docs/spectrum-ts/platform-narrowing
- https://photon.codes/docs/spectrum-ts/webhooks
- https://photon.codes/docs/spectrum-ts/content (and /text, /voice, /attachments, /read, /typing-indicators, /membership, /polls, /replies, /edits, /unsend)
- https://photon.codes/docs/spectrum-ts/providers
- https://photon.codes/docs/spectrum-ts/providers/voice
- https://photon.codes/docs/spectrum-ts/providers/voice/outbound-calls
- https://photon.codes/docs/spectrum-ts/providers/voice/inbound-calls
- https://photon.codes/docs/spectrum-ts/providers/voice/troubleshooting
- https://photon.codes/docs/spectrum-ts/providers/imessage
- https://photon.codes/docs/spectrum-ts/providers/imessage/connection-and-routing
- https://photon.codes/docs/spectrum-ts/providers/imessage/messaging-features (and /group-membership, /inbound-group-events, /inbound-read-receipts, /message-metadata, /tapback-reactions, /fetching-attachments)
- https://photon.codes/docs/spectrum-ts/providers/terminal (and /setup-and-usage, /interactions)
- https://photon.codes/docs/spectrum-ts/providers/whatsapp-business (and /setup, /conversations)
- https://photon.codes/docs/spectrum-ts/providers/telegram (and /setup, /conversations-and-features)
- https://photon.codes/docs/spectrum-ts/custom-events-and-lifecycle
- https://photon.codes/docs/spectrum-ts/custom-platforms
- https://photon.codes/docs/best-practices/architecture
- https://photon.codes/docs/best-practices/inbound-pipeline
- https://photon.codes/docs/best-practices/recovery-and-state
- https://photon.codes/docs/best-practices/imessage-deliverability
- https://photon.codes/docs/spectrum-ts/troubleshooting/imessage
- https://photon.codes/docs/webhooks/overview
- https://photon.codes/docs/webhooks/quickstart
- https://photon.codes/docs/webhooks/events
- https://photon.codes/docs/webhooks/delivery
- https://photon.codes/docs/cli/projects
- https://photon.codes/docs/cli/spectrum
- https://photon.codes/docs/cli/billing
- https://photon.codes/docs/api-reference/introduction
- https://photon.codes/docs/api-reference/rate-limit
- https://spectrum.photon.codes/openapi/json

**Photon docs: Beta (Photon 2.0)**
- https://photon.codes/docs/beta/photon
- https://photon.codes/docs/beta/index
- https://photon.codes/docs/beta/get-started/project
- https://photon.codes/docs/beta/get-started/imessage
- https://photon.codes/docs/beta/get-started/voice
- https://photon.codes/docs/beta/plans-and-billing
- https://photon.codes/docs/beta/billing
- https://photon.codes/docs/beta/messaging/index
- https://photon.codes/docs/beta/cookbooks
- https://photon.codes/docs/beta/cookbooks/voice/retell
- https://photon.codes/docs/beta/cookbooks/voice/elevenlabs
- https://photon.codes/docs/beta/cookbooks/voice/livekit
- https://photon.codes/docs/beta/cookbooks/voice/twilio
- https://photon.codes/docs/beta/api-reference
- https://photon.codes/docs/beta/problems/catalog
- https://photon.codes/docs/beta/websocket (and /connect, /session, /events, /cursors, /replies)
- https://api.photon.codes/openapi.json
- https://api.photon.codes/asyncapi.yaml

**Photon site and legal**
- https://photon.codes/pricing
- https://photon.codes/beta
- https://photon.codes/blog/introducing-photon-2.0 (dated Oct 15, 2026)
- https://photon.codes/privacy-policy (last updated Sept 25, 2026)
- https://photon.codes/terms-of-services
- https://photon.co/beta (parked domain; GoDaddy for-sale)

**Hackathon**
- https://somethingreat.notion.site/Hackathon-Guidelines-for-Photon-2-0-3f8e443f36bb81f9893fed0d08a4c01d
- Its "Examples" child page, via the public page-chunk endpoint

**GitHub**
- https://github.com/photon-hq/spectrum-ts (HEAD `36754b2`, 2026-10-16)
- Issues #217, #158, #287; PRs #248, #250, #272
- https://github.com/photon-hq/tuichat (README, PROTOCOL.md, release v0.1.4)

**npm (tarballs read only)**
- spectrum-ts@12.11.0, @spectrum-ts/core@12.12.0, @spectrum-ts/imessage@12.11.0, @spectrum-ts/terminal@12.11.0, @spectrum-ts/telegram@12.11.0, @spectrum-ts/whatsapp-business@12.11.0, @spectrum-ts/hono@12.11.0, @photon-ai/api@0.5.0
- create-spectrum-project@0.9.0 (readme via `npm view`)

**Third parties**
- https://docs.retellai.com/deploy/custom-telephony
- https://docs.retellai.com/api-references/create-phone-call
- https://elevenlabs.io/docs/eleven-agents/phone-numbers/sip-trunking
- https://elevenlabs.io/docs/eleven-agents/api-reference/sip-trunk/outbound-call (via search result summary)
- https://docs.livekit.io/telephony/making-calls/outbound-trunk/
- https://docs.livekit.io/telephony/features/secure-trunking/
- https://docs.vapi.ai/advanced/sip/sip-trunk
- https://core.telegram.org/bots/features#privacy-mode
- https://core.telegram.org/bots/api#update
- https://docs.railway.com/reference/tcp-proxy
- https://community.render.com/t/opening-up-a-udp-port-for-incoming-traffic/821 (community, not official docs)

**Discord invites seen (four different ones)**
- Notion guidelines: https://discord.gg/KhCRKNsx55
- Notion Examples page: https://discord.gg/hBDgu5vytc
- photon.codes/beta and blog: https://discord.com/invite/4yXmmFPadR
- Beta docs: https://discord.gg/4mr54mqQN
- Stable webhook docs: https://discord.gg/4c3VJzDfNA

---

## 12. Could not verify

- What the dashboards actually show a new hackathon project: line count, whether the $100 credit applies, whether a card is demanded. I did not log in.
- Whether `spectrum-ts` works with Photon 2.0 (`pho_prj_`) projects. No code path to `api.photon.codes` was found.
- Photon 2.0 Telegram, WhatsApp-personal and SMS **group** behaviour on a free project, and the meaning of "in-network" for SMS.
- Whether SHA-256 digest interoperates with Retell, LiveKit and ElevenLabs in practice. Photon's cookbooks say so for Retell and LiveKit; MD5 is the documented fallback.
- Retell and ElevenLabs free-tier credits, the Retell API auth header format, and webhook signature verification details.
- Twilio trial-account restrictions for SIP `To` targets.
- Whether `app.messages` replays messages missed while the process was **down**. The iMessage cursor appears to be held in memory only.
- Whether running two replicas duplicates `app.messages` events.
- Photon message-content retention periods and deletion endpoints. Neither docs nor policy state them.
- iMessage-to-SMS fallback mechanics (automatic? configurable? group MMS?).
- Render's current official stance on UDP: only a community staff reply was found.
- Whether `Spectrum()` with only `terminal.config()` makes any network call at startup. Test with Wi-Fi off.
- Photon 2.0 API numeric rate limits.
