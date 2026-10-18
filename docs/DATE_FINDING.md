# Finding a date when nobody uses a calendar

Fenn's group product found dates by reading calendars: the device calendar plus Google Calendar sync (`research/fenn-concepts.md` Q2). That only works if every friend:
- installs the app,
- grants calendar access, and
- actually keeps their social life in a calendar.

Most friend plans live in people's heads ("I think I have something Thursday?"). Homi's design starts from that reality.

> **The core insight: recognition beats recall.**
> "When are you free next week?" is homework. You have to replay your week, and most people put it off.
> "Fri 7pm?" is a reflex. You know instantly, and you can answer with one tap.
> So Homi **never asks for availability**. It **proposes**, people **react**, and it **decides on a deadline**.

This file gives the exact algorithms. They live in `src/engine/parse.ts` (reply grammar) and `src/engine/schedule.ts` (option generation and choosing). Both are pure and unit-tested.

---

## 1. Propose, don't poll: generating three options

Input: the trigger message ("dinner next week?") and the current time in the group's time zone.

1. **Activity → natural time.**

   | Activity words | Default time |
   |---|---|
   | dinner | 7:00pm |
   | drinks | 8:00pm |
   | lunch | 12:30pm |
   | brunch | 11:00am |
   | breakfast | 9:30am |
   | coffee | 3:00pm |
   | movie | 7:30pm |
   | game night | 7:00pm |
   | hike / picnic / park | 11:00am (outdoor, enables the weather glance) |
   | anything else ("hang out") | 6:30pm on weekdays, 2:00pm on weekends |

2. **Window.** Each phrase maps to a range of days:

   | Phrase | Days |
   | --- | --- |
   | "tonight" | today |
   | "tomorrow" | tomorrow |
   | "this week" | today+1 → Sunday |
   | "this weekend" | Fri → Sun |
   | "next week" | next Mon → Sun |
   | a named day | that day |
   | "soon" or nothing | the next 7 days, starting tomorrow |

