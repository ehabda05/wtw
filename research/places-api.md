# Places, weather, geocoding and walking time: research and recommendation

HackHarvard 2026. Researched 2026-10-16, about 21:30 to 22:30 EDT. Every claim below was checked against an official page on that date unless it appears under "Could not verify". Quotes are kept under 15 words. Nothing was signed up for.

**Privacy rule this plan is built around:** the only things that leave our server for a places lookup are a cuisine, a price band and a neighborhood string, or a coordinate we work out ourselves from that string. We never send a device location, a name or a phone number.

---

## TL;DR recommendation

| # | Decision | Pick |
|---|---|---|
| a | Live lookup | **Google Places API (New) Text Search**, with a strict field mask and a hard quota cap, but **only if one teammate is willing to attach a billing account (card)**. If no one is, skip live lookup and run on the OSM bundle alone. Never route Places content through the LLM (details below). |
| b | Offline fallback | **OpenStreetMap snapshot** pulled once from Overpass tonight and bundled as JSON under **ODbL**, with "© OpenStreetMap contributors" attribution. Evaluate `opening_hours` locally with the `opening_hours` npm package. This is also the default for Harvard Square and Allston, so the demo makes **zero** third-party calls. |
| c | Price band when the source has none | OSM has **0%** price tagging in both areas. Use a **team-curated `price_estimates.json`** keyed by OSM id, plus a fallback by amenity type, and always print it as an estimate, e.g. `~$$ (est.)`. Never copy prices from Google or Yelp. |
| d | Weather | **NWS api.weather.gov**: no key, "free to use for any purpose", User-Agent required, covers 7 days. Send only the neighborhood centroid. Beyond 7 days, reply "no forecast yet". |
| e | Geocoding | **Hardcoded gazetteer** of about 20 Boston, Cambridge and Somerville neighborhoods with team-derived centroids, plus aliases and fuzzy matching. No Nominatim at runtime. |
| f | Walking time | **Haversine x 1.3 detour / 1.3 m/s (~78 m/min)**, rounded up, shown as "~N min walk". No routing API. |

---

## 1. Comparison table

### 1a. Cost, access and what we would send

| | Google Places API (New) | Yelp Places API (Fusion) | Foursquare Places API (new, 2025+) | OSM Overpass + Nominatim |
|---|---|---|---|---|
| **Free tier (verified 2026-10-16)** | Per-SKU **monthly** free caps, which replaced the $200 credit on 2025-03-01. Text Search Pro: **5,000/mo**, then $32.00 per 1,000. **Text Search Enterprise: 1,000/mo**, then $35.00 per 1,000. Nearby Search Pro 5,000 ($32), Enterprise 1,000 ($35). Text Search Essentials (IDs only): unlimited. | **No free tier.** A 30-day trial with **5,000 calls**, "STRICTLY FOR EVALUATION AND NOT FOR COMMERCIAL DEPLOYMENT". After that, Base $229/mo (+$5.91 per 1k), Enhanced $299/mo (+$6.57 per 1k), Premium $643/mo (+$14.13 per 1k). Paid plans include 30,000 calls/mo and up to 5,000/day (FAQ). | Pro endpoints: the table lists **0-500 calls at $0.00 CPM**, then $15 CPM. The same page also says "up to 10,000 free calls on Pro endpoints", which **conflicts**. **Premium has no free tier: $18.75 CPM** from the first call. | Free. Public instances are donation-run. Overpass guidance: about 10,000 requests/day and under ~1 GB/day per user. Nominatim: **at most 1 request/second**. |
| **Card required?** | **Yes, in practice.** Maps requires a "billing-enabled Cloud project". The Google Cloud Free Trial requires "a credit card or other payment method". | Not stated on any official page (see Could not verify). Sign-up needs a "Business email". | **No.** PAYG customers are "not required to have a credit card on file". | No |
| **Key required?** | Yes (API key) | Yes (private API key) | Yes (service key bearer token, plus the `X-Places-Api-Version` header) | No key. A User-Agent or Referer identifying the app is required for Nominatim. |
| **Data sent per query (our design)** | `textQuery` such as "thai restaurant in Harvard Square, Cambridge MA", optional `priceLevels`, optional `openNow`, optional `locationBias` circle around **our** centroid. Google's own terms forbid sending end-user PII (GMP ToS 3.2.2(b)(ii)). | term, cuisine category, price, plus location string or lat/lon | `query` and/or `fsq_category_ids`, `min_price`/`max_price`, `open_now`, plus `near` (string) or `ll` (our centroid). **Pitfall:** with no location, search "defaults to IP-based geolocation" (our server's IP, not the user's, but always pass `near` or `ll`). | Overpass: a bounding circle and tag filters (sent once, at build time). Nominatim: the neighborhood string. |
| **Coverage of our need** | Best: cuisine, price, open now and coordinates in one call | Good, but legally unusable for us (see 1b) | Price and hours exist **only as Premium** fields | Cuisine and hours are partial, price is absent (see section 3) |

