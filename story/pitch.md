# Whats the Word: pitch, demo runbook, and judge prep

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
"This is Homi. You add a number to your group, and that's the whole setup. Let me show you." → *live demo, see the runbook*

**[Slide 6 · Privacy]**
"Homi is a guest in your chat, so it behaves like one:
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

That's Whats the Word. Homi is the friend who always makes the plan happen, splits the bill, keeps the photos and plans the next trip, and it never gets tired."

> Delivery notes:
> - Say "friendship" in the first two sentences. ✔︎
> - Don't say "AI agent" before slide 5.
> - Pause after "67 minutes".

---

## Live demo runbook (about 3 minutes)

**Why it's set up this way:**
- Free Photon iMessage lines can't join **group** chats, so the group experience runs in our **iMessage look-alike web demo**. It's labeled "Simulated iMessage · real Homi engine": a real engine behind a simulated iMessage screen.
- Judges play it on an **iPhone**.
- The **real iMessage** moment is a 1:1 text to Homi's number over Photon.

**Setup (8:30 AM rehearsal, twice):**
- **Web demo.** The laptop is on the phone hotspot and runs `npm.cmd run web` with `HOST=0.0.0.0` (docs/WEB_DEMO.md). It prints a URL with an access key; open it in Safari on two iPhones and choose Ana on one and Ben on the other.
- **Live Homi.** A second terminal runs `npm.cmd start` with `SURFACES=imessage` and your Photon project keys in `.env`. The teammates' numbers are registered as users in the Photon dashboard (the free plan allows up to 10), and each has texted Homi once.
- **Video.** The phone video `story/out/homi-phone-1080x1920.mp4` loops on the second laptop.
- **Sam's iPhone** is on the table with the ringer on, if voice is set up; otherwise the web demo shows the simulated call.

