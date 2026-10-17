# Demo video: script and shot list

**Rendered cut:** `story/out/homi-demo-1920x1080.mp4` (landscape) and `story/out/homi-phone-1080x1920.mp4` (vertical), both **2:30**. They're generated from `story/motion/script.json`, which follows [docs/DEMO.md](../docs/DEMO.md) beat for beat.

**Length check.** Check the Devpost video limit in `research/judging.md` §1b once a teammate pastes it. If the limit is under 2:30, trim Act 5 (savings card) and Act 6 first.

**Voiceover:** optional. A teammate can read the VO column over the landscape cut, and the captions stay as burned in.

| Time (approx.) | Chapter | Picture | Voiceover |
|---|---|---|---|
| 0:00–0:10 | Plans die here | "we should hang out!!", three hearts, "6 days later", silence | "Most friendships don't end in a fight. They end in a group chat." |
| 0:10–0:18 | Homi joins | Homi's one-message intro and privacy promise | "So we built Whats the Word. Add Homi to the chat you already have. No app, no calendar." |
| 0:18–0:40 | Find a date | "@homi dinner next week?" → 3 options → replies and hearts → **conflict bridge** adds Sat 11am | "Homi never asks when you're free. It proposes times, you tap, and when friends conflict it finds a workable option." |
| 0:40–0:55 | The quiet friend | Nudge → call screen "(simulated call audio)" → "Sam's in" → Fri locked → ramen pick | "Sam went quiet and said Homi could call. The call carries only the question." |
| 0:55–1:15 | Show-up pledge | Where no-show money goes (3 options) → rules card → everyone agrees → 6 × "I'm in" → "$60 held (SIMULATED)" | "Optional pledges: $10 each, back when you show up. The group agrees first where no-show money goes, and every payment here is simulated." |
| 1:15–1:35 | Split the bill | Check-ins → Ben's itemized bill → **receipt card: $141.61, adds up exactly** → Uber → **who pays whom** → "Pledge settled (SIMULATED) … Sam's $10 went to the group fund" | "Ben paid. Homi does the math: items, tax and tip, to the cent, and who pays whom." |
| 1:35–1:55 | Shared album | Album link (demo link) → photos from Ana, Jo, Maya → **album screen** → Jo removes their photos → 2 left | "Photos go into a members-only album only when you share them, and you can always take yours back." |
| 1:55–2:15 | Plan the trip | "let's plan Japan for 2030" → answers → **overview card** (labeled estimates, example listing) → comfort +$950 → savings | "Next trip: Homi turns 'let's do Japan' into a plan. It's too early to book, so every price is a labeled estimate." |
| 2:15–2:25 | Then it forgets | "what do you know" (full dump) → "forget" | "Ask what it knows. Tell it to forget." |
| 2:25–2:30 | End card | Whats the Word · Homi · Built on Photon · QR placeholder | "Whats the Word. Homi, the friend who makes plans happen." |

**Before submitting:**
- Replace the end card's QR placeholder with Homi's number: run `node story/qr/make-qr.mjs --sms +1…`, then re-render (story/README.md).
- Fill `{{TEAM}}` in the deck.
