| Metric | Result |
|---|---|
| Date replies: per-day votes read correctly | **98.5%** (135 day-cells in 45 messages) |
| Date replies: whole message exactly right | 95.6% |
| Correct final date | **10/10** fixtures |
| Correct lock reason (everyone / deadline / threshold / forced) | 10/10 |
| Food-intent precision / recall | **100.0% / 87.9%** (183 labeled messages) |
| Hungry flow triggered exactly when it should | 10/10 |
| Recommendation matches stated cuisine and budget | 3/4 |
| Message intent accuracy (7 classes) | 95.6% |
| Unprompted group messages sent (all fixtures) | 5; noise budget respected in 10/10; quiet-hour violations 0 |
| Log lines with message text, phone numbers, emails or handles | **0** of 502 |
| Database values containing plaintext message text or numbers | **0** |

| Fixture | Final date | Lock | Hungry | Place | Unprompted (max/12h) | Date cells | Errors |
|---|---|---|---|---|---|---|---|
| 01-happy-path-thai | ✓ fri | ✓ everyone | ✓ | ✗ Bon Me | 2 (1) | 15/15 | 0 |
| 02-food-idioms-forced-lock | ✓ thu | ✓ forced | ✓ | – my apt | 0 (0) | 15/15 | 0 |
| 03-conflict-bridge | ✓ sat | ✓ everyone | ✓ | – ben's apt | 0 (0) | 15/15 | 0 |
| 04-time-shift-ruthless-deadline | ✓ fri | ✓ deadline | ✓ | – the pub on mass ave | 2 (1) | 17/18 | 0 |
| 05-threshold-hungry-midpoll | ✓ fri | ✓ threshold | ✓ | ✓ Tabla Express | 0 (0) | 12/12 | 0 |
| 06-silent-member-call | ✓ fri | ✓ everyone | ✓ | – lily's apartment | 1 (1) | 12/12 | 0 |
| 07-veto-after-confirm | ✓ sat | ✓ everyone | ✓ | ✓ Hokkaido Ramen Santouka | 0 (0) | 24/24 | 0 |
| 08-hackathon-instant-meet-middle | ✓ sat | ✓ none | ✓ | ✓ Dolphin Bay | 0 (0) | 0/0 | 0 |
| 09-privacy-forget-stop | ✓ none | ✓ none | ✓ | –  | 0 (0) | 9/9 | 0 |
| 10-quiet-hours-late-night | ✓ wed | ✓ everyone | ✓ | –  | 0 (0) | 14/15 | 0 |
