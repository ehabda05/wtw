# Otto privacy model

Otto is a guest in your group chat. A guest that remembers everything is a liability, so Otto keeps only the plan, and only until the plan is over.

**Short version:**
- Otto reads only what it needs to notice its name.
- It stores the plan, never the conversation.
- It never asks where you are.
- It deletes everything 24 hours after the event, or immediately when anyone says `otto forget`.

This document lists our ten privacy principles. For each one it gives the rule, how the code enforces it (with the file that does it), and how a judge can check it.

> **What we cannot promise.** Otto runs on Photon, which relays messages between the chat apps and our server. Photon's own terms and privacy policy cover data in transit and in their logs (see `research/photon-capabilities.md` §8.7). We make claims only about **what Otto stores and sends**. We never claim that "nobody ever sees your messages". The chat apps and Photon are outside our control.

---

## 1. Consent at the door

**Rule.** When Otto first sees a new chat, it introduces itself **once**, says what it reads and stores, and then does nothing until a member starts a plan. A member starts a plan by mentioning Otto or typing `/plan`. Any member can say `otto stop`, and Otto deletes everything and leaves.

**How it works.**
- **Trigger.** The intro fires on the first message Otto sees in an unknown chat. Where the platform also tells us Otto was added to a group, that event triggers the intro too. Both triggers are idempotent, so the intro is sent only once per chat (`intro_sent` flag).
- **Intro text** (one message of two sentences, the same on every channel):
  > Hi, I'm Otto 👋 Mention me or say /plan and I'll find a date and a place for this group; I skip every other message and never save your chats. I keep only the plan, delete it 24h after the event, and "otto stop" makes me delete everything and leave.
- **Before a plan exists**, Otto replies only to:
  - its name or `/plan`
  - `otto privacy`
  - `otto stop`
- **`otto stop`.** Otto purges all plan state for this chat and leaves.
  - Where the platform can't leave a chat (macOS local iMessage), Otto keeps a **tombstone**: a salted hash of the chat ID and a `muted` flag, nothing else. It then ignores the chat forever and asks a human to remove it.
- **Code:** `src/engine/plan.ts` (`intro`, `stop`), `src/runner/runner.ts` (tombstone).
- **Test:** `test/engine/consent.test.ts`. This test checks that no action is ever emitted in a chat before a trigger, apart from the one intro.

## 2. Data minimization

**Rule.** Otto stores plan state only:
- proposed dates
- availability answers
- chosen place and time
- RSVP status
- nudge history
- display names that members chose to give it

Otto stores **no chat history**. A message not addressed to Otto gets one local check (is this my name, a command, or a reply to my question?) and is then dropped. It never reaches disk.

**How it works.**
- **Classified events only.** The channel adapter turns each inbound message into a typed event, such as `vote`, `mention` or `food-signal`. The engine and the database see only those events.
- **Message text is never stored.** Raw text lives only in memory for that one function call. No table has a column for message text.
- **Exactly what we keep per member:**
  - a salted hash ID
  - a status (`yes`/`maybe`/`no`/`out`/`pending`)
  - per-option votes
  - an encrypted display name, if given
  - an encrypted "last message ID". This is an ID, not text, and it lets Otto thread a nudge as a reply to that person's own message, so it never has to print a name or number.
- **Inbound dedupe** stores a hash of the platform message ID for 24 hours. It never stores the message itself.
- **Head-counting** (the one thing Otto takes from messages *not* addressed to it):
  - While a plan is open, Otto notes that a member exists, as a salted hash, when they post anything. That lets it say "2 people haven't picked yet".
  - It never notes what they said, and the hash is purged with the plan.
  - On dedicated iMessage lines it uses the platform roster instead.
- **Code:** `src/store/schema.sql`. There is no `text` column anywhere, and a test greps the schema for one.

## 3. No message content to hosted LLMs by default

**Rule.** All intent detection and date parsing run on our own server:
1. **Rules.** Keyword and grammar rules, plus `chrono-node` for date words.
2. **Small local model.** A naive-Bayes intent classifier. Its weights (a few KB) are trained on our own labeled phrases and live in the repo.

A hosted LLM is **off by default** (`DISABLE_HOSTED_LLM=true`).

If a team switches it on:
- It is used only for an availability reply that both earlier stages failed to parse.
- It receives a **redacted snippet**: names, @handles, phone numbers, emails, URLs and digits other than times and dates are replaced with placeholders.
- It sees nothing else. No member list, no group name, no plan details beyond the option labels ("Thu 7pm / Fri 7pm / Sat 7pm").

**Code:** `src/engine/parse.ts` (stages 1 and 2), `src/llm/redacted.ts` (stage 3, gated), `src/privacy/redact.ts`.

**Test:** `test/privacy/redact.test.ts` checks that no digit run of 7 or more, `@handle` or email survives redaction.

## 4. Pseudonymous members

**Rule.** Otto refers to a member internally by `HMAC-SHA256(ID_SALT, platform + ":" + spaceId + ":" + handle)`.
- Because the group ID is in the hash, the same person gets a **different ID in every group**. No two groups can be linked.
- The raw handle (phone number, email or Telegram ID) is needed only to deliver a private message or a phone call. It lives in an **encrypted delivery lookup**, which is deleted when the plan completes or Otto leaves.

**Code:** `src/privacy/ids.ts`, `src/store/delivery.ts`.

**Test:** `test/privacy/partition.test.ts`. The same handle in two groups gets two unlinked IDs, and plan state never crosses between them.

## 5. Ephemeral by default

