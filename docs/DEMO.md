# The demo story (canonical)

Both the offline simulator demo (`npm run demo`) and the phone video (`story/motion`) follow this script. Every name, number and label below must match in both.

**Cast.** The group chat is "the crew": Ana, Ben, Sam, Jo, Maya and You. "You" is the phone owner, shown in blue bubbles. The agent is **Homi**, and the app is **Whats the Word**.

**Time zone.** America/New_York. The story starts Sat Oct 17, 2026, 10:00am. Dinner is Fri Oct 23, 7pm.

**Noise rule for pledges.** Pledge messages are transactional updates for a flow the participants opted into: the check-in count, the settlement and dispute results. They count as *prompted*, so they never spend the 1-unprompted-message-per-12h budget (docs/STATE_MACHINE.md hard rule 2).

**Labels that must be visible wherever they apply:**
- "SIMULATED" on every deposit, refund and forfeit.
- "Example listing · estimated price" on every travel listing.
- "(simulated call)" on the phone call.
- "demo link" on the album URL.

---

## Act 1: the plan (existing flow, unchanged behavior)

1. Maya: "guys we never hang out anymore" → Homi posts its one-time intro (name Homi).
2. You: "@homi dinner next week?" → Homi posts a header and three options: Thu Oct 22, Fri Oct 23 and Sat Oct 24, all at 7pm.
3. Replies come in ("fri works, i'm busy thu and sat", "sat works. thu and fri i can't", and so on). The **conflict bridge** appears and adds Sat Oct 24 · 11am. Then hearts, and "anything but thu".
4. 12 hours later Homi nudges once and calls Sam, who opted in **(simulated call)**. Sam answers "friday works", and Homi posts "Fri Oct 23 · 7pm it is: 5 in."
5. Maya: "ok I'm starving where are we eating" → one question; the answers are ramen, cheap, harvard square. Homi offers three places and the group locks **Hokkaido Ramen Santouka, 1 Bow Street, Cambridge**.

## Act 2: show-up pledge (optional commitment)

6. Maya: "homi let's do a $10 show-up pledge"
7. Homi asks first where no-show money should go. **Nothing is held until every participant agrees.**
   - **Header:** "Show-up pledge for Fri Oct 23 · 7pm: $10 each, back when you check in. First, where should no-show money go (everyone who pledges has to agree)?"
   - **Options:**
     - `1 · Group fund for the next outing`
     - `2 · Split among the people who showed up`
     - `3 · Donate to a charity we pick`
   - **Rules card:** a header plus line fragments.
     - Header: "How the pledge works (payments are SIMULATED in this demo):"
     - `· Check in: "homi I'm here" at Hokkaido Ramen Santouka, 6:45–7:30pm; it counts once a second person is there (or someone 👍s it)`
     - `· Refund: automatic, by 8:30pm`
     - `· No-show: your $10 goes where we agree`
     - `· Cancel by Thu Oct 22, 7pm for a full refund ("homi cancel my pledge")`
     - `· Disputes: "homi dispute" within 24h; the others vote, a tie means a refund`
8. Ana, Ben, Jo, Maya, Sam and You all pick option 1, by ❤️ or by replying "1".
   - Homi: "Everyone agreed: no-show money goes to the group fund. Pledges are open: say "homi I'm in" to put down $10 (SIMULATED, no real money moves)."
9. All six say "homi I'm in". Homi acknowledges each one with 👍, then posts once:
   - "6 of 6 pledged: $60 held (SIMULATED). See you Friday at 7."

## Act 3: the night out (Fri Oct 23)

10. **Check-ins** (6:50–7:05pm): Ana, Ben, Jo, Maya and You each say "homi I'm here". Sam doesn't show.
    - Homi acknowledges each check-in with a 👍 reaction.
    - When only one person is left, Homi replies to that check-in: "5 of 6 checked in ✓ Still waiting on Sam; check-in closes at 7:30pm."
    - **Verification:** a check-in counts once a second participant has checked in (mutual presence) or someone 👍s it; anything wrong goes through disputes.

11. **The bill.** Ben paid for the whole table and logs it:
    - Ben: "homi itemize dinner, paid by ben: ana shio ramen 16.50; ben spicy miso ramen 17.50 + gyoza 8; jo toroniku ramen 21; maya veggie ramen 16; you shoyu ramen 16.50; shared edamame 6 + karaage 10; tax 7%; tip 20%"
    - **Arithmetic** (shared items $16.00 split 5 ways, so $3.20 each):
      - Subtotal $111.50
      - Tax 7% = $7.81 (the $7.805 rounds half-up)
      - Tip 20% on the pre-tax subtotal = $22.30
      - **Total $141.61**
      - Each person pays their own items plus a share of tax and tip in proportion to their subtotal. Rounding uses the largest remainder, so the shares add up to exactly $141.61.

    | Person | Items + shared | Share of tax + tip | Owes |
    |---|---|---|---|
    | Ana | 16.50 + 3.20 = 19.70 | 5.32 | **25.02** |
    | Ben | 25.50 + 3.20 = 28.70 | 7.75 | **36.45** |
    | Jo | 21.00 + 3.20 = 24.20 | 6.54 | **30.74** |
    | Maya | 16.00 + 3.20 = 19.20 | 5.18 | **24.38** |
    | You | 16.50 + 3.20 = 19.70 | 5.32 | **25.02** |
    | **Total** | **111.50** | **30.11** | **141.61** |

    - Homi replies with a card:
      - Header: "Dinner $141.61 (tax $7.81 + 20% tip $22.30), paid by Ben:"
      - `Ana $25.02 · Ben $36.45 · Jo $30.74 · Maya $24.38 · You $25.02`
      - Footer: "Adds up to $141.61 exactly."

