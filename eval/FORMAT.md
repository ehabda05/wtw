# Eval fixture format

Each file in `eval/fixtures/NN-slug.json` is one role-played group chat, replayed against the engine by `eval/run.ts` on the offline `sim` surface. The fixtures were written **blind**: the author read only `docs/` (STATE_MACHINE, DATE_FINDING, HUNGRY_FLOW, PRIVACY, FEATURES), never `src/`. Labels and expectations therefore say what the **spec** promises, not what the code happens to do.

All phone numbers are fake (`555-01xx`) and all emails use `example.com`. They are there on purpose, so the log-leak counter (PRIVACY.md §7) has something to catch.

## Top level

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Same as the file name without `.json`, e.g. `"03-conflict-bridge"`. |
| `title` | string | Short human title. |
| `notes` | string | What the fixture tests, the option days Otto is expected to propose, and any timing assumptions. |
| `tz` | IANA zone | The group's time zone. Every fixture uses `America/New_York` (EDT, `-04:00`, in October 2026). |
| `start` | ISO-8601 | Absolute time of the first step. Most fixtures start Monday 2026-10-19 in the evening; the notes explain any other start. |
| `surface` | `"sim"` | The in-process simulator: option bubbles plus reactions, full roster, edits, DMs, `leave`, and a mock voice call. |
| `members` | array | 3–7 `{ "id", "name" }`. The sim roster is full, so every member is a *known* member from the first step, even one who never posts. |
| `steps` | array | The conversation, in order (below). |
| `expect` | object | Outcome checks (below). |

Each fixture is a **new chat**. Otto has never seen it, so the first step should produce the one-time intro (PRIVACY.md §1).

## Clock

- `t` on a step is a duration **relative to the current simulated clock**: the previous step's time, or the end of the previous `ff`. The first step is `"+0m"` and happens at `start`.
- Durations match `^\+?\d+(s|m|h|d)$`, e.g. `"+3m"`, `"+2h"`, `"12h"`.
- `places` and `answer` steps take no time and have no `t`.

## Step types

