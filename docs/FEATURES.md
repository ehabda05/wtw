# Handy features: what we build, and why

Status key:
- **build** = in scope this weekend, which becomes **shipped** in the README once tests pass;
- **planned** = designed, not built.

Picked for demo value per minute of build time, and for the Photon judging criteria (Vision, Craft, Depth, Traction).

| # | Feature | Status | Why | Where |
|---|---|---|---|---|
| 1 | **"Where are we at?"** one-message plan card | build | Replaces scrolling; it is the in-chat substitute for Fenn's app screens (Craft) | `plan.ts` status |
| 2 | **Reaction voting** (tapbacks on option bubbles; numbers everywhere) | build | One tap to answer is the core of calendar-free scheduling (DATE_FINDING.md §2) | `parse.ts`, `plan.ts` |
| 3 | **Smart quiet hours** (23:00–09:00 group-local) | build | Judges notice restraint; also Photon's deliverability guidance | `nudge.ts` |
| 4 | **Tone dial** (gentle / normal / ruthless) | build | Funny in demos, and it shows Homi carries the social cost | `templates.ts` |
| 5 | **Weather glance** for outdoor plans | build (small) | One line in the day-before reminder, from NWS with a rounded coordinate only | `places/weather.ts` |
| 6 | **Split the bill** (`homi split 142.50`) | build | Pure math, no payments, so it is privacy-safe | `plan.ts` |
| 7 | **Calendar handoff** (`.ics` / text block) | build | Plans reach calendars **without** reading any (DATE_FINDING.md §7) | `ics.ts` |
| 8 | **Threshold mode** ("lock it when 4 say yes") | build | Quorum, not unanimity | `schedule.ts` |
| 9 | **Veto and swap** ("can't do Friday anymore") | build | Reopens one decision, not the whole plan (Depth) | `plan.ts` |
| 10 | **Reminder ladder** (day-before + hour-before, once each) | build | No-shows kill plans after the "yes" | `plan.ts`, scheduler |
| 11 | **Plan-scoped shared memory** (`homi note …` / `homi what did we decide about …`) | build | Photon rewards "context that persists"; ours is plan-scoped and is deleted with the plan | `plan.ts` |
| 12 | **Multi-group isolation**, proven by test | build | The same person in two groups gets two unlinked IDs and two isolated plans | `test/privacy/partition.test.ts` |
| 13 | **"Explain yourself"** (`homi why`) | build | Trust: shows the tally and any low-confidence reads | `plan.ts` |
| 14 | Rich iMessage UI (interactive cards via the iMessage apps extension) | planned | Needs the extension setup from the Photon examples page; not worth the risk this weekend | — |
| + | **Conflict bridges** (add a 4th option / shift the time) | build | Photon's own demo moment: conflicting availability leads to a workable next step | `schedule.ts` |
| + | **Meet in the middle** (two neighborhoods → midpoint) | build | Fair, and uses only neighborhood strings | `hungry.ts`, `geo.ts` |
| + | **Notice mode** (opt-in: offers help when a plan is forming) | build (small) | Catches "we should hang out!!" before it dies, but only with consent | `plan.ts` |
| + | Inbound "call Homi to RSVP" | build (webhook mode only) | Best Voice Agent wants calls **in and out** | `voice/inbound.ts` |
| + | Email digest | planned | Needs domain DNS | — |
| + | WhatsApp Business check-ins | planned | 1:1 only on spectrum-ts | — |

At least four "handy features" are required. We target 13 built, and the README marks each one **shipped** only after its test passes.

## Beyond the plan

Four features carry the group from "let's hang out" through the night out and on to the next trip. Each one is a self-contained extension module (`src/engine/ext/`). Each has a runner-side handler where it needs I/O (`src/runner/handlers/`).

| Feature | What it does | In the app | Simulated / estimated | Needs integration for real use | Doc |
|---|---|---|---|---|---|
| **Bill splitting** | Equal, custom and itemized splits. Handles tip, tax, service and fees; several payers on one tab; "who pays whom" settle-up; shares always add up to the total | ✅ engine | nothing: it's math | nothing. Paying each other happens outside Homi | [BILLS.md](BILLS.md) |
| **Travel planning** | Turns "let's plan Japan for 2030" into a trip: collects details, gives an itinerary with flights, stays, transport, activities and costs, offers a budget tier and a comfort upgrade with the difference, plus savings tips | ✅ engine + estimates provider | prices are **labeled estimates** with **example listings** when dates are too far ahead or no live provider is set | flight / stay search APIs, Airbnb partner access or deep links, fare alerts | [TRAVEL.md](TRAVEL.md) |
| **Show-up pledges** | Optional deposits that come back when you attend or finish a goal. The group must agree where no-show money goes before anyone pledges. Covers check-ins, refunds, forfeits, cancellation and disputes | ✅ engine + payment handler | **every deposit, refund and forfeit is SIMULATED** | a payment provider with holds and payouts, each participant's authorization, and a compliance review | [COMMITMENTS.md](COMMITMENTS.md) |
| **Shared album** | Explicitly shared photos go to a members-only event album; members can view, and can remove their own photos | ✅ engine + encrypted disk store + gallery page | demo album links | Photon attachment fetching per channel, object storage, per-member signed links | [ALBUM.md](ALBUM.md) |
