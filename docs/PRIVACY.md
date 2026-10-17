# Homi privacy model

Homi is a guest in your group chat. A guest that remembers everything is a liability, so Homi keeps only the plan, and only until the plan is over. The extras that are meant to last (bill tab, trip, shared album) stay only until a member deletes them; see "Beyond a single plan" at the end.

**Short version:**
- Homi reads only what it needs to notice its name.
- It stores the plan, never the conversation.
- It never asks where you are.
- It deletes everything 24 hours after the event, or immediately when anyone says `homi forget`.

This document lists our ten privacy principles. For each one it gives the rule, how the code enforces it (with the file that does it), and how a judge can check it.

> **What we cannot promise.** Homi runs on Photon, which relays messages between the chat apps and our server. Photon's own terms and privacy policy cover data in transit and in their logs (see `research/photon-capabilities.md` §8.7). We make claims only about **what Homi stores and sends**. We never claim that "nobody ever sees your messages". The chat apps and Photon are outside our control.

---

## 1. Consent at the door

**Rule.** When Homi first sees a new chat, it introduces itself **once**, says what it reads and stores, and then does nothing until a member starts a plan. A member starts a plan by mentioning Homi or typing `/plan`. Any member can say `homi stop`, and Homi deletes everything and leaves.

**How it works.**
- **Trigger.** The intro fires on the first message Homi sees in an unknown chat. Where the platform also tells us Homi was added to a group, that event triggers the intro too. Both triggers are idempotent, so the intro is sent only once per chat (`intro_sent` flag).
- **Intro text** (one message of two sentences, the same on every channel):
  > Hi, I'm Homi 👋 Mention me or say /plan and I'll find a date and a place for this group; I skip every other message and never save your chats. I keep only the plan, delete it 24h after the event, and "homi stop" makes me delete everything and leave.
- **Before a plan exists**, Homi replies only to:
  - its name or `/plan`
  - `homi privacy`
  - `homi stop`
- **`homi stop`.** Homi purges all plan state for this chat and leaves.
  - Where the platform can't leave a chat (macOS local iMessage), Homi keeps a **tombstone**: a salted hash of the chat ID and a `muted` flag, nothing else. It then ignores the chat forever and asks a human to remove it.
- **Code:** `src/engine/plan.ts` (`intro`, `stop`), `src/runner/runner.ts` (tombstone).
- **Test:** `test/engine/consent.test.ts`. This test checks that no action is ever emitted in a chat before a trigger, apart from the one intro.

## 2. Data minimization

**Rule.** Homi stores plan state only:
- proposed dates
- availability answers
- chosen place and time
- RSVP status
- nudge history
- display names that members chose to give it

Homi stores **no chat history**. A message not addressed to Homi gets one local check (is this my name, a command, or a reply to my question?) and is then dropped. It never reaches disk.

**How it works.**
- **Classified events only.** The channel adapter turns each inbound message into a typed event, such as `vote`, `mention` or `food-signal`. The engine and the database see only those events.
- **Message text is never stored.** Raw text lives only in memory for that one function call. No table has a column for message text.
- **Exactly what we keep per member:**
  - a salted hash ID
  - a status (`yes`/`maybe`/`no`/`out`/`pending`)
  - per-option votes
  - an encrypted display name, if given
  - an encrypted "last message ID". This is an ID, not text, and it lets Homi thread a nudge as a reply to that person's own message, so it never has to print a name or number.
- **Inbound dedupe** stores a hash of the platform message ID for 24 hours. It never stores the message itself.
- **Head-counting** (the one thing Homi takes from messages *not* addressed to it):
  - While a plan is open, Homi notes that a member exists, as a salted hash, when they post anything. That lets it say "2 people haven't picked yet".
  - It never notes what they said, and the hash is purged with the plan.
  - On dedicated iMessage lines it uses the platform roster instead.