### 1b. Fields, caching, attribution, privacy

| | Google Places API (New) | Yelp | Foursquare | OSM |
|---|---|---|---|---|
| **Cuisine** | `places.primaryType`, `places.types` (e.g. `thai_restaurant`), **Pro** | categories | `categories`, **Pro** | `cuisine=*` tag |
| **Price** | `places.priceLevel` / `places.priceRange`, **Enterprise** | `price` | `price` (1-4), **Premium** | **none** (0 of 235 POIs) |
| **Open now** | `places.currentOpeningHours`, **Enterprise**. The request filter `openNow: true` also exists. | `is_open_now` / hours | `hours` (incl. `open_now`), **Premium** | `opening_hours=*`, evaluated locally |
| **Coords** | `places.location`, **Pro** | coordinates | `latitude`/`longitude`, **Pro** | node lat/lon or way `center` |
| **Caching / bundling** | **No bundling.** GMP ToS 3.2.3(a): no pre-fetching, indexing or storing; may not "copy and save business names, addresses". 3.2.3(b): no caching except as the Service Specific Terms allow. Places section 14.3: may cache **lat/lng only, up to 30 consecutive calendar days**. Place IDs are exempt and can be stored indefinitely (Places policies page). | **No bundling.** May not store Yelp content "longer than twenty-four (24) hours" (API Terms 5a). Business IDs only for back-end matching. No building "your own database of business listing information" (5b). | **No bundling.** EULA: no making Places Data available "in bulk" or exposing "material portions" to third parties. Usage Guidelines: non-ID data cached up to 30 days (see Could not verify). | **Yes.** ODbL permits redistribution. Share-alike applies to the derived database (see section 4). |
| **Attribution** | No map shown: show the Google logo, or the text "Google Maps" when space is limited (Roboto, 12-16sp). Third-party attributions Google returns must also be shown. Content must not be used **with a non-Google map** (SST 14.2). | Yelp logo "prominently visible", linked to Yelp. Branded stars only. Voice and non-visual apps must attribute Yelp explicitly. | "Powered by Foursquare" on any screen where Places Data appears (EULA 2.2). | "© OpenStreetMap contributors" (or "OpenStreetMap") plus an ODbL notice or link. For data in a repo: README or metadata. |
| **LLM / AI notes** | GMP ToS 3.2.3(c): "will not create content based on Google Maps Content". Google created a separate **Maps Grounding Lite API** carve-out (SST section 10) to let LLMs generate output from Maps content. Our inference: feeding Places results to our LLM to rephrase is risky. **Render Google rows with a template and keep them out of the LLM prompt.** | **Disqualifying:** API Terms 9.4 bans "Submit or ingest any Yelp Content into any Generative AI Model" (e.g. ChatGPT prompts). | EULA (last updated 2024-02-29) has no AI clause | None. ODbL applies to the data. |
| **Privacy notes** | Server-side REST from our backend, so the user's device never talks to Google. Send no PII (also a Google requirement). | Same as Google, but moot | Always pass `near`/`ll` so IP geolocation is never used | Snapshot means no runtime calls at all, which is the strongest privacy story |

