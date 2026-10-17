# Why Fenn pivoted from friend groups to couples, and what it means for Otto

Researched 2026-10-16 (about 10 PM EDT) for HackHarvard 2026. Public sources only: no logins, no accounts, no Bookface. Builds on `research/fenn-concepts.md` (not edited). Quotes are kept short and linked.

**Tags**
- **VERIFIED (live):** read on the live page or original document on 2026-10-16.
- **VERIFIED (index):** seen only as a web-search excerpt. The page itself did not render for us (x.com returns HTTP 402, the xcancel mirror returns HTTP 451). Weaker than a live read.
- **INFERRED:** our reasoning. No source states it.

## TL;DR
1. **No direct evidence.** We found no founder or company statement explaining why Fenn moved from friend groups to couples, on X, Threads, LinkedIn, Substack, Launch YC, Hacker News, Product Hunt, podcasts or App Store replies.
2. **Best-supported inferred reason: the atomic network shrank from about 8 people to 2.** The group product needed every member to install an iOS-only app. A couple needs one other install. The group-planning tools that did scale (Partiful, Doodle, Apple Invites) all let guests take part without installing anything.
3. **Second reason: a natural payer.** Fenn now sells one $14.99/month subscription covering both partners. A YC couples app (Candle) reported over $150K in monthly revenue and a DAU/MAU near 50% within about 6 months. Both founders' past employer, Life360, sells a single membership per household "Circle". Friend groups have no obvious payer.
4. **Third reason: frequency.** Couples coordinate daily: pickups, groceries, schedules. That is what Fenn's earliest reviews describe. Friend plans are episodic: only 43% of Americans see friends in person at least weekly.
5. **For Otto:** living inside the existing chat removes install friction and the iOS-only lock-in. It does **not** solve monetization, episodic usage, platform risk, or commoditization by native polls. The top direct competitor is **Continua** (GV-backed bot that already sits in SMS, iMessage and Discord groups). The biggest long-term risk is that **platform-native tools** (iOS 26 Messages polls with Apple Intelligence suggestions, WhatsApp polls and events, Meta AI in WhatsApp groups) absorb the "find a date" step.

---

## 1. Direct evidence of why they pivoted

**Verdict: none found.** Nothing public from Charly Delaroche, Marc McCole or Fenn says why they left friend-group plans for couples.

**Closest signals (none of them states a reason)**

| Signal | Tag | Source |
|---|---|---|
| Delaroche's X post (Sep 23) says Fenn's immersive 3D onboarding is "performing surprisingly well" and links the couples App Store listing. This is evidence that the couples funnel converts, not a stated reason for the pivot. | VERIFIED (index) | https://x.com/nal_uh |
| McCole's X bio: "building multi player AI with Fenn (YC F26)", plus four kids. A Sep 20 post says couples create a place together in the new onboarding. | VERIFIED (index) | https://x.com/thisboy |
| McCole's Substack "Notes on Fenn" has a byline, "co-founder of fenn and father of four", and no posts. | VERIFIED (live) | https://fennai.substack.com/ |
| The earliest App Store reviews (Jun 1–3, under the group-era listing) describe a marriage and family schedule, coordinating with "people in their life", and finding a daughter's pickup code. None mention friend groups. | VERIFIED (live) | https://apps.apple.com/us/app/fenn-life-organizer/id6761315757?see-all=reviews&platform=iphone |
| Frontrun flagged Fenn on Aug 21 with the group-plans pitch. The App Store version notes from v1.41 (Sep 14) onward are all about couples. So the switch happened roughly between Aug 21 and Sep 14, 2026. | VERIFIED (live) | https://www.frontrun.vc/blog/yc-f26-companies-full-list ; App Store listing above |
| The paywall (Fenn Couple $14.99/mo, $99.99/yr, 14-day trial) appears only in v1.63–1.66 (about Oct 11–16). The FAQ still says Fenn is free for both partners. Monetization arrived after the pivot, so it may be a consequence rather than the trigger. | VERIFIED (live) | App Store listing above; https://fenn.chat/fair-questions |

**What we searched**
- **X:** web-search snippets for `nal_uh` and `thisboy` combined with Fenn, couples, pivot, onboarding and partner. x.com does not render, and the xcancel.com mirror returned HTTP 451.
- **Threads:** a site-restricted search. Nothing relevant was indexed.
- **LinkedIn:** search only. One "Charly Delaroche – Stealth Startup" profile surfaced, which we did not open (login wall). McCole's LinkedIn showed only an unrelated 2024 post.
- **YC:** "Launch YC" Fenn returned nothing. `/companies/fenn` and `/companies/fenn-ai` returned 404 in prior research. Bookface was not attempted.
- **Hacker News:** a site search returned nothing.
- **Product Hunt:** only an unrelated "Fenn" (a Mac file-search app).
- **Podcasts and interviews:** nothing found.
- **TikTok and Instagram:** no Fenn account found through search.
- **App Store:** reviews checked; no developer replies.
- **Substack:** no posts.
- **Reddit:** nothing found.
- **Press:** none for this Fenn.