12. **A second payer:** Jo: "homi jo paid 23.40 for the uber, split ana jo you"
    - Homi: "Uber $23.40 paid by Jo: $7.80 each for Ana, Jo and You."

13. Ana: "homi settle up" → Homi card:
    - Header: "Here's who pays whom (2 expenses, $165.01):"
    - `Ana → Ben $32.82`
    - `You → Ben $32.82`
    - `Maya → Ben $24.38`
    - `Jo → Ben $15.14`
    - Footer: "Then everyone's even."
    - **Check:** Ana 25.02 + 7.80 = 32.82. You 25.02 + 7.80 = 32.82. Maya 24.38. Jo owes 30.74 + 7.80 = 38.54 but paid 23.40, so 15.14. Ben paid 141.61, owes 36.45, and receives 105.16. The four transfers sum to 105.16 ✓.

14. **Pledge outcome**, at 8:30pm (SIMULATED):
    - Homi: "Pledge settled (SIMULATED): $10 back to Ana, Ben, Jo, Maya and You. Sam didn't check in, so Sam's $10 went to the group fund (now $10); Sam can dispute until Sat 8:30pm."

## Act 4: shared memories

15. You: "homi start an album for tonight"
    - Homi: "Album "Ramen night · Fri Oct 23" is open to this group only: https://homi.example/a/… (demo link). Send photos with "homi add" or reply to this message; you can remove your own anytime with "homi remove my photos"."
16. Ana sends 1 photo, Jo sends 2 and Maya sends 1, each with "homi add".
    - Homi: "4 photos in the album from Ana, Jo and Maya."
17. **Video only:** the album screen shows a 2×2 grid with contributor names, captioned "members only".
18. Jo: "homi remove my photos" → Homi: "Removed Jo's 2 photos; 2 left in the album."

## Act 5: the next trip

19. Ana: "homi let's plan Japan for 2030"
    - Homi: "Japan 2030, love it ✈️ Where are you flying from, roughly when and for how long, how many of you, and a budget per person?"
20. The answers:
    - Ana: "boston, late march for cherry blossoms, 10 nights"
    - Ben: "5 of us, ~$3,000 each all in"
    - Maya: "food, temples, one onsen night"
21. Homi sends an overview card. **Everything is a labeled estimate**, because flights and stays for spring 2030 can't be booked yet.
    - Header: "Japan · late Mar 2030 · 10 nights · 5 from Boston. Too far ahead to book, so these are estimates in today's prices:"
    - **Itinerary:**
      - `Days 1–4 · Tokyo (Asakusa base)`
      - `Day 5 · Hakone onsen night`
      - `Days 6–8 · Kyoto (+ Nara day trip)`
      - `Days 9–10 · Osaka, fly home from Kansai`
    - **Budget lines, per person:**
      - `✈️ Flights BOS→Tokyo, Osaka→BOS (open-jaw, 1 stop): ~$1,300`
      - `🏠 Stays, budget tier: ~$450 · Example listing · estimated price: 3-bedroom Airbnb-style apartment in Asakusa, ~$230/night for 5`
      - `🚄 Trains + transit: ~$220 (individual Shinkansen tickets beat a nationwide JR Pass on this route)`
      - `🍜 Food + activities: ~$700`
    - Footer: "Total ≈ $2,670 per person ($13,350 for 5), under your $3,000."
22. Homi offers the comfort upgrade and explains the price difference:
    - "Want it more comfortable? 4★ hotels plus one ryokan night with dinner runs ≈ $3,620 per person (+$950: stays ~$1,300 instead of ~$450, food ~$800 instead of ~$700)."
23. **Savings card:**
    - Header: "Less obvious savings:"
    - `· Fly into Tokyo and home from Osaka: no backtracking`
    - `· Book the ryokan on a weeknight`
    - `· Late March is peak bloom; early April or mid-May is usually cheaper`
    - `· Convenience-store breakfasts`
    - Footer: "Last-minute deals: none yet; I'll watch fares once 2030 schedules open (about 11 months out)."
24. Ben: "comfortable please"
    - Homi: "Comfort plan saved: ≈ $3,620 per person, all estimates. Say "homi trip" anytime to see it."

## Act 6: privacy

25. Jo: "homi what do you know"
    - Homi replies with a full dump: the dinner plan, the pledge outcome, the bill tab, the trip estimate, and an album with 2 photos from Ana and Maya.
26. Ana: "homi forget"
    - Homi: "Done: I've deleted this plan."
    - The album, bill tab and trip stay until the group deletes them: "homi delete album", "homi clear the tab", "homi forget the trip". "homi stop" deletes everything.

**End card:** Whats the Word · Homi, the friend who makes plans happen · Built on Photon.
