# story/: demo video + pitch deck

Everything here works offline from a laptop: system fonts, inline SVG, no CDN, no network calls.

```
story/
  motion/   phone-UI motion demo (index.html, phone.css, timeline.js, script.json) → see motion/README.md
  render/   serve.mjs (tiny static server), render.mjs (frame capture + ffmpeg + deck PDF)
  deck/     index.html (8-slide deck), deck.pdf (print backup)
  out/      otto-phone-1080x1920.mp4, otto-demo-1920x1080.mp4, posters (frames/ is gitignored, deleted after encoding)
```

## Open the deck

Double-click `story/deck/index.html` (works from disk; the demo video on slide 5 loads from
`../out/otto-phone-1080x1920.mp4`).

- `→` / `Space` / `PageDown` next, `←` / `PageUp` back, `Home` / `End`.
- `N` toggles the speaker-notes panel (every slide has notes).
- `P` toggles print mode (all slides stacked, one 16:9 page each); `Ctrl+P` then prints one slide per page.
- `index.html#5` opens slide 5.

Placeholders to fill before presenting: `{{TEAM}}` (slide 1 and its notes), `{{EVAL_TABLE}}` and
the `{{EVAL_DATE_ACC}}`, `{{EVAL_FOOD_P}}`, `{{EVAL_FOOD_R}}`, `{{EVAL_LEAKS}}`, `{{EVAL_N}}` cells
(slide 8), `{{EVAL_SUMMARY}}` (slide 8 notes). After editing, re-export the PDF (below).

The only statistics in the deck are the verified ones from `research/problem-evidence.md`
(Kannan & Veazie 2023 on slide 2; Blair, Thompson & Wuensch 2005 on slide 3; Mollgaard &
Mathiesen 2016 in the slide 3 notes only).

## Preview the motion demo

```
node story/render/serve.mjs
```

Open `http://127.0.0.1:5178/motion/index.html?layout=vertical` or `?layout=landscape`.

## Re-render the videos

The render tools are **not** installed in the project (the project path is ~200 characters and
npm hits Windows MAX_PATH). They live in a short path:

```
mkdir C:\Users\<you>\AppData\Local\Temp\otto-story-tools
cd C:\Users\<you>\AppData\Local\Temp\otto-story-tools
npm init -y
npm install playwright-core ffmpeg-static
```

`render.mjs` loads them with `createRequire` from that folder (override with `OTTO_TOOLS=...`).
It drives the installed Microsoft Edge (`EDGE_PATH=...` to override), so no browser download is
needed. ffmpeg comes from `FFMPEG=...`, else `ffmpeg-static`, else `ffmpeg` on PATH.
(If `ffmpeg-static`'s download is cut short, its `ffmpeg.exe` fails with "not a valid
application"; re-run `node node_modules/ffmpeg-static/install.js` or set `FFMPEG`.)

From the project root:

```
node story/render/render.mjs                    # both MP4s + posters (about 6-8 min on a laptop)
node story/render/render.mjs --only=vertical    # just the 1080x1920 phone video
node story/render/render.mjs --stills=5000,20000   # spot-check PNGs in story/out/stills/
node story/render/render.mjs --deck-pdf         # story/deck/deck.pdf
```

What it does: serves `story/` on a random localhost port, opens
`motion/index.html?layout=…&render=1` in headless Edge, calls `window.__seek(f × 1000/30)` for
every frame, captures each (raw CDP PNG screenshot) to `story/out/frames/<layout>/00000.png`, encodes H.264
(`libx264 -crf 18 -pix_fmt yuv420p -movflags +faststart`), writes the poster PNGs, and deletes
the frames (`--keep-frames` keeps them).

Outputs:

| File | Size |
|---|---|
| `out/otto-phone-1080x1920.mp4` | 59.2 s, 6.8 MB; vertical, phone fills the frame, caption underneath |
| `out/otto-demo-1920x1080.mp4` | 59.2 s, 5.2 MB; landscape, phone centered, chapters left, caption right |
| `out/otto-poster-1080x1920.png`, `out/otto-poster-1920x1080.png`, `out/otto-poster.png` | poster frames (votes beat) |

## Regenerate script.json from a simulator transcript

1. Run the simulator (`npm run sim`) and copy the conversation as `Name: text` lines.
2. Paste them into a copy of `story/motion/storyboard.txt`, keeping the directives
   (`@chapter`, `@caption`, `@react`, `@call` … `@endcall`, `@end`). The format is in
   `story/motion/README.md`.
3. `node story/motion/build-script.mjs story/motion/storyboard.txt story/motion/script.json`
   (prints the total length; aim for 45-60 s).
4. Preview with `serve.mjs`, spot-check with `--stills`, then run `render.mjs`.

You can also write `script.json` by hand or from code: the schema is in `story/motion/README.md`.

## What is real and what is not (keep this honest)

- The phone UI is an original mock-up ("iMessage-style" in spirit, no Apple logos or marks).
- Otto's lines are the real templates from `docs/STATE_MACHINE.md`, `docs/HUNGRY_FLOW.md` and
  `docs/PRIVACY.md`, including the exact intro from PRIVACY.md §1.
- Restaurants are real entries from `src/places/data/harvard-allston.json` (© OpenStreetMap
  contributors, ODbL). Prices are team estimates, shown as "~$$ (est.)"; walk times are our
  haversine estimate from the Harvard Sq centroid. The snapshot has no Thai places near Harvard
  Sq, so the hungry beat asks for tacos instead of Thai.
- The phone call is **simulated** and labeled "Simulated call audio" on screen. The number is a
  masked placeholder, "(617) 555-01xx".
- The QR code on the end card is a placeholder ("Text Otto: (number TBA)").
- Heads-up: the OSM snapshot contains a Harvard Sq pizza place literally named "Otto". The demo
  avoids it; the mention detector may want to know about it.
