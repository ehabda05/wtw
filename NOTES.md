# NOTES

This is the running log of sources, assumptions, and decisions. Newest entries go at the bottom of each section.
Times are EDT. Product name: TBD (Phase 2).

## Status
- **2026-10-16 21:00:** Phase 1 (Study) in progress.
  - We are roughly 1 hour behind the brief's timeline. The brief planned Phases 1 and 2 for 5 to 8 PM.
  - The Photon workshop (4 to 5 PM) is over. Discord is now the only way to ask Photon questions tonight.
- **2026-10-17 08:20: Code-complete offline.**
  - **Tests:** `npm test` 289/289 green, `tsc` clean.
  - **`npm run eval`:**
    - date cells 98.5%, final date 10/10, lock reason 10/10;
    - food precision/recall 100%/87.9%, intent 95.6%;
    - noise budget 10/10, 0 quiet-hour violations;
    - 0 log leaks (502 lines), 0 DB plaintext.
    - Place match 3/4: the OSM snapshot has no Thai near Harvard Sq.
  - **Deck and story:** deck numbers filled, `deck.pdf` re-exported, both demo MP4s rendered.
  - **Remaining human steps:** the teammate actions above, plus first live run on Photon (Telegram or dedicated iMessage), voice go/no-go, and filling team name, repo URL, video URL and Otto's number.
  - **Fixes during integration:**
    - Estimated prices get one band of slack, and meal places come before cafés (fixed the "coffee shop for dinner" bug).
    - The short-window phone escalation now happens at the deadline.
    - The eval leak check uses exact needles; a generic 10-digit pattern flagged timestamps.
- **2026-10-17 07:35:** Build status.
  - **Done:** research, design docs, voice (59 tests), places (35 tests), infra/runner/sim (89 tests), LLM fallback (4 tests), blind eval fixtures, eval harness, motion demo MP4s, deck HTML, pitch/Devpost/video/ship drafts.
  - **Still building:** the engine state machine (`plan.ts`), which stalled overnight and was resumed at 07:35.
  - **Spec clarifications from the fixture author** are folded into the docs: the 12h budget rule, escalation folded into the nudge, top-3 day selection, veto-and-swap, bare numbers, idioms.
- **2026-10-16 21:17:** Phase 1 complete, waiting for the go-ahead on Phase 2.
  - Deliverables:
    - `research/fenn-concepts.md`
    - `research/photon-capabilities.md`
    - `research/judging.md` (Devpost section still needs a teammate paste)
    - `research/problem-evidence.md`

## Teammate actions (things the agent must not do itself)
1. **Post on the Photon Discord tonight. This is the most urgent item.** The draft is below. The answer decides our group-chat surface.
   - Invites: https://discord.gg/hBDgu5vytc (Examples page), https://discord.gg/KhCRKNsx55 (Guidelines page), https://discord.com/invite/4yXmmFPadR (photon.codes/beta).
2. **Create the Photon projects yourself.** We will likely need both:
   - **Stable:** https://app.photon.codes/dashboard, for `spectrum-ts`. Put `SPECTRUM_PROJECT_ID` and `SPECTRUM_PROJECT_SECRET` in `.env`.
   - **Photon 2.0 beta:** https://app.beta.photon.codes (reached from https://photon.codes/beta), for the SMS number and voice. Put the `pho_prj_…` ID and API key in `.env`.
   - Never paste secrets into chat.
   - ⚠ **Do not use `photon.co/beta`.** It is a for-sale parked domain, not Photon.
3. **Payment method decision (team call, not mine).** Outbound voice returns `402 ENTITLEMENT_REQUIRED` unless the org has a payment method (verified in the OpenAPI spec). A US SMS number is listed at $2/month. Photon's blog mentions $100 free credit. If the team accepts this, a teammate adds the card themselves.
4. **Open https://hackharvard2026.devpost.com/** in your own browser. Paste the judging criteria and submission requirements verbatim into `research/judging.md` §1a/§1b. Devpost blocks automated access behind a human check.
5. **Mac check:** does any teammate have a Mac that can stay signed in to Messages all weekend with a spare Apple ID? That unlocks the `imessage-local` fallback for real iMessage groups.

