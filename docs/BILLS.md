# Bill splitting and the group tab

After the meal, Homi splits the bill and keeps a small group tab, so "who owes whom" takes one message. This is Act 3 of [DEMO.md](DEMO.md) (steps 11 to 13). Every number in the demo comes out of this code exactly and is pinned by tests.

**Status:** the engine side is complete and tested (pure, no I/O). It is pure arithmetic, so nothing external is needed. **No payment is ever made:** Homi only does the math and keeps the tab. People pay each other however they like.

Code: `src/engine/ext/bills.ts` (the extension hooks) and `src/engine/ext/bills/`:
- `money.ts`: cents, percentages, largest-remainder rounding
- `split.ts`: the equal, custom and itemized math
- `ledger.ts`: the tab, balances, settle-up
- `parse.ts`, `itemize.ts`, `extras.ts`, `names.ts`: the grammar
- `copy.ts`: every message

Tests: `test/ext/bills.math.test.ts`, `test/ext/bills.parse.test.ts`, `test/ext/bills.engine.test.ts`.

## Commands

Homi only listens to bill commands that are addressed to it ("homi …", @homi, `/split`). Bill-shaped messages that aren't addressed are ignored.

| Say | What happens |
|---|---|
| `homi split 86.40 4 ways` | Equal split, to the cent: "$86.40 split 4 ways: $21.60 each." |
| `homi split 86.40 + 18% tip 4 ways` | Adds the tip first: "$101.95 split 4 ways ($86.40 + 18% tip $15.55): 3 pay $25.49, 1 pays $25.48." |
| `homi split 120` | With no count given, Homi uses the yes votes on the chosen date (or the people still in). If it doesn't know, it asks "How many ways?". |
| `homi split 120 between ana ben jo` | Named equal split. Other forms: "split 120 for ana ben jo" and "split uber 23.40 ana jo you". |
| `homi split 120 between ana ben jo, paid by ana` | The same, and it goes **on the tab** because the payer is known. |
| `homi jo paid 23.40 for the uber, split ana jo you` | Payer first. "for the uber" becomes the label "Uber" (DEMO step 12). |
| `homi split 60 custom: ana 25, ben 20, jo rest` | Custom split by amount. You can also use percentages ("ana 50%, ben 30%, jo rest") or mix the two. Whoever says "rest" shares what's left equally. "split 60 between ana ben jo: ana 25, ben 20, jo rest" works too. |
| `homi itemize dinner, paid by ben: ana shio ramen 16.50; ben spicy miso ramen 17.50 + gyoza 8; …; shared edamame 6 + karaage 10; tax 7%; tip 20%` | Itemized split (DEMO step 11). See "Itemized syntax" below. |
| `homi settle up` / `homi who owes who` | The fewest obvious transfers to make everyone even (DEMO step 13). |
| `homi tab` | Lists the expenses on the tab (the latest 10). |
| `homi undo` | Removes the last expense from the tab. A bare `homi undo` with an empty tab is left for other features. |
| `homi clear the tab` | Deletes the whole tab. |
| `homi stop` | Deletes everything for the chat, the tab included. |

`homi forget` deletes the plan only. The tab stays until "homi clear the tab" or "homi stop" (DEMO step 26).

### Receipt photos

Reply to a receipt photo (or ask within ten minutes) with `homi split the bill`. The configured hosted reader extracts the grand total, currency, visible items and printed charges; Homi refuses unsupported currencies and totals whose printed arithmetic is inconsistent. It equal-splits the validated USD grand total using the human roster/headcount when available, and asks for a count when membership is not reliable. Item-by-item claiming is not yet wired into the bill flow.

### Extras: tip, tax, service and fees

You can write extras as a percent or a fixed amount, inline (`+ 18% tip`, `tip 20%`) or as an itemized segment (`tax 7%`):

- `tip 20%`, `18% tip`, `tip 22`, `gratuity 18%`
- `tax 7%`, `tax 8.875%`, `tax 7.81`. VAT, GST and HST also count as tax.
- `service 18%`, `service charge 18%`
- `fee 3.50 delivery`, `+ 3.50 delivery fee`, `card fee 2`

How each extra is calculated:
- **Tax, service and fees** apply to the pre-tax subtotal.
- **Tip** also defaults to the **pre-tax subtotal**.
- `tip 20% on total` (also "after tax") tips on the subtotal plus tax. It does not include service charges or fees.
- Each percentage rounds **half-up to the cent**: 7% of $111.50 is $7.805, which becomes $7.81.

### Itemized syntax

After `homi itemize [label][, paid by X]:`, list segments separated by `;` or new lines:

- `ana shio ramen 16.50`: a person, then their items. Separate items with `+` or `,`. The **last** number in an item is its price, so "2 tacos 9" costs $9. Add `x2` to multiply ("ramen 8 x2"). Item names are read for the price only and are never stored.
- `shared edamame 6 + karaage 10`: split equally among **everyone on the bill**.
- To share among only some people, name them: `shared by ana ben: nachos 12`, `shared nachos 12 by ana and ben` or `shared by ana and ben nachos 12`.
- `tax 7%`, `tip 20%`, `service 18%`, `fee 3.50 delivery`
- `paid by ben`, which you can also put in the header

### Names