---

## 2. Option notes (things that did not fit the table)

### Google Places API (New)
- **SKU is set by the highest field in the field mask.** The docs say "billed at the highest SKU applicable to your request". The field mask is mandatory: omitting it "returns an error".
- **Recommended Text Search call (Enterprise SKU, 1,000 free/month):**
  - `POST https://places.googleapis.com/v1/places:searchText`
  - Header `X-Goog-FieldMask: places.id,places.displayName,places.primaryType,places.types,places.priceLevel,places.currentOpeningHours,places.location,places.shortFormattedAddress`
  - Body: `textQuery` ("<cuisine> restaurant in <neighborhood>, <city> MA"), `locationBias.circle` (our centroid, radius ~900 m), optional `priceLevels: [...]`, optional `openNow: true`.
  - `locationRestriction` is rectangle-only on Text Search. Nearby Search requires a `locationRestriction` circle and has no Essentials tier; its lowest tier is Pro.
- **Cheaper variant (Pro SKU, 5,000 free/month), unverified:** drop `priceLevel` and `currentOpeningHours` from the mask. Instead, send the user's band as `priceLevels: [<band>]` and set `openNow: true`, so every result is open and inside the band. The docs do not tie request parameters to SKUs, but they don't explicitly confirm this either (see Could not verify).
- **Set a quota cap** in the Cloud console, e.g. 30 requests/day, so a demo loop can't spend money.
- **No caching beyond 30-day lat/lng and place IDs.** The offline bundle therefore **cannot** come from Google, and team price estimates must **not** be copied from Google results ("copy and save business names, addresses").
- **Do not mix Google rows and OSM rows in the same 3-line answer.** Mixing makes attribution ambiguous. The Places UI Kit terms (SST 15.3, a sibling section, not the Places API section) require making clear "what is Google Maps Content", and we apply the same principle here. Each answer should be all-Google (with a "Google Maps" credit) or all-OSM (with an OSM credit).
- **Doc inconsistency:** the Get Started page's summary box still mentions a "$200 monthly credit". The pricing page (updated 2026-10-15) and the March 2025 change page show the per-SKU free caps. We treat the pricing page as authoritative.

### Yelp: rejected
- There is no free tier: a 30-day, 5,000-call evaluation trial, then $229 or more per month.
- 24-hour cache limit, so no bundled snapshot.
- **API Terms 9.4 forbids putting Yelp content into any generative AI model.** Our product is an LLM chat agent. Terms last updated 2026-09-22.

### Foursquare: rejected for this use
- Open-now and price are **Premium** fields ($18.75 CPM, no free Premium allowance listed), so the free tier gives no price and no hours.
- The free Pro allowance is contradictory on the official pricing page (500 vs 10,000).
- V3 endpoints were deprecated 2026-05-15. New pricing has applied since 2026-06-01.
- **Side note:** FSQ OS Places (the open dataset; its schema page shows an Apache-2.0 notice) has names, categories, coordinates and `date_closed`, but no hours or price. We did not pursue it, because OSM already covers cuisine and hours better for our purpose.

### OSM
- **Overpass at runtime is not viable for a demo.** Our first request tonight got **HTTP 502**, with a body saying the server was "at capacity". It also said the public endpoint is "intended for browser-based and human-operated tools". The Overpass commons page says only "running your own instance sustainably serves your mission". Pull once at build time and bundle the result.
- **Nominatim policy**, operations.osmfoundation.org (no date shown):
  - absolute max 1 request/second
  - identifying User-Agent ("stock User-Agents ... will not do")
  - cache results
  - visible attribution
  - autocomplete forbidden
  - "periodic requests from apps are considered bulk geocoding" and are strongly discouraged
  - must be able to switch it off at OSMF's request without a software update
