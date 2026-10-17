# Otto: pitch, demo runbook, and judge prep

`{{…}}` placeholders are filled from `eval/results.json` and the team list before Sunday 7 AM.

---

## The 90-second pitch (follows the deck)

**[Slide 1 · Title]**
"Most friendships don't end in a fight. They end in a group chat, where 'we should hang out!!' gets four hearts and no plan."

**[Slide 2 · The problem]**
"Six days later nobody has followed up, because nobody wants to be the one who nags. In 2003 Americans aged 15 to 24 spent about two and a half hours a day with friends in person. By 2019, before COVID, it was 67 minutes."

**[Slide 3 · Why it keeps happening]**
"Every group has one organizer, and organizing is unpaid emotional labor. When a message goes to everyone, almost nobody answers. And the tools that are supposed to help, like polls, calendar links and new apps, pull the plan out of the chat."

**[Slide 4 · The insight]**
"So the fix has to live in the chat you already have, and it has to carry the social cost so no human has to. And it can't ask for anyone's calendar, because nobody keeps their social life in one."

**[Slide 5 · Demo]**
"This is Otto. You add a number to your group, and that's the whole setup. Let me show you." → *live demo, see the runbook*

**[Slide 6 · Privacy]**
"Otto is a guest in your chat, so it behaves like one:
- It skips every message not addressed to it.
- It stores the plan, never the conversation.
- It never asks where you are.
- It deletes everything 24 hours after the event.

You can ask it what it knows, and tell it to forget."

**[Slide 7 · How it works]**
"It's built on Photon's spectrum-ts, so one engine runs on iMessage, Telegram and real phone calls. The engine is a pure state machine with local parsing: no message ever goes to a cloud model by default. Places come from OpenStreetMap, and nothing personal leaves our server."

**[Slide 8 · Measured]**
"We measured it on ten role-play group chats written blind from our spec, by an author who never saw the code:
- date replies read correctly: 98.5%;
- final date right: 10 of 10;
- food-intent precision: 100%;
- messages leaked to logs: zero.

Otto is the friend who always makes the plan happen. It never gets tired, and it forgets everything afterwards."

> Delivery notes:
> - Say "friendship" in the first two sentences. ✔︎
> - Don't say "AI agent" before slide 5.
> - Pause after "67 minutes".

---

## Live demo runbook (2 minutes)

**Setup (8:30 AM rehearsal, twice):**
- Two phones charged.
- The laptop runs `npm start` (live surfaces) and has `npm run sim` ready in a second terminal.
- The phone loop video plays on the second laptop.
- Hotspot on.
- Sam's phone is on the table with its ringer **on**.