3. **Pick 3 days** from the window.
   - **Score each day.** For social plans the scores are Fri 3, Sat 3, Thu 2, Sun 2, Wed 1, Tue 1, Mon 0. Brunch and hikes prefer Sat and Sun.
   - **Take the top 3 by score.** Ties go to the earlier day. Show them in chronological order. Friend plans cluster at the end of the week, so "next week" gives Thu, Fri and Sat.
   - **Remove these days:**
     - any day the requester ruled out ("not monday");
     - any slot less than 3h from now ("tonight" asked at 8pm, when nothing is 3h out, still means tonight: the floor drops to 30 minutes and the last slot to 11:30pm; once the evening is really over Homi says so and offers tomorrow, never a silent jump to next week), **unless the trigger named the time** ("dinner tonight at 8pm" said at 5:45 gives exactly one option, Sat 8pm, with 30 minutes' notice as the floor; the decide-by deadline then falls halfway, never at or after the start).
   - A named time on a one-day window is the only option ("dinner friday 7pm" → Fri 7pm). A trailing "at <place>" in the trigger is kept as the place ("… at halal guys").
   - While options are open, "homi make it 8pm" / "homi I said 8pm" re-proposes the same days at that time (old options are retired); a day nobody proposed ("homi wednesday works", or an unaddressed "I was thinking Wednesday") is added as a new option with the proposer's yes.
   - **Single-day windows** ("tomorrow") get 3 *times* on that day instead (e.g., 12:30, 6:30, 8pm).
4. **Decide-by deadline.** `min(now + 24h, first option − 6h)`, but at least `now + 2h`. If it lands in quiet hours, move it to 9:30am, or to 10:30pm if 9:30am would be too late.

**Output:** for example, "1. Thu Oct 22, 7pm", "2. Fri Oct 23, 7pm", "3. Sat Oct 24, 7pm", locking "tomorrow 9:30pm".

## 2. Two taps to answer

Every answer path costs one tap or one short phrase:

| Channel | Fastest answer |
|---|---|
| iMessage (cloud or local) | Tapback ❤️ / 👍 on an **option bubble**. Each option is its own bubble, so a tapback is a vote on exactly that option. 👎 = no, ❓ = maybe. |
| Telegram | Native multi-answer poll (non-anonymous, so votes map to members). Or reply. |
| Any channel, including SMS | Reply in plain words: "fri or sat", "1 3", "anything but thu", "either". |
| Inline reply to an option bubble | Yes for that option, unless the reply text says otherwise. |

## 3. The reply grammar (closed vocabulary)

Free-form date parsing is unreliable. Our own test showed `chrono-node` reads "Fri or Sat works" as two *different* weeks.

Homi avoids the problem because it **only has to match replies against the three options it posted**. That makes this a small classification problem, not open-ended NLP.

**References → option sets**

| Reference type | Examples | Matches |
|---|---|---|
| Index | `1`, `#2`, `option 3`, `the first`, `second one`, `last one` | that option |
| Day name | `thu`, `thurs`, `friday`, `sat` | options on that weekday |
| Relative day | `tomorrow`, `tonight` | the option on that date |
| Date | `the 23rd`, `23`, `oct 23` | option on that date. A bare number N ≤ the number of options is an index; a larger number counts as a date only if it equals an option's day of the month. |
| Group | `weekend` | Sat and Sun options |
| Group | `weekday`, `weeknight` | Mon–Fri options |
| Quantifier: all | `either`, `any`, `all`, `both`, `whatever`, `anything`, `all good`, `any works`, `free whenever`, `anytime` | all options |
| Quantifier: none | `none`, `neither`, `nothing works`, `can't do any` | all options = no |

**Polarity cues (per clause)**

| Polarity | Cues |
|---|---|
| yes (default when a clause only has references) | works, good, down, in, free, can do, could do, can make, yes, yeah, yep, ✅, 👍; preference words (better, prefer, preferably, ideal, best) unless the clause is past tense or a question |
| no | not, can't, cannot, no, busy, out, bad, won't, doesn't work, nope, except, but not |
| maybe | maybe, prob, probably, might, should be, possibly, tentative, if, `?` right after a reference |

**Clause rules**

1. **Split clauses** on `but`, `except`, `though`, `however`, `,`, `;` and `.`. Each clause takes its own polarity, so "not thu, fri works" → Thu no, Fri yes.
2. **Exclusion phrases.** "anything but sat", "all except sat", "any night but thu" and "free whenever except sat" mean all = yes, then Sat = no. When the excluded day was never proposed ("any day but monday"), every option is a yes; "can't do any day but sat" flips it (only Sat). Filler ("honestly", "tbh", "pretty much", "lol") is ignored.
3. **Time constraints** ("after 8", "before 7", "only late", "after work") are stored as a window on that member's day preference. An option outside the window becomes **maybe (time)**, and that can trigger a time-shift bridge (§5).
4. **Day level beats option level.** "fri works" is stored as a *day* preference, so if Homi later adds a Fri 8:30pm option, it already counts as a yes.
   - Explicit per-option answers override day-level ones. Those are a number, a tapback, or a poll answer.
5. **Updates.** A later message from the same member overrides only the options it mentions. A quantifier ("any" / "none") overrides everything.
6. **Is it even a vote?** An unaddressed message counts only if all of the following hold:
   - the plan is in `collecting_availability`, and
   - the message (a) contains an option reference **and** a polarity cue, or (b) consists only of references ("fri or sat", "1, 3").
   - "lol fri was wild" contains "fri" but no cue, so it is ignored. False positives are worse than misses.
7. **Bare "I'm in" / "down" / "yes"** in reply to the options counts as **all = yes, low confidence**. That's how people talk. `homi why` reveals low-confidence reads.
8. **Unparseable but addressed** ("@homi idk depends on work"):
   - With the hosted LLM off, Homi asks once: "Got it, which ones could work: 1, 2 or 3?"
   - With it on, the redacted snippet goes to the LLM (PRIVACY.md §3).

## 4. Choosing: quorum, not unanimity

Plans die waiting for the last person. So Homi announces the decision time up front and decides with whoever showed up.

- **Score.** `score(option) = yes + 0.5 × maybe`. Unknown counts 0, not "no".
- **Organizer veto.** An option the plan's starter said **no** to is skipped, unless every option has that no.
- **Ties** go to more hard yes, then fewer no, then earlier date.
- **Early lock** happens when either of these is true:
  1. a threshold is set ("lock it when 4 say yes") and an option reaches it, or
  2. every known member has answered and at least 2 answered.
- **Maybes on the winner** get one confirm ping, folded into the lock message: "Fri it is: 4 in. Jo, you said maybe; still good?"

## 5. Conflict bridges: the "workable next step"

This is the demo moment Photon's examples page describes: two people give conflicting availability, and the agent proposes something workable. It happens **immediately**, in direct reply to the message that created the conflict, so it is *prompted* and doesn't spend the noise budget.

| Conflict detected | What Homi says |
|---|---|
| **Hard day conflict**: two members each have yes only on different days, and no on the other's day | "Ana can only do Fri and Ben only Sat. Could either of you do Fri late or Sat brunch? I'll add it." When someone answers ("sat brunch works"), Homi adds a 4th option with day-level prefs applied. Ben's "Sat works" carries over automatically. |
| **Time conflict**: the winner works for someone only at another time ("fri but after 8:30") | "Fri works for everyone if we push to 8:30. Want Fri 8:30?" Any yes moves the option's time. |
| **Winner strands someone** (at decision time): the best option misses an answered member who said yes elsewhere, and the runner-up loses at most one yes | One question inside the lock message: "Fri works for 4 (not Ben); Sat works for 3 including Ben. Fri unless someone says "sat" in the next few hours?" |
| **Event less than 24h away** | No bridge. Lock and be kind: "Fri it is; Ben, we'll miss you this time." |

## 6. Silent members, without being creepy

- **Who exists?** On dedicated iMessage lines, `space.getMembers()` gives the full roster. Elsewhere Homi only knows people who have posted while a plan was open. It records a salted hash that someone exists, never what they said (PRIVACY.md §2).
- **Headcount.** "homi we're 6" sets the expected headcount, so Homi can say "2 people haven't picked yet" about people it has never seen.
- **Addressing without names or numbers.** A nudge is an **inline reply to that person's own last message**. iMessage and Telegram both show it as directed at them. Homi stores only the message ID (encrypted), never the text.
- **Names are opt-in.** Homi knows only names given with "homi I'm Sam". On Telegram it uses the platform's display handle.
- **Escalation ladder.** Each step is announced and capped at 2 nudges per member per plan:
  1. collective group nudge;
  2. inline-reply nudge;
  3. opt-in DM or phone call (the call says only the open question; PRIVACY.md §10).
- **"I'm out" is a first-class answer.** It stops all nudges for that person with zero guilt. Homi replies "All good, next time 💛" and counts them as not attending, not as missing.

## 7. Making the plan stick (still no calendar access)

- **Calendar handoff.** On confirmation, `homi add to calendar` returns an `.ics` file (no attendee emails) or a copyable text block. The plan reaches the calendars of people who use them, and Homi never reads one.
- **Reminder ladder.** A day-before reminder and an hour-before reminder, each with the address and a maps link, each sent exactly once.
- **Veto and swap.** "can't do Friday anymore" after confirmation reopens **only the date** with 3 new options. The place and notes are kept.
  - The new options come from the same window minus the vetoed day. If fewer than 3 days remain, the window extends by a week.
  - Day-level answers carry over, so an earlier "sat works" already counts on a new Saturday option. Votes on removed options are dropped.
- **Living tally.** Where the platform allows editing sent messages (iMessage cloud within its edit window; Telegram always), Homi edits its header to show "✓ Thu 1 · Fri 3 · Sat 2" instead of posting new messages.

---

## Group-chat problems an app avoids, and how Homi solves them in-thread

| Problem in a shared thread | Fenn-style app answer | Homi's answer |
|---|---|---|
| Nobody keeps social plans on a calendar | Read everyone's calendar (requires install plus permission) | Propose 3 concrete times; one tap to answer; decide on a deadline |
| Polls feel corporate and leave the chat | Native UI in its own app | Tapbacks on option bubbles; native polls only where the chat app has them; plain-word replies always work |
| "When everyone is asked, no one answers" (36% vs 14% reply rate; Blair et al. 2005) | Push notifications | Decide-by time announced up front; collective then individual nudges, capped |
| The organizer looks pushy | AI member sends follow-ups | Same, plus every nudge is visible, capped (≤1 unprompted per 12h), and tone-adjustable |
| No names, only phone numbers | Account profiles | Inline-reply addressing; opt-in "homi I'm Sam" |
| Silent members are invisible | Member list in app | Roster where the platform gives it; hashed presence otherwise; "we're 6" headcount |
| Conflicting constraints | Calendar intersection | Conflict bridges: add a 4th option or shift the time, asked in-thread |
| Chat noise | Separate app screen | Living tally edits, merged messages, quiet hours, one-message `where are we at` card |
| Plans fall apart after "yes" | Live Activities, location ETAs | Reminder ladder, `.ics` handoff, veto-and-swap that reopens one decision only |
| Trust | Privacy policy | Ask it what it knows; tell it to forget; it deletes itself 24h after |

## Demo quorum (`QUORUM_DM_AFTER_MS`, off by default)

For a live demo the real nudge ladder (hours) is too slow, so three settings compress it. `QUORUM_DM_AFTER_MS` after the options go out, everyone who has not answered is asked privately where Homi has their handle (everyone who spoke in the group since the plan started; on Telegram only people who have started the bot can be DMed) and named in the group either way. `QUORUM_REPLY_MS` later the silent count as not coming, people the platform only counted (Telegram's member count) included. Then: at least `MIN_ATTENDEES` yes votes locks the date as usual; fewer cancels the plan ("Only 1 can make it, so no dinner this time"). The same rule applies to an early lock: once everyone is accounted for, one yes is not a plan. A private reply ("yes", "no", "2") is fed back to the plan as that person's vote; a bare "yes" / "no" / "1" in the group from someone who was just asked counts even without "homi". With the quorum on, the header and "where are we at" say "I'll lock it in once everyone answers" instead of a decide-by time, since the timers decide, not the clock. With `DEMO_SIMPLE=on` every group message while the poll is open is read as an answer (vote grammar first, Claude for the rest), addressed or not; the person who proposed one exact time ("dinner friday 7pm") counts as a yes for it, and "I want to do earlier" with no time named gets "What time, then?" instead of silence. On every surface, anyone who addresses Homi gets an answer: the open question again, or "Not sure what you mean" (`onMessage` in `src/engine/plan/messages.ts`). Demo values: `30000` / `15000` / `2`. Code: `src/engine/plan/timers.ts` (`quorumDm`, `quorumClose`), `src/engine/plan/lock.ts`, `src/runner/runner.ts` (`#routeDmReply`). Tests: `test/engine/quorum.test.ts`, `test/runner/dm-reply.test.ts`.
