# Live web demo: simulated iMessage, real Homi engine

A browser page that looks like an iMessage group chat ("the crew": Ana, Ben, Sam, Jo, Maya and You) and runs the
**real** Homi engine locally: the same engine, runner, scheduler, sealed store, extension handlers (bill split,
pledges, album, travel) and album gallery as production. Only the screen, the people, the clock and a few outside
services are pretend, and the page says so on every screen: **"Simulated iMessage · real Homi engine"**.

Why it exists: real iMessage groups need a dedicated Photon line or a Mac on macOS 26 with local iMessage. Photon's
shared lines can't join groups, and we have neither, so this is how we show the group experience live.

## Run it

```powershell
npm.cmd run web            # Windows PowerShell
```

```sh
npm run web                # macOS / Linux
```

Then open **http://127.0.0.1:5180/**. Until the `web` script is in package.json, use `npx tsx src/web/server.ts`.
It is offline by default: no keys, no `.env`, no network calls. The two opt-ins are real phone calls and the
LLM fallback (both at the end of this page). Stop it with Ctrl+C.

| Setting | Default | What it does |
|---|---|---|
| `PORT` | `5180` | Port to listen on |
| `HOST` | `127.0.0.1` | `0.0.0.0` lets phones on the same Wi-Fi join (see below) |
| `START` (or `--start`) | now | Fake-clock start, ISO, e.g. `2026-10-17T10:00:00-04:00` |
| `DEFAULT_TZ` | `America/New_York` | The group's time zone |
| `WEB_TOKEN` | random on `0.0.0.0`, none on `127.0.0.1` | A fixed access token (then required on any host), e.g. for a printed QR code |

Opening `/?start=2026-10-17T10:00:00-04:00` on a fresh chat also sets the clock. **▶ Play the full demo** always
resets to the story start (Sat Oct 17, 10:00am, docs/DEMO.md).

## Play it on iPhones (same Wi-Fi)

```powershell
$env:HOST = "0.0.0.0"; npm.cmd run web
```

```sh
HOST=0.0.0.0 npm run web
```

The terminal prints one URL per network interface, each ending in `?k=<token>`, for example
`http://192.168.1.23:5180/?k=Xy3…   (Wi-Fi)`. Open the Wi-Fi one on each phone (or turn it into a QR code). On
`0.0.0.0` **every** request needs that token, so other devices on the venue network can't drive the demo; the first
visit with `?k=` sets a cookie, so album links and photos keep working.

- **Windows firewall:** the first time, Windows asks whether Node.js may accept connections. Allow it on
  **Private networks** only. If phones can't connect, check that the Wi-Fi profile is set to Private, or add the
  rule in "Allow an app through Windows Firewall".
- **Venue Wi-Fi** often blocks device-to-device traffic. If phones time out, run a phone hotspot and join the laptop
  and the phones to it.
- **Full screen:** in Safari tap Share → Add to Home Screen. The page has `apple-mobile-web-app-capable`, a black
  theme color, safe-area insets for the notch and the home indicator, and a Homi icon.
- **Many devices at once:** every browser sees the same chat live (one Server-Sent Events stream each) and picks its
  own persona, remembered per device. A reset or the scripted demo updates everyone.

On phones (narrower than 600 px) the chat is full screen, the persona row sits above the message box, and the
controls (clock, fast-forward, play, reset, private messages, legend) are behind the ⚙️ button. On a laptop or
projector the phone frame scales to the window height with the controls beside it.

## What judges can do

- **Pick who is typing** (Ana, Ben, Sam, Jo, Maya, You) and text the group; Enter sends. Try `@homi dinner next week?`.
- **Tap any bubble** (or long-press / right-click) for tapbacks ❤️ 👍 👎 😂 ❓ as the current persona. ❤️ on an option
  is a vote. The same menu has **Reply** for a threaded reply.
- **📷** shares a generated sample photo with an editable caption (default `homi add`).
- **⏩ +1h / +12h / Next day (10am)** move the fake clock. Due nudges, reminders, check-in windows and pledge
  settlements fire in order, exactly as the scheduler runs them in production.
- **Answer Homi's call.** When Homi phones someone who opted in ("homi you can call me"), an incoming-call screen
  shows the question; type what they say (for example `friday works`) or tap Don't pick up. Fast-forward pauses while
  a call rings.
- **▶ Play the full demo** replays `demo/demo.sim.txt` (about 90 seconds): the plan, the conflict bridge, the call,
  the ramen place, the $10 pledge, check-ins, the itemized bill ($141.61), settle up, the album, Japan 2030, "what do
  you know" and "forget". You can type, react and fast-forward while it plays; ■ stops it.
- **Open the album link** in the chat: it opens this server's member-only gallery (`/a/<albumId>`), the same page
  production serves.
- **↺ Reset** starts a fresh chat for everyone.

Homi's private messages to one member never appear in the group; they show under **Private messages**, with a short
"Homi sent Sam a private message" line in the chat.

## Simulated vs real