---

## 2. Ranked inferred reasons, with evidence

Ranked by how much independent, verifiable evidence supports each reason. **Every reason below is INFERRED.** The supporting facts carry their own tags.

### Rank 1 (strongest). The atomic network shrank from about 8 iPhone owners to 2

**Logic (INFERRED).** In the group era, every member of a group had to install Fenn and join its chat. Testimonials cited groups of 8 and 9. A single Android user or holdout breaks the plan. A couple is the smallest possible network, and both people are already motivated.

**Supporting facts**
- **VERIFIED (live).** Fenn runs only on iOS: "Fenn's app is currently available on iOS." The getting-started flow is to download the app and invite your partner. https://fenn.chat/fair-questions
- **VERIFIED (index).** Group-era testimonials described 8- and 9-person groups (askfenn.to, in `fenn-concepts.md`). Fenn's own Terms call it "an AI-assisted group chat", meaning a separate app rather than a bot in iMessage. https://fenn.chat/l
- **VERIFIED (live).** Andrew Chen defines the atomic network as "the smallest network needed that can stand on its own" (book excerpt, Lenny's Newsletter, 2021-12-09). https://www.lennysnewsletter.com/p/atomic-network
  - In an interview he put the minimum at "two to three people" for Zoom and "five to 10 people" for Slack (Food On Demand, 2022-01-06). https://foodondemand.com/01062022/andrew-chen-examines-the-cold-start-problem-for-platforms-like-uber-snackpass/
  - INFERRED: a couples app has a Zoom-sized atomic network. A friend-group planner sits in Slack territory or above.
- **VERIFIED (live).** Howbout, a friends' social calendar with $8M Series A and over 4M registered users, lets non-users see an invite, but to respond they "have to download the app". https://techcrunch.com/2024/09/13/howbout-raises-8m-from-goodwater-to-build-a-calendar-that-you-can-share-with-your-friends
- **VERIFIED (live).** The planning products that reached scale do not require guests to install anything:
  - **Partiful:** "Invite anyone with a link — guests don't need the app!" One link works for Apple and non-Apple users. The listing shows 271K ratings. https://apps.apple.com/us/app/partiful-party-invite-maker/id1662982304
  - **Apple Invites:** iCloud+ subscribers create invitations, and anyone can RSVP without an Apple Account or Apple device. https://www.businesswire.com/news/home/20250203932522/en/Introducing-Apple-Invites-a-new-app-that-brings-people-together-for-life%E2%80%99s-special-moments
  - **Doodle:** participants do not need an account to vote. https://help.doodle.com/en/articles/8393821-do-i-need-a-doodle-account-to-participate-in-a-group-poll
- **Counter-signal, VERIFIED (live).** Text.ai, a YC company, first shipped an AI that lived inside group chats ("No new apps to download, no learning curve, just text and go."). It then launched Alfi as a standalone chat app on iOS and Android. https://www.ycombinator.com/launches/NP6-text-ai-ai-in-your-group-chats ; https://www.ycombinator.com/launches/PHB-alfi-your-group-chat-with-social-skills
  - Its stated reason was that users wanted something more social. It did not cite install friction.
  - INFERRED: a team that already had zero-install distribution still chose its own app. That points to limits in the in-chat form (UI, persistence, monetization) that Otto inherits. See section 3.

### Rank 2. Couples have a natural payer and proven willingness to pay

**Logic (INFERRED).** A household is one payer with recurring value. In a friend group, nobody owns the bill, and free-riding is the default.

**Supporting facts**
- **VERIFIED (live).** Fenn Couple costs $14.99 a month or $99.99 a year. One subscription covers both partners, with a 14-day trial. https://apps.apple.com/us/app/fenn-life-organizer/id6761315757
- **VERIFIED (live).** Candle (YC), a daily-prompts app for couples and close friends, reported after about 6 months:
  - 300K users, including 150K couples;
  - monthly revenue above $150K;
  - a DAU/MAU ratio around 50%.

  Its founders tested more than 10 ideas before landing on relationships (TechCrunch, 2025-09-24). https://techcrunch.com/2025/09/24/these-yc-founders-pivoted-5-times-before-building-a-social-app-that-nabbed-300k-users-and-over-1m-arr-in-6-months/
- **Founder DNA. VERIFIED (index).**
  - Delaroche's bio lists Life360 (https://x.com/nal_uh). A ZoomInfo listing shows McCole as a Life360 product director, which may be stale (https://www.zoominfo.com/p/Marc-Mccole/3868305862).
  - Life360 sells memberships per household "Circle". Its FAQ says plans cover all the family members in your Circle (https://www.life360.com/?p=36520).
  - Life360 reported 2.8M Paying Circles and $489.5M in revenue for 2025 (Q4 2025 release, seen as a search excerpt; the page returned HTTP 403). https://investors.life360.com/news-releases/news-release-details/life360-reports-record-q4-2025-results
  - INFERRED: Fenn's "one subscription covers both partners" copies that household-unit model.
- **Weak, analyst report only.** Partiful keeps core invites free and monetizes add-ons. https://sacra.com/research/partiful
- **Caveat (VERIFIED, timing).** The paywall shipped about a month after the pivot (section 1). So this reason may describe why couples are a good business, rather than what triggered the switch.

### Rank 3. Usage frequency: couples coordinate daily, friend groups occasionally

**Logic (INFERRED).** A planning agent for friends is used only when a hangout is being organized, perhaps a few times a month. That gives a weak habit loop, so push opt-ins and app-open frequency decay. A couple's logistics, such as pickups, groceries and calendars, recur daily. That is the "life organizer" Fenn now sells.

**Supporting facts**
- **VERIFIED (live).** Fenn's earliest reviews are about daily family logistics (a family schedule, a school pickup code), not hangouts. https://apps.apple.com/us/app/fenn-life-organizer/id6761315757?see-all=reviews&platform=iphone
- **VERIFIED (live).** In an American Communities Project and Ipsos survey of 5,312 people, 43% said they spend time with friends in person at least weekly (2024-11-26). INFERRED: most people do not, which caps how often a friend-plan tool is needed. https://www.americancommunities.org/americans-feelings-and-behaviors-highlight-connection-and-its-limits/
- **VERIFIED (live).** In the Harris Poll Gen Z Weekend Report (fielded May 28–Jun 6, 2026; 603 Gen Z adults within 4,100 U.S. adults):
  - 74% of Gen Z stay in at least half their weekends;
  - 62% agree they avoid making weekend plans to avoid financial regret.

  https://theharrispoll.com/wp-content/uploads/2026/07/The-Gen-Z-Weekend-Report-July-2026.pdf
- **VERIFIED (live).** Candle's DAU/MAU of about 50% is a couples daily-habit benchmark (TechCrunch link in Rank 2).

### Rank 4. Fenn's core features (location, calendars) fit partners better than friend groups

**Logic (INFERRED).** Fenn's strengths come from its Zenly and Life360 roots: background location, ETAs, presence, battery levels and calendar reading (`fenn-concepts.md`, Q2 and Q7). People share these readily with a partner and reluctantly with a group of eight.

**Supporting facts**
- **VERIFIED (live).** Thayer, Bietz, Derthick and Lee, CSCW 2012. This was a qualitative study of 30 Google Calendar users who share calendars, interviewed in 2009.
  - 73% (22 of 30) shared a calendar with a significant other;
  - 33% shared with a friend;
  - 17% shared with groups of associates.

  The authors frame calendar sharing as "relationship work". The sample is small and selected for people who share. https://depts.washington.edu/csclab/wordpress/wp-content/uploads/Thayer-Derthick-Bietz-Lee-2012.pdf
- **VERIFIED (live).** Tungare, Pérez-Quiñones and Sams: half of their 98 survey respondents (faculty, staff and students) coordinate calendars with spouses, roommates or family. https://arxiv.org/pdf/0809.3447
- **Counterpoint, VERIFIED (index).** Location sharing among friends can work. Amo's Bump, built by the Zenly team, is described as staying connected with friends through real-time location sharing. https://play.google.com/store/apps/details?id=co.amo.android.location&hl=en_GB
  - INFERRED: so this is a fit argument, not proof.

### Rank 5. Founder and early-user pull toward family life

**Logic (INFERRED, low to medium).** A co-founder who is a "father of four" and early reviewers who are married parents both point toward household logistics. Delaroche said publicly that the couples onboarding performed well.

**Supporting facts:** Substack byline (VERIFIED, live); X bio and posts (VERIFIED, index); early reviews (VERIFIED, live). All are linked in section 1.

### Rank 6 (weakest). Group planning got crowded and commoditized

**Logic (INFERRED, speculative as a cause).** Between mid-2024 and 2026, the platforms shipped in-thread planning features and well-funded startups crowded in. Couples organizers face less direct pressure from Apple, Meta and OpenAI.

**Supporting facts**
- **VERIFIED.** iOS 26 polls in Messages, with Apple Intelligence suggesting polls (Apple, 2025-06-09).
- **VERIFIED.** WhatsApp events in groups (June 2024).
- **VERIFIED.** ChatGPT group chats (2025-11-20).
- **VERIFIED.** Continua's $8M seed (2025-08-12).
- **VERIFIED.** Alfi (Text.ai, YC P25).

All URLs are in section 4.

### Context that is *not* good evidence
- **IRL shut down in June 2023** after its board found that 95% of its reported 20M users were automated or bots (TechCrunch, 2023-06-26). That was a fraud and metrics failure, not a cold start, so do not cite it as cold-start evidence. https://techcrunch.com/2023/06/26/irl-shut-down-fake-users/
- **Houseparty:** Epic announced on 2021-09-09 that it would shut the service in October 2021. Coverage ties this to Epic refocusing its team, not to cold start. https://en.wikipedia.org/wiki/Houseparty_(app)
- Both cases show that consumer social apps are fragile. Neither tells us why Fenn pivoted.

---

## 3. What Fenn's pivot means for an in-chat group agent like Otto

| Problem that pushed Fenn toward couples | Does Otto escape it? | How Otto should answer it (judges will ask) |
|---|---|---|
| **Everyone must install an iOS-only app (cold start)** | **Yes, mostly.** One person adds Otto's number to a group that already exists. Nobody else installs anything or signs up. Comparable products make the same promise: Milo ("No accounts required for your friends."), Continua (add a phone number to a group SMS) and Partiful's no-app links. | "Otto's atomic network is the group chat you already have." Cross-platform reach depends on what Photon's channels actually support (see `photon-capabilities.md`). Do not claim Android coverage for iMessage groups without testing. |
| **Calendar permissions and OAuth** | **Yes, by design.** Otto asks in chat. | Section 5: friends coordinate over open channels, and calendar sharing is concentrated in couples. Asking fits how friend groups behave. |
| **Data liability (location, message history)** | **Yes.** No location, plan-scoped memory, then forget. | Make it a feature: "remembers the plan, not you". |
| **Monetization: no natural payer** | **No.** A group has no single subscriber, and "forget everything" rules out profile- or ad-based revenue. | **For the hackathon:** state it plainly and skip it. **For the pitch,** two options are consistent with our privacy principles:<br>(a) booking or merchant fees with a public no-paid-ranking rule. Pally already uses this model: "Merchants can never pay to change what Pally recommends to you." (https://pally.com/)<br>(b) the organizer pays per plan, or a premium tier for large groups and trips. Do not claim either is validated. |
| **Episodic usage (weak retention)** | **No.** Friend plans stay occasional (43% see friends in person at least weekly). | Measure plans that actually happened, not DAU. Zero install makes it cheap to come back: re-adding Otto or @-mentioning it costs nothing. Forgetting is the normal loop, not churn. |
| **Distribution without an App Store page** | **Partly.** Every plan shows Otto to N people, like Partiful's invite loop. But nobody can "find" a phone-number bot. | Use a one-line footer on the final plan card ("Planned by Otto, add me to any group: …"), shown once per plan and never as a nudge. |
| **Platform risk** | **No, and it is worse than for an app.** WhatsApp's Business API terms bar AI providers from distributing general-purpose assistants from 2026-01-15; Meta AI is unaffected (TechCrunch, 2025-10-18). Apple approved only one third-party AI agent (Poke) for Messages for Business as of 2026-06-04 (9to5Mac). | Position Otto as a narrow planning tool, not a general assistant. Keep the core independent of any one channel. Demo on whichever channel Photon supports reliably. Do not depend on WhatsApp Business API approval. |
| **Native features commoditize "find a date"** | **No.** iOS 26 Messages polls, WhatsApp polls and events, and @Meta AI in WhatsApp groups are all free and need no install. | Win on what a poll cannot do:<br>- read free-text answers ("either", "after 7", "not Sunday");<br>- close the loop with a published tie-break rule, a venue choice and capped nudges sent as the bot;<br>- work across platforms;<br>- forget afterwards.<br>Be honest in the demo that a native poll covers the single-question case. |
| **No rich UI or persistent state** | **No.** | A compact plan card that is re-posted, with a version number (as in `fenn-concepts.md`). |
| **Consent: the group never agreed to an AI reading the chat** | **Not an issue Fenn had.** In Fenn's app, joining was the consent. | Copy the stricter norm: Meta AI in WhatsApp sees only messages that @mention it, and Pally answers only when addressed by name. Otto should read only during an active plan or when mentioned. It should introduce itself, and any member can type `forget` or remove it. |

**Bottom line (INFERRED).** Fenn's pivot is evidence that a group app which everyone must install is very hard to get going. Otto removes that specific barrier. It does not remove the two other likely reasons, monetization and frequency, and it adds platform risk. For a hackathon, that is the right trade-off. For a company, revenue and repeat use are the open questions.

---

## 4. Competitive table (as of 2026-10-16)

"Install by every member?" means: does each participant need the app or an account to take part?

| Product | Lives in existing chat, or own app? | Install by every member? | Calendar access | Location | Privacy posture | Source |
|---|---|---|---|---|---|---|
| **Fenn** (now couples) | Own iOS app | Yes, iOS only (2 people now; whole group before) | Yes: device calendar plus Google Calendar read/write | Yes: background precise location, ETAs, presence | Messages kept while the account is active. AI vendors not named. App Store label lists tracking identifiers. | https://fenn.chat/l ; https://fenn.chat/fair-questions |
| **Alfi** by Text.ai (YC P25) | Own chat app (iOS and Android), "group chat with social skills" | Yes. Members are added by a share link or QR code into the app. | "Social calendar" of upcoming hangs. A user review mentions creating Google Calendar events (not an official feature). | App Store label lists precise location linked to you. v1.31 uses location for recommendations. | Label also links phone number, contacts and device ID to you. No privacy description on YC page. | https://www.ycombinator.com/companies/text-ai ; https://apps.apple.com/app/textai/6752585798 |
| **text.ai** (Alfi's predecessor) | Inside SMS (US and Canada), WhatsApp, Telegram | No: "No new apps to download" | "Booking each other's calendars" listed as planned | Not stated | Not stated on the launch page. Current status unknown. | https://www.ycombinator.com/launches/NP6-text-ai-ai-in-your-group-chats |
| **ChatGPT group chats** (global 2025-11-20) | Inside ChatGPT (app or web), not in iMessage or WhatsApp | Yes: up to 20 people who accept an invite (logged-in users) | Not part of the group-chat feature (not verified otherwise) | Not stated | Personal memory is not used, and group chats do not create new memories (TechCrunch and eWeek, seen as search excerpts). | https://techcrunch.com/2025/11/20/chatgpt-launches-group-chats-globally/ ; https://www.eweek.com/news/openai-chatgpt-group-chat-global/ |
| **Meta AI in WhatsApp groups** | In the existing WhatsApp chat, invoked with @Meta AI | No (WhatsApp only) | None found | None found | Only messages that mention @Meta AI are shared with it (per fact-checks citing WhatsApp help). Pitched for group restaurant picks and meetups. | https://www.whatsapp.com/meta-ai ; https://english.factcrescendo.com/2025/08/20/whatsapp-meta-ai-advanced-chat-privacy-fact-check/ |
| **WhatsApp polls and events** (native) | In chat | No | Event with date and time, plus RSVP. No calendar reading. | No | Polls end-to-end encrypted (secondary source) | https://gulfnews.com/technology/media/whatsapp-now-lets-you-organise-events-in-group-chats-plan-parties-gatherings-easier-1.1714893885488 |
| **Apple Messages polls** (iOS 26) | In the iMessage chat. Apple Intelligence can suggest a poll. | No, but participants reportedly need iOS 26 and iMessage (secondary source) | No | No | Polls reported as end-to-end encrypted (secondary source). Apple's release does not detail poll privacy. | https://www.apple.com/newsroom/2025/06/apple-elevates-the-iphone-experience-with-ios-26/ ; https://techcrunch.com/2025/06/09/apple-is-bringing-polls-to-imessage/ |
| **Apple Invites** | Own app plus web (icloud.com/invites) | No for guests (RSVP on the web, no Apple Account). Hosts need iCloud+. | Event invites | Maps details on the event | Apple | https://www.businesswire.com/news/home/20250203932522/en/Introducing-Apple-Invites-a-new-app-that-brings-people-together-for-life%E2%80%99s-special-moments |
| **Partiful** | Own iOS app plus a web invite link shared in any chat | No: guests don't need the app | Date poll before the final date. No calendar reading. | Event address only | RSVP with a phone number. Text blasts from the host. | https://apps.apple.com/us/app/partiful-party-invite-maker/id1662982304 |
| **Howbout** | Own app (social calendar) | Yes, to respond (web responses were being tested in 2024) | Yes: shared calendars. Over 75% of users share their full calendar with at least one friend. | Not stated | Calendar sharing is the core feature | https://techcrunch.com/2024/09/13/howbout-raises-8m-from-goodwater-to-build-a-calendar-that-you-can-share-with-your-friends |
| **Luma** | Web event pages (public and community events) | No: name and email form | Sends a calendar invite after registration | Event location | Collects name and email | https://help.luma.com/p/event-registration-process |
| **Doodle / When2meet** | Web | Doodle: no account to vote (the organizer needs one). When2meet: web grid; no-account status not verified. | Availability grid; no calendar reading needed | No | Doodle collects name and email when you vote | https://help.doodle.com/en/articles/8393821-do-i-need-a-doodle-account-to-participate-in-a-group-poll ; https://www.when2meet.com/ |
| **Continua** (GV-led $8M seed, Aug 2025) | Inside SMS, iMessage and Discord groups (add its number or username) | No | Yes: reminders, polls and calendar invites. Gmail and calendar integrations reported. | Not stated | Not addressed in TechCrunch coverage. No 2026 news found. | https://techcrunch.com/2025/08/12/google-vet-raises-8m-for-continua-to-bring-ai-agents-to-group-chats |
| **Pally** | iMessage, RCS, Telegram. "Add Pally to the group." Mainly a personal assistant. | Unclear for other members | Yes: each person connects Google Calendar and chooses what to share | Not mentioned | Encrypted. "See and edit everything Pally knows." Free, funded by merchant fees, with a no-paid-ranking pledge. | https://pally.com/ |
| **Tomo** | iMessage. Can join group conversations. | Not stated | Yes: calendars and email | Not stated | Not stated. Basic plan from $19.99/month. | https://techcrunch.com/2026/10/10/all-the-ai-agents-that-can-live-in-your-text-messages/ |
| **Milo** | Inside WhatsApp groups (tag it). The adder approves actions in Milo's app. | No: "No accounts required for your friends." | Optional Google Calendar, to check who is free | Not stated | Not stated. Released 2026-06-24, under 1K downloads (third-party mirror of the App Store listing). | https://mwm.ai/apps/milo-ai/6772659005 |

**Threat ranking (INFERRED)**
1. **Top direct competitor: Continua.** It has the same form factor (a bot in existing SMS and iMessage groups), the same jobs (polls, reminders, availability, calendar invites) and GV money.
   - **Our edge:** no calendar or Gmail access, plan-scoped memory, capped nudges sent as the bot.
   - **Caveat:** we found no 2026 news on Continua, so its current status is unknown.
2. **Biggest commoditization risk: platform-native tools.** These are iOS 26 Messages polls with Apple Intelligence suggestions, WhatsApp polls and events, and @Meta AI in groups. They are free, native and need no install. For an iMessage demo, judges will ask "why not just use an iMessage poll?". Answer with free-text parsing, tie-breaks, venue choice, capped nudges, cross-platform reach and forgetting.
3. **Distribution giant in its own app: ChatGPT group chats.** Everyone needs to join ChatGPT, so it re-creates the install problem that Fenn faced.
4. **Alfi:** a well-funded team that chose a standalone app. It has the same cold-start exposure Fenn had.

---

## 5. Calendar-reality evidence

**Plain answer:** we could **not** find a credible, verifiable statistic on what share of young adults keep, or do not keep, *social* plans on a digital calendar. The one age-split calendar survey we found is about daily schedules, not social plans. It is a vendor survey, and it cuts the other way (see "Dropped" below). Do not claim "most young people don't use calendars".

**What we can cite (each checked against the original)**
1. **Schuler, Grandhi, Mayer, Ricken and Jones, "The doing of doing stuff", CHI 2014, pp. 119–128.** VERIFIED (live).
   - A diary study of 36 people coordinating group social activities.
   - People mostly coordinate over open channels (texting, calls, email) and avoid tools that feel disruptive to natural conversation.
   - The result is conversational overload and an uneven split of coordination work, which causes frustration and confusion about plan details.
   - This is the best academic support for Otto's design: stay in the open channel, and take the coordination work off the organizer.
   - https://researchwith.njit.edu/en/publications/the-doing-of-doing-stuff-understanding-the-coordination-of-social/
2. **Thayer et al., CSCW 2012.** VERIFIED (live).
   - Among 30 adults who share Google Calendars, 73% shared with a significant other, 33% with a friend, and 17% with groups of associates.
   - It is small, qualitative and from 2009, but it supports the pattern that calendar sharing clusters in couples, not friend groups. That is where Fenn's calendar-based design fits and where Otto's ask-in-chat design is needed.
   - https://depts.washington.edu/csclab/wordpress/wp-content/uploads/Thayer-Derthick-Bietz-Lee-2012.pdf
3. **Pew Research Center, 2012.** VERIFIED (live).
   - 41% of cell phone owners had used their phone in the past 30 days to coordinate a meeting or get-together.
   - It is old, and it is about phones, not calendars. Use it only as background.
   - https://www.pewresearch.org/internet/2012/05/07/main-report-16/
4. **Harris Poll, July 2026 (603 Gen Z adults).** VERIFIED (live).
   - 54% of Gen Z prefer weekend activities planned ahead; 46% prefer spontaneous ones.
   - 62% avoid weekend plans because of financial regret.
   - This is not calendar data, but it does support Otto asking for a price band.
   - https://theharrispoll.com/wp-content/uploads/2026/07/The-Gen-Z-Weekend-Report-July-2026.pdf

**Dropped or weak**
- **ECAL** (a calendar vendor, about 2018, 1,000 Australians): 72% of 18–24-year-olds rely mainly on a digital calendar and 24% on paper, for their *daily schedule*. This shows digital calendars are common. It says nothing about social plans, and it is a vendor survey from Australia. We dropped it as evidence for our claim. https://ecal.com/70-percent-of-adults-rely-on-digital-calendar/
- **Howbout:** over 75% of its users share their full calendar with a friend. That is true only of its own self-selected users, so it is not a population figure.
- **Reinecke et al., "Doodle around the world", CSCW 2013:** 1.5M Doodle polls showing that culture shapes scheduling behavior. Real, but not about friends or why polls fail among them. https://www.eecs.harvard.edu/~kgajos/papers/2013/reinecke13doodle.pdf

---

## 6. Sources (all accessed 2026-10-16; publication date given where known)

**Fenn and its founders**
| URL | Date | How read |
|---|---|---|
| https://fenn.chat/fair-questions | undated | live |
| https://fenn.chat/l | policy updated 2026-09-12 | via `fenn-concepts.md` |
| https://apps.apple.com/us/app/fenn-life-organizer/id6761315757 | version notes v1.41–1.66, Sep 14–Oct 16, 2026 | live |
| https://apps.apple.com/us/app/fenn-life-organizer/id6761315757?see-all=reviews&platform=iphone | reviews Jun 1–3 | live |
| https://fennai.substack.com/ | launched about a month ago | live |
| https://x.com/nal_uh | posts Sep 23 | index |
| https://x.com/thisboy (also https://twitter.com/thisboy) | posts Sep 20 | index |
| https://www.frontrun.vc/blog/yc-f26-companies-full-list | Aug 27, updated Sep 25, 2026 | via `fenn-concepts.md` |
| https://www.zoominfo.com/p/Marc-Mccole/3868305862 | undated | index |

**Industry and theory**
| URL | Date |
|---|---|
| https://www.lennysnewsletter.com/p/atomic-network | 2021-12-09 |
| https://foodondemand.com/01062022/andrew-chen-examines-the-cold-start-problem-for-platforms-like-uber-snackpass/ | 2022-01-06 |
| https://techcrunch.com/2025/09/24/these-yc-founders-pivoted-5-times-before-building-a-social-app-that-nabbed-300k-users-and-over-1m-arr-in-6-months/ | 2025-09-24 |
| https://investors.life360.com/news-releases/news-release-details/life360-reports-record-q4-2025-results | 2026 (index only, HTTP 403) |
| https://www.life360.com/?p=36520 | undated (index) |
| https://sacra.com/research/partiful | undated (analyst; weak) |
| https://techcrunch.com/2023/06/26/irl-shut-down-fake-users/ | 2023-06-26 |
| https://en.wikipedia.org/wiki/Houseparty_(app) | (cites Houseparty blog, WaPo, TechCrunch, The Verge, 2021-09-09) |
| https://play.google.com/store/apps/details?id=co.amo.android.location&hl=en_GB | undated (index) |
| https://www.americancommunities.org/americans-feelings-and-behaviors-highlight-connection-and-its-limits/ | 2024-11-26 |
| https://www.americansurveycenter.org/commentary/why-americans-are-spending-less-time-with-friends-and-what-to-do-about-it | 2022-12-20 (background only) |
| https://theharrispoll.com/wp-content/uploads/2026/07/The-Gen-Z-Weekend-Report-July-2026.pdf | July 2026 (fielded May 28–Jun 6, 2026) |

**Competitors and platforms**
| URL | Date |
|---|---|
| https://www.ycombinator.com/companies/text-ai | live |
| https://www.ycombinator.com/launches/PHB-alfi-your-group-chat-with-social-skills | undated |
| https://www.ycombinator.com/launches/NP6-text-ai-ai-in-your-group-chats | "over 1 year ago" |
| https://apps.apple.com/app/textai/6752585798 | latest version Aug 14 |
| https://techcrunch.com/2025/11/20/chatgpt-launches-group-chats-globally/ | 2025-11-20 (index; OpenAI's own page returned HTTP 403) |
| https://www.eweek.com/news/openai-chatgpt-group-chat-global/ | Nov 2025 (index) |
| https://www.apple.com/newsroom/2025/06/apple-elevates-the-iphone-experience-with-ios-26/ | 2025-06-09 (live) |
| https://techcrunch.com/2025/06/09/apple-is-bringing-polls-to-imessage/ | 2025-06-09 (index) |
| https://www.whatsapp.com/meta-ai | live |
| https://english.factcrescendo.com/2025/08/20/whatsapp-meta-ai-advanced-chat-privacy-fact-check/ | 2025-08-20 (index) |
| https://gulfnews.com/technology/media/whatsapp-now-lets-you-organise-events-in-group-chats-plan-parties-gatherings-easier-1.1714893885488 | mid-2024 (index) |
| https://techcrunch.com/2025/10/18/whatssapp-changes-its-terms-to-bar-general-purpose-chatbots-from-its-platform/ | 2025-10-18 (index) |
| https://9to5mac.com/2026/06/04/apples-messages-app-on-iphone-now-has-a-third-party-ai-agent/ | 2026-06-04 (index) |
| https://www.businesswire.com/news/home/20250203932522/en/Introducing-Apple-Invites-a-new-app-that-brings-people-together-for-life%E2%80%99s-special-moments | 2025-02-03 (index) |
| https://apps.apple.com/us/app/partiful-party-invite-maker/id1662982304 | latest version about 2026-10-13 (live) |
| https://techcrunch.com/2024/09/13/howbout-raises-8m-from-goodwater-to-build-a-calendar-that-you-can-share-with-your-friends | 2024-09-13 (live) |
| https://help.luma.com/p/event-registration-process | undated (index) |
| https://help.doodle.com/en/articles/8393821-do-i-need-a-doodle-account-to-participate-in-a-group-poll | undated (index) |
| https://www.when2meet.com/ | live |
| https://techcrunch.com/2025/08/12/google-vet-raises-8m-for-continua-to-bring-ai-agents-to-group-chats | 2025-08-12 (live) |
| https://pally.com/ | live |
| https://techcrunch.com/2026/10/10/all-the-ai-agents-that-can-live-in-your-text-messages/ | 2026-10-10 (live) |
| https://mwm.ai/apps/milo-ai/6772659005 | live (third-party mirror) |

**Calendar and coordination research**
| URL | Date |
|---|---|
| https://researchwith.njit.edu/en/publications/the-doing-of-doing-stuff-understanding-the-coordination-of-social/ | CHI 2014 |
| https://depts.washington.edu/csclab/wordpress/wp-content/uploads/Thayer-Derthick-Bietz-Lee-2012.pdf | CSCW 2012 (full PDF read) |
| https://arxiv.org/pdf/0809.3447 | 2008 (full PDF read) |
| https://www.pewresearch.org/internet/2012/05/07/main-report-16/ | 2012-05-07 |
| https://ecal.com/70-percent-of-adults-rely-on-digital-calendar/ | about 2018 (dropped) |
| https://www.eecs.harvard.edu/~kgajos/papers/2013/reinecke13doodle.pdf | CSCW 2013 (index) |

## 7. Could not verify
- **Any first-party reason for the pivot.** None exists publicly as far as we could search.
- **Full text of the founders' X posts.** x.com returns 402 and xcancel returns 451; all X content above is from search excerpts.
- **Founders' LinkedIn pages.** Behind a login wall; not opened.
- **An App Store name "Fenn: AI with friends" and a tagline about being the friend a group chat was missing.** Both appeared once in search-engine summaries and could not be reproduced. Treat them as unverified.
- **The exact pivot date.** It falls between Aug 21 (Frontrun's group pitch) and Sep 14 (first couples version note). The order of the App Store renames is unknown.
- **Pre-pivot traction, retention or revenue for the group product.** No data found.
- **McCole's Life360 role.** ZoomInfo only.
- **Life360 FY2025 figures.** Investor page returned HTTP 403; the numbers come from a search excerpt.
- **OpenAI's own group-chat announcement page** returned HTTP 403. Details come from TechCrunch and eWeek.
- **Apple's requirement that every poll participant be on iOS 26** (secondary sources only). **Polls' end-to-end encryption** is also secondary.
- **WhatsApp Help Center wording on Meta AI in groups** (fact-checkers' paraphrase only). **Enforcement of WhatsApp's Jan 2026 chatbot ban** was not checked.
- **Continua's status in 2026.** **Pally's behavior for non-adder group members.** **When2meet's no-account behavior** (page shows only a grid). **Luma guest-account rules** (inferred from the help page).
- **A population-level statistic on social plans and digital calendars among young adults.** None found.

## 8. Text aimed at AI
None found. We checked the WebFetch reads of the Fenn FAQ, the TechCrunch Oct 2026 roundup, pally.com (it links "llms.txt" and "MCP" pages, but its content has no instructions to AI) and when2meet.com. We also grep-scanned the extracted text of the Harris, Thayer and Tungare PDFs for prompt-injection patterns.
