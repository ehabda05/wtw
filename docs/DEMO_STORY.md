# What's the Word · demo video story (v2)

**Rendered cut:** `story/out/homi-phone-1080x1920.mp4` (vertical) and `story/out/homi-demo-1920x1080.mp4` (landscape),
about 1:17 with voiceover and sound, built from `story/motion/storyboard-v2.txt` and `story/audio/vo-lines.json`
(see `story/motion/README.md` to change a line, re-render and re-mix).
The previous 2:30 cut is kept in `story/out/v1/`. The table below is the beat sheet the cut follows; the timings there
are the generous version for a phone-recorded remake, the animated cut runs tighter.

Remake of the 73-second silent recording (`ScreenRecording_10-17-2026_23-58-20_1`). The old cut has the right
instinct (a plan dying in a group chat) but no payoff: 73 s of one person typing into silence, a Facebook
notification in the middle, and Homi never appears. This version keeps the pain as a 10-second hook and spends the
rest showing Homi finish the job. Hard cap 2:00; this runs ~1:40 with the waits time-lapsed.

## The spine

Open loop → relief → proof → close. One chat, one plan, one dinner that actually happens.

| Time | Beat | What's on screen | Caption (burned in) |
| --- | --- | --- | --- |
| 0:00–0:10 | **The dead plan** | Old recording, 3× speed: "Hey guys lets hangout!" → a lone 👍 → "Is that a yes?? Where do u guys wanna meet" → typing bubble appears, vanishes → "Hello?" Hold 1 s of silence. | *Every group chat has a plan that died like this.* (0:06, small: *88% of Gen Z have one stuck right now*¹) |
| 0:10–0:16 | **The turn** | Same chat. Type `homi dinner friday 7pm`. Homi's header + `1 · Fri Oct 23 · 7pm` appear. | *Meet Homi. It lives in the chat you already have.* |
| 0:16–0:40 | **Everyone answers** | Escander taps ❤️. Charlie says nothing. Sticker "30 s later" → Homi: "Still need Charlie; I've asked them privately. No word by 7:16pm counts as not coming." Cut to Charlie's phone: Homi's DM → Charlie replies `yes`. Back to group: "Fri Oct 23 · 7pm it is: 3 in." | *It asks. Then it follows up, privately.* → *Locked. Nobody chased anybody.* |
| 0:40–1:05 | **The argument, settled** | Homi: "What are we feeling? …" Riad `thai`, Escander `sushi for me`, Charlie `pizza`. Homi: "No majority yet: Thai 1 · Japanese 1 · Pizza 1. Need 2 of 3 on one; say the one you'd switch to, or "surprise us"." Escander: `ok thai then`. Homi posts "Thai in Boston, here are 3…" + 3 spots. Two people reply `2`. Homi: "Dakzen it is: 195 Elm Street, Somerville" + maps link. | *Majority rules.* → *Three real spots. One address.* |
| 1:05–1:20 | **The bill** | Receipt photo dropped in the chat, `homi split the bill 3 ways`. Homi: "$84.00 split 3 ways: $28.00 each." | *Dinner's over. So is the Venmo chase.* (small: *76% who front money for friends never get fully repaid*²) |
| 1:20–1:30 | **Nothing to hide** | `homi what do you know` → only the plan. `homi forget` → "Done: I've deleted this plan." | *It keeps the plan. Never your messages.* |
| 1:30–1:40 | **Close** | Wordmark. Tagline, surfaces, QR to the repo. | *Homi plans. You just show up.* / *iMessage · Telegram · no app to download* / *HackHarvard 2026* |

## Type-this cheat sheet (in order)

Three people: Riad (recording phone), Escander, Charlie. Homi saved as a contact named "Homi" on every phone so the
bubbles read "Homi", not "Maybe: Spectrum".

| # | Who | Message | Homi replies |
| --- | --- | --- | --- |
| 1 | Riad | `homi dinner friday 7pm` | header + `1 · Fri Oct 23 · 7pm` |
| 2 | Escander | ❤️ on the option | (silent 👍) |
| 3 | nobody for 30 s | | "Still need Charlie; I've asked them privately…" + DM to Charlie |
| 4 | Charlie (DM) | `yes` | "Got it, thanks. I'll tell the group." then in group: "Fri Oct 23 · 7pm it is: 3 in." + "What are we feeling? …" |
| 5 | Riad | `thai` | 👍 |
| 6 | Escander | `sushi for me` | 👍 |
| 7 | Charlie | `pizza` | "No majority yet: Thai 1 · Japanese 1 · Pizza 1. Need 2 of 3 on one…" |
| 8 | Escander | `ok thai then` | "Thai in Boston, here are 3. Tap ❤️ on your pick (or reply 1, 2 or 3)." + 3 spots |
| 9 | Riad, Charlie | `2` | "Dakzen it is: 195 Elm Street, Somerville https://maps.apple.com/…" |
| 10 | Riad | receipt photo, then `homi split the bill 3 ways` | "$84.00 split 3 ways: $28.00 each." |
| 11 | Riad | `homi what do you know` | the plan summary |
| 12 | Riad | `homi forget` | "Done: I've deleted this plan." |