- **`opening_hours` npm package** exists and is maintained:
  - latest 3.15.0, published 2026-09-21; releases roughly every 1-3 months through 2026 (3.10.0 to 3.15.0)
  - about 60.5k downloads in the week of 2026-10-06 to 10-12
  - license **LGPL-3.0-only**, ships TypeScript types, repo github.com/opening-hours/opening_hours.js
  - Usage: `new opening_hours(str, {address:{country_code:'us', state:'MA'}}).getState(now)`.
  - Wrap it in try/catch and treat parse failures as "hours unknown". About 15 of the 125 hours strings we fetched use extended times (`27:00`), multiple ranges, or commas where semicolons are expected.
  - LGPL is fine to depend on from npm; we just should not copy its source into our code.

---

## 3. OSM coverage measurement (actually run)

**Query.** POST to `https://overpass-api.de/api/interpreter` with User-Agent `hackharvard-planner-research/0.1 (one-off coverage check)`. There were **3 POSTs in total**: the first got a 502 (at capacity), then one succeeded for each area.

```
[out:json][timeout:60];
nwr["amenity"~"^(restaurant|fast_food|cafe)$"](around:900,<lat>,<lon>);
out center tags;
```

Results (OSM data timestamp 2026-10-17T01:24Z / 01:26Z):

| Metric | Harvard Square (42.3732,-71.1189, r=900 m) | Allston (42.3529,-71.1321, r=900 m) |
|---|---|---|
| Total POIs | **87** (54 restaurant, 16 fast_food, 17 cafe; 85 nodes, 2 ways) | **148** (100 restaurant, 21 fast_food, 27 cafe; 138 nodes, 10 ways) |
| `name` | 100% | 98.0% |
| `cuisine` | **74.7%** (65) | **88.5%** (131) |
| `opening_hours` | **70.1%** (61) | **43.2%** (64) |
| `addr:street` | 67.8% (59) | 86.5% (128) |
| cuisine AND opening_hours | 64.4% (56) | 41.9% (62) |
| cuisine AND hours AND street | 51.7% (45) | 39.2% (58) |
| Restaurants only: cuisine / hours | 37/54 (68.5%) / 31/54 (57.4%) | 90/100 (90%) / 39/100 (39%) |
| Price-ish tags | **0%**. Only `internet_access:fee` (4) and `toilets:fee`/`toilets:charge` (1-2). | **0%**. Only `internet_access:fee` (3). |
| Any `check_date*` (freshness signal) | 49.4% | 26.4% |
| `website` | 62.1% | 55.4% |
| Top cuisines | coffee_shop 13, pizza 9, donut 5, sandwich/chinese/burger/japanese/american 4 each | chinese 19, coffee_shop 17, korean 14, pizza 9, bubble_tea 9, donut 8 |

**What this means:**
- Cuisine is good enough to filter on in both areas.
- Opening hours are good in Harvard Square but weak in Allston, where more than half have no hours. For those places, print "hours unknown" rather than "open now", or rank them below places confirmed open.
- Price must come from us.
- Caveats:
  - The percentages are of **OSM-mapped** POIs only. We did not measure how many real eateries OSM is missing, or how many mapped ones have closed.
  - The Allston circle also takes in parts of Brighton Ave, Commonwealth Ave and Packard's Corner.

