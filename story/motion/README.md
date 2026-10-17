# Whats the Word motion demo (agent: Homi)

A dark-mode group chat in a phone frame, driven entirely by `script.json`. Nothing animates on its
own: `window.__seek(ms)` computes every bubble, reaction, typing indicator, card, album tile and
caption from the time alone, so the renderer can capture identical frames at 30 fps. The story follows
`docs/DEMO.md` Acts 1-6 (plan, show-up pledge, the night out, shared album, the next trip, privacy).

| File | What it is |
|---|---|
| `index.html` | Stage, phone, chat app, album screen, call screen, title card, end card |
| `phone.css` | All styling (system fonts only, no CDN) |
| `photos.js` | Placeholder "photos" drawn in SVG: `ramen`, `friends` (silhouettes), `city`, `neon` |
| `timeline.js` | Loads `script.json`, builds the chat once, renders any time `t` |
| `script.json` | The beats (generated from `storyboard.txt`) |
| `storyboard.txt` | Human-friendly source of the current `script.json` |
| `build-script.mjs` | `storyboard.txt` (or a sim transcript) → `script.json`, with automatic timing |

Preview: `node story/render/serve.mjs`, then open
`http://127.0.0.1:5178/motion/index.html?layout=vertical` (or `layout=landscape`). Space pauses,
←/→ jump 2 s, the slider scrubs, `&t=81500` starts at 81.5 s. Opening the file directly from disk
does not work, because browsers block `fetch('script.json')` on `file://`.

## script.json schema

```json
{
  "version": 1,
  "meta": {
    "chat": "the crew",
    "fps": 30,
    "duration": 149611,
    "members": [
      { "id": "you",  "name": "You" },
      { "id": "ana",  "name": "Ana", "color": "#E0567F" },
      { "id": "homi", "name": "Homi", "bot": true }
    ],
    "roster": ["ana", "ben", "maya", "jo", "sam"]
  },
  "events": [ { "t": 3330, "type": "message", "from": "you", "text": "we should hang out!!" } ]
}
```

- `meta.members`: everyone who can speak. `you` is the phone's owner (blue, right side). A member
  with `"bot": true` gets the amber Homi avatar and a warm bubble. Others get a lettered avatar in
  `color`.
- `meta.roster`: who is in the chat before anyone is added (the header shows the first three and
  counts them plus you).
- `meta.duration`: total length in ms. Defaults to the end card's `t + duration`.
- Every event has `t` (ms from the start) and `type`. Events can be in any order.

| `type` | Fields | Effect |
|---|---|---|
| `message` | `from`, `text`, optional `id`, `typing` (ms), `card`, `photos`, `quote` | A bubble appears at `t`. With `typing`, a typing indicator shows for that long first (for `you`, the text is typed into the compose bar instead). Give it an `id` if something will react to it. `card` turns it into a card bubble (below); `photos: ["ramen"]` (or two names) shows photo bubbles with `text` as the caption bubble under them; `quote` adds a small reply-quote line above it ("You: homi I'm here"). |
| `typing` | `from`, `duration` | A typing indicator that appears and then gives up (no message). |
| `reaction` | `target` (message id), `emoji`, `from` | A tapback lands on that bubble; repeats of the same emoji stack into a count (votes: "❤️ 5"). Homi's 👍 acknowledgments are reactions `from: "homi"`. |
| `receipt` | `target` (message id), `text` | Small grey line under the bubble, e.g. "Read by 5". |
| `divider` | `text`, optional `clock` ("6:50"), optional `style: "jump"` | Centered timestamp. `clock` also sets the status-bar time. `*word*` is bold. |
| `system` | `text`, optional `addMember` (member id) | Centered system line; `addMember` also pops that avatar into the header. |
| `jump` | `duration`, `text`, optional `ticker` (array) | Blurs the chat and shows "6 days later" with a ticking list (e.g. day names). |
| `caption` | `text`, optional `until` (ms) | Lower-third caption (beside the phone in landscape). `*word*` is amber. Ends at `until` or at the next caption. |
| `chapter` | `text` | Chapter label (vertical) and chapter list (landscape). |
| `call` | `duration`, `caller`, `number`, `label`, `note`, `accept` (ms into the call), `endAt`, `lines: [{from, text, t, duration}]` | Cuts to an incoming-call screen; the call is accepted at `accept`, then each line's words are revealed over its `duration` (times relative to the call start). `label` is the pill at the top ("Sam's phone · (simulated call)"), `note` the label at the bottom ("Simulated call audio"). |
| `album` | `duration`, `title`, `header`, `sub`, `subAfter`, `foot` (`\n` for a second line), `photos: [{art, by}]`, optional `remove: {by, at, toast}` | A full-screen album slides up inside the phone: "Members only" header, title, a 2×2 grid with each contributor's name. With `remove`, that member's tiles fade out at `at` ms, the rest slide into place, `sub` switches to `subAfter` and `toast` pops up. |
| `title` | `title`, `line`, `duration` | Opening title card (app name + Homi avatar), fades into the chat. |
| `end` | `title`, `line`, `tagline`, `badge`, `qr`, optional `name`, `duration` | Full-frame end card with a QR placeholder box. |

