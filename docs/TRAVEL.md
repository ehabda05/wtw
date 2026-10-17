# Trip planning

Homi helps a group rough out a trip: where, when, how long, how many, and what it will cost per person. It is
the Act 5 story in [DEMO.md](DEMO.md). Far-off trips get **labeled estimates**: Homi never pretends a price or a
listing is real.

## Flow

The trip belongs to the group (`state.space.ext.travel`), not to a dinner plan, so it outlasts any plan. There
is one trip per group. It stays until someone says `homi forget the trip` or `homi stop`.

| Phase | What happens |
|---|---|
| start | Someone addresses Homi with a trip phrase: "homi let's plan Japan for 2030", "homi plan a trip to Lisbon", "homi trip to Japan in 2030". Homi asks **one** question that lists what's missing (DEMO step 19). If the first message already has the essentials, Homi skips the question and starts pricing. |
| collecting | Answers can come from anyone, in any order, and without "homi". A message counts if it has at least one trip detail: an origin city, a month or season, a length ("10 nights", "two weeks"), a group size ("5 of us"), a budget ("$3,000 each", "12k total") or two interests ("food, temples"). Other chatter is ignored. Unaddressed answers count for 48 hours after the last trip activity; after that, members need to address Homi. Homi asks again, listing only what's still missing, when someone addresses it with a partial answer. |
| ready | The essentials are in (destination, origin, timing, nights, group size), but a budget or interests are still missing and nobody addressed Homi. Homi waits for the group's **next message** (or reaction) so anyone still typing can add them, then prices the trip. "homi go" prices it right away. |
| searching | Homi emits two `lookup_travel` actions, one per tier (`budget`, `comfort`). The runner answers each one with a `travel_result`. |
| offered | When both results are in, Homi sends the overview card (step 21), the comfort offer with the price difference (step 22) and the savings card (step 23). For 48 hours, an unaddressed "comfortable please" or "budget is fine" picks a tier. After that, members need to address Homi. |
| saved | The chosen tier is saved (step 24). `homi trip` shows it at any time. An addressed change ("homi make it 7 nights", "homi actually 4 of us for the trip") re-prices the trip. |

Pricing starts as soon as the essentials are known and **either** Homi was addressed **or** both the budget and
the interests are in. "cherry blossoms" is read as a timing cue (late March), not an interest. That's why the
demo prices the trip after Maya's message, not Ben's.

Commands (addressed): `homi trip` (show), `homi forget the trip` (delete), `homi go` (price now),
`homi comfortable please` / `homi budget is fine` (choose). `homi what do you know` includes a single trip line,
for example `trip: Japan, late Mar 2030, 10 nights, 5 from Boston, comfort ≈ $3,620 pp (estimates), your budget
$3,000 pp, interests food/temples/onsen`. Plain `homi forget` deletes the dinner plan and keeps the trip.

## Estimated vs real

