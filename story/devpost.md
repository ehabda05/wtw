# Devpost submission: Otto

> Paste section by section into https://hackharvard2026.devpost.com/ before **Sun Oct 18, 7:45 AM**.
> Submit to: **Build a Messaging Agent with Photon 2.0**, which covers the iMessage track and Best Voice Agent. Also pick any general track that fits.
> Fill the `{{…}}` placeholders from `eval/results.json` and the team list.

**Project name:** Otto

**Tagline (49 chars):** The friend who makes plans happen, then forgets.

---

## Inspiration

Plans die in the group chat, and friendships die with them.

Someone says "we should hang out!!", four people heart it, two never answer, and nobody wants to be the one who nags. The friend who always organizes slowly burns out, and when they stop, the group stops meeting.

Time with friends has collapsed. Americans aged 15–24 spent 153 minutes a day with friends in person in 2003 and 67 in 2019 (Kannan & Veazie 2023, American Time Use Survey).

Polls and calendar links pull the plan out of the chat. New apps ask everyone to switch. We wanted the friend who always makes the plan happen: one who lives in the chat you already have, carries the social cost, and forgets everything afterwards.

## What it does

You add Otto's number to your group. That's the whole setup.

- **Finds a date with nobody's calendar.** "@otto dinner next week?" → Otto proposes three concrete times and announces when it will decide. People answer with a tapback or in plain words: "fri or sat", "anything but thu", "fri but after 8:30", "either". Otto decides by quorum, not unanimity.
- **Bridges conflicts.** If Ana can only do Friday and Ben only Saturday, Otto asks right away whether a late Friday or a Saturday brunch works for both, then adds that option.
- **Picks a place.** "ok I'm starving where are we eating" → one question (cuisine, budget, roughly where). The tightest budget wins quietly, vetoes are respected, and two neighborhoods mean it meets you in the middle. You get exactly three one-line options with walk time and opening hours *at the plan's time*.
- **Checks in with quiet friends without making anyone the bad guy.**
  - Nudges come from Otto, are visible to the group, are capped, and respect quiet hours, with a tone dial (gentle / normal / ruthless).
  - If someone opted in, Otto **calls them**, asks only the open question, and posts the answer back in the group: "Sam's in for Fri (by phone)."
- **Keeps it on track.** Plan card ("where are we at?"), `.ics` handoff (no calendar access), day-before and hour-before reminders, veto-and-swap ("can't do Friday anymore" reopens only the date), plan-scoped notes, bill split, and "explain yourself".
- **Then forgets.** "otto what do you know" dumps everything it has. "otto forget" deletes it. Otherwise it deletes itself 24 hours after the event.

## How we built it

- **Photon spectrum-ts** (TypeScript) is the single message loop for every surface. Thin adapters translate each platform to typed events and declare capabilities, so features degrade gracefully (tapbacks → numbered replies → plain text).
  - **Group surfaces:** a dedicated cloud iMessage line, macOS local iMessage, and **Telegram** groups through Photon's edge.
  - **Private check-ins:** shared-line iMessage DMs.
  - **Offline development:** the terminal provider plus our own in-process simulator.
- **Voice:**
  - The call runs on a **Photon 2.0 SMS number**, which goes over SIP/TLS to a **Retell** hosted voice agent.
  - Outbound calls ask one question. Inbound "call Otto to RSVP" works through Retell's inbound webhook.
  - Retell is set to store basic attributes only, for 1 day.
- **Engine:** a pure state machine, `applyEvent(state, event, ctx) → {state, actions}`, with no I/O and no clock reads. Every behavior is unit-tested, and whole conversations replay in milliseconds.
- **Local language understanding:**
  - a closed-vocabulary reply grammar (we match replies against the three options we posted instead of parsing free-form dates);
  - `chrono-node` for date words;
  - a small naive-Bayes intent model trained on our own phrases.
  - A hosted LLM fallback exists, but it is **off by default** and receives only redacted snippets.
- **Places:**
  - a bundled **OpenStreetMap** snapshot of Harvard Square and Allston (ODbL), with opening hours evaluated locally;
  - a bundled neighborhood gazetteer, so the neighborhood text never leaves the server;
  - NWS weather for outdoor plans, with a rounded coordinate only.
- **Storage:**
  - SQLite (`node:sqlite`), with each plan sealed as one AES-256-GCM blob and HMAC'd member IDs that differ in every group;
  - persisted at-most-once scheduler jobs;
  - a retention sweep;
  - a redacting logger.

## Challenges we ran into

- **Group semantics on Photon.** Free projects get *shared* iMessage lines, and shared lines can't see group chats (photon-hq/spectrum-ts#217). We designed for three group surfaces and made the engine capability-driven, so whichever line we get works.
- **Voice.** Voice runs on Photon 2.0 SIP on an SMS number, not on the iMessage line. Getting SIP/TLS digest auth, the hosted agent's privacy settings, and the inbound webhook to line up took real reading.
- **No calendars, by choice.** Free-form date parsing is unreliable. Our own test showed a popular parser reading "Fri or Sat works" as two different weeks. The fix was to only interpret replies relative to the options Otto itself proposed.
- **Privacy constraints at 4 AM.** No message text in storage meant designing every feature (nudges, names, reply addressing) around IDs instead of content.

## Accomplishments that we're proud of

- **The conflict bridge**: the exact moment Photon describes ("conflicting availability → a workable next step"), working in-thread.
- **Measured, not vibes:** 98.5% of date replies read correctly, the right final date in 10 of 10 conversations, 100% food-intent precision (87.9% recall), the noise budget kept in 10 of 10, and zero message text or phone numbers in 502 log lines or the database (ten role-play chats written blind from our spec; `npm run eval`).
- An agent that can say "here's everything I know" and then actually forget it.

## What we learned

- Recognition beats recall. People answer "Fri 7pm?" instantly and never answer "when are you free?".
- Restraint is a feature. The noise budget and quiet hours make the agent feel like a friend instead of a notification.
- The social design (who sends the nudge, who gets blamed) matters more than the NLP.

## What's next

- More Photon channels: WhatsApp 1:1 check-ins and an email digest.
- Interactive iMessage cards for one-tap date and place pickers.
- An open-source release of the engine as a reusable "group decision" library.

## What is simulated (please read)

- **Offline simulator (`npm run sim`):** a stand-in group chat for when the venue network fails. In the simulator the phone call is mocked and labeled "(simulated call)".
- **Restaurant price bands** are our team's estimates, shown as "~$ (est.)", because OpenStreetMap has no price data. Venue names, cuisines, addresses and opening hours come from OpenStreetMap.
- **Clock fast-forward:** to show a 24-hour nudge in a 2-minute demo we fast-forward the clock, and we say so when we do it.
- **Live surfaces:** in the live demo, the following ran on real Photon channels: {{LIVE_SURFACES}}.

## Built with

typescript · node.js · photon · spectrum-ts · imessage · telegram · sip · retell · sqlite · openstreetmap · opening_hours · chrono-node · luxon · national-weather-service · anthropic (optional, off by default)

## Links

- **Repo:** {{REPO_URL}}
- **Demo video:** {{VIDEO_URL}}
- **Try it:** text {{OTTO_NUMBER}} or add {{TELEGRAM_BOT}} to a group