### Draft Discord post (teammate sends; edit freely)
> Hi! HackHarvard team here, building a privacy-first group-chat planner on Photon. You add it to an existing group chat; it finds the date, picks a place nearby, checks in on quiet friends (including a phone call), then deletes everything.
> Three questions:
> (1) Shared lines can't see iMessage groups (spectrum-ts issue #217). Can hackathon teams get a temporary dedicated line? If not, would a Telegram group, or macOS local iMessage, still qualify for the iMessage track?
> (2) Does a spectrum-ts app on app.photon.codes count as "built on Photon 2.0", or must we use app.beta.photon.codes / api.photon.codes?
> (3) Outbound voice needs a payment method (402). Is there hackathon credit, or a way to test calls without a card?

## Sources (URL, date accessed, what we took from it)

| # | URL | Accessed | Used for |
|---|---|---|---|
| S1 | https://hhuh.io/#challenges | 2026-10-16 | Photon challenge text, prize amounts, schedule, FAQ (venue closes overnight, no dinner, in-person judging) |
| S2 | https://somethingreat.notion.site/Hackathon-Guidelines-for-Photon-2-0-3f8e443f36bb81f9893fed0d08a4c01d | 2026-10-16 | Photon judging criteria (Vision/Craft/Depth/Traction), prize names, voice runs on SMS number, iMessage group chat needs dedicated line, cookbook links |
| S3 | https://somethingreat.notion.site/Examples-a28e443f36bb828794ed0147e04d40a9 | 2026-10-16 | Team coordinator / facilitator ideas, 60-second demo formula, "send me that number" test |
| S4 | https://devpost.com/api/hackathons?search=hackharvard | 2026-10-16 | Devpost URL for HackHarvard 2026 and its metadata |
| S5 | https://hackharvard2026.devpost.com/ | 2026-10-16 | Blocked by Cloudflare human check. Not read. |
| S6 | https://portal.hackharvard.io/ | 2026-10-16 | Redirects (301) to https://portal.hhuh.io/. Login-gated. Not read. |
| S7 | https://photon.co/beta | 2026-10-16 | Returned an empty body. Consistent with the brief's "dead parked domain". Use app.photon.codes. |
| S8 | https://photon.codes/docs/beta/cookbooks | 2026-10-16 | Linked from S2. Voice cookbooks for Retell, ElevenLabs, LiveKit, Twilio (detail in research/photon-capabilities.md) |
| S9 | https://api.github.com/repos/photon-hq/spectrum-ts/issues/217 | 2026-10-16 | **Re-verified by lead.** A shared-pool iMessage line does not emit text from existing groups. Maintainer (2026-07-26): a Shared Line limitation; points to the Enterprise plan. |
| S10 | https://api.photon.codes/openapi.json | 2026-10-16 | **Re-verified by lead.** Send endpoint: a shared iMessage line sends only in direct Spaces. `SHARED_LINE_GROUP_UNSUPPORTED` (422). Outbound voice credential: payment method required, else `402 ENTITLEMENT_REQUIRED`. SHA-256 digest recommended. |
| S11 | https://photon.codes/beta | 2026-10-16 | **Re-verified by lead.** Links to app.beta.photon.codes (the Photon 2.0 dashboard). |
| S12 | https://www.ebi.ac.uk/europepmc/webservices/rest/PMC9811250/fullTextXML (Kannan & Veazie 2023, SSM-Population Health 21:101331) | 2026-10-16 | **Re-verified by lead.** All ages: time with friends was 60 min/day in 2003, 34 in 2019 and 20 in 2020. Ages 15-24: friend time "plummeted" by 377 h/year, 2003 to 2019. The 15-24 per-year minutes (153, 67, 43) come from the paper's supplement, read by the research agent. |

## Pitch evidence (shortlist; full detail in research/problem-evidence.md)
1. **Slide 2:** ages 15-24 spent 153 min/day with friends in person in 2003 and 67 in 2019. Lead with 2019 so nobody blames COVID. (S12)
2. **Plans die in the group chat:** 36% replied when asked alone or with one other person, versus 14% when 14 or 49 others were copied. (Blair, Thompson & Wuensch 2005; email field experiment; frame it as a mechanism)
3. **The organizer burns out:** in the average relationship, one person is almost twice as likely to initiate, and long one-sided streaks raise the chance the tie ends. (Mollgaard & Mathiesen 2016, PLoS ONE)
- **Dropped:** Hall's 50/90/200 hours to make a friend. The paper itself could not be checked, only a press release.