- **Names are free-text labels** as typed. Matching ignores case, and names are displayed capitalized ("ANA" and "ana" are both Ana). In the simulator, "you" is an ordinary name.
- **"me" and "I"** mean the sender. Homi uses the name it already has for the sender: their name on the plan, or else the display name the platform provides (first word). If it has neither, it asks: *I don't know your name yet, so use names instead of "me" (like "paid by ana").*
- **What goes on the tab.** A split goes on the tab only when it names everyone and says who paid. Otherwise Homi does the math and adds one sentence explaining how to put it on the tab.

## Allocation and rounding

All money is **integer cents**. Floats are never used for money.

1. **Exact subtotals.** Each person's exact subtotal is their own items plus an equal part of each shared item. Shared parts are kept as exact fractions over a common denominator: the lcm of the sharer counts, held as BigInt numerators. This means a $10 item split three ways stays at exactly 333⅓¢ each until the end.
2. **Extras.** The extras are computed in cents as described above. The total is the subtotal plus the extras.
3. **Proportional shares.** Each person's exact share is their subtotal × total ÷ subtotal. In other words, tax, tip, service and fees are shared in proportion to each person's subtotal.
4. **Largest remainder, once.** Everyone gets the floor of their exact share. The leftover cents then go one at a time to the largest remainders. Ties go to the larger subtotal, then to the name that sorts first. The shares therefore **always add up to the total exactly**.
5. **Equal splits.** Equal splits use the same rule, with equal weights: $101.95 ÷ 4 → $25.49, $25.49, $25.49, $25.48.
6. **Custom splits.** Fixed amounts and percentages of the base become the weights, and "rest" shares the remainder. Extras follow those weights. Homi refuses parts that don't add up, and says by how much.

Worked example (DEMO step 11): the subtotal is $111.50, tax is $7.81, the tip is $22.30 and the total is $141.61. The exact shares (×141.61/111.50) are:
- Ana 25.0199…
- Ben 36.4503…
- Jo 30.7351…
- Maya 24.3849…
- You 25.0199…

The floors add up to $141.58. The 3 leftover cents go to the three largest remainders: Ana and You (0.99) and Jo (0.51). The result is **Ana 25.02 · Ben 36.45 · Jo 30.74 · Maya 24.38 · You 25.02**, which adds up to $141.61.

### Settle up

1. **Balances.** Each person's balance is what they paid minus what they owe, summed over the tab.
2. **Greedy matching.** Homi repeatedly takes the largest debtor and the largest creditor (ties go to name order) and transfers the smaller of the two amounts. It stops when everyone is even.
3. **Result.** This gives at most *people − 1* transfers, in integer cents, netting exactly to zero. In DEMO step 13, Ana, You, Maya and Jo each pay Ben: $32.82 + $32.82 + $24.38 + $15.14 = $105.16.

## Copy

Every message follows the two-sentence rule. A card has three parts:
- a header ending in ":"
- short fragment lines, at most five names per line
- a one-sentence footer, plus at most one hint sentence

These are DEMO steps 11 to 13 exactly:

```
Dinner $141.61 (tax $7.81 + 20% tip $22.30), paid by Ben:
Ana $25.02 · Ben $36.45 · Jo $30.74 · Maya $24.38 · You $25.02
Adds up to $141.61 exactly.

Uber $23.40 paid by Jo: $7.80 each for Ana, Jo and You.

Here's who pays whom (2 expenses, $165.01):
Ana → Ben $32.82
You → Ben $32.82
Maya → Ben $24.38
Jo → Ben $15.14
Then everyone's even.
```

## What is stored, and when it is deleted

**Where.** The tab lives in `state.space.ext.bills`, which is group-level data sealed with the space settings (`SpaceSettings.ext`).

**What each expense keeps:**
- the label (for example "Dinner")
- the payer's name
- the total in cents
- each participant's name and cents
- the split kind
- `createdAt`

**What is never kept:**
- item names
- the itemized lines
- tip and tax percentages
- message text and message ids

Members explicitly hand Homi this data for this purpose (see PRIVACY.md §2: data members explicitly give Homi).

**Limits.** A tab holds at most 100 expenses, and a bill is limited to 50 people and $100,000.

**When it is deleted.** The tab is **not** tied to the plan's 24-hour retention. It stays until:
- `homi clear the tab` (or `homi undo` on the last expense), or
- `homi stop`, which calls `onStop` and deletes it with everything else.

`homi forget` leaves it alone.

**`homi what do you know`** shows it in one line, for example:
`bill tab: 2 expenses, $165.01 (Dinner paid by Ben, Uber paid by Jo), Ben is owed $105.16`

## What the real app still needs

- **Nothing external for the math.** It is pure and deterministic, and it runs the same in the sim, Telegram and iMessage.
- **Payment-app links (optional, not implemented).** Venmo, Cash App or PayPal deep links next to each settle-up line would be a runner-side rendering choice: build the link from the handles members choose to share, never from phone numbers. Bills never initiates, holds or verifies a payment, and nothing in this feature moves money. (The show-up pledge in docs/COMMITMENTS.md is the only feature with a payment action, and it is SIMULATED.)
- **Currency.** Amounts are USD and are displayed as "$1,234.56". Other currencies would need a currency on the tab and a formatter. The math is currency-agnostic.
