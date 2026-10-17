# Judging criteria and prize rules

Collected 2026-10-16, 8:45 to 9:05 PM EDT. Every line names its source.

Copyright note: criterion **names** are copied exactly. Longer descriptions are close paraphrases with a link to the original, so the team can check exact wording at the source.

---

## 1. HackHarvard 2026 Devpost page: NOT RETRIEVED, teammate action needed

- URL: https://hackharvard2026.devpost.com/ (found via Devpost's public search API, `https://devpost.com/api/hackathons?search=hackharvard`)
- Both the page and `/rules` sit behind a Cloudflare "verify you are human" check. Our rules say we never complete those, so we stopped there.
- **What the public API does show** (fetched 2026-10-16):
  - Title "HackHarvard2026: Hack to the Moon", Devpost id 31752, open
  - Submission period Oct 16 to 18, 2026
  - Location: David Rubenstein Treehouse
  - Themes: Beginner Friendly, Design, Machine Learning/AI
  - 21 registrations at fetch time
  - Gallery: https://hackharvard2026.devpost.com/project-gallery
  - Start a submission: https://hackharvard2026.devpost.com/challenges/start_a_submission
- **TODO for a teammate (2 minutes):** open the Devpost page in your own browser. Paste these verbatim into section 1a below:
  - the "Judging Criteria" section
  - the "Requirements / What to Submit" section, especially the video length limit
  - the list of prizes you can opt into

### 1a. Devpost judging criteria (paste here)

> _empty: waiting for teammate_

### 1b. Devpost submission requirements (paste here)

> _empty: waiting for teammate_

---

## 2. HackHarvard site, Photon challenge (https://hhuh.io/#challenges)

Fetched with a browser, 2026-10-16.

- **Challenge name:** "Build a Messaging Agent with Photon 2.0", presented by Photon.
- **Framing (paraphrase):** build an agent that lives where people already talk. With Photon 2.0 the agent gets a real phone number and a native presence across iMessage, SMS, RCS, WhatsApp, Telegram, email and phone calls. Suggested directions:
  - companions that understand social context
  - multi-agent systems that collaborate with humans
  - voice agents that answer and place real calls
- **Requirement:** the project must be built on Photon 2.0 and be live on at least one Photon channel.
- **How it's judged:** the most creative and technically impressive agent wins.
- **Workshop:** Friday 4:00 to 5:00 PM (already over by the time of this research).
- **Prizes on hhuh.io:**
  - Winner: $400 cash + $300 Photon credits + fast-track to the final interview round
  - Runner-up: $200 cash + $100 Photon credits
  - Best voice agent: $300 cash + $100 Photon credits, for the best voice agent on a Photon phone number

## 3. Photon's own hackathon guidelines (Notion)

Source: https://somethingreat.notion.site/Hackathon-Guidelines-for-Photon-2-0-3f8e443f36bb81f9893fed0d08a4c01d. Read in a browser, 2026-10-16.

### Prize names on the Notion page (more specific than hhuh.io)

| Prize | Award | Note |
|---|---|---|
| **iMessage Track Winner ($700)** | $400 cash, $300 Photon credits, fast-track to final interview round | The main prize is framed as **iMessage** |
| **iMessage Runner-Up ($300)** | $200 cash, $100 Photon credits | |
| **Best Voice Agent ($400)** | $300 cash, $100 Photon credits | A separate, standalone prize. Needs real phone calls **in and out**, built on Photon 2.0's voice channel, which runs **on an SMS number** |

All prizes are awarded per team.

### Photon judging criteria (names exact, questions paraphrased)

| Criterion | What it asks | How we hit it (draft, refine in Phase 4) |
|---|---|---|
| **Vision** | Does it push the frontier of hybrid human + AI intelligence? | An agent that takes on the *social* cost of organizing, a job no human wants. It is a participant in the group, not a tool. |
| **Craft** | Is it cohesive, responsive, and tastefully integrated? | Two-sentence messages, at most one unprompted message per 12 hours, quiet hours, reactions as votes, typing indicator. |
| **Depth** | How well does it handle real-world context and edge cases? | Conflicting availability, "either works", people who go quiet, vetoes after confirmation, false-positive food talk, recorded evals. |
| **Traction** | Could this run with real users tomorrow? | No app to install: add a number to a chat you already have. Privacy posture a friend group would actually accept. |

