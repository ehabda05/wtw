# The hungry flow: "ok I'm starving, where are we eating?"

HackHarvard serves no dinner. Its FAQ tells hackers to explore the restaurants of Harvard Square and Allston (hhuh.io FAQ, 2026-10-16), so every hacker and judge in the room has this problem tonight.

Otto's job here:
1. ask one question,
2. merge everyone's answers fairly,
3. return exactly three good options,
4. lock the winner into the plan.

The engine logic is in `src/engine/hungry.ts` (pure). Lookups are in `src/places/`.

## 1. Trigger: precision over recall

False positives are worse than misses. A bot that jumps in on "food for thought" gets kicked.

**Signals** (lexicon in `src/engine/hungry.ts`):

| Weight | Examples |
|---|---|
| **Strong (2 points)** | "where should we eat", "where are we eating", "what should we eat", "I'm starving", "so hungry", "grab food", "grab a bite", "get food", "food?", "dinner?" or "lunch?" as a whole message |
| **Weak (1 point)** | hungry, food, eat, eating, dinner, lunch, brunch, restaurant, takeout, order in, any cuisine word |
| **Cancel (idioms)** | "food for thought", "eat my words", "eating me up", "eating me alive", "eat me alive", "what's eating", "food coma", "brain food", "food poisoning", "dog food", "eat dust" |
| **Negative (−1)** | "ate so much", "already ate", "just ate" (people who already ate aren't asking where to eat) |

**Rules:**
1. **Addressed** (mention, `otto …`, `/food`, or a reply to Otto): needs **≥ 1 point** and no cancel idiom.
   - If the message also names a future window ("dinner next week?"), it is **plan intent**, not food intent. It starts a date plan, and any cuisine word is saved as a hint for later.
2. **Not addressed:** starts the flow only if **all three** hold:
   - there is an active plan, or notice mode is on;
   - the message scores **≥ 2 points** with no idiom;
   - the local classifier (`classifier.ts`) agrees, with P(food) ≥ 0.6.
3. **Never re-trigger** while the flow is already running for this plan.

**Measured on the eval fixtures** (README): food-intent precision and recall. At least 4 fixtures have real food talk, and at least 2 have food words with no intent.

## 2. Ask, don't assume

One question:

> "What are we feeling? Cuisine, budget, and roughly where?"

If the plan already has a neighborhood, the question drops "and roughly where".

**Collect answers** until the first of these happens:
- every known active member has answered;
- someone says "just pick", "otto go" or "whatever you think";
- 10 minutes pass (job `hungry_deadline`). Food is urgent, so there are no nudges here.

## 3. Resolve taste fairly

| Input | Examples | Merge rule |
|---|---|---|
| Cuisine | "thai", "tacos" (→ mexican), "sushi", "ramen", "pho" (→ vietnamese), "pizza", "dumplings", "halal" | +1 per member per cuisine. Synonyms map to OSM-style tags. |
| Veto | "no sushi", "not thai", "anything but pizza" | Removed from the candidate cuisines, whatever its votes |
| Budget | "cheap", "broke", "$", "under 15" → **$** · "normal", "$$", "under 30" → **$$** · "treat ourselves", "fancy", "splurge" → **$$$** | **The tightest stated budget wins.** Nobody has to admit they're broke out loud. Otto says "keeping it cheap", never "because Ben said so". |
| Diet | vegetarian, vegan, halal, kosher, gluten-free, nut allergy, dairy-free, pescatarian, shellfish allergy | A hard filter where the data has the tag (OSM `diet:*`). Otherwise a soft preference, and the option line gets a short "check: nut allergy" note. |
| Where | "Harvard Square", "harvard sq", "Allston", "Central", "near Porter" | Matched against the bundled gazetteer (`src/places/geo.ts`). |
| Where (two places) | "Harvard Square" and "Allston" | **Meet in the middle:** search around the midpoint of the two centroids. The option header says "halfway between Harvard Sq and Allston". |
| Where (vague) | "near me", "here" | Otto asks once: "Which neighborhood? I never use your location." |
| Wildcard | "anything", "idc", "whatever" | Counts as answered and adds no cuisine weight |

**Split groups get a compromise, not a winner-take-all.**
- If the second cuisine has at least half the votes of the first, the 3 options are 2 from the top cuisine and 1 from the runner-up.
- The header says so: "Two said Thai, one said tacos: two Thai spots and a taco place."

**Open at the plan's time, not "now".**
- When the plan already has a date, opening hours are checked for **that** time ("open Fri 7pm").
- For an instant plan they are checked for now.
- Unknown hours are shown as "hours unknown", never as "open".

## 4. Recommend exactly three

The header is at most 2 sentences. Then one bubble per option, or a native poll on Telegram:

```
Thai, cheap, Harvard Sq: here are 3. Tap ❤️ on your pick (or reply 1, 2 or 3).
1 · Tasty Thai · Thai · $ · 4 min walk · open at 7pm
2 · Pho Basil · Vietnamese/Thai · $ · 6 min walk · open at 7pm
3 · Taco Spot · Mexican · $ · 3 min walk · hours unknown
```

**Ranking** (`hungry.rank`, pure):
- **Score:** `3·cuisineShare + 2·priceFit + 2·openAtTime + dietFit − 0.15·walkMinutes`.
- **Excluded:** places known to be closed at plan time, and places over budget.
- **Ties** go to the shorter walk.
- **Variety:** no two options share a name or brand.

**Walking time.**
- Haversine distance from the neighborhood centroid (or midpoint), × 1.3 for street detours, ÷ 78 m/min (1.3 m/s), rounded up.
- It's an estimate, labeled "min walk", and no routing API is called (that would send more data).

## 5. Vote and close the loop

**Votes:**
- tapback on an option bubble;
- "1", "2", "3", or a name;
- a Telegram poll answer.

**When the vote ends:** after 10 minutes, or as soon as a majority of members who answered have voted.

**Winner:** the most votes; ties go to rank order. With no votes at all, Otto says "Going with #1 since nobody objected 🍜".

**Closing message:**
- "{Name} it is: {address} {maps link}."
- If the plan has a future event time: "Want a reminder 30 min before? Say "otto remind me"."
- For an instant plan: no reminder offer, because the plan is now.

**Back to the plan:**
- The winner becomes `plan.place`.
- The address is posted **once**.
- The return stack pops: to `collecting_details` (then straight to `confirmed`), to `confirmed` for an instant or changed place, or to `collecting_availability` if the date is still open.

## 6. Data that leaves the server

Per PRIVACY.md §9, the places lookup receives only:
- the **cuisine tags**,
- a **price band**,
- a **coordinate we derive locally** from the neighborhood string, using a gazetteer bundled in the repo.

It never receives member names, phone numbers, device location, or the neighborhood text itself.

## 7. Offline fallback

`src/places/data/harvard-allston.json` is a bundled snapshot of Harvard Square and Allston restaurants, built from OpenStreetMap (ODbL, attribution in the file and the README). If the live lookup fails or takes longer than 3 seconds, Otto uses the snapshot and says so in `otto why`. The demo can never dead-end.

## 8. Provider choice (decision D5, from `research/places-api.md`)

| Need | Choice | Why |
|---|---|---|
| Venue data (default) | **Bundled OpenStreetMap snapshot** for Harvard Square and Allston, plus any other areas we pre-build | No runtime third-party call at all. ODbL allows bundling with attribution. Measured coverage: 87 places near Harvard Sq and 148 near Allston, with cuisine tagged on 75% and 89% |
| Live lookup (optional) | Google Places (New) Text Search, `PLACES_PROVIDER=google` | Only if a teammate attaches billing and sets a daily cap. Price and open-now are Enterprise fields (1,000 free calls a month). Google results may **not** be cached, so they never feed the offline file. |
| Rejected | Yelp | Its API terms ban putting Yelp content into generative AI, and it has no free tier |
| Rejected | Foursquare | Price and hours are Premium-only, with no free allowance |
| Price band | Team estimate shown as **"~$ (est.)"** | OSM has no price data (0% coverage). Fast food and cafés default to $; others use a hand-checked override list, or `$$ (est.)`. |
| Opening hours | `opening_hours` npm package, evaluated locally at plan time | 70% of Harvard Sq places and 43% of Allston places have hours; the rest show "hours unknown" |
| Weather | US National Weather Service `api.weather.gov` | No key, free. Receives only a rounded coordinate. |
| Geocoding | Bundled gazetteer of ~20 Boston/Cambridge/Somerville neighborhoods | The neighborhood string never leaves the server |
| Walking time | Haversine × 1.3 ÷ 78 m/min (1.3 m/s) | No routing API |

Attribution "© OpenStreetMap contributors (ODbL)" appears in the README, in the data file header, and in `otto why`.
