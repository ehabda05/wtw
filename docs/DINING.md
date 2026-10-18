# Dining mode (the demo)

`HOMI_MODE=dining` is the default whenever `ANTHROPIC_API_KEY` is set. It replaces the rule-based planning engine with one Claude agent that reads the whole chat, remembers everything, and is optimized for one thing: getting a group to dinner and settling the bill. It works on every chat surface the repo has (iMessage through Photon, Telegram, the CLI sim), because it sits behind the same adapter interface.

Code: `src/dining/` (four files, no state machine):

| File | What it does |
|---|---|
| `agent.ts` | The system prompt and one Claude call per batch of messages, with tools: `web_search` (Anthropic server tool, restaurant lookups), `split_bill` (exact math), `save_notes` (its own memory), `react`, `follow_up_in`, `stay_silent`. |
| `memory.ts` | Plaintext SQLite (`./data/homi-dining.db`): the full transcript per chat, the last 5 photos (receipts), the agent's notes, follow-up timers. |
| `runner.ts` | Adapters → memory → agent → reply. Batches bursts of messages (1.5 s quiet window, 0.4 s when addressed or a photo arrives), one run per chat at a time, posts the reply, applies reactions and timers. |
| `boot.ts` / `cli.ts` | Boot for `npm start` and the `npm run dining` simulator. |

## What it does in the chat

- **Silence first.** Every group message is remembered, but Homi is only consulted when it was addressed, a photo arrived, it has an open question, it spoke in the last 4 minutes (people are answering it), or the message is about food, plans, places or money (a keyword gate in `runner.ts`). Reactions to other people's messages are ignored. When it is consulted, the model still defaults to staying quiet: banter gets silence, "2 looks good" gets a 👍, "homi find us a spot" gets three options.
- **Plans with nudges, not forms.** "Friday 7:30? 👍 if in" instead of "what day works for everyone". One question at a time. When the plan is set it posts one clear line with every detail.
- **Recommends real places** with Claude's web search, three compact options with neighborhood, price, why it fits this group (diets, budget, vibe), and a Google Maps link. Default area is `HOMI_CITY` (Cambridge, Massachusetts).
- **Reads receipts.** Send a photo of the bill: it lists the items back, works out who had what from the conversation ("sam had the veggie ramen, beers were me and jo, rest shared"), asks one question only for items it cannot place, then calls `split_bill`. Tax and tip are split in proportion to what each person ordered; shares always add up to the total to the cent. Corrections ("the ice cream was just me") redo the split.
- **Quorum by DM.** A plan is not decided until everyone in the chat answered. After 30 seconds Homi privately messages whoever is silent ("the group's doing Santouka Fri 7:30, are you in?"); their DM reply counts as their vote in the group. Two minutes later the still-silent count as not coming and it proceeds with the rest.
- **A running account.** Every split with a payer and every "I paid ben back" goes into a netted ledger: if Ben owed Jo $20 and Jo now owes Ben $25, the balance is Jo owes Ben $5. "homi settle up" answers from it, one line per pair. Corrections to a bill replace that bill's entries.
- **Accountability pledge.** Say "let's do a $10 pledge" (or "flakers buy dessert") before the plan locks. Everyone who says they're in has committed; whoever cancels late or doesn't show owes the pledge, split among the people who came, and it goes into the same who-owes-whom ledger. Homi checks in about 30 minutes after the start time to see who made it. "homi who flaked" answers from memory. No money moves; it is friends keeping friends honest.
- **Remembers.** Who's in, who's vegetarian, who paid, who owes whom, what was decided. "homi what do I owe" is answered from memory. "homi forget everything" wipes the chat's memory.

## Run it

```bash
npm run dining
```

A fake group chat with the real agent: `ana: dinner this week?`, `/photo ben C:\path\receipt.jpg homi split this`, `/react jo 👍`, `/notes`.

```bash
npm run dining:seed
```

Plants a "last week" dinner (a bill, the debts, a note) into the most recently active chat in the live memory, so "homi what do I owe from last time" has an answer on stage. Run it after the group has sent at least one message.

```bash
npm start
```

With `SURFACES=imessage` (Photon dedicated line, see [CHANNELS.md](CHANNELS.md)) or `telegram-direct`. The boot line says `homi started (dining mode)`.

Settings (`.env`): `HOMI_DINING_MODEL` (default `claude-haiku-5-5` at low effort, the fastest; `claude-sonnet-5-5` or `claude-opus-5-5` are smarter but slower), `HOMI_CITY`, `HOMI_NAME`, `HOMI_DINING_DB`. `HOMI_MODE=legacy` brings the old engine back.

## Worked example (real run, `npm run dining`)

Ben posts the receipt with "homi split this, i paid. sam had the veggie ramen, ana shio, jo spicy miso, i had tonkotsu. beers were me and jo, everything else shared":

> I see: shio 16.50, spicy miso 17.50, tonkotsu 18, veggie ramen 15.50, gyoza x2 16, edamame 6, karaage 10, Sapporo x2 14, matcha ice cream 6.50. Subtotal $120.00, plus $8.40 tax and $24.00 tip, for a total of $152.40 ✅
>
> Ben paid, so:
> Ana pays Ben $33.18
> Sam pays Ben $31.91
> Jo pays Ben $43.34
> (Ben's own share is $43.97)
>
> Tax and tip are split by what each person ordered. The karaage is chicken, but I split it 4 ways like you said. Tell me if Sam should be taken off it and I'll redo the split 🌱

Jo: "wait the ice cream was just me" → the split is redone, and later "homi what do i owe and to who" → "Sam, you owe Ben $29.84".