### "What great looks like" (Photon's list, paraphrased), with our tension notes

1. **Real human-in-the-loop collaboration**, not a demo reel of prompts.
   - Ours: humans answer in their own words, and the agent only decides when the tally is clear.
2. **Context that persists across time, channels, and teammates.**
   - ⚠ Tension with our "forgets everything" stance.
   - Resolution: memory is *plan-scoped*. It persists across days, channels and the phone call for the life of the plan, then is deleted.
   - Pitch line: "It remembers everything about the plan and nothing about you."
3. **A delightful default:** the agent elevates the moment without demanding attention.
   - Ours: the 12-hour cap, quiet hours, and silence until invoked.
4. **Thoughtful safety and fallback behaviors that earn trust.**
   - Ours: the consent intro, "what do you know", "forget this plan", the offline fallback, and labeled simulation.
5. **Voice agents:** natural turn-taking, low latency, and an agent that **remembers the call when the conversation moves back to text**.
   - Ours: the call answer is written into plan state and posted in the group.
   - Implication: **inbound** calls matter too ("call the number to RSVP"), not only outbound.

### Other facts on the guidelines page
- **Voice:** phone calls run on an **SMS number, not iMessage**. Set up a Voice profile and connect over SIP to Retell, ElevenLabs, LiveKit or Twilio. Cookbooks exist for each: https://photon.codes/docs/beta/cookbooks
- **iMessage limits:** calls **and group chat on iMessage both need a dedicated iMessage line**.
  - ⚠ This is the single biggest technical risk for a group-chat product. See `photon-capabilities.md`.
- iMessage is described as the flagship / "home base" channel for text agents.
- **Discord invites:** the Guidelines page links https://discord.gg/KhCRKNsx55, and the Examples page links https://discord.gg/hBDgu5vytc. Both are recorded. Use whichever one a teammate can join.

## 4. Photon examples page

Source: https://somethingreat.notion.site/Examples-a28e443f36bb828794ed0147e04d40a9. Read 2026-10-16.

**Directly on our thesis:**
- "Team coordinator" (turn group-chat updates into decisions, tasks, reminders).
- "Team Communication Facilitator", whose demo moment is two people giving conflicting availability and the agent proposing a workable next step. Its suggested starting point is Photon iMessage **group chat** plus check-ins, a task store, and reminders.
- "Fridge-to-dinner negotiator".
- "Club producer" (event scouting plus group decisions).
- Under "Moment" it lists "trying to get five friends to agree".

**The 60-second demo formula (paraphrase):**
1. Show the moment.
2. Send something real.
3. Show the useful behavior.
4. Show the payoff.

**Other guidance:**
- Build one working loop first: message → action → result.
- Use sample data where integrations slow you down, and label what is simulated.
- Questions to answer: Why would someone text this again tomorrow? Why is iMessage the right home? What would make a friend want the number?
- Their closing test: a friend says "Send me that number."
- They mention an open-source skill for sending interactive interfaces in iMessage through Photon's custom iMessage apps extension (Sina Matian). This is our stretch goal #14.
- The page says feedback before building will boost a team's chances, and invites teams to Discord.

## 5. Event logistics that change our plan (https://hhuh.io FAQ, read 2026-10-16)

- **The venue closes overnight. Overnight stays are not permitted.** The brief's 10 PM code freeze and late-night work must happen off-site. Plan where the team works tonight and Saturday night.
- **Dinner is not served.** The FAQ tells hackers to try restaurants in **Harvard Square and Allston**. This is the hungry flow's real-world hook: every hacker and judge has this exact problem tonight. Use it in the pitch.
- **Judging is in person** (no virtual judging), Sunday 9:00 AM to 12:00 PM in Canopy Hall. Teams must be present for judging and for the 3:00 to 4:00 PM closing ceremony.
- Deliberations run 1:00 to 2:30 PM. Submissions are due on Devpost by 8:00 AM Sunday.
- Minor discrepancy: the schedule lists judge debrief at 8:15 AM, while the FAQ says 8:00 AM. This doesn't affect us.
- Prizes go to each person on the team unless otherwise specified (hhuh.io Tracks section). Photon's Notion page says its prizes are **per team**.
