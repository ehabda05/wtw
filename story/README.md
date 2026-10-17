# story/: Whats the Word demo video + pitch deck

The app is **Whats the Word**; its agent in the group chat is **Homi** (amber face avatar). Everything here
works offline from a laptop: system fonts, inline SVG, no CDN, no network calls. The story itself is
canonical in [`docs/DEMO.md`](../docs/DEMO.md); the video follows its Acts 1-6 name for name and number for number.

```
story/
  motion/   phone-UI motion demo (index.html, phone.css, photos.js, timeline.js, script.json) → see motion/README.md
  render/   serve.mjs (tiny static server), render.mjs (frame capture + ffmpeg + deck PDF)
  deck/     index.html (9-slide deck), deck.pdf (print backup)
  qr/       make-qr.mjs (QR code + printable table tent, once the Homi number exists)
  out/      homi-phone-1080x1920.mp4, homi-demo-1920x1080.mp4, posters (frames/ and stills/ are scratch, deleted after use)
```

## Open the deck

Double-click `story/deck/index.html` (works from disk; the demo video on slide 5 loads from
`../out/homi-phone-1080x1920.mp4`).

- `→` / `Space` / `PageDown` next, `←` / `PageUp` back, `Home` / `End`.
- `N` toggles the speaker-notes panel (every slide has notes).
- `P` toggles print mode (all slides stacked, one 16:9 page each); `Ctrl+P` then prints one slide per page.
- `index.html#6` opens slide 6.

Slides: 1 title · 2 problem · 3 why · 4 insight · 5 live demo · 6 after the plan (bill, pledge, album,
trip, each with an honest status line) · 7 privacy · 8 architecture · 9 measured + next.

The only placeholder left to fill before presenting is `{{TEAM}}` (slide 1 and its notes). After
editing, re-export the PDF (below).

The only statistics in the deck are the verified ones from `research/problem-evidence.md`
(Kannan & Veazie 2023 on slide 2; Blair, Thompson & Wuensch 2005 on slide 3; Mollgaard &
Mathiesen 2016 in the slide 3 notes only).

## Preview the motion demo

```
node story/render/serve.mjs
```

Open `http://127.0.0.1:5178/motion/index.html?layout=vertical` or `?layout=landscape`.

## Re-render the videos

The render tools are **not** installed in the project (the project path is long and npm hits
Windows MAX_PATH). They live in a short path under `%TEMP%`:

```
mkdir C:\Users\<you>\AppData\Local\Temp\homi-story-tools
cd C:\Users\<you>\AppData\Local\Temp\homi-story-tools
npm init -y
npm install playwright-core ffmpeg-static qrcode
```

`render.mjs` loads them with `createRequire` from `HOMI_TOOLS=...` if set, else from the first of
`%TEMP%\homi-story-tools` or `%TEMP%\otto-story-tools` (the folder's name before the rename) that has a
`node_modules`. It drives the installed Microsoft Edge (`EDGE_PATH=...` to override), so no browser
download is needed. ffmpeg comes from `FFMPEG=...`, else `ffmpeg-static`, else `ffmpeg` on PATH.
(If `ffmpeg-static`'s download is cut short, its `ffmpeg.exe` fails with "not a valid
application"; re-run `node node_modules/ffmpeg-static/install.js` or set `FFMPEG`.)

From the project root:

```
node story/render/render.mjs                       # both MP4s + posters (about 15 min on a laptop)
node story/render/render.mjs --only=vertical       # just the 1080x1920 phone video
node story/render/render.mjs --stills=17500,81500  # spot-check PNGs in story/out/stills/
node story/render/render.mjs --poster=81500        # time (ms) used for the poster PNGs (default: the bill card)
node story/render/render.mjs --deck-pdf            # story/deck/deck.pdf
node story/render/render.mjs --deck-stills         # a PNG of every deck slide in story/out/stills/
```

What it does: serves `story/` on a random localhost port, opens
`motion/index.html?layout=…&render=1` in headless Edge, calls `window.__seek(f × 1000/30)` for
every frame, captures each (raw CDP PNG screenshot) to `story/out/frames/<layout>/00000.png`, encodes H.264
(`libx264 -crf 18 -pix_fmt yuv420p -movflags +faststart`), writes the poster PNGs, and deletes
the frames (`--keep-frames` keeps them). Delete `story/out/stills/` when you are done checking.

Before encoding a new script, look at stills from every act (cold open, intro, votes, call, pledge
rules, check-ins, bill card, settle-up, album grid before and after the removal, trip card, savings,
the "what do you know" dump, end card) and check every number against `docs/DEMO.md`.

Outputs:

| File | Size |
|---|---|
| `out/homi-phone-1080x1920.mp4` | 2:29.6 (149.6 s), 21.0 MB; vertical, phone fills the frame, chapter + caption underneath |
| `out/homi-demo-1920x1080.mp4` | 2:29.6 (149.6 s), 15.4 MB; landscape, phone centered, chapters left, caption right |
| `out/homi-poster-1080x1920.png`, `out/homi-poster-1920x1080.png`, `out/homi-poster.png` | poster frames (the bill-split card) |

## Regenerate script.json

`story/motion/storyboard.txt` is the source of the current `script.json`:

```
node story/motion/build-script.mjs story/motion/storyboard.txt story/motion/script.json
```

It prints the total length; keep it at 120-150 s (trim with negative `@wait`s or card `"hold"`s).
To start from a real simulator run instead, run `npm run sim -- --script test/engine/demo.sim.txt`, copy
the `Name: text` lines into a copy of the storyboard and keep the directives around them (`@chapter`,
`@caption`, `@react`, `@call` … `@endcall`, `@card`, `@photo`, `@album`, `@end`). The format and the
`script.json` schema are in `story/motion/README.md`. Preview with `serve.mjs`, spot-check with
`--stills`, then run `render.mjs`.

## What is real and what is not (keep this honest)

- The phone UI is an original mock-up ("iMessage-style" in spirit, no Apple logos or marks).
- Act 1 copy is the real template text from a simulator run of `test/engine/demo.sim.txt` (intro,
  header, conflict bridge, nudge, call line, lock, hungry question, place offers). Acts 2-6 copy is
  taken word for word from `docs/DEMO.md`; the bill, Uber, settle-up and trip numbers match it exactly.
- Restaurants are real entries from `src/places/data/harvard-allston.json` (© OpenStreetMap
  contributors, ODbL). Prices are team estimates, shown as "~$$ (est.)"; walk times are our
  haversine estimate from the Harvard Sq centroid.
- The phone call is **simulated**: the call screen says "(simulated call)" and "Simulated call
  audio". The number is a masked placeholder, "(617) 555-01xx".
- Pledge money is **SIMULATED**: every deposit, refund and forfeit line carries an amber SIMULATED pill.
- The album URL `https://homi.example/a/…` is labeled "demo link". The four photos are placeholder
  art drawn in SVG (`motion/photos.js`: a ramen bowl, friends as silhouettes, city lights, a neon
  sign); no real people, no image files.
- Trip prices are estimates; the listing is labeled "Example listing · estimated price".
- The QR code on the end card is a placeholder ("Text Homi: (number TBA)").
- Heads-up: the OSM snapshot contains a Harvard Sq pizza place literally named "Homi". The demo
  avoids it; the mention detector may want to know about it.