**Rule.** Plan state is deleted `RETENTION_HOURS` after the event (default 24).
- `otto forget` deletes it **now**.
- When a plan is purged, everything goes with it: rows, the delivery lookup, scheduled jobs, and dedupe hashes older than 24 hours.
- **No cross-group profile of anyone exists.** One exception, which is per group only and opt-in: the group's settings row (tone, quiet-hours city, notice mode). It holds no personal data and is deleted by `otto stop`.

**How it works.**
- A retention sweep runs every 10 minutes and at startup.
- The purge runs in a single SQLite transaction and is followed by `VACUUM`, so deleted pages are not left in the file.

**Code:** `src/privacy/retention.ts`.

**Test:** `test/privacy/retention.test.ts`. The test fast-forwards the clock and asserts that zero rows remain.

## 6. Transparent nudges

**Rule.**
- Every nudge is either posted in the group or announced there.
- Otto contacts a member privately (DM or phone call) **only if that member opted in**, by saying `otto you can DM me` or `otto you can call me`.
- After a private check-in, the group is told: "I checked in with Sam privately." So nobody is chased behind anyone's back.
- Nudges always come **from Otto**, never in the organizer's name. That is the point: Otto carries the social cost.

**Code:** `src/engine/nudge.ts` (policy), `src/engine/plan.ts` (announcement is emitted with every private action).

**Test:** `test/engine/nudge.test.ts`. Every `dm` or `call` action in the same `applyEvent` result is paired with a group `send` announcing it.

## 7. Encrypted at rest, redacted logs

**Rule.**
- Every personal field is encrypted with AES-256-GCM using `DATA_KEY`. That covers display names, delivery handles, last-message IDs and the neighborhood string.
- Logs never contain message text, phone numbers, emails or handles.
- Photon telemetry stays off.

**How it works.**
- Logs go through `src/privacy/logger.ts`:
  - The logger drops known-sensitive keys (`text`, `content`, `handle`, `phone`, `address`, `name`).
  - It regex-scrubs the rest for phone numbers, emails and long digit runs.
- `Spectrum({ options: { telemetry: false } })` is set explicitly.

**Test:** the eval harness captures every log line from all ten fixture conversations and counts leaks. The README reports this number, and the target is **0**.

## 8. Open and inspectable

**Rule.**
- The repo is public, and this document is linked from the README.
- **`otto what do you know`** returns a complete dump of everything stored about this group, with no exceptions. Only the decrypted plan fields are shown; ciphertext and IDs are never printed. The dump also offers `otto forget`.

**Example dump:**
> Here's everything I have for this chat: plan "dinner" · options Thu 7pm, Fri 7pm, Sat 7pm · chosen Fri 7pm · place Tasty Thai (Harvard Sq) · 5 people: 4 yes, 1 pending · names you gave me: Ana, Ben, Sam · 2 nudges sent · deletes Sat 9pm. Say "otto forget" to delete it now.

**Code:** `src/engine/plan.ts` (`dump`). It is generated from the same store rows that the purge deletes, so the dump cannot drift from what is actually stored.

## 9. Coarse, consented location only

**Rule.**
- Otto never requests device location and never tracks anyone.
- For places it uses only what members **type**, such as "Harvard Square" or "near Allston", or a single pin a member chooses to share.
- The location is stored as **one neighborhood string on the plan**, never per person, and it is purged with the plan.
- Only three things go to the places lookup: cuisine, price band, and a coordinate that **we** derive from the neighborhood string using a bundled gazetteer.

**Code:** `src/places/geo.ts` (gazetteer, so the neighborhood string itself never leaves the server), `src/places/*`.

**Test:** `test/places/egress.test.ts` stubs the HTTP layer and asserts the exact query parameters sent.

## 10. Voice is text-first

**Rule.** SIP audio may be unencrypted on part of the path. Photon 2.0 negotiates SRTP "when supported", and the phone network leg never is. So a call carries only the open question and the answer:
- **Allowed:** "Hi, this is Otto calling for your group plan. Does Friday at 7 or Saturday at 7 work better for you?"
- **Never said:** other members' names, the place, the group name, or anything said in the chat.

**How it works.**
- The call script is built from the open question alone (`src/voice/script.ts`).
- The voice provider receives only `{question, options}` as dynamic variables, plus an opaque `call_ref` that is meaningless outside our database.
- The provider's data storage is set to the most minimal mode it offers (see `docs/CHANNELS.md`).
- Calls happen **only to members who opted in**, and the group is told before Otto dials.

---

## What Otto stores: the complete list

| Table | Fields | Encrypted | Deleted when |
|---|---|---|---|
| `spaces` | hashed chat ID, platform, muted flag; sealed settings (intro sent, tone, time zone, notice mode, headcount) | settings blob | `otto stop` |
| `plans` | plan ID, hashed chat ID, state, event time, purge time (plaintext, for routing and retention); **everything else in one sealed blob**: activity, options, votes, members (hashed IDs, status, opt-ins, names you gave, last message IDs), chosen option, place, neighborhood, notes, nudge log | the whole blob | event + `RETENTION_HOURS`, or `otto forget` |
| `delivery` | hashed member ID → raw handle | handle | with the plan, or when Otto leaves |
| `jobs` | scheduled nudges and reminders (kind, due time, plan ID) | none personal | with the plan |
| `seen` | SHA-256 of inbound message IDs | n/a (hash) | after 24h |

Nothing else is stored. In particular, Otto has no messages table, no location history, no contacts table, no analytics, and no third-party SDKs.
