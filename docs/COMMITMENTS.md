# Commitments: the show-up pledge

An optional way for a group to put a little money behind "I'll be there". Nobody has to join, and nothing is held until the people voting agree where no-show money goes. **In this repo every payment is SIMULATED**: no money moves anywhere (see [What is simulated](#what-is-simulated)).

Code: `src/engine/ext/commit.ts` and `src/engine/ext/commit/*` (pure engine), `src/payments/*` (providers), `src/runner/handlers/payments.ts` (runner). Tests: `test/ext/commit*.test.ts`, `test/runner/payments.test.ts`. The canonical walkthrough is [DEMO.md](DEMO.md) Acts 2–3.

## The commitment

| | Show-up pledge | Goal pledge |
|---|---|---|
| Start | `homi let's do a $10 show-up pledge`, `homi pledge $10`, `homi commit $20 each` | `homi pledge $20 that everyone books flights by Dec 1` |
| Needs | a plan with a **locked date** (otherwise: "Lock a date first; then I can set up a pledge.") and at least 15 min before it starts | an open plan and a deadline at least 1h away |
| Promise | be there: check in between **15 min before and 30 min after** the start | do the thing by the end of the deadline day (11:59pm, group time zone) |
| Deposit | the same amount for everyone, **$1 to $500**, integer cents | same |

Homi posts a header, three option bubbles and a rules card (DEMO step 7). Like every Homi message, the header is two sentences or fewer (`test/ext/commit-copy.test.ts` checks every pledge message).

## 1. Where no-show money goes (agreement first)

The three options:

1. **Group fund for the next outing**: credited to the group's fund at settlement (`SpaceSettings.ext.commit.fundCents`; it persists after the plan is deleted, until `homi stop`).
2. **Split among the people who showed up**: shared equally among the confirmed attendees in exact cents (largest remainder, so $10 over 3 is $3.34 + $3.33 + $3.33).
3. **Donate to a charity we pick**: set aside and recorded as an amount "to donate" (`donateCents`); the group picks the charity and makes the donation.

Votes: ❤️/👍 on a bubble, or reply `1`/`2`/`3` (or "group fund", "split", "charity"). Votes can change; taking the reaction back removes the vote.

**Agreement rule.** Pledges open only when **every member who voted picked the same option and at least two voted**. Homi checks once everyone in the plan has voted (or when someone asks with `homi pledges` / `homi I'm in`). If votes are split, Homi says the counts and that pledges open once everyone agrees. The destination is fixed once pledges open.

## 2. Pledges

- `homi I'm in` sends a **hold** for the deposit. Homi acknowledges with a 👍 once the provider confirms it (a short text reply where the channel can't react). If the hold fails, Homi says so and nothing is counted.
- Only members who voted for the agreed option can pledge while voting is open. After the "Everyone agreed" message, saying `homi I'm in` means accepting that announced destination.
- When everyone who agreed has pledged, Homi posts once: "6 of 6 pledged: $60 held (SIMULATED). See you Friday at 7." `homi pledges` shows the current count anytime.
- Members who don't pledge are simply not in it. Pledges close when check-in opens (goal: at the deadline).

## 3. How attendance (or completion) is verified

- **Show-up:** `homi I'm here` inside the window. A check-in **counts once a second participant has checked in** (mutual presence: everyone checked in vouches for everyone else) **or someone else 👍s it**. Each check-in gets a 👍. When exactly one participant is left, Homi replies "5 of 6 checked in ✓ Still waiting on Sam; check-in closes at 7:30pm."; when everyone is in, it says so once.
- **Goal:** `homi done`, which counts once **another participant** 👍s that message or says `homi confirm <name>`. You can't confirm yourself.
- Homi never uses location. Anything the rules get wrong goes through a dispute.

## 4. When money is returned, and no-shows

**Settlement** runs 60 minutes after check-in closes (8:30pm for a 7pm dinner; goal: at the deadline):

- Everyone with a confirmed check-in gets a **refund** of their deposit.
- Everyone else **forfeits** their deposit to the agreed destination. The fund is credited at once; a split or a donation is paid out when the dispute window (and any open vote) closes.
- If nobody showed up and the destination is "split", everyone is refunded (there is no one to split with).
- One message: "Pledge settled (SIMULATED): $10 back to Ana, Ben, Jo, Maya and You. Sam didn't check in, so Sam's $10 went to the group fund (now $10); Sam can dispute until Sat 8:30pm."

## 5. Cancellation

- `homi cancel my pledge` **until 24h before the start** (goal: 24h before the deadline): full refund, and you're out of the pledge.
- Later: "Too late to cancel; you can dispute after if something came up."
- `homi forget` (plan deleted) and `homi stop` (everything deleted) **refund every held deposit first**, plus no-show money not yet paid out (a split or donation still in its dispute window). Group-fund money stays in the fund on `forget`.
- If the locked date moves (veto-and-swap), the pledge was for the old time: every deposit is refunded and the pledge is dropped.

## 6. Disputes

- A member who forfeited can say `homi dispute` **within 24h of the settlement**.
- Homi asks the other participants to reply `homi refund <name>` or `homi keep it` within 24h.
- The **majority decides** when everyone has voted or at the deadline. **A tie means a refund** (no votes at all is a tie). A refund from the group fund comes back out of the fund.
- While money is still disputable the plan is kept past its usual deletion (24h after the event) until the window and any vote close, then deleted as usual. `homi forget` still deletes it immediately (with refunds).

## Noise and privacy

- Pledge updates are transactional messages for a flow the participants opted into (the check-in milestone, the settlement, dispute outcomes, payouts), so they are **prompted** and never spend the 1-unprompted-per-12h budget (STATE_MACHINE.md hard rule 2).
- State: hashed member keys, amounts in integer cents, times, statuses, the ID of each participant's pledge/check-in message (IDs only, never text), payment refs, and for a goal pledge the short goal text the member gave Homi. Plan-level data is deleted with the plan; the group fund and donation tally are group settings, deleted by `homi stop`.
- `homi what do you know` lists the pledge (amount, date, destination, who pledged/checked in, the outcome, disputes) and the group fund.
- Payment memos carry no names: `Whats the Word show-up pledge Fri Oct 23: hold`.

## What is simulated

`PAYMENTS_PROVIDER=simulated` (the default) uses `SimulatedPaymentProvider`: an in-memory escrow ledger (holds per member and plan, a pool per group, idempotent by `ref`). It answers every `payment` action with `payment_result { simulated: true }`, and **every deposit, refund and forfeit message says "SIMULATED"**. No card is charged, nothing leaves the process, and no payment details are ever asked for. The ledger is lenient by default (after a restart it can't know earlier holds, so it doesn't refuse refunds); tests use `{ strict: true }`.

Any other provider id (e.g. `stripe`) gets a provider that **fails closed** (`not_configured`, `simulated: false`): Homi says it couldn't take the pledge, and nothing is held.

## What a real integration needs

Real deposits need a payment integration **and explicit authorization from each participant through the provider's secure checkout**. Card details never go through chat. With Stripe Connect (or a similar marketplace/escrow provider):

1. **Per-participant authorization:** `hold` creates a manual-capture PaymentIntent (or an escrow hold) and returns a hosted checkout / payment link for that one member; the hold exists only after they approve it there. This needs a contract change: a checkout URL (or "pending authorization" status) in `payment_result`, sent privately or as a link only that member can use.
2. **Holds and escrow:** card authorizations expire (about 7 days), so pledges further out need capture-then-refund or a true escrow product.
3. **Refunds:** cancel the uncaptured authorization, or refund a captured charge. **Forfeits:** capture into a platform or connected account that holds the group's pool.
4. **Payouts:** split shares and dispute refunds are transfers from the pool to members' connected accounts, which need **KYC/identity verification**; donations go through a vetted charity partner with receipts.
5. **Compliance review:** holding and redistributing other people's money can be **money transmission** (licensing per state/country), plus terms of service, age checks, tax reporting, refund policy and consumer-protection rules. Get legal review before enabling it.
6. **Chargebacks:** a member can dispute the card charge with their bank, which can reverse a forfeit after settlement; the pool must absorb or claw that back.
7. **Async results:** webhooks for authorization, capture, refund and payout events, mapped back to `payment_result` by `ref` (already an idempotency key).
8. **Credentials:** environment only, never logged or put in chat, e.g. `PAYMENTS_PROVIDER=stripe`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_ACCOUNT`. The slot is `src/payments/stripe.ts`.

## Commands

| Say | Does |
|---|---|
| `homi pledge $10` / `homi let's do a $10 show-up pledge` / `homi commit $20 each` | start a show-up pledge |
| `homi pledge $20 that <goal> by Dec 1` | start a goal pledge |
| `1` / `2` / `3`, ❤️ on a bubble | vote where no-show money goes |
| `homi I'm in` | pledge (hold the deposit) |
| `homi pledges` | the vote, pledge, check-in or settlement status |
| `homi I'm here` / `homi done` / `homi confirm <name>` | check in / report and confirm a goal |
| `homi cancel my pledge` | refund, until 24h before |
| `homi dispute`, `homi refund <name>`, `homi keep it` | dispute a forfeit, and vote on it |