- **Code:** `src/store/schema.sql`. There is no `text` column anywhere, and a test greps the schema for one.

## 3. No message content to hosted LLMs by default

**Rule.** All intent detection and date parsing run on our own server:
1. **Rules.** Keyword and grammar rules, plus `chrono-node` for date words.
2. **Small local model.** A naive-Bayes intent classifier. Its weights (a few KB) are trained on our own labeled phrases and live in the repo.

A hosted LLM (Claude) is **off by default** (`DISABLE_HOSTED_LLM=true`). It has two optional uses, both behind the same switch.

**Turning it on.**
- Server (`npm start`): `DISABLE_HOSTED_LLM=false` **and** `ANTHROPIC_API_KEY`.
- Web demo (`npm run web`) and simulator (`npm run sim`): `HOMI_LLM=on` (or `DISABLE_HOSTED_LLM=false`) **and** `ANTHROPIC_API_KEY`. The demo reads only these variables (plus `HOMI_LLM_MODEL`) from `.env`, and prints `LLM fallback ON (Claude, redacted snippets)` or `LLM fallback OFF` at startup. `HOMI_LLM=off` always wins.
- Model: `claude-haiku-5-5` by default (fast, about $0.10 per million input tokens, so a few hundred calls cost cents); `HOMI_LLM_MODEL` overrides it.
- Off again: remove the key, or set `DISABLE_HOSTED_LLM=true` / `HOMI_LLM=off`.

**1. Availability fallback.** It is used only for an addressed availability reply that both earlier stages failed to parse, while a date poll is open. It sees the redacted reply and the option labels ("Thu 7pm / Fri 7pm / Sat 7pm"), nothing else. Anything the parser recognises as a command ("homi go", "homi status", "homi split 84 3 ways") never reaches it, even when the command does not apply yet: live, the model once read "homi go" as "every day works". Test: `test/runner/llm-fallback.test.ts`.

**2. Repair router** (for live demos). It runs only when someone **addressed Homi** and the engine could only answer with a generic fallback ("Not sure what you mean…", the help line, "which ones could work", "we already have a plan"). Unaddressed chatter is never sent.
- It receives a **redacted snippet** of that one message and a short context line, for example `plan state: collecting_availability; open options: Thu Oct 22 7pm | Fri Oct 23 7pm | Sat Oct 24 7pm; members: 6; open flows: bill tab`. No names, no group name, no other messages, no notes or places.
- It may answer only with one command from a fixed catalog (`homi split 120 5 ways`, `fri or sat works`, `homi settle up`, ...), or nothing. Homi rejects answers that invent an amount, are longer than 200 characters, or delete data the message didn't ask to delete.
- Placeholders such as `[name1]` are filled back in **on our server** from the original message. Homi then re-runs the engine once on that command. If the call fails, times out (4 s) or doesn't help, the original reply stands.
- Logs record only `llm repair used: yes/no` and a reason, never text.

**Redaction (both uses).** @handles, phone numbers, emails, URLs and long digit runs are replaced with placeholders, and so are the names Homi knows: display names of members it has seen (kept in memory only), names on the plan, the bill tab and the album, and the demo personas. A name Homi has never seen (say, a friend outside the chat) is not caught. Times, dates, years and money amounts ("84", "23.40") are kept. The router's placeholders are numbered, so the answer can be mapped back locally.

**Code:** `src/engine/parse.ts` (stages 1 and 2), `src/llm/redacted.ts` (redaction, availability fallback), `src/llm/router.ts` + `src/runner/repair.ts` (repair router), `src/privacy/redact.ts`.

**Tests:** `test/privacy/redact.test.ts` checks that no digit run of 7 or more, `@handle` or email survives redaction. `test/llm/router.test.ts` checks that no name, phone, email or link reaches the request and that bad answers are rejected. `test/runner/repair.test.ts` checks that unaddressed messages never reach the router and that it runs at most once per message.