Run Homi for the shoot with short timers so the waits are real but brief:
`DEMO_SIMPLE=on QUORUM_DM_AFTER_MS=20000 QUORUM_REPLY_MS=15000 MIN_ATTENDEES=2`.

## Why each beat is there (the psychology)

- **Hook in the first 3 seconds.** Short-form practitioners converge on one rule: open on the moment of tension, never on a logo. "Hello?" into silence is that moment, and every viewer has lived it.
- **Problem first.** Judges interviewed by JetBrains all raised the same point: a project they understand beats a stronger one they don't. The dead plan is the problem; no narration needed.
- **Open loop → closure (Zeigarnik).** The old cut opens a loop and never closes it. v2 closes it twice: the date locks, then the address lands.
- **Loss aversion over gain.** "A plan that died" and "the Venmo chase" name losses people already feel; "better planning" names a gain nobody feels.
- **One core action, visible result.** The demo pattern judges reward: first screen, the one action (`homi dinner friday 7pm`), the output that proves it works (an address and a bill). Everything else is cut.
- **Social proof inside the product.** "3 in", "Need 2 of 3", "Majority rules": the group's own numbers do the persuading, not a voiceover.
- **Peak-end rule.** The strongest beats sit last: the address, the split bill, the delete. End on competence and relief, not a feature list.
- **Captions, not voiceover.** Most feed video plays muted; the original was silent anyway. Burn captions in, add one music track, and drop the music to silence for the "Hello?" beat.

## Numbers you can say out loud (and how safe they are)

| Claim | Source | Caveat |
| --- | --- | --- |
| 88% of Gen Z have at least one plan stalled in their messages; 47% of trip ideas never leave the chat | Thorpe Park survey of 1,000 Gen Z adults (via GMX) | Brand-commissioned; say "a survey found", not "research shows" |
| 76% who fronted money for a group trip were never fully repaid; 20% mute the chat to avoid the money talk | Zelle survey (via Black Enterprise) | Brand-commissioned |
| 79% share big life news with the group chat before family | Giphy survey, Sept 2025 (via Axios) | Brand-commissioned; good for "the group chat is where life gets planned" |
| Daily contact with friends among 16–24s fell from 44% (2015) to 36% (2022) | OECD, via Yahoo News | Independent; the strongest line for "why now" |
| Americans socialize 35 min/day, down from 41 in 2015 | BLS American Time Use Survey, via NBC | Independent |
| Only 17% of under-30s feel deeply connected to a community | Harvard IOP Youth Poll, via CNBC | Independent |

Positioning that falls out of this: the group chat is already where plans are born and where they die. Homi is not
another app to download; it is the friend in the chat who actually follows up, decides, and splits the bill, and
then forgets everything.

## Production checklist

- Do Not Disturb on every phone (the old cut has a Facebook notification at 0:55). Hide Live Activities (the Uber Eats pill).
- Dark mode, 60 fps, record vertical; export 1080×1920 for socials and a 16:9 letterboxed master for Devpost.
- Speed-ramp typing to 2–3×; replace timer waits with a 1-second "30 s later" sticker.
- Second phone for Charlie's DM: screen-record it separately and picture-in-picture it, or cut to it.
- Save Homi as a contact on all phones; delete old plans (`homi forget`) and the test chat before recording.
- One music track. Silence under "Hello?". A soft tick on each Homi message.
- Captions ≤ 7 words, bottom third, high contrast; nothing important in the top 15% (platform UI covers it).
- Last frame holds 3 s with the QR and the repo link.

## Sources

1. https://www.gmx.co.uk/travel/11607788-gen-z-fear-holiday-plans-stuck-group-chat.html
2. https://www.blackenterprise.com/gen-z-friends-loan-money-group-trips/
3. https://www.axios.com/2025/10/21/giphy-group-chats-gen-z-survey
4. https://www.yahoo.com/news/articles/why-loneliness-rise-among-young-101120350.html (OECD figures)
5. https://nbcpalmsprings.com/2026/07/22/americans-socializing-less-as-loneliness-continues-to-rise (BLS)
6. https://www.nbcsandiego.com/news/business/money-report/just-17-of-americans-under-30-feel-they-have-deep-social-connections-new-harvard-survey-shows/3811771
7. https://blog.jetbrains.com/ai/2026/06/how-to-win-a-hackathon-notes-from-the-judging-table/
8. https://blogs.reskilll.com/hackathon-demo-presentation-tips-pitch-3-minutes-win-2026/
9. https://sustained.substack.com/p/lessons-from-winning-five-hackathons
10. https://www.go-viral.app/blog/hook-first-3-seconds/ (practitioner rule of thumb, not peer-reviewed)