### Message
```json
{"t":"+3m","from":"ben","text":"fri or sat works","label":{"intent":"vote","food":false,"votes":{"thu":"unknown","fri":"yes","sat":"yes"}}}
```
A member posts `text` in the group. Every message step has a `label` (see [Labels](#labels)).

### Reaction (tapback)
```json
{"t":"+1m","from":"jo","react":{"emoji":"❤️","option":2}}
{"t":"+1m","from":"jo","react":{"emoji":"❤️","option":1,"set":"place"}}
```
- `option` is the 1-based number Otto printed on the option bubble ("2 · Fri Oct 23 · 7pm"). Bridge options that Otto adds later continue the numbering (`4`).
- `set` is optional: `"date"` (the default) targets the current **date** option bubbles; `"place"` targets the current **restaurant** option bubbles from the hungry flow. This field extends the original schema, because a fixture can have both kinds of bubble open.
- Emoji meaning (CHANNELS.md): ❤️ 👍 ‼️ = yes, 👎 = no, ❓ = maybe, 😂 = ignored.
- Reactions carry no `label`; their meaning follows from the emoji and the option.

### Fast-forward
```json
{"ff":"12h"}
```
Advance the fake clock by the duration. Every scheduler job that falls due inside the interval fires in order, and its actions run, including any `call` (answered from a queued `answer`). A trailing `ff` is allowed. It checks that nothing further fires.

### Scripted phone answer (voice mock)
```json
{"answer":{"from":"sam","text":"uh yeah friday works, saturday i'm busy"}}
```
Queue what this member will say if Otto calls them. The **next** `call` action to that member consumes it, and the harness feeds it back as a `call_result` event. It has no label. The fixture's `otherChecks` say how it should be read.

### Places marker
```json
{"places":"default"}
```
Any places lookup that the engine emits from this point on is answered from the bundled offline Harvard Sq / Allston snapshot (`PLACES_PROVIDER` unset, HUNGRY_FLOW.md §7). The marker is placed just before the message expected to trigger the lookup.

## Labels

`label` is what a careful human who has read the spec would say Otto should do with the message **in its context**: the state of the plan, whether Otto was addressed, and what is open.

### `label.intent` (required)

| Value | Use for |
|---|---|
| `plan` | Starts a plan: a mention or `/plan` with plan intent ("@otto dinner thu, fri or sat?"). |
| `vote` | An availability answer for the **date** options, including an answer to a bridge question or to a maybe confirm-ping. It is also used for a **place** vote in the hungry flow (then `placeVote` is set; see below). |
| `food` | Food intent that should start or enter the hungry flow: `otto find food`, `/food`, "@otto where should we eat", or an unaddressed strong signal while a plan is active. |
| `food_answer` | An answer to "What are we feeling? Cuisine, budget, and roughly where?": a cuisine, budget, diet, neighborhood, cuisine veto ("no sushi") or wildcard ("idc"). |
| `command` | Any other `otto …` / `/…` command: status, threshold, `lock fri`, tone, `I'm Sam`, `you can call me`, `I'm out`, note, `place: …`, `no place needed`, `go` / `just pick`, calendar, split, `what do you know`, `forget`, `stop`, `privacy`. |
| `veto` | "can't do friday anymore" from a yes voter **after** confirmation (reopens only the date). |
| `chatter` | Everything Otto should ignore. This includes text that *looks* like a vote or food talk but must not count in that context: "lol fri was wild", a quoted "friday works" after the lock, or "where are we eating" with no active plan and no mention. |

Conventions:
- A plan trigger with a future window is `plan`, not `food`, even if it says "dinner" (HUNGRY_FLOW.md §1 rule 1).
- A cuisine veto inside a food answer ("anything but sushi") is `food_answer`. `veto` is only for the date.
- `I'm out` / `count me out` is `command`, and its `votes` are all `no` (the member becomes *out*: not attending, never nudged).

### `label.food` (required)

`true` only when the message expresses real intent to go eat or to choose a place to eat **with Otto's help**, or when it answers Otto's food question or votes in its restaurant poll. Otherwise `false`. That covers idioms ("food for thought", "eating me alive", "food coma", "what's eating him"), food mentioned in passing ("i ate so much at lunch lol"), a personal errand ("brb grabbing food from the dhall"), plan triggers, and setting the place by text (`otto place: priya's apt`).

`food` is **semantic**: it does not depend on whether Otto is allowed to act. An unaddressed "i'm starving, where are we eating" with no plan is `food: true` with `intent: "chatter"`, because Otto must stay silent (silence until invited). A harness should score food-intent precision and recall on `food` and score triggering separately with `expect.hungryTriggered`.

### `label.votes` (on every message that expresses availability)

- The keys are the weekday keys (`mon`…`sun`) of **every day Otto proposes anywhere in the conversation**, including bridge options and the fresh options after a veto. Each value is `yes`, `maybe`, `no` or `unknown`. A day the message does not mention is `unknown`, including a day that has not been proposed yet.
- Values follow the reply grammar in DATE_FINDING.md §3:
  - clause splitting;
  - polarity cues;
  - `anything but X`;
  - quantifiers (`either`, `any`, `both` = all);
  - `?` right after a reference = maybe;
  - time constraints outside the option's time = `maybe`;
  - a bare `down` / `I'm in` = all yes (low confidence).
- The map records what **this message** says, not the member's merged state. A harness that wants merged state applies DATE_FINDING.md §3 rule 5 (later messages override only the options they mention).
- Granularity is per weekday. When a day has two options (a bridge adds "Sat brunch" next to "Sat 7pm"), the label applies to the weekday; the fixture notes say which option is meant.
- If the engine never proposes a day that appears in a map (for example, a different set of fresh options after a veto), the harness should ignore that key and report the option-set mismatch separately.
- The phone answer in an `answer` step is not labeled. The fixture's `otherChecks` state its expected reading.

### `label.placeVote` (optional)

The 1-based restaurant option a text message votes for in the hungry flow ("1 looks good" means `1`). It appears only with `intent: "vote"` and `food: true`, and never together with `votes`.

## `expect`

| Field | Meaning |
|---|---|
| `finalDay` | Weekday key of the date the plan ends up confirmed on, after any veto-and-swap. For an instant plan (hungry flow started with no plan) it is today's weekday. `null` when no date should be confirmed, for example after `otto forget`. |
| `lockedBy` | How the **final** date lock happened: `"deadline"`, `"everyone"` (every known member answered, at least 2), `"threshold"`, `"forced"` (`otto lock fri`), or `null` (no lock, or an instant plan, which never polls a date). |
| `place` | `null` when the hungry flow should not pick a restaurant. Otherwise `{ "cuisineAnyOf": [...], "priceMax": n }`: the chosen place's cuisine tag must be in the list, and its price band must be ≤ `priceMax`, where `$`=1, `$$`=2 and `$$$`=3 (the tightest stated budget wins). |
| `hungryTriggered` | Whether the hungry flow (`collecting_place`) should start at least once. |
| `maxUnpromptedPer12h` | Always `1`. Count group messages that are **not** prompted (STATE_MACHINE.md hard rule 2) in every half-open window `[t, t+12h)`; the maximum must not exceed this value. Prompted means one of: a direct reply within 10 minutes to a member's message or reaction; the result of an announced call; a reminder a member explicitly asked for; a stop or forget confirmation. A merged message counts once. |
| `otherChecks` | Free-text checks of anything else the spec promises in this conversation: copy, ordering, quiet hours, privacy and dump contents. A human or LLM judge scores them pass/fail against the transcript and log. |

Every fixture also contributes to the global log-leak count: no captured log line may contain message text, a phone number in any format, an email, or a handle (target **0**, PRIVACY.md §7).

## Minimal example

```json
{
  "id": "00-example",
  "title": "Tiny example",
  "notes": "Explicit days; everyone answers.",
  "tz": "America/New_York",
  "start": "2026-10-19T18:00:00-04:00",
  "surface": "sim",
  "members": [{"id":"ana","name":"Ana"},{"id":"ben","name":"Ben"},{"id":"jo","name":"Jo"}],
  "steps": [
    {"t":"+0m","from":"ana","text":"@otto dinner thu, fri or sat?","label":{"intent":"plan","food":false}},
    {"t":"+3m","from":"ben","text":"fri or sat works","label":{"intent":"vote","food":false,"votes":{"thu":"unknown","fri":"yes","sat":"yes"}}},
    {"t":"+1m","from":"jo","react":{"emoji":"❤️","option":2}},
    {"t":"+2m","from":"ana","text":"fri works for me","label":{"intent":"vote","food":false,"votes":{"thu":"unknown","fri":"yes","sat":"unknown"}}}
  ],
  "expect": {"finalDay":"fri","lockedBy":"everyone","place":null,"hungryTriggered":false,"maxUnpromptedPer12h":1,"otherChecks":[]}
}
```