**Cards.** `card: { head, rows, sections: [{ title, rows }], foot, compact }`. A row is either a plain
string (a bullet line such as "· Refund: automatic, by 8:30pm") or an object
`{ k, icon, l, note, r }`: `k` is a fixed-width amber key ("Days 1–4", "Plan"), `icon` an emoji,
`l` the label, `note` a small grey line under it, `r` a right-aligned amount ("$25.02", "~$1,300").
Cards are wider than text bubbles (318 px) and are used for the pledge rules, the bill breakdown,
"who pays whom", the trip overview, the savings list and the "what do you know" dump.

**Display-only labels** (the words never change, they only get a visual treatment):
"SIMULATED" becomes a small amber pill (a bracketed "(SIMULATED)" drops its brackets), "(demo link)"
a grey pill, "Example listing · estimated price" a small label, URLs turn link blue, and `**text**` is
bold. `timeline.js` also keeps "3 min walk", "~$$ (est.)", "6 for 6", "3-bedroom", " · " separators
and a trailing emoji from breaking across lines.

## Regenerating script.json

`build-script.mjs` turns plain text into `script.json` and does the timing for you (typing
length, reading time, card reading time, call pacing):

```
node story/motion/build-script.mjs story/motion/storyboard.txt story/motion/script.json
```

The input is one item per line. Paste the simulator's `Name: text` lines in and keep or adjust the
directives around them. (The `# ...` notes below are explanations only: in a real file `#` starts a
comment only at the beginning of a line.)

```
@member you You                 # ids + display names; add "#RRGGBB" for a color, "bot" for Homi
@member homi Homi bot
@roster ana ben maya jo sam
@title {"title":"Whats the Word","line":"Meet Homi, the friend who makes plans happen.","duration":2000}
@chapter Find a date
@caption No calendars. Homi *proposes*, friends just *react*.
You: @homi dinner next week?
Homi: Dinner, next week. Tap ❤️ on every time that works ...
+ 1 · Thu Oct 22 · 7pm [#d1]    # "+" = another bubble from the same sender, no typing
@react ❤️ jo #d2                 # target: #id, ^1 (last message, the default), ^2 ...
@react 👍 homi                   # Homi acknowledges the last message
~Ana: homi I'm in               # "~" = quick message from anyone: no typing, short gap
@quote You: homi I'm here       # reply-quote above the next message
@card Homi {"id":"bill","head":"Dinner $141.61 ...","rows":[{"l":"Ana","r":"$25.02"}],"foot":"...","hold":2800}
@photo Jo friends,city | homi add          # photo bubble(s) + caption bubble
@album {"title":"Ramen night · Fri Oct 23","header":"Members only","photos":[{"art":"ramen","by":"ana"}],"duration":2700}
@receipt Read by 5              # under the last "You" message (or add [#id])
@divider *Fri, Oct 23* 6:50 PM | 6:50 | jump   # text | status-bar clock [| jump]
@system Maya added Homi to the conversation +homi
@typing jo 1100                 # typing that never turns into a message
@jump 1300 6 days later | Sun Mon Tue Wed Thu Fri
@call {"caller":"homi","number":"(617) 555-01xx","label":"Sam's phone · (simulated call)","note":"Simulated call audio"}
> Homi: Hi, this is Homi calling about your group's plan. ...
> Sam: friday works
@endcall
@wait 500                       # also negative, to tighten a gap
@end {"title":"Whats the Word","line":"Homi, the friend who makes plans happen.","badge":"Built on Photon","qr":"Text Homi: (number TBA)","duration":4600}
```

Names after `Name:` match a member id or display name (case-insensitive). A card's `"hold"` (ms)
overrides its automatic reading time; `"id"` names it for reactions. The script prints the total
length; keep it at 120-150 s (trim with negative `@wait`s and card holds). Then re-render (see
`story/README.md`).

If the simulator labels the call as simulated, keep the label and the `note`. If you ever render a
real call, change both to say so, and never put a real phone number in `number`. Keep the SIMULATED,
"demo link" and "Example listing · estimated price" labels wherever `docs/DEMO.md` requires them.