## 4. Pseudonymous members

**Rule.** Homi refers to a member internally by `HMAC-SHA256(ID_SALT, platform + ":" + spaceId + ":" + handle)`.
- Because the group ID is in the hash, the same person gets a **different ID in every group**. No two groups can be linked.
- The raw handle (phone number, email or Telegram ID) is needed only to deliver a private message or a phone call. It lives in an **encrypted delivery lookup**, which is deleted when the plan completes or Homi leaves.

**Code:** `src/privacy/ids.ts`, `src/store/delivery.ts`.

**Test:** `test/privacy/partition.test.ts`. The same handle in two groups gets two unlinked IDs, and plan state never crosses between them.

## 5. Ephemeral by default

**Rule.** Plan state is deleted `RETENTION_HOURS` after the event (default 24).
- `homi forget` deletes it **now**.
- When a plan is purged, everything goes with it: rows, the delivery lookup, scheduled jobs, and dedupe hashes older than 24 hours.
- **No cross-group profile of anyone exists.** One exception, which is per group only and opt-in: the group's settings row (tone, quiet-hours city, notice mode). It holds no personal data and is deleted by `homi stop`.

**How it works.**
- A retention sweep runs every 10 minutes and at startup.
- The purge runs in a single SQLite transaction and is followed by `VACUUM`, so deleted pages are not left in the file.

**Code:** `src/privacy/retention.ts`.

**Test:** `test/privacy/retention.test.ts`. The test fast-forwards the clock and asserts that zero rows remain.

## 6. Transparent nudges

**Rule.**
- Every nudge is either posted in the group or announced there.
- Homi contacts a member privately (DM or phone call) **only if that member opted in**, by saying `homi you can DM me` or `homi you can call me`.
- After a private check-in, the group is told: "I checked in with Sam privately." So nobody is chased behind anyone's back.
- Nudges always come **from Homi**, never in the organizer's name. That is the point: Homi carries the social cost.

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
- **`homi what do you know`** returns a complete dump of everything stored about this group, with no exceptions. Only the decrypted plan fields are shown; ciphertext and IDs are never printed. The dump also offers `homi forget`.

**Example dump:**
> Here's everything I have for this chat: plan "dinner" · options Thu 7pm, Fri 7pm, Sat 7pm · chosen Fri 7pm · place Tasty Thai (Harvard Sq) · 5 people: 4 yes, 1 pending · names you gave me: Ana, Ben, Sam · 2 nudges sent · deletes Sat 9pm. Say "homi forget" to delete it now.

**Code:** `src/engine/plan.ts` (`dump`). It is generated from the same store rows that the purge deletes, so the dump cannot drift from what is actually stored.

## 9. Coarse, consented location only

**Rule.**
- Homi never requests device location and never tracks anyone.
- For places it uses only what members **type**, such as "Harvard Square" or "near Allston", or a single pin a member chooses to share.
- The location is stored as **one neighborhood string on the plan**, never per person, and it is purged with the plan.
- Only three things go to the places lookup: cuisine, price band, and a coordinate that **we** derive from the neighborhood string using a bundled gazetteer.

**Code:** `src/places/geo.ts` (gazetteer, so the neighborhood string itself never leaves the server), `src/places/*`.

**Test:** `test/places/egress.test.ts` stubs the HTTP layer and asserts the exact query parameters sent.

## 10. Voice is text-first

**Rule.** SIP audio may be unencrypted on part of the path. Photon 2.0 negotiates SRTP "when supported", and the phone network leg never is. So a call carries only the open question and the answer:
- **Allowed:** "Hi, this is Homi calling for your group plan. Does Friday at 7 or Saturday at 7 work better for you?"
- **Never said:** other members' names, the place, the group name, or anything said in the chat.

