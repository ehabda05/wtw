# Otto motion demo

A dark-mode group chat in a phone frame, driven entirely by `script.json`. Nothing animates on its
own: `window.__seek(ms)` computes every bubble, reaction, typing indicator and caption from the
time alone, so the renderer can capture identical frames at 30 fps.

| File | What it is |
|---|---|
| `index.html` | Stage, phone, chat app, call screen, end card |
| `phone.css` | All styling (system fonts only, no CDN) |
| `timeline.js` | Loads `script.json`, builds the chat once, renders any time `t` |
| `script.json` | The beats. **Replace this** with lines from a real simulator run |
| `storyboard.txt` | Human-friendly source of the current `script.json` |
| `build-script.mjs` | `storyboard.txt` (or a sim transcript) → `script.json`, with automatic timing |

Preview: `node story/render/serve.mjs`, then open
`http://127.0.0.1:5178/motion/index.html?layout=vertical` (or `layout=landscape`). Space pauses,
←/→ jump 2 s, the slider scrubs, `&t=15000` starts at 15 s. Opening the file directly from disk
does not work, because browsers block `fetch('script.json')` on `file://`.

## script.json schema

```json
{
  "version": 1,
  "meta": {
    "chat": "the crew",
    "fps": 30,
    "duration": 58750,
    "clock": "8:14",
    "members": [
      { "id": "you",  "name": "You" },
      { "id": "ana",  "name": "Ana", "color": "#E0567F" },
      { "id": "otto", "name": "Otto", "bot": true }
    ],
    "roster": ["ana", "ben", "maya", "jay", "sam"]
  },
  "events": [ { "t": 1880, "type": "message", "from": "you", "text": "we should hang out!!" } ]
}
```

- `meta.members`: everyone who can speak. `you` is the phone's owner (blue, right side). A member
  with `"bot": true` gets the amber Otto avatar and a warm bubble. Others get a lettered avatar in
  `color`.
- `meta.roster`: who is in the chat before anyone is added (the header shows the first three and
  counts them plus you).
- `meta.duration`: total length in ms. Defaults to the end card's `t + duration`.
- Every event has `t` (ms from the start) and `type`. Events can be in any order.

| `type` | Fields | Effect |
|---|---|---|
| `message` | `from`, `text`, optional `id`, optional `typing` (ms) | A bubble appears at `t`. With `typing`, a typing indicator shows for that long first (for `you`, the text is typed into the compose bar instead). Give it an `id` if something will react to it. |
| `typing` | `from`, `duration` | A typing indicator that appears and then gives up (no message). |
| `reaction` | `target` (message id), `emoji`, `from` | A tapback lands on that bubble; repeats of the same emoji stack into a count. |
| `receipt` | `target` (message id), `text` | Small grey line under the bubble, e.g. "Read by 5". |
| `divider` | `text`, optional `clock` ("6:58"), optional `style: "jump"` | Centered timestamp. `clock` also sets the status-bar time. `*word*` is bold. |
| `system` | `text`, optional `addMember` (member id) | Centered system line; `addMember` also pops that avatar into the header. |
| `jump` | `duration`, `text`, optional `ticker` (array) | Blurs the chat and shows "6 days later" with a ticking list (e.g. day names). |
| `caption` | `text`, optional `until` (ms) | Lower-third caption (beside the phone in landscape). `*word*` is amber. Ends at `until` or at the next caption. |
| `chapter` | `text` | Chapter label (vertical) and chapter list (landscape). |
| `call` | `duration`, `caller`, `number`, `label`, `note`, `accept` (ms into the call), `endAt`, `lines: [{from, text, t, duration}]` | Cuts to an incoming-call screen; the call is accepted at `accept`, then each line's words are revealed over its `duration` (times relative to the call start). `note` is the "Simulated call audio" label. |
| `end` | `title`, `line`, `tagline`, `badge`, `qr`, `duration` | Full-frame end card with a QR placeholder box. |

Display-only typography: `timeline.js` keeps "3 min walk", "~$$ (est.)", "open Fri 7pm", "6 for 6"
and a trailing emoji from breaking across lines. It never changes the words.

## Regenerating script.json from a simulator transcript

`build-script.mjs` turns plain text into `script.json` and does the timing for you (typing
length, reading time, call pacing):

```
node story/motion/build-script.mjs story/motion/storyboard.txt story/motion/script.json
```

The input is one item per line. Paste the simulator's `Name: text` lines in and keep or adjust the
directives around them. (The `# ...` notes below are explanations only: in a real file `#` starts a
comment only at the beginning of a line.)

```
@member you You                 # ids + display names; add "#RRGGBB" for a color, "bot" for Otto
@member otto Otto bot
@roster ana ben maya jay sam
@chapter Find a date
@caption No calendars. Otto *proposes*, friends just *react*.
You: @otto dinner next week?
Otto: Dinner, next week. Tap ❤️ on every time that works ...
+ 1 · Thu Oct 22 · 7pm [#d1]    # "+" = another bubble from the same sender, no typing
@react ❤️ maya #d2               # target: #id, ^1 (last message, the default), ^2 ...
@receipt Read by 5              # under the last "You" message (or add [#id])
@divider *Sun* 7:28 PM | 7:28   # text | status-bar clock [| jump]
@system Maya added Otto to the conversation +otto
@typing jay 1100                # typing that never turns into a message
@jump 1500 6 days later | Sun Mon Tue Wed Thu Fri Sat
@call {"caller":"otto","number":"(617) 555-01xx","label":"Sam's phone","note":"Simulated call audio"}
> Otto: Hi, this is Otto calling about your group's plan. Does Friday at 7 work for you?
> Sam: Friday works.
@endcall
@wait 500                       # also negative, to tighten a gap
@end {"title":"Otto","line":"...","badge":"Built on Photon","qr":"Text Otto: (number TBA)","duration":5000}
```

Names after `Name:` match a member id or display name (case-insensitive). The script prints the
total length; aim for 45-60 s (trim with negative `@wait`s). Then re-render (see `story/README.md`).

If the simulator labels the call as simulated, keep the `note`. If you ever render a real call,
change the note to say so, and never put a real phone number in `number`.