| Part | In this demo |
|---|---|
| Homi engine, runner, scheduler, retention, extension handlers | **Real**, the production code |
| Store | **Real** schema and sealing, in memory, ephemeral keys, gone on reset or exit |
| Album | **Real** encrypted album store and gallery, in a temp folder deleted on reset and exit |
| iMessage UI | Simulated: this page, not Apple's Messages app |
| People | Simulated: you play all six personas |
| Clock | Simulated: a fake clock you fast-forward |
| Phone call | Simulated: no audio, no phone network, you type the answer (labeled "simulated call") |
| Pledge payments | Simulated: no money moves (every deposit, refund and forfeit says SIMULATED) |
| Travel prices | Labeled estimates with example listings |
| Photos | Generated sample images |
| Places | Offline snapshot, no live search |
| Understanding messages | Rules on this laptop; the LLM fallback is **off** unless you turn it on (below) |

The server never logs message text: it prints only its startup lines and, for a failed request, the path and error
name.

## How it differs from real iMessage on Photon

| | This web demo | Real Photon iMessage |
|---|---|---|
| Group chat | One simulated group in the browser | Needs a **dedicated** Photon line (shared lines can't join groups) or a Mac on **macOS 26** running local iMessage (`SURFACES=imessage-local`) |
| Members | Six personas you switch between | Real people with their own phones |
| Delivery | Server-Sent Events to browsers | Photon / Apple delivery, read receipts, typing indicators |
| Tapbacks, replies, edits | Rendered from the same channel calls the adapter makes | Native iMessage features, where the line supports them |
| Time | Fake clock with fast-forward | Real time (`DEMO_MODE=true` adds `homi demo ff 22h`) |
| Calls | Typed answers | Retell voice calls (docs/VOICE_SETUP.md) |

Everything Homi says comes from the same engine either way; see docs/CHANNELS.md for the real surfaces and
docs/DEMO.md for the canonical story.

## API (for scripting and tests)

All POST bodies are JSON (`content-type: application/json`; other types get 415 and cross-site posts get 403).

| Endpoint | Body | |
|---|---|---|
| `GET /events` | | SSE: `snapshot`, `entry`, `clock`, `call`, `script` |
| `GET /api/state`, `GET /api/transcript` | | Current chat as JSON |
| `POST /api/say` | `{persona, text, replyTo?}` | `replyTo`: a ref (`sim-12`, `u-3`), `last`, or option number `2` |
| `POST /api/react` | `{persona, emoji, target}` | Same targets as `replyTo` |
| `POST /api/photo` | `{persona, caption?}` | |
| `POST /api/answer` | `{persona, text}` or `{persona, decline: true}` | Answers a ringing call, or the next one |
| `POST /api/ff` | `{ms}`, `{duration: "12h"}` or `{nextDay: true}` | |
| `POST /api/reset` | `{start?}` | |
| `POST /api/script/play` | `{speed?}` | Resets, then replays `demo/demo.sim.txt` |
| `POST /api/script/stop` | | |

Tests: `node --import tsx --test test/web/*.test.ts` (included in `npm test`).


## Real phone calls in the web demo (Photon 2.0 + Retell)

By default the call to Sam is simulated. To make it **ring a real phone**:
1. **Voice setup.** Finish docs/VOICE_SETUP.md: a Photon 2.0 SMS number, a SIP profile, the Retell import, and `src/voice/setup.ts`. That gives you `RETELL_API_KEY`, `RETELL_AGENT_ID` and `PHOTON_VOICE_NUMBER` in `.env`.
2. **Choose the persona.** Add `WEB_REAL_CALLS=sam=+1XXXXXXXXXX` to `.env`, using the teammate phone that plays Sam.
3. **Restart.** Run `npm.cmd run web`. The startup banner says "Real calls ON for: sam".

**What happens:**
- When Homi checks in on Sam, the chat shows "📞 (REAL call · Photon 2.0 + Retell)" and the phone rings.
- Homi asks only the open question, Sam answers out loud, and the answer lands in the group.
- **Pauses:** "Play the full demo" pauses while a real call is ringing (up to about 4 minutes).
- **Everything else stays simulated:** the other personas, payments and the iMessage UI.
- **Cost:** each call uses Photon voice minutes and Retell credit. Photon requires a payment method on the account before outbound calls work.

## LLM fallback in the web demo (optional, Claude)

Homi understands chat with local rules. In a live demo someone may phrase a request in a way the rules don't
catch ("homi how much do we each owe, it was 120") and get "Not sure what you mean". The **LLM fallback** (repair
router) catches that case: Claude maps the message onto one of Homi's own commands ("homi split 120 5 ways"),
and Homi answers that instead.

**Turn it on:** add both lines to `.env` (or set them in the shell), then restart `npm.cmd run web`:

```sh
HOMI_LLM=on
ANTHROPIC_API_KEY=sk-ant-...
```

- The startup banner says `LLM fallback ON (Claude, redacted snippets)` or `LLM fallback OFF`.
- `DISABLE_HOSTED_LLM=false` works too. `HOMI_LLM=off` always turns it off.
- `HOMI_LLM_MODEL` picks the model (default `claude-haiku-5-5`, the fast low-cost one).
- The demo reads only these variables from `.env`.

**What it sends** (docs/PRIVACY.md §3):
- Only messages **addressed to Homi** that Homi couldn't understand, one call per message at most.
- The text is redacted: persona names, handles, phones, emails and links are replaced with placeholders. Amounts and day words are kept.
- A context line with the plan state, the open date options, the member count and the open flows.
- Nothing else: no other messages, no group name.

**If it fails:** if the call fails or takes longer than 4 seconds, Homi sends its normal reply. A call costs API
credit, so leave it off when you don't need it.