| # | Who | Action | What the judge sees |
|---|---|---|---|
| 1 | Judge (iPhone, as You) | "@homi dinner next week?" | Homi's intro, then a header and 3 option bubbles (Thu / Fri / Sat 7pm) with a lock-in time |
| 2 | Teammates as Ana and Ben | Ana: "fri works, i'm busy thu and sat". Ben: "sat works. thu and fri i can't" | **Conflict bridge:** "Ana can only do Fri and Ben only Sat. Could either of you do Fri late or Sat brunch (I'll add it)?" |
| 3 | Judge | Taps ❤️ on Fri; then ⏩ +12h | One capped nudge, then "giving Sam a quick call" with a call screen (simulated, or Sam's real iPhone rings). Then "Fri Oct 23 · 7pm it is" |
| 4 | Judge | "ok I'm starving where are we eating" → "ramen", "cheap", "harvard square" | 3 real nearby places with walk time and opening hours → Hokkaido Ramen Santouka locked |
| 5 | Judge | "homi let's do a $10 show-up pledge", taps option 1, "homi I'm in" | The group agrees on where no-show money goes before anyone pledges; deposits are labeled **SIMULATED** |
| 6 | Narrator | ▶ "Play the rest" (or ⏩ to Friday) | Check-ins, then Ben's itemized bill → **"Dinner $141.61 … Adds up to $141.61 exactly."**, then settle-up, then "Pledge settled (SIMULATED) … Sam's $10 went to the group fund" |
| 7 | Judge | 📷 "homi add", then "homi remove my photos" | The album fills, then their own photo disappears; the album link opens the members-only gallery |
| 8 | Judge | "homi let's plan Japan for 2030" + the three answers | Itinerary and costs, all **labeled estimates** (≈ $2,670 pp), the comfort upgrade (+$950) and savings tips |
| 9 | Judge | "homi what do you know" → "homi forget" | The full dump (plan, pledge, tab, album, trip), then "Done: I've deleted this plan." |
| 10 | Judge, on a teammate's iPhone in **real iMessage** | Texts Homi: "homi split 86.40 + 18% tip 4 ways" | A real reply over Photon's iMessage line: "$101.95 split 4 ways ($86.40 + 18% tip $15.55): 3 pay $25.49, 1 pays $25.48." |

**Lines to say out loud:**
- **At step 1:** "The group chat here is simulated iMessage, because Photon's free lines can't join groups yet. The engine behind it is the real Homi."
- **At step 2:** "This is the moment Photon's own examples page describes: conflicting availability, and the agent proposes a workable next step."
- **At step 5:** "No money moves in this build; everything that touches money says SIMULATED."
- **At step 8:** "2030 can't be booked yet, so every price is a labeled estimate and every listing is an example."
- **At step 10:** "And this is real iMessage, through Photon, right now."

### Fallback ladder
1. **Venue Wi-Fi fails:** switch to the phone hotspot (already paired).
2. **Photon is down or the line is flaky:** the web demo runs entirely on the laptop, so keep going and skip step 10. Last resort: `npm.cmd run demo` on the projector plus the phone loop video. Say: "Same engine, offline."
3. **Voice fails:** the web demo's call screen is labeled "(simulated call)"; say so. Or play the call segment from the video.
4. **The places lookup fails:** nothing to do. The default is already the offline OpenStreetMap file.
5. **Everything fails:** walk through the deck and the phone loop. The judging criteria still map one to one.

---

## Judge questions with answers

**Why not just a poll?**
- A poll answers one question.
- Homi reads "either works but not before 8", decides on a published rule (quorum, not unanimity, with an announced lock time), bridges conflicts, finds the place, chases the quiet ones as itself, reminds everyone, and then forgets.
- Native polls (iOS 26 Messages, WhatsApp) are great for the single-question case, and we say so. They don't close the loop, and they don't work across platforms.

**What does Photon store?**
- Photon relays the messages, and its terms and privacy policy cover data in transit and in its logs. We cite that in docs/PRIVACY.md.
- We only make claims about what **Homi** stores: plan state in one encrypted blob, deleted 24h after the event or on `homi forget`, with no column anywhere that can hold message text.
- The voice provider (Retell) is configured to keep basic attributes only, for 1 day.

**How is this different from Fenn?**
- Fenn was a separate iOS app that read calendars and tracked location. It has since pivoted to a paid couples app.
- Our inference (they haven't said why): getting eight friends to install an iOS-only app is a wall. A couple needs one install.
- Homi has no app, no calendar access, no location, and it forgets.

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
  - `homi stop` from anyone.

**How do you make money without data?**
- Not from data, ever. Fenn's pivot suggests friend groups don't pay, so we don't plan to charge them.
- Two paths:
  1. Organizations with recurring plans (clubs, teams, offsites), which need dedicated lines and multiple groups.
  2. A per-booking fee from venues when Homi books a table. The venue gets party size and time only.

**What breaks on SMS?**
- No reactions, so people reply with numbers. No threads, so Homi uses names or counts.
- Group texting on SMS needs carrier (10DLC) registration, so we use the SMS number for voice and keep groups on iMessage or Telegram.
- The same engine degrades by declared capabilities.

**Why would a friend text this again tomorrow?**
- Every group has a next plan, and Homi needs zero setup. Re-adding it costs one tap.
- Forgetting is the loop, not churn.

**Doesn't WhatsApp ban AI bots?**
- Its Business API terms bar general-purpose AI assistants from 2026-01-15.
- Homi is a narrow planning tool, and we don't depend on WhatsApp. We use iMessage, Telegram and voice.

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
  - voice on a Photon 2.0 SMS number over SIP/TLS, out **and** in ("call Homi to RSVP");
  - the terminal provider for offline development.
- **Privacy on purpose.** An agent that "lives with us" has to be trusted. Telemetry is off, logs are redacted, the hosted LLM is off by default, and everything is plan-scoped.
- **Judging criteria:**
  - **Vision:** hybrid intelligence that takes the *social* job.
  - **Craft:** two-sentence messages, restraint, one-tap answers.
  - **Depth:** bridges, vetoes, maybes, false-positive food talk, measured on blind fixtures.
  - **Traction:** zero install; the group chat you already have *is* the onboarding.