**Surface for the group (decided by Photon's answer; see docs/CHANNELS.md):**
- **A:** a dedicated iMessage line, with a fresh group.
- **B:** a Telegram group, with the bot added via `t.me/<bot>?startgroup=otto`.
- **C:** offline sim on the projector.

| # | Who | Action | What the judge sees |
|---|---|---|---|
| 1 | Judge (or teammate) | Creates a fresh group with two teammates and adds Otto | One intro message with the privacy promise. Nothing else. |
| 2 | Teammate Ana | "@otto dinner next week?" | Header + 3 option bubbles (Thu / Fri / Sat 7pm) with a lock-in time |
| 3 | Ana and Ben | Ana: "fri or sat works". Ben: "only sat". Ana: "fri only actually" | **Conflict bridge:** "Ana can only do Fri and Ben only Sat. Could either of you do Fri late or Sat brunch?" Ben: "fri late works" → Otto adds Fri 8:30pm and both count |
| 4 | Ana | ❤️ on the new option; "otto lock it" | "Fri Oct 23 · 8:30pm it is: 3 in. Where to?" |
| 5 | Ben | "ok I'm starving, where are we eating?" | "What are we feeling? Cuisine, budget, and roughly where?" → "tacos" / "cheap" / "harvard square" → 3 one-line options with walk minutes and "~$ (est.)" |
| 6 | Both | ❤️ on option 2 | "{place} it is: {address}" + maps link |
| 7 | Narrator | "Sam has been quiet. Sam said Otto may call. I'll fast-forward the clock, and I'm telling you I'm doing it." Type `otto demo ff 22h` in the group (live, needs `DEMO_MODE=true`; Otto posts a visible "fast-forwarding" notice) or `/ff 22h` (sim) | Group: "Still need Sam, so I'm giving them a quick call (they said that's ok)." **Sam's phone rings.** Otto asks only the open question. Sam: "Friday works." Group: "Sam's in for Fri (by phone). 4 for 4 🎉" |
| 8 | Judge | "otto what do you know" | A one-message dump: options, chosen date, place, counts, names given, deletion time. No locations, no messages. |
| 9 | Judge | "otto forget" | "Done: I've deleted this plan." Then "otto stop" → Otto leaves (Telegram/dedicated) or tombstones (local) |
| 10 | Narrator | 15 seconds on the second channel (Telegram, or the sim if Telegram is the main channel) | The same flow and engine, on a different chat app |

**Lines to say out loud:**
- At step 3: "This is the moment Photon's own examples page describes: two people with conflicting availability, and the agent proposes a workable next step."
- At step 7: "The call carries only the question. No names, no place."
- At step 9: "That's the whole product promise: it remembers everything about the plan and nothing about you."

### Fallback ladder
1. **Venue Wi-Fi fails:** switch to the phone hotspot (already paired).
2. **Photon is down or the line is flaky:** `npm run sim -- --fancy` on the projector, with the phone loop video beside it. Say: "Same engine, offline simulator."
3. **Voice fails:** play the call segment from `story/demo.mp4` and say it was recorded earlier. In the sim the call is labeled "(simulated call)".
4. **The places lookup fails:** nothing to do. The default is already the offline OpenStreetMap file.
5. **Everything fails:** walk through the deck and the phone loop. The judging criteria still map one to one.

---

## Judge questions with answers

**Why not just a poll?**
- A poll answers one question.
- Otto reads "either works but not before 8", decides on a published rule (quorum, not unanimity, with an announced lock time), bridges conflicts, finds the place, chases the quiet ones as itself, reminds everyone, and then forgets.
- Native polls (iOS 26 Messages, WhatsApp) are great for the single-question case, and we say so. They don't close the loop, and they don't work across platforms.

**What does Photon store?**
- Photon relays the messages, and its terms and privacy policy cover data in transit and in its logs. We cite that in docs/PRIVACY.md.
- We only make claims about what **Otto** stores: plan state in one encrypted blob, deleted 24h after the event or on `otto forget`, with no column anywhere that can hold message text.
- The voice provider (Retell) is configured to keep basic attributes only, for 1 day.

**How is this different from Fenn?**
- Fenn was a separate iOS app that read calendars and tracked location. It has since pivoted to a paid couples app.
- Our inference (they haven't said why): getting eight friends to install an iOS-only app is a wall. A couple needs one install.
- Otto has no app, no calendar access, no location, and it forgets.

**Isn't Continua already doing this?**
- Continua (GV-backed) also lives in SMS, iMessage and Discord groups, with polls and reminders. The form factor is validated.
- Our wedge is trust:
  - no calendar or Gmail access;
  - ephemeral by design;
  - inspectable ("what do you know");
  - a voice check-in that carries only the question;
  - an open-source repo.

**What happens with 20 people?**
- Quorum, not unanimity. Threshold mode ("lock it when 12 say yes").
- Collective nudges, never 20 DMs.
- The noise budget still holds: at most one unprompted message per 12 hours.
- On Telegram, sends are paced to 1 message per 3 seconds.

**What stops it spamming?**
- Hard rules, each with a test:
  - at most one unprompted group message per rolling 12 hours;
  - quiet hours from 11 PM to 9 AM;
  - at most 2 nudges per person per plan;
  - every private DM or call announced in the group;
  - `otto stop` from anyone.

**How do you make money without data?**
- Not from data, ever. Fenn's pivot suggests friend groups don't pay, so we don't plan to charge them.
- Two paths:
  1. Organizations with recurring plans (clubs, teams, offsites), which need dedicated lines and multiple groups.
  2. A per-booking fee from venues when Otto books a table. The venue gets party size and time only.

**What breaks on SMS?**
- No reactions, so people reply with numbers. No threads, so Otto uses names or counts.
- Group texting on SMS needs carrier (10DLC) registration, so we use the SMS number for voice and keep groups on iMessage or Telegram.
- The same engine degrades by declared capabilities.

**Why would a friend text this again tomorrow?**
- Every group has a next plan, and Otto needs zero setup. Re-adding it costs one tap.
- Forgetting is the loop, not churn.

**Doesn't WhatsApp ban AI bots?**
- Its Business API terms bar general-purpose AI assistants from 2026-01-15.
- Otto is a narrow planning tool, and we don't depend on WhatsApp. We use iMessage, Telegram and voice.

**Who wrote your eval set? Isn't it biased?**
- A separate AI agent wrote the ten role-play chats and their labels. It could read only our spec (`docs/`), never the code, so the labels test the spec.
- It's small: a sanity check, not a benchmark.
- The harness replays the chats through the real stack, and the one recommendation miss is a real data gap (no Thai near Harvard Sq in OpenStreetMap). We report it rather than hide it.

**Is anything simulated?**
- Yes, and it's labeled in the demo, the README and Devpost.
- **Offline simulator:** the venue-proof demo; it uses a mock call when not live.
- **Restaurant price bands:** our estimates (OpenStreetMap has no prices).
- **The clock fast-forward:** we tell the judges when we use it.

## Photon-specific talking points
- **On-thesis.** We are right on Photon's examples page: "Team Communication Facilitator" (conflicting availability → workable next step) and "fridge-to-dinner".
- **Photon features we use:**
  - group chats (dedicated iMessage, or Telegram through Photon's edge);
  - tapback reactions as votes;
  - inline replies to address quiet members without names;
  - typing indicators;
  - edits for a living tally;
  - voice on a Photon 2.0 SMS number over SIP/TLS, out **and** in ("call Otto to RSVP");
  - the terminal provider for offline development.
- **Privacy on purpose.** An agent that "lives with us" has to be trusted. Telemetry is off, logs are redacted, the hosted LLM is off by default, and everything is plan-scoped.
- **Judging criteria:**
  - **Vision:** hybrid intelligence that takes the *social* job.
  - **Craft:** two-sentence messages, restraint, one-tap answers.
  - **Depth:** bridges, vetoes, maybes, false-positive food talk, measured on blind fixtures.
  - **Traction:** zero install; the group chat you already have *is* the onboarding.