**Raw files** (ODbL data. Each file's `osm3s.copyright` field reads "The data included in this document is from www.openstreetmap.org. The data is made available under ODbL."):
- `research/data/osm-harvard-square.json` (46,654 bytes)
- `research/data/osm-allston.json` (69,262 bytes)

---

## 4. ODbL implications of bundling in a public GitHub repo

From the OSM copyright page, the OSMF Attribution Guidelines (adopted 2021-06-25) and the OSMF Licence/Legal FAQ:
- **Attribution:** name "OpenStreetMap" and make clear the data is ODbL. "© OpenStreetMap contributors" is acceptable. For data in a repository, put the attribution and the ODbL link "in a readme file or within the data or metadata".
  - In the chat UI, also append a short credit line such as `Data © OpenStreetMap contributors (ODbL)` to any answer built from the snapshot. The guidelines want attribution visible to anyone exposed to the work.
- **Share-alike:** if we "adapt, modify, enhance, correct or extend" the data, the result is a **Derivative Database**. Publishing it is Public Use, and it "must continue to be licensed under the ODbL".
  - **Simplest compliant path:** license the bundled data files (snapshot plus our cleaned fields and price estimates) under ODbL, with a `data/LICENSE-ODbL` link and a README note.
  - Alternatively, keep `price_estimates.json` as a separate file keyed by OSM id, which may count as a "Collective Database". The FAQ points to separate guidelines for drawing that line, and we have not verified them.
- **App source code is not affected.** The FAQ's obligations concern the data, not our code license.
- **Do not mix in Google or Yelp data** (their terms forbid storing it anyway). Yelp API Terms 5g also explicitly bar using Yelp geocodes in "Open Street Maps or other open source map implementations".

---

## 5. Recommendations, with reasoning

### (a) Live lookup: Google Places API (New) Text Search, conditional
- **Why Google:** it is the only option that returns cuisine, price, open-now and coordinates in one call at **$0** for hackathon volume: 1,000 Enterprise calls/month, or 5,000 if the Pro-filter variant works.
- **Why the others lose:**
  - Yelp: no free tier, plus the AI-ingest ban.
  - Foursquare: price and hours are Premium with no free allowance.
  - Overpass: discouraged for runtime, and it was at capacity tonight.
- **Conditions:**
  - a teammate's billing account with a card
  - an API key restricted to the Places API and our server IP
  - a daily quota cap
  - the request carries only the cuisine, the price band and the neighborhood string or our centroid
  - results rendered by a deterministic template with a "Google Maps" credit, never passed through the LLM
  - only place IDs and coordinates stored, and coordinates for no more than 30 days
- **If no one will attach a card, drop live lookup.** The OSM bundle alone covers the demo neighborhoods.

### (b) Offline fallback: bundled OSM snapshot
- Re-run the two Overpass queries above once tonight (already saved) and transform them into `restaurants.json`. Fields: `osm_type/id`, `name`, `cuisine[]`, `opening_hours`, `lat`, `lon`, `addr`, `neighborhood`, `price_est`, `price_source`.
- Evaluate open-now locally with `opening_hours` in America/New_York.
- Make it the **default path for Harvard Square and Allston**, so the demo never depends on the network.

### (c) Price band strategy
- OSM has no price data here (0/235).
- Keep a team-curated `price_estimates.json` (`{"node/123": "$$"}`) filled from **team members' own knowledge or a visit to the restaurant's own menu**. Do not use Google or Yelp, whose terms forbid copying.
- Fallback heuristic by amenity type, always labeled: `fast_food` and `cafe` → `~$ (est.)`, `restaurant` → `~$$ (est.)`.
- Display it as `~$$ (est.)`. When live Google data is used, show Google's `priceLevel` without "est.".
- To match the user's budget, treat estimates as soft filters and rank exact matches first.

### (d) Weather: NWS api.weather.gov
- No key. The page says "free to use for any purpose". Required User-Agent format: `(app-name, contact)`.
- Flow: `/points/{lat},{lon}`, then the `forecast` URL, giving 12-hour periods for the next **7 days**, each with `probabilityOfPrecipitation`.
  - Verified live tonight: Harvard Square maps to grid `BOX/69,101`, and the forecast returned 14 periods through 2026-10-23.
- Send only our neighborhood centroid.
- The docs let you cache the points-to-grid mapping per neighborhood, but they also say to recheck `/points` periodically because the mapping can change.
- **Why not Open-Meteo:**
  - Its free API is "only ... for non-commercial purposes", with limits of 10k/day, 5k/hour and 600/minute, and the data is under CC-BY 4.0.
  - A hackathon project pitched as a product is ambiguous under that rule.
  - Its free-tier logs keep coordinates for 90 days.
  - Its advantage is 16 days of forecast (`forecast_days` 0-16, `daily=precipitation_probability_max`). Use it only if the team decides dates more than 7 days out matter and accepts the non-commercial terms.

### (e) Geocoding: hardcoded gazetteer
- About 20 entries with aliases. Candidates: Harvard Sq, Central Sq, Kendall/MIT, Inman Sq, Porter Sq, Davis Sq, Union Sq (Somerville), Assembly Row, Allston (Harvard Ave & Brighton Ave), Lower Allston/Barry's Corner, Brighton Center, Coolidge Corner, Kenmore/Fenway, Back Bay/Copley, Downtown Crossing, Chinatown, North End, Beacon Hill, South End, Seaport, JP Centre St.
- Derive centroids ourselves, e.g. the main intersection or T stop read off OSM. Don't take them from Google, since copying Google content is restricted.
- Unknown string: ask the user to pick from the list. Do not call out.
- **Why not Nominatim:**
  - It sends free text the user typed (which might be a home address) to a third party.
  - The policy discourages periodic app requests, requires 1 request/second and caching, and requires the ability to switch it off.
  - It adds a network failure point to the demo.

### (f) Walking time: haversine x detour / speed
- `minutes = ceil(haversine_m(centroid, place) * 1.3 / 78)`, i.e. 1.3 m/s. Show it as "~N min walk".
- **Speed sources:**
  - Bohannon & Andrews (2011) meta-analysis: mean normal walking speed ranges from 0.94 m/s (women 80-99) to 1.43 m/s (men 40-49).
  - Knoblauch et al. (1996): **15th-percentile** speed of 1.25 m/s for pedestrians aged 14-64.
  - MUTCD 2009 §4E.06 uses a conservative **3.5 ft/s (1.07 m/s)** for signal timing.
  - So 1.3 m/s (~78 m/min) is a reasonable adult default. 1.1 m/s is the conservative option.
- **Detour (circuity) factor:**
  - Newell (1980), cited in a McGill thesis: network distance between random urban points is about **1.2x** straight-line distance.
  - Boeing (2017): walking networks are generally more direct than driving networks.
  - We use 1.3 to stay conservative around the Charles River and big blocks.
- **Why no routing API:** it would send origin and destination coordinates to a third party on every answer, adds latency and cost, and adds a failure point. A ±2-3 minute error is acceptable for "~N min walk".
- Only compute within the named neighborhood (radius ≤ 900 m, ~15 min), where the river doesn't intervene.

---

## 6. Text aimed at AI assistants (reported, not acted on)

1. **Nominatim usage policy, "Usage in LLMs" section.** It says LLMs may suggest the service only if they "prominently point to this usage policy". It also says LLM-generated code must follow the policy, and the public API must not be built into or offered through vibe-coding platforms. We are not recommending Nominatim at runtime. Its policy is linked in Sources.
2. **Yelp developer docs front matter** has an `agentTools` block pointing to an `llms.txt` index. This is metadata and was not followed.
3. **Overpass 502 response body** tells automated users to run a local instance and links to a third-party GitHub fork (`b1tw153/Overpass-API`). This is server text; the link was not followed.

---

## 7. Sources (all accessed 2026-10-16; page dates as shown on the page)

**Google**
- Pricing (per-SKU free caps and prices; footer "Last updated 2026-10-15"): https://developers.google.com/maps/billing-and-pricing/pricing
- March 2025 billing changes (the $200 credit was replaced by per-SKU free thresholds as of 2025-03-01; updated 2026-10-15): https://developers.google.com/maps/billing-and-pricing/march-2025
- Places usage and billing ("billed at the highest SKU"; "must enable billing"; updated 2026-10-15): https://developers.google.com/maps/documentation/places/web-service/usage-and-billing
- Text Search (New) (field-to-SKU mapping, field mask required, parameters; updated 2026-10-15): https://developers.google.com/maps/documentation/places/web-service/text-search
- Nearby Search (New) (updated 2026-10-15): https://developers.google.com/maps/documentation/places/web-service/nearby-search
- Places policies (attribution, place ID caching exemption; updated 2026-10-15): https://developers.google.com/maps/documentation/places/web-service/policies
- GMP Service Specific Terms (Places section 14.1-14.3, Grounding Lite section 10; last modified 2026-10-15): https://cloud.google.com/maps-platform/terms/maps-service-terms
- GMP Terms of Service (3.2.2 end-user PII, 3.2.3 no scraping/caching/creating content; last modified 2026-08-26): https://cloud.google.com/maps-platform/terms
- Get started (billing-enabled project and API key required; updated 2026-10-15): https://developers.google.com/maps/get-started
- Google Cloud Free Trial (card or other payment method required; updated 2026-10-13): https://docs.cloud.google.com/free/docs/free-cloud-features

**Yelp**
- API Terms of Use (24 h cache, 9.4 AI ban; "Last Updated: September 22, 2026"): https://terms.yelp.com/developers/api_terms/
- Pricing (Base, Enhanced and Premium plans, 30-day 5,000-call trial; no date): https://business.yelp.com/data/resources/pricing/
- Places FAQ (trial for evaluation only, 30k/mo, 5k/day; no date): https://docs.developer.yelp.com/docs/places-faq
- Fusion intro (no date): https://docs.developer.yelp.com/docs/fusion-intro
- Display requirements (no date): https://terms.yelp.com/developers/display_requirements/

**Foursquare**
- Pricing (Pro and Premium CPMs, conflicting free allowance; © 2026): https://foursquare.com/pricing/
- Upcoming Places API changes (V3 deprecation 2026-05-15, pricing from 2026-06-01; page dated 2026-10-05): https://docs.foursquare.com/developer/reference/upcoming-changes
- Place Search reference (new endpoint, IP-geolocation default): https://docs.foursquare.com/fsq-developers-places/reference/place-search
- Response fields (Pro vs Premium): https://docs.foursquare.com/fsq-developers-places/reference/response-fields
- Billing (no credit card required for PAYG; updated 2026-02-12): https://docs.foursquare.com/developer/docs/manage-organization-billing
- Places API PAYG EULA ("Powered by Foursquare", no bulk; last updated 2024-02-29): https://foursquare.com/legal/terms/apilicenseagreement/
- Usage Guidelines (30-day caching; JS-rendered, read via search snippet only): https://docs.foursquare.com/docs/usage-guidelines
- FSQ OS Places schema (updated 2026-02-12): https://docs.foursquare.com/data-products/docs/places-os-data-schema

**OpenStreetMap**
- Copyright and licence (ODbL): https://www.openstreetmap.org/copyright
- OSMF Attribution Guidelines (adopted 2021-06-25; page last edited 2026-09-10): https://osmfoundation.org/wiki/Licence/Attribution_Guidelines
- OSMF Licence and Legal FAQ (Derivative Database vs Produced Work): https://osmfoundation.org/wiki/Licence/Licence_and_Legal_FAQ
- Nominatim usage policy (no date shown): https://operations.osmfoundation.org/policies/nominatim/
- Overpass API "commons" usage guidance: https://dev.overpass-api.de/overpass-doc/en/preface/commons.html
- Overpass interpreter, queried 2026-10-16 ~21:24-21:27 EDT: https://overpass-api.de/api/interpreter
- `opening_hours` npm registry metadata (latest 3.15.0, 2026-09-21): https://registry.npmjs.org/opening_hours and https://www.npmjs.com/package/opening_hours
- npm download count (60,524 in the week of 2026-10-06 to 10-12): https://api.npmjs.org/downloads/point/last-week/opening_hours
- Repo: https://github.com/opening-hours/opening_hours.js

**Weather**
- NWS API documentation: https://www.weather.gov/documentation/services-web-api
- Live check: https://api.weather.gov/points/42.3732,-71.1189 and https://api.weather.gov/gridpoints/BOX/69,101/forecast
- Open-Meteo terms (no revision date; © 2022-2026): https://open-meteo.com/en/terms
- Open-Meteo forecast docs: https://open-meteo.com/en/docs

**Walking speed and detour**
- Knoblauch, Pietrucha & Nitzburg (1996), *Field Studies of Pedestrian Walking Speed and Start-Up Time*, TRR 1538: https://trid.trb.org/View/469376
- Bohannon & Andrews (2011), *Normal walking speed: a descriptive meta-analysis*, Physiotherapy 97(3). Abstract via CSP: https://csp.org.uk/node/338279 (doi:10.1016/j.physio.2010.12.004)
- MUTCD 2009, Part 4E §4E.06 (3.5 ft/s): https://mutcd.fhwa.dot.gov/htm/2009/part4/part4e.htm
- Boeing (2017/2019), *The Morphology and Circuity of Walkable and Drivable Street Networks*: https://arxiv.org/abs/1708.00836
- McGill thesis citing Newell (1980), ~1.2 circuity: https://escholarship.mcgill.ca/downloads/hx11xk53t (secondary source)

---

## 8. Could not verify

- **Google, Pro-filter variant:**
  - Whether sending the request filters `openNow` and `priceLevels`, without the matching fields in the mask, keeps a call on the Pro SKU. The docs bill by field mask and do not tie parameters to SKUs, but say nothing explicit either way.
  - Whether the subfield mask `places.currentOpeningHours.openNow` is accepted, and how it is billed.
- **Google + LLM:** whether passing Places content through our LLM counts as "create content based on Google Maps Content". This is inferred from ToS 3.2.3(c) plus the Grounding Lite carve-out. Mitigation: use a template, not the LLM.
- **Google card:** a payment method is confirmed for the Google Cloud Free Trial. We did not confirm whether a non-trial Maps billing account can ever exist without one.
- **Google $200 credit:** the Get Started page still mentions a "$200 monthly credit", contradicting the pricing and March 2025 pages.
- **Yelp:**
  - whether the trial needs a card
  - whether a public hackathon demo counts as "commercial deployment" or "public launch"
  - the included-calls figure: 30,000/mo in the FAQ, not stated on the pricing page
- **Foursquare:**
  - the free Pro allowance (500 vs "up to 10,000") and whether it is monthly
  - the 30-day caching figure, which comes only from a search-engine snippet of the official Usage Guidelines (the page did not render for us)
  - the licence of the whole FSQ OS Places dataset (the Apache-2.0 notice appears only in the Delta Files section of the schema page)
- **Overpass:**
  - The 502 page text about "browser-based and human-operated tools" was not found on an official policy page.
  - The commons page does not specify a User-Agent requirement.
- **OSM ground truth:** how many real eateries in each circle are missing from OSM, and how many mapped ones have closed. The freshness proxy is that only 49% and 26% have a `check_date`.
- **`opening_hours`:** not installed or run. The parse success rate on our 125 hours strings was not measured.
- **ODbL:** whether a separate `price_estimates.json` keyed by OSM id qualifies as a Collective Database (the separate OSMF guideline was not read). We recommend licensing it ODbL anyway.
- **Walking speed:**
  - Only the Bohannon & Andrews abstract was read (range of strata means), not the per-age table.
  - The 1.2 circuity figure (Newell 1980) is secondhand.
  - No primary source pins the 1.3 detour factor; it is our conservative choice.
- **NWS:** exact rate limits are not published. The `/points` coordinate-precision rules were not checked.
- **Open-Meteo:** whether a free, non-monetized hackathon project counts as non-commercial (the terms list educational and non-profit examples but do not mention hackathons).