More sources are listed in each research file's own Sources section:
- `research/fenn-concepts.md`
- `research/photon-capabilities.md`
- `research/problem-evidence.md`

## Assumptions (each one is a guess until verified)
- A1. The team has at least one iPhone for the iMessage demo and a second phone for the voice call.
- A2. "Live on at least one Photon channel" is satisfied by one real channel. The terminal provider alone probably does not count. (Unverified; ask Photon.)
- A3. The free beta includes at least one iMessage line and one SMS number per project. (Unverified until the dashboard is opened. See photon-capabilities.md.)
- A4. The team will work off-site overnight, because the venue closes (S1 FAQ).

## Decisions
- **D1 (2026-10-16): Plan memory is plan-scoped.** It persists across time, channels, and the voice call for the life of the plan, then is purged.
  - Why: this resolves the tension between Photon's "context that persists" criterion and our "forgets everything" principle.
  - Pitch line: "remembers everything about the plan, nothing about you".
- **D2 (2026-10-16): Build voice on the SMS number**, per S2. Do not build it on iMessage.
  - Stack: Photon 2.0 SMS number → SIP/TLS → Retell hosted agent (Photon's own cookbook). ElevenLabs is the fallback.
  - Go/no-go test: research/photon-capabilities.md §7.
- **D3 (2026-10-16): The engine is transport-agnostic.**
  - Thin adapters: (a) spectrum-ts for terminal, Telegram and iMessage; (b) the Photon 2.0 API for SMS and voice events.
  - Why: the group surface and prize eligibility are unresolved (S9, S10). This way no answer from Photon forces a rewrite.
- **D4 (pending Photon's answer): group-chat surface, in order of preference:**
  1. dedicated iMessage line, if Photon grants one;
  2. `imessage-local` on a teammate's Mac (real iMessage groups, but runs only on that Mac);
  3. Telegram group via spectrum-ts.
  - In every case: iMessage DMs on the shared line for opt-in private check-ins, plus the terminal for offline fallback.

- **D5 (2026-10-16): Places.**
  - Data: a bundled OpenStreetMap snapshot (ODbL), so the demo makes no runtime third-party call. Google Places is optional, needs a card, and is never cached.
  - Price band: labeled team estimates.
  - Weather: NWS. Geocoding: bundled gazetteer.
  - Evaluation: research/places-api.md.
- **D6 (2026-10-16): Toolchain.**
  - Tests use `node:test` + `tsx`, not vitest. Vitest's deep file paths exceed Windows MAX_PATH in this folder, and npm tar failed.
  - Storage: `node:sqlite` (no native build).
- **D7 (2026-10-16): The product name is "Otto".**
  - Why: short, a name and not a common word (so mention detection stays clean), sounds like a friend.
  - Rejected: "Remy". An existing iMessage to-do agent and Google's Gemini agent both use it.
- **D8 (2026-10-16): Scope.** The user asked to finish the whole project end to end, without phase-by-phase stops.

## Why Fenn pivoted (research/fenn-pivot.md)
- **No public statement from the founders.** Everything below is inference.
- **Strongest inference:** cold start. Every one of 8 or 9 friends had to install an iOS-only app; a couple needs one other install.
- **Next strongest:** a couple is a natural paying unit ($14.99 a month), and couples coordinate daily, while friend groups plan occasionally.
- **What it means for Otto:** we escape the install problem completely. We do **not** escape monetization or episodic usage, so the pitch needs answers for both (story/pitch.md, judge Q&A).
- **Closest competitor:** Continua (GV-backed, already a bot in SMS, iMessage and Discord groups). The long-term platform risk is native features: iOS 26 Messages polls and Meta AI in WhatsApp.

## Facts that changed vs the brief (verified)
- Free projects get **shared** iMessage lines, which **cannot see or post in groups** (S9, S10). The brief assumed group chat works on cloud lines.
- Voice runs on an **SMS number via Photon 2.0**. Server `sip.photon.codes`, per-profile SIP credentials, SRTP "Auto", call events available by webhook. It does not run on iMessage via `sip.spectrum.photon.codes` with the project secret, which is the older Stable path.
- `spectrum-ts` has **no SMS, RCS, email or voice provider**. Those are Photon 2.0 API platforms.
- Photon's guidelines call the Photon 2.0 beta an "open source framework" and link the spectrum-ts docs. That suggests spectrum-ts counts as Photon 2.0, but it is unconfirmed (Discord Q2).