| Situation | What Homi sends | `result.estimates` |
|---|---|---|
| Departure more than about 11 months away (airlines haven't opened schedules) | Estimates, **with no external call at all** | `true` |
| `TRAVEL_PROVIDER=estimates` (the default) | Estimates | `true` |
| Live provider set, but not configured, failing, or the destination isn't in the gazetteer | Estimates (the service falls back and never throws) | `true` |
| Live provider configured and the dates are bookable | Live flights and stays with their URLs. Trains and food stay estimated and are flagged `estimate: true`. | `false` |

**The estimates provider** (`src/travel/estimates.ts`) is deterministic and pure:
- **Japan guide** (`src/travel/data/japan.ts`): an open-jaw route of Tokyo (Asakusa base), a Hakone onsen night,
  Kyoto (+ Nara) and Osaka. Flights depend on the origin region and are adjusted by month. Stays cost $45 pp/night
  on the budget tier. On the comfort tier they cost $110 pp/night in 4★ hotels, plus $310 for one ryokan night with
  dinner. Trains cost $150 in individual tickets (cheaper than a 7-day JR Pass) plus $7/day. Food and activities
  cost $70/day (budget) or $80/day (comfort). Stay prices scale with group size: solo travelers and pairs pay more
  per person. Boston, late March, 10 nights, 5 people comes to $2,670 and $3,620, the DEMO numbers.
- **Other destinations** (`src/travel/data/regions.ts`): rough regional averages (Europe, Asia, Latin America,
  Caribbean, Hawaii, US, world). Every line says "rough regional average". The itinerary is a generic two-base
  sketch.
- **Bookable dates** get a verifiable **Airbnb search** deep link with the dates and guest count, for example
  `https://www.airbnb.com/s/Tokyo--Japan/homes?checkin=2027-03-15&checkout=2027-03-25&adults=5`. It is a search,
  never a claimed listing.

## Labeling rules

- Every listing from the estimates provider is `example: true, estimate: true`.
- Every stay that describes a listing carries **"Example listing · estimated price"**. The engine adds the label if
  a provider forgets it (`render.ts`, `listingLine`).
- The overview header always says why the numbers are estimates: "Too far ahead to book, so these are estimates in
  today's prices:" or "No live prices for these dates yet, so these are …". Regional averages say "rough regional
  averages in today's prices, not real listings".
- The saved message says "all estimates" whenever `result.estimates` is true.
- A live listing counts as real (`example: false`) only if the provider says so **and** it has a URL.
- Headers are at most 2 sentences. Card lines are fragments.

## Real searches: providers and credentials

Set `TRAVEL_PROVIDER` (read in `src/config.ts`): `estimates` (default), `live` / `duffel`, or `amadeus`.
`TRAVEL_STAYS=booking|expedia` chooses the stays provider. The interfaces are in `src/travel/providers.ts`. Every
class there is a **not-configured stub** that throws `NotConfiguredError` (listing the missing env keys), and
`TravelService` then falls back to labeled estimates. No live API is called in this build.

| Need | Provider | Credentials / access | Env |
|---|---|---|---|
| Flights | **Duffel** Flights API (offer requests support multi-slice, open-jaw trips) | Duffel account and access token. Test mode tokens are available. Ticketing needs Duffel payments set up. | `DUFFEL_ACCESS_TOKEN` |
| Flights (alt) | **Amadeus Self-Service** Flight Offers Search | API key and secret (OAuth2 client credentials). Check that Self-Service still accepts new sign-ups before building on it. | `AMADEUS_CLIENT_ID`, `AMADEUS_CLIENT_SECRET` |
| Stays | **Booking.com Demand API** | Approved Booking.com affiliate partner | `BOOKING_AFFILIATE_ID`, `BOOKING_API_TOKEN` |
| Stays (alt) | **Expedia Group Rapid API** | Expedia Partner Solutions approval | `EXPEDIA_RAPID_API_KEY`, `EXPEDIA_RAPID_SHARED_SECRET` |
| Airbnb | No open public API: access is partner-only | Without partner access, use the search deep links above (already built in) | none |
| Last-minute deals | A fare-alert or price-watch feed (most are partner or approval-only), or a scheduled re-run of the flight search compared against the last price | Depends on the vendor | `FARE_ALERTS_API_KEY` |

To go live, implement `searchFlights` / `searchStays` / `lastMinute` against the vendor API. Return per-person,
whole-trip prices rounded to dollars, with a verifiable `url` per listing. The service, the labels and the fallback
already work: see the fake-provider test in `test/runner/travel.test.ts`.

## Privacy

- Homi stores only what members typed for the trip: destination, origin city, month and year, nights, group size,
  budget and interests. It also stores the estimate. It never stores message text (`test/ext/travel-privacy.test.ts`).
- The provider query (`TravelQuery`) carries **trip details only**. It never includes names, handles, phone
  numbers, member keys or chat ids. Origins come from a fixed gazetteer. Interests come from a fixed vocabulary.
  Free-text destinations are sanitized: letters only, at most 3 words, no possessives, never a member's name. They
  are also **never sent to a live provider**, because only gazetteer destinations leave the process. The tests
  `test/ext/travel-privacy.test.ts` and `test/runner/travel-runner.test.ts` check this.
- Far-future trips make no external call at all.

## Limits

- **Fare watch is lazy.** Extension timers belong to a dinner plan, and the trip has none, so Homi can't wake
  itself up later. "I'll watch fares once 2030 schedules open" means: once the dates come within about 11 months,
  `homi trip` re-prices the trip (using the live provider, if one is configured). Proactive alerts need group-level
  timers (see below).
- `TravelQuery` has a month, not a day. Live searches and deep links use the 15th as check-in.
- If the essentials are in and nobody says anything else, a "ready" trip waits until the next message or reaction
  (or `homi go`).
- English only. The vocabulary is small and rule-based (`src/engine/ext/travel/parse.ts`): known cities and
  countries, simple number words, `$` amounts.
- While a trip is collecting, an unaddressed message with trip details ("5 of us") goes to the trip, even if it
  was meant for a dinner vote.
- Estimates are rough and only move with month, origin region, nights and group size. They don't account for
  exchange rates, fare sales or availability.

## Proposed contract changes (not made; `src/engine/types.ts` is shared)

1. `TravelQuery.startDate?: string` (ISO), so live searches and deep links use the real check-in date and not the
   15th of the month.
2. Group-level extension timers: a `schedule` action without a plan, or `SpaceSettings`-scoped jobs. This would let
   Homi actually watch fares and post "fares for 2030 are on sale" without being asked.

## Files

`src/engine/ext/travel.ts` (hooks), `src/engine/ext/travel/{flow,parse,state,render,geo}.ts` (engine, pure),
`src/travel/{service,estimates,providers,links}.ts` and `src/travel/data/{japan,regions,shared}.ts` (runner side),
`src/runner/handlers/travel.ts` (lookup_travel → travel_result). Tests: `test/ext/travel*.test.ts`,
`test/runner/travel*.test.ts`.
