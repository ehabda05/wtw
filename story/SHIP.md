# Ship plan: timeline and checklist

All times are EDT. The venue **closes overnight** (hhuh.io FAQ), so plan where the team works Friday and Saturday nights.

## Friday Oct 16 (tonight)

- [x] Phases 1–2: research, design docs (`research/`, `docs/`)
- [x] Engine, infra, places, voice and the simulator built in parallel (`src/`, `test/`)
- [ ] **Teammate:** post the Discord question (draft in NOTES.md), then read the answer in the morning
- [ ] **Teammate:** create the Photon projects:
  - Stable: app.photon.codes (for spectrum-ts)
  - Photon 2.0: app.beta.photon.codes (SMS number + voice)
  - Put the secrets in `.env` yourself.
- [ ] **Teammate:** create a Telegram bot with @BotFather and turn privacy mode off (CHANNELS.md)
- [ ] **Teammate:** paste the Devpost judging criteria and video limit into `research/judging.md` §1a/§1b

## Saturday Oct 17

| Time | Do | Owner |
|---|---|---|
| 9:00 | `npm install`, `npm test`, `npm run sim -- --script story/demo-script.txt`: everything green | anyone |
| 9:30 | First live surface: Telegram group (or dedicated iMessage if Photon granted it) running `npm start`; walk through the full runbook once | lead |
| 10:00–12:00 | **Sponsor fair.** Show the Photon table the sim demo and the live group, and ask about dedicated lines / eligibility (pitch.md Q&A) | 2 people |
| by 11:00 | Voice: SMS number + SIP profile + Retell import + `node --import tsx src/voice/setup.ts`; **Test A** (Retell dashboard call) | voice lead |
| **12:00** | **Voice go/no-go (Test B):** our server places the call and the answer lands in the group, 2 runs out of 2. If no-go, run the ElevenLabs cookbook for 1 hour, then the mock call, labeled. | voice lead |
| 13:00–17:00 | Second surface, polish, edge cases from fixtures, `npm run eval`, README numbers | all |
| 18:00 | Record real-phone footage for the video (`story/video-script.md`); record the call | 2 people |
| 19:00 | Motion demo: regenerate `story/motion/script.json` from a sim transcript and re-render (`story/README.md`) | story |
| **22:00** | **Code freeze.** After this, only the deck, video and Devpost | all |
| 22:00–01:00 | Cut the video, burn captions, finish the deck numbers, draft Devpost | story |

## Sunday Oct 18

| Time | Do |
|---|---|
| 7:00 | Upload the final video (YouTube unlisted or Devpost upload), check the length against the limit |
| **7:45** | **Devpost submitted** to the Photon challenge (+ a fitting general track); 15 minutes of buffer to 8:00 |
| 8:30 | Full dress rehearsal of the live demo **twice**, including the call and the fallback ladder |
| 9:00–12:00 | Judging, Canopy Hall: phone loop playing, two phones charged, hotspot on, QR table tent out |
| 15:00 | Closing ceremony (attendance required) |

## Pre-submission checklist

- [ ] Repo public. README has the problem, privacy, run steps, evals, and the simulated list. The repo is ready locally; publishing it is a teammate's call.
- [ ] `.env` not committed (`git ls-files | grep .env` shows only `.env.example`). `.env.example` complete.
- [ ] `npm test` green; `npm run eval` numbers pasted into README and deck slide 8
- [ ] Video under the Devpost limit, captions on, "simulated" labels visible
- [ ] Deck (`story/deck/index.html`) runs offline. `deck.pdf` backup exists.
- [ ] Phone loop `story/out/homi-phone-1080x1920.mp4` copied to **two** laptops
- [ ] Agent number QR on the end card and on a table tent: `node story/qr/make-qr.mjs --sms +1XXXXXXXXXX` (or `--telegram <bot>`), then print `story/qr/table-tent.html`
- [ ] Devpost submitted to the Photon challenge; "What is simulated" section filled
- [ ] Fallback ladder rehearsed once (Wi-Fi off → sim; voice off → recorded call)
- [ ] Retell agent privacy settings verified in the dashboard (basic attributes / 1-day retention)
- [ ] After the event: run `homi stop` in every demo group, and delete the demo DB (`data/homi.db`)