**How it works.**
- The call script is built from the open question alone (`src/voice/script.ts`).
- The voice provider receives only `{question, options}` as dynamic variables, plus an opaque `call_ref` that is meaningless outside our database.
- The provider's data storage is set to the most minimal mode it offers (see `docs/CHANNELS.md`).
- Calls happen **only to members who opted in**, and the group is told before Homi dials.

---

## What Homi stores: the complete list

| Table | Fields | Encrypted | Deleted when |
|---|---|---|---|
| `spaces` | hashed chat ID, platform, muted flag; sealed settings (intro sent, tone, time zone, notice mode, headcount) | settings blob | `homi stop` |
| `plans` | plan ID, hashed chat ID, state, event time, purge time (plaintext, for routing and retention); **everything else in one sealed blob**: activity, options, votes, members (hashed IDs, status, opt-ins, names you gave, last message IDs), chosen option, place, neighborhood, notes, nudge log | the whole blob | event + `RETENTION_HOURS`, or `homi forget` |
| `delivery` | hashed member ID → raw handle | handle | with the plan, or when Homi leaves |
| `jobs` | scheduled nudges and reminders (kind, due time, plan ID) | none personal | with the plan |
| `seen` | SHA-256 of inbound message IDs | n/a (hash) | after 24h |
| `spaces` settings blob → **bill tab** | expenses members logged with Homi: label, payer name, participant names, per-person cents | yes (sealed with the settings) | `homi clear the tab`, or `homi stop` |
| `spaces` settings blob → **trip** | trip details members typed (destination, origin city, month, nights, group size, budget, interests) and the estimate | yes | `homi forget the trip`, or `homi stop` |
| `spaces` settings blob → **album index** | album title, photo IDs, contributor (hashed ID + the name the platform shows), added time, caption without the address | yes | `homi remove my photos` (your own), `homi delete album`, or `homi stop` |
| `<DATA_DIR>/albums/…` | **photo files** members explicitly shared with "homi add" (or a reply to the album message) | yes, AES-256-GCM per file | same as the album index; photos not explicitly shared are deleted immediately |
| `plans` blob → **pledge** | amount, agreed no-show destination, who pledged / checked in, payment references, dispute votes | yes (inside the plan blob) | with the plan; the group fund balance stays in the settings blob until `homi stop` |

Nothing else is stored. In particular, Homi has no messages table, no location history, no contacts table, no analytics, and no third-party SDKs.

## Beyond a single plan: what lasts longer, and why

Bill splitting, pledges, the shared album and trip planning are useful *because* they outlive one dinner. So they don't follow the 24-hour rule. Instead:

- **Deleting is up to you.** Each one stays until a member deletes it with a command: `homi clear the tab`, `homi forget the trip`, `homi delete album`, or `homi remove my photos` (contributors control their own photos). `homi stop` deletes all of it at once.
- **Explicit, never inferred.** Homi stores only what members hand it on purpose: amounts and names typed into a bill, trip details, photos sent with "homi add". It never stores chat text or unsolicited photos, and it never reads receipts or bank data.
- **Inspectable.** "homi what do you know" lists the tab, the trip, the album (photo counts per contributor) and any pledge, along with the plan.
- **Pledge disputes extend one deadline.** When a pledge has a dispute window, the plan's deletion waits until that window closes (24h after settlement), so a dispute can still be decided. Then the usual purge runs.
- **Money is never moved silently.** In this build every pledge deposit, refund and forfeit is **SIMULATED** and labeled that way. A real deployment needs a payment provider and each participant's explicit authorization in the provider's own secure checkout. Card details never go in the chat (docs/COMMITMENTS.md).
- **Album links are capability links.** Anyone holding the album URL can view it, so it should be shared only in the group. Production should use per-member signed links sent by DM, with expiry (docs/ALBUM.md).
- **Trip searches send no personal data.** They carry only destination, dates, group size, budget and interests, never names or numbers. Far-future trips use labeled estimates and make no external call at all (docs/TRAVEL.md).
