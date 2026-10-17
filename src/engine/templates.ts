// Every user-facing string Homi sends. Hard rule 1: no message has more than two sentences, and option /
// place bubbles are fragments. test/engine/templates.test.ts renders every template below with every sample
// in TEMPLATE_SAMPLES and lints it with countSentences(). Tone variants apply to nudges and the deadline lock
// only (STATE_MACHINE.md "Tone dial"); privacy, stop and error copy is always plain.

import type { Tone } from './types.js';
import { capitalize } from './util.js';

/**
 * Counts sentences the way a reader would: terminal . ! ? (optionally followed by a closing quote or
 * bracket) end a sentence; URLs, decimals ("$28.50"), file names ("PRIVACY.md") and a few abbreviations
 * ("est.", "Ave.") do not. A trailing fragment without punctuation counts as a sentence if it has a
 * letter or digit. Emoji-only fragments do not count.
 */
export function countSentences(text: string): number {
  const t = text
    .replace(/"[^"\n]*"/g, 'Q') // a quoted example command ("homi dinner next week?") is not a sentence end
    .replace(/https?:\/\/\S+/g, 'URL')
    .replace(/(\d)\.(\d)/g, '$1$2')
    .replace(/\b(e\.g|i\.e|etc|vs|approx|est|min|st|ave|rd|blvd|dr|mt|ft|jr|sr|mr|mrs|ms)\./gi, '$1')
    .replace(/\.{2,}|…/g, ' ');
  const parts = t.split(/[.!?]+["')\]]*(?=\s|$)/);
  return parts.filter((p) => /[\p{L}\p{N}]/u.test(p)).length;
}

const maybeTail = (maybe: number) => (maybe > 0 ? `, ${maybe} maybe` : '');

export const TEMPLATES = {
  // ── consent & privacy (always plain) ──
  intro: (p: { hours: number }) =>
    `Hi, I'm Homi 👋 Mention me or say /plan and I'll find a date and a place for this group; I skip every other message and never save your chats. I keep only the plan, delete it ${p.hours}h after the event, and "homi stop" makes me delete everything and leave.`,
  help: () =>
    `I can find a date ("homi dinner next week?"), pick food, split bills ("homi split 84 3 ways"), run a $10 show-up pledge (simulated money), keep a shared album and plan trips. Ask "homi what do you know" anytime to see everything I store.`,
  privacy: (p: { hours: number }) =>
    `I keep only the plan (dates, votes, place, and names you give me), never your messages, and I delete it ${p.hours}h after the event. Say "homi what do you know" to see all of it or "homi forget" to delete it now (full policy: docs/PRIVACY.md).`,
  stopLeave: () => `Deleted everything for this chat. Bye 👋`,
  stopTombstone: () =>
    `Deleted everything for this chat, and I'll ignore it from now on 👋 This app won't let me leave on my own, so please remove me from the group.`,
  forgetDone: () => `Done: I've deleted this plan.`,
  forgetNothing: () => `There's no plan to forget right now.`,
  unknown: () => `Not sure what you mean; try "homi where are we at" or "homi help".`,
  needPlan: () => `There's no plan yet; say "homi dinner next week?" to start one.`,
  alreadyPlan: () => `We already have a plan going; say "homi where are we at" to see it, or "homi forget" to start over.`,

  // ── dates ──
  askWhen: () => `I'm in. Roughly when: this week, this weekend, or next week?`,
  datesNudge: (p: { activity: string }) => `Still up for ${p.activity}? Just tell me when-ish.`,
  header: (p: { activity: string; window: string; deadline: string; how: 'tap' | 'reply'; tally?: string }) => {
    const head = `${capitalize(p.activity)}, ${p.window}${p.tally ? ` ✓ ${p.tally}` : ''}.`;
    return p.how === 'tap'
      ? `${head} Tap ❤️ on every time that works (or reply like "fri or sat"); I'll lock it in ${p.deadline}.`
      : `${head} Reply with the numbers that work (like "1 3") or days (like "fri or sat"); I'll lock it in ${p.deadline}.`;
  },
  pollQuestion: (p: { activity: string; window: string; deadline: string }) =>
    `${capitalize(p.activity)}, ${p.window}: pick every time that works, and I'll lock it in ${p.deadline}.`,
  optionBubble: (p: { id: number; label: string }) => `${p.id} · ${p.label}`,
  whichOnes: (p: { ids: string }) => `Got it, which ones could work: ${p.ids}?`,
  noneWork: () => `None of these work for anyone yet. Reply with a day that does, or "homi forget" to drop it.`,

  // ── locking ──
  lockEarly: (p: { label: string; yes: number; maybe: number }) => `${p.label} it is: ${p.yes} in${maybeTail(p.maybe)}.`,
  lockDeadline: (tone: Tone, p: { label: string; yes: number; maybe: number; absent?: string }) => {
    if (tone === 'gentle') return `Going with ${p.label}, ${p.yes} can make it 💛`;
    if (tone === 'ruthless')
      return p.absent ? `Time's up: ${p.label} it is, and ${p.absent} will hear about this.` : `Time's up: ${p.label} it is.`;
    return `${p.label} it is: ${p.yes} in${maybeTail(p.maybe)}.`;
  },
  whereTo: () => `Where to: say "homi find food" for 3 options, or tell me the spot ("homi we're going to …").`,
  maybePing: (p: { names?: string }) => (p.names ? `${p.names}, you said maybe; still good?` : `If you said maybe, still good?`),
  missYou: (p: { names?: string }) => (p.names ? `${p.names}, we'll miss you this time.` : `We'll miss whoever can't make it this time.`),
  stranded: (p: { win: string; winYes: number; notNames: string; alt: string; altYes: number; inclNames: string; altWord: string }) =>
    `${p.win} works for ${p.winYes} (not ${p.notNames}); ${p.alt} works for ${p.altYes} including ${p.inclNames}. ${p.win} unless someone says "${p.altWord}" in the next few hours?`,
  switched: (p: { label: string; yes: number }) => `Switched: ${p.label} it is, ${p.yes} in.`,
  card: (p: { when: string; place?: string; yes: number; maybe: number; remind: 'the day before' | 'an hour before' | 'none' }) =>
    `Locked: ${p.when}${p.place ? ` · ${p.place}` : ''} · ${p.yes} in${maybeTail(p.maybe)}. ${
      p.remind === 'none' ? `Say "homi add to calendar" for an invite.` : `I'll remind you ${p.remind}; say "homi add to calendar" for an invite.`
    }`,

  // ── nudges (tone dial) ──
  nudgeCollective: (tone: Tone, p: { k: number; n: number; who: string; deadline: string; day: number; hasHave: 'has' | 'have'; how: 'tap' | 'reply' }) => {
    if (tone === 'gentle')
      return `No rush! ${p.k} of ${p.n} have picked; ${p.how === 'tap' ? 'tap a time above' : 'reply with a number'} when you get a sec 💛`;
    if (tone === 'ruthless') return `Day ${p.day}: ${p.who} ${p.hasHave} said nothing. The group waits; I lock ${p.deadline} regardless.`;
    return `${p.k} of ${p.n} have picked. Still need ${p.who}; I'm locking it in ${p.deadline}.`;
  },
  nudgeIndividual: (tone: Tone, p: { days: string; how: 'tap' | 'reply' }) => {
    if (tone === 'gentle') return `Hey, no pressure: does ${p.days} work for you?`;
    if (tone === 'ruthless') return `Still waiting on you. ${p.days}; choose wisely.`;
    return p.how === 'tap' ? `${p.days}? Tap a time above.` : `${p.days}? Reply with the numbers that work.`;
  },
  detailsNudge: (p: { day: string }) => `Still need a spot for ${p.day}; want 3 options? Say "homi find food".`,
  escalate: (p: { who: string; mode: 'call' | 'dm' | 'mixed' }) =>
    p.mode === 'call'
      ? `Still need ${p.who}, so I'm giving them a quick call (they said that's ok).`
      : p.mode === 'dm'
        ? `Still need ${p.who}, so I'm sending them a quick DM (they said that's ok).`
        : `Still need ${p.who}, so I'm checking in with them privately (they said that's ok).`,
  escalateDeadline: (p: { who: string; callees: string; same: boolean; mode: 'call' | 'dm' | 'mixed' }) => {
    const them = p.same ? 'them' : p.callees;
    const how =
      p.mode === 'call' ? `I'm giving ${them} a quick call` : p.mode === 'dm' ? `I'm sending ${them} a quick DM` : `I'm checking in with ${them} privately`;
    return `Still need ${p.who} before I lock it in, so ${how} (they said that's ok).`;
  },
  escalateTimeout: (p: { name: string; day: string }) => `Couldn't reach ${p.name}; going with ${p.day}.`,
  dmCheckIn: (p: { options: string }) =>
    `Quick check from Homi for your group plan: which of ${p.options} work for you? Reply in the group with the numbers (like "1 3").`,
  /** PRIVACY §10: only the open question and the times. Never names, the place, or the group. */
  callQuestion: (p: { options: string }) => `Hi, this is Homi calling about your group's plan. Does ${p.options} work for you?`,
  callYes: (p: { name: string; days: string; k: number; n: number; simulated: boolean }) =>
    `${p.name}'s in for ${p.days} (by phone). ${p.k} for ${p.n} 🎉${p.simulated ? ' (simulated call)' : ''}`,
  callNone: (p: { name: string; simulated: boolean }) =>
    `${p.name} can't make any of these (by phone${p.simulated ? ', simulated call' : ''}).`,
  callUnclear: (p: { name: string; simulated: boolean }) =>
    `${p.name} picked up${p.simulated ? ' (simulated call)' : ''}, but I couldn't catch an answer; I'll go with who's answered.`,
  callFailed: (p: { name: string; simulated: boolean; deadline?: string }) =>
    `Couldn't reach ${p.name} by phone${p.simulated ? ' (simulated call)' : ''}; ${
      p.deadline ? `the vote still closes ${p.deadline}.` : "I'll go with who's answered."
    }`,
  nudgeEscalate: (p: { k: number; n: number; who: string; callees: string; same: boolean; mode: 'call' | 'dm' | 'mixed'; deadline: string }) => {
    const them = p.same ? 'them' : p.callees;
    const how =
      p.mode === 'call' ? `I'm giving ${them} a quick call` : p.mode === 'dm' ? `I'm sending ${them} a quick DM` : `I'm checking in with ${them} privately`;
    return `${p.k} of ${p.n} have picked, and I'm locking it in ${p.deadline}. Still need ${p.who}, so ${how} (they said that's ok).`;
  },

  // ── bridges (prompted, immediate) ──
  dayConflict: (p: { a: string; dayA: string; b: string; dayB: string; altA: string; altB: string }) =>
    `${p.a} can only do ${p.dayA} and ${p.b} only ${p.dayB}. Could either of you do ${p.dayA} ${p.altA} or ${p.dayB} ${p.altB} (I'll add it)?`,
  addedOption: (p: { how: 'tap' | 'reply' }) =>
    p.how === 'tap' ? `Added it as a new option; tap ❤️ if it works.` : `Added it as a new option; reply with its number if it works.`,
  timeShift: (p: { day: string; time: string; count: number; everyone: boolean }) =>
    `${p.day} works for ${p.everyone ? 'everyone' : p.count} if we push to ${p.time}. Want ${p.day} ${p.time}?`,
  timeShiftDone: (p: { bubble: string }) => `Moved it: ${p.bubble}.`,
  timeShiftKeep: (p: { time: string }) => `Okay, keeping ${p.time}.`,
  timeMoved: (p: { time: string }) => `Changed the time to ${p.time}:`,
  timeNoted: (p: { time: string }) => `Got it, ${p.time}. Which day?`,
  timeTooSoon: (p: { time: string }) => `${p.time} has passed or is too soon; keeping the options as they are.`,
  timeAlready: (p: { time: string; ids: string; how: 'tap' | 'reply' }) =>
    `${p.time} is already there, options ${p.ids}; ${p.how === 'tap' ? 'tap ❤️ on' : 'reply with'} the one that works.`,

  // ── intake ──
  askActivity: () => `I'm in. What are we doing: dinner, drinks, brunch, or something else?`,

  // ── demo quorum (QUORUM_DM_AFTER_MS) ──
  quorumPing: (p: { who: string; dmd: boolean; by: string }) =>
    p.dmd ? `Still need ${p.who}; I've asked them privately. No word by ${p.by} counts as not coming.` : `Still need ${p.who}: does any of these work? No word by ${p.by} counts as not coming.`,
  dmQuorum: (p: { activity: string; options: string }) => `Homi here, from the group chat: does ${p.options} work for you for ${p.activity}? Reply yes, no, or a number.`,
  dmThanks: () => `Got it, thanks. I'll tell the group.`,
  quorumOut: (p: { who: string }) => `No word from ${p.who}, so I'm counting them as not coming.`,
  noQuorum: (p: { yes: number; activity: string }) =>
    `Only ${p.yes} can make it, so no ${p.activity} this time. Say "homi ${p.activity} next week" to try again.`,

  // ── commands ──
  statusNone: () => `No plan yet. Say "homi dinner next week?" to start one.`,
  statusDates: (p: { activity: string }) => `Planning ${p.activity}, but I still need a rough time. This week, this weekend, or next week?`,
  statusAvail: (p: { activity: string; window: string; lead: string; tally: string; who?: string; deadline: string }) =>
    `${capitalize(p.activity)}, ${p.window}: ${p.lead} (✓ ${p.tally}). ${
      p.who ? `Still need ${p.who}; I lock it in ${p.deadline}.` : `Everyone has picked, so I'll lock it in ${p.deadline} at the latest.`
    }`,
  statusDetails: (p: { activity: string; when: string; yes: number; maybe: number }) =>
    `${capitalize(p.activity)}, ${p.when}: ${p.yes} in${maybeTail(p.maybe)}. Still need a place: "homi find food" or "homi we're going to …".`,
  statusPlace: (p: { activity: string; when?: string; voting: boolean }) =>
    `${capitalize(p.activity)}${p.when ? `, ${p.when}` : ''}: picking a place right now. ${
      p.voting ? 'Vote on the options above.' : 'Tell me cuisine, budget, and roughly where.'
    }`,
  statusConfirmed: (p: { activity: string; when: string; place?: string; yes: number; maybe: number; pending: number }) =>
    `${capitalize(p.activity)} · ${p.when}${p.place ? ` · ${p.place}` : ''} · ${p.yes} in${maybeTail(p.maybe)}${
      p.pending ? `, ${p.pending} pending` : ''
    }. Say "homi add to calendar" for an invite.`,
  statusCompleted: (p: { activity: string; when: string; deletes: string }) =>
    `${capitalize(p.activity)} was ${p.when}; I'll delete everything ${p.deletes}.`,
  why: (p: { tally: string; notes?: string }) => `${p.tally}.${p.notes ? ` ${capitalize(p.notes)}.` : ''}`,
  whyPlaces: (p: { lines: string; source?: string }) => `${p.lines}.${p.source ? ` ${p.source}.` : ''}`,
  nameSet: (p: { name: string }) => `Hi ${p.name} 👋`,
  nameNoPlan: (p: { name: string }) => `Hi ${p.name} 👋 I only keep names while a plan is open, so tell me again once one starts.`,
  out: () => `All good, next time 💛`,
  optInDm: () => `Got it: if you haven't picked near the deadline, I'll DM you once and tell the group.`,
  optInDmUnavailable: () => `This chat app doesn't let me DM people, so I'll stick to the group.`,
  optInCall: () => `Got it: if you haven't picked near the deadline, I'll call you once and tell the group first.`,
  optInNoPlan: () => `Opt-ins last for one plan, so tell me again once a plan starts.`,
  toneSet: (p: { tone: Tone }) => `Tone set to ${p.tone}.`,
  thresholdSet: (p: { n: number }) => `Got it: I'll lock the first time that gets ${p.n} yes.`,
  headcountSet: (p: { n: number }) => `Got it, ${p.n} of you.`,
  noteSaved: (p: { key: string }) => `Noted: ${p.key}.`,
  noteFound: (p: { key: string; value: string }) => `${capitalize(p.key)}: ${p.value}.`,
  noteMissing: (p: { key: string }) => `I don't have a note about ${p.key}; add one with "homi note ${p.key}: …".`,
  notesList: (p: { list?: string }) => (p.list ? `Notes: ${p.list}.` : `No notes yet; add one with "homi note parking: …".`),
  split: (p: { each: string; n: number }) => `${p.each} each for ${p.n} people (tip not included).`,
  splitAsk: () => `How many ways? Try "homi split 142.50 5 ways".`,
  icsCaption: (p: { activity: string }) => `${capitalize(p.activity)} invite: tap to add it to your calendar (no attendee info inside).`,
  icsNoDate: () => `No date yet, so there's nothing to add; I'll have one after the vote.`,
  icsText: (p: { block: string }) => `Copy this into your calendar:\n${p.block}`,
  noticeOn: () => `Notice is on: if a plan starts forming, I'll offer to help at most once a day.`,
  noticeOff: () => `Notice is off.`,
  noticeOffer: () => `Want me to make that happen? Reply "homi yes" and I'll find a date.`,
  tzSet: (p: { city: string }) => `Got it: quiet hours (11pm–9am) now follow ${p.city} time.`,
  tzUnknown: () => `I don't know that city yet; try a big city nearby, like "homi we're in Chicago".`,
  placeSet: (p: { place: string }) => `Got it: ${p.place}.`,
  placeSetOpen: (p: { place: string }) => `Noted: ${p.place}. I'll lock the date at the deadline.`,
  placeChanged: (p: { place: string }) => `Updated the place: ${p.place}.`,
  lockNothing: () => `Nothing to lock right now.`,
  lockWhich: (p: { ids: string }) => `Which one should I lock: ${p.ids}?`,
  remindSet: () => `Will do: I'll ping 30 minutes before.`,
  remindTooSoon: () => `It's less than 45 minutes away, so no reminder needed 🙂`,
  remindNoTime: () => `There's no time set yet; I'll offer once there is.`,
  vetoReopen: (p: { place?: string }) =>
    p.place ? `No problem: reopening just the date (${p.place} stays).` : `No problem: reopening just the date.`,

  // ── hungry flow ──
  foodAsk: (p: { where: boolean }) =>
    p.where ? `What are we feeling? Cuisine, budget, and roughly where?` : `What are we feeling? Cuisine and budget?`,
  foodWhere: () => `Which neighborhood? I never use your location.`,
  foodHeader: (p: { summary: string; n: number; how: 'tap' | 'reply' }) => {
    const nums = p.n === 1 ? '1' : p.n === 2 ? '1 or 2' : '1, 2 or 3';
    return p.how === 'tap'
      ? `${p.summary}: here ${p.n === 1 ? 'is 1' : `are ${p.n}`}. Tap ❤️ on your pick (or reply ${nums}).`
      : `${p.summary}: here ${p.n === 1 ? 'is 1' : `are ${p.n}`}. Reply ${nums} (or the name) with your pick.`;
  },
  placeBubble: (p: { id: number; name: string; cuisine?: string; price?: string; walk?: string; open: string; check?: string }) =>
    [`${p.id}`, p.name, p.cuisine, p.price, p.walk, p.open, p.check ? `check: ${p.check}` : undefined].filter(Boolean).join(' · '),
  foodNoResults: () => `I couldn't find a match for that nearby. Try another cuisine or neighborhood?`,
  foodGiveUp: () => `I couldn't find a good match, so tell me the spot with "homi we're going to …".`,
  foodHeaderNoMatch: (p: { cuisine: string; where?: string; n: number; price?: string; how: 'tap' | 'reply' }) => {
    const nums = p.n === 1 ? '1' : p.n === 2 ? '1 or 2' : '1, 2 or 3';
    return `No ${p.cuisine}${p.where ? ` near ${p.where}` : ''} in my map; ${p.n} close ${p.n === 1 ? 'pick' : 'picks'} instead${p.price ? `, ${p.price}` : ''}. ${
      p.how === 'tap' ? `Tap ❤️ on your pick (or reply ${nums}).` : `Reply ${nums} (or the name) with your pick.`
    }`;
  },
  placeClose: (p: { name: string; address?: string; url?: string; noVotes: boolean; remindOffer: boolean; emoji?: string }) => {
    const where = [p.address, p.url].filter(Boolean).join(' ');
    const e = p.emoji ?? '🍽️';
    const s1 = p.noVotes
      ? `Going with #1 since nobody objected: ${p.name}${where ? `, ${where}` : ''} ${e}`
      : `${p.name} it is${where ? `: ${where}` : ''} ${e}`;
    return p.remindOffer ? `${s1} Want a reminder 30 min before (say "homi remind me")?` : s1;
  },

  // ── reminders ──
  remindDay: (p: { day: string; time: string; what: string; url?: string; rain: boolean }) =>
    `${p.day} ${p.time}: ${p.what}${p.url ? ` · ${p.url}` : ''}${p.rain ? ' ☔ Rain looks likely, so bring an umbrella.' : ''}`,
  remindHour: (p: { what: string }) => `1 hour to go: ${p.what} 🍜 After, "homi split 120" splits the bill.`,
  remind30: (p: { what: string }) => `30 minutes to go: ${p.what}.`,

  // ── dump frame (content built in dump.ts) ──
  dumpPlan: (p: { parts: string }) => `Here's everything I have for this chat: ${p.parts}. Say "homi forget" to delete it now.`,
  dumpNoPlan: (p: { settings: string }) =>
    `Here's everything I have for this chat: ${p.settings}, and no plan. Say "homi stop" to delete those too.`,
};

type Tpl = typeof TEMPLATES;
const TONES: Tone[] = ['gentle', 'normal', 'ruthless'];

/** Sample arguments for every template (the type forces one entry per template). Used by the linter test. */
export const TEMPLATE_SAMPLES: { [K in keyof Tpl]: Parameters<Tpl[K]>[] } = {
  intro: [[{ hours: 24 }]],
  help: [[]],
  privacy: [[{ hours: 24 }]],
  stopLeave: [[]],
  stopTombstone: [[]],
  forgetDone: [[]],
  forgetNothing: [[]],
  unknown: [[]],
  needPlan: [[]],
  alreadyPlan: [[]],
  askWhen: [[]],
  datesNudge: [[{ activity: 'dinner' }]],
  header: [
    [{ activity: 'dinner', window: 'next week', deadline: 'tomorrow 10am', how: 'tap' }],
    [{ activity: 'dinner', window: 'next week', deadline: 'tomorrow 10am', how: 'reply', tally: 'Thu 1 · Fri 3 · Sat 2' }],
    [{ activity: 'hang out', window: 'Thu, Fri or Sat', deadline: 'tonight 9:30pm', how: 'tap', tally: 'Thu 0 · Fri 1 · Sat 0' }],
  ],
  pollQuestion: [[{ activity: 'drinks', window: 'this weekend', deadline: 'Fri 9:30am' }]],
  optionBubble: [[{ id: 1, label: 'Thu Oct 22 · 7pm' }], [{ id: 4, label: 'Sat Oct 24 · 11am' }]],
  whichOnes: [[{ ids: '1, 2 or 3' }]],
  noneWork: [[]],
  lockEarly: [[{ label: 'Fri Oct 23 · 7pm', yes: 4, maybe: 1 }], [{ label: 'Fri Oct 23 · 7pm', yes: 6, maybe: 0 }]],
  lockDeadline: TONES.flatMap((t) => [
    [t, { label: 'Fri Oct 23 · 7pm', yes: 4, maybe: 1, absent: 'Sam' }] as [Tone, { label: string; yes: number; maybe: number; absent?: string }],
    [t, { label: 'Fri Oct 23 · 7pm', yes: 4, maybe: 0 }] as [Tone, { label: string; yes: number; maybe: number; absent?: string }],
  ]),
  whereTo: [[]],
  maybePing: [[{ names: 'Jo' }], [{}]],
  missYou: [[{ names: 'Ben' }], [{}]],
  stranded: [[{ win: 'Fri', winYes: 4, notNames: 'Ben', alt: 'Sat', altYes: 3, inclNames: 'Ben', altWord: 'sat' }]],
  switched: [[{ label: 'Sat Oct 24 · 7pm', yes: 3 }]],
  card: [
    [{ when: 'Fri Oct 23, 7pm', place: 'Tasty Thai, 1234 Mass Ave', yes: 4, maybe: 1, remind: 'the day before' }],
    [{ when: 'Fri Oct 23, 7pm', yes: 4, maybe: 0, remind: 'an hour before' }],
    [{ when: 'Fri Oct 23, 7pm', yes: 4, maybe: 0, remind: 'none' }],
  ],
  nudgeCollective: TONES.flatMap((t) => [
    [t, { k: 4, n: 6, who: 'Sam and Jo', deadline: 'tomorrow 10am', day: 2, hasHave: 'have', how: 'tap' }] as Parameters<Tpl['nudgeCollective']>,
    [t, { k: 5, n: 6, who: '1 person', deadline: 'tonight 9:30pm', day: 1, hasHave: 'has', how: 'reply' }] as Parameters<Tpl['nudgeCollective']>,
  ]),
  nudgeIndividual: TONES.flatMap((t) => [
    [t, { days: 'Thu, Fri or Sat', how: 'tap' }] as Parameters<Tpl['nudgeIndividual']>,
    [t, { days: 'Thu, Fri or Sat', how: 'reply' }] as Parameters<Tpl['nudgeIndividual']>,
  ]),
  detailsNudge: [[{ day: 'Fri' }]],
  escalate: [[{ who: 'Sam', mode: 'call' }], [{ who: 'Sam and Jo', mode: 'dm' }], [{ who: '2 people', mode: 'mixed' }]],
  escalateDeadline: [
    [{ who: 'Sam', callees: 'Sam', same: true, mode: 'call' }],
    [{ who: 'Sam and Jo', callees: 'Jo', same: false, mode: 'dm' }],
    [{ who: '2 people', callees: 'Sam', same: false, mode: 'mixed' }],
  ],
  escalateTimeout: [[{ name: 'Sam', day: 'Fri' }]],
  dmCheckIn: [[{ options: '1 · Thu 7pm, 2 · Fri 7pm or 3 · Sat 7pm' }]],
  callQuestion: [[{ options: 'Thursday at 7, Friday at 7, or Saturday at 11' }]],
  callYes: [
    [{ name: 'Sam', days: 'Fri', k: 6, n: 6, simulated: false }],
    [{ name: 'Sam', days: 'Fri and Sat', k: 5, n: 6, simulated: true }],
  ],
  callNone: [[{ name: 'Sam', simulated: false }], [{ name: 'Sam', simulated: true }]],
  callUnclear: [[{ name: 'Sam', simulated: true }]],
  callFailed: [[{ name: 'Sam', simulated: false }], [{ name: 'Sam', simulated: true, deadline: 'tomorrow 10am' }]],
  nudgeEscalate: [
    [{ k: 5, n: 6, who: 'Sam', callees: 'Sam', same: true, mode: 'call', deadline: 'tomorrow 10am' }],
    [{ k: 3, n: 6, who: 'Sam, Jo and 1 more', callees: 'Sam', same: false, mode: 'mixed', deadline: 'today 1pm' }],
    [{ k: 4, n: 6, who: 'Sam and Jo', callees: 'Jo', same: false, mode: 'dm', deadline: 'Sun 10am' }],
  ],
  dayConflict: [
    [{ a: 'Ana', dayA: 'Fri', b: 'Ben', dayB: 'Sat', altA: 'late', altB: 'brunch' }],
    [{ a: 'One of you', dayA: 'Thu', b: 'another', dayB: 'Fri', altA: 'late', altB: 'lunch' }],
  ],
  addedOption: [[{ how: 'tap' }], [{ how: 'reply' }]],
  timeShift: [[{ day: 'Fri', time: '8:30pm', count: 5, everyone: true }], [{ day: 'Fri', time: '8:30pm', count: 4, everyone: false }]],
  timeShiftDone: [[{ bubble: '2 · Fri Oct 23 · 8:30pm' }]],
  timeShiftKeep: [[{ time: '7pm' }]],
  timeMoved: [[{ time: '8pm' }]],
  timeNoted: [[{ time: '8pm' }]],
  timeTooSoon: [[{ time: '8pm' }]],
  timeAlready: [[{ time: '8pm', ids: '1 and 2', how: 'tap' }], [{ time: '8pm', ids: '1 and 2', how: 'reply' }]],
  askActivity: [[]],
  quorumPing: [[{ who: 'Sam and Jo', dmd: true, by: '6:45pm' }], [{ who: '2 people', dmd: false, by: 'tonight 6:45pm' }]],
  dmQuorum: [[{ activity: 'dinner', options: '1 · Fri Oct 23 · 7pm' }]],
  dmThanks: [[]],
  quorumOut: [[{ who: 'Sam' }]],
  noQuorum: [[{ yes: 1, activity: 'dinner' }]],
  statusNone: [[]],
  statusDates: [[{ activity: 'dinner' }]],
  statusAvail: [
    [{ activity: 'dinner', window: 'next week', lead: 'Fri leads with 4 yes', tally: 'Thu 1 · Fri 4 · Sat 2', who: 'Sam', deadline: 'tomorrow 10am' }],
    [{ activity: 'dinner', window: 'next week', lead: 'no picks yet', tally: 'Thu 0 · Fri 0 · Sat 0', deadline: 'tomorrow 10am' }],
  ],
  statusDetails: [[{ activity: 'dinner', when: 'Fri Oct 23, 7pm', yes: 5, maybe: 1 }]],
  statusPlace: [[{ activity: 'dinner', when: 'Fri Oct 23, 7pm', voting: true }], [{ activity: 'lunch', voting: false }]],
  statusConfirmed: [[{ activity: 'dinner', when: 'Fri Oct 23, 7pm', place: 'Tasty Thai', yes: 5, maybe: 1, pending: 0 }]],
  statusCompleted: [[{ activity: 'dinner', when: 'Fri Oct 23, 7pm', deletes: 'Sat 7pm' }]],
  why: [
    [{ tally: 'Thu had 1 yes; Fri had 4 yes + 1 maybe; Sat had 3 yes, 2 no' }],
    [{ tally: 'Fri had 4 yes', notes: "I read Jo's reply as a yes to everything (low confidence); Ana locked it early" }],
  ],
  whyPlaces: [[{ lines: '1 Tasty Thai: Thai, fits the budget, 4 min walk; 2 Pho Basil: Thai, 6 min walk', source: 'Places came from the offline OpenStreetMap snapshot (© OpenStreetMap contributors, ODbL)' }]],
  nameSet: [[{ name: 'Sam' }]],
  nameNoPlan: [[{ name: 'Sam' }]],
  out: [[]],
  optInDm: [[]],
  optInDmUnavailable: [[]],
  optInCall: [[]],
  optInNoPlan: [[]],
  toneSet: [[{ tone: 'ruthless' }]],
  thresholdSet: [[{ n: 4 }]],
  headcountSet: [[{ n: 6 }]],
  noteSaved: [[{ key: 'parking' }]],
  noteFound: [[{ key: 'parking', value: 'behind the building' }]],
  noteMissing: [[{ key: 'parking' }]],
  notesList: [[{ list: 'parking: behind the building; door code: 4411' }], [{}]],
  split: [[{ each: '$28.50', n: 5 }]],
  splitAsk: [[]],
  icsCaption: [[{ activity: 'dinner' }]],
  icsNoDate: [[]],
  icsText: [[{ block: 'Dinner · Tasty Thai\nFri Oct 23, 7pm to 9pm (America/New_York)\n1234 Mass Ave' }]],
  noticeOn: [[]],
  noticeOff: [[]],
  noticeOffer: [[]],
  tzSet: [[{ city: 'Chicago' }]],
  tzUnknown: [[]],
  placeSet: [[{ place: "Ana's place" }]],
  placeSetOpen: [[{ place: 'Tasty Thai' }]],
  placeChanged: [[{ place: 'Pho Basil' }]],
  lockNothing: [[]],
  lockWhich: [[{ ids: '1, 2 or 3' }]],
  remindSet: [[]],
  remindTooSoon: [[]],
  remindNoTime: [[]],
  vetoReopen: [[{ place: 'Tasty Thai' }], [{}]],
  foodAsk: [[{ where: true }], [{ where: false }]],
  foodWhere: [[]],
  foodHeader: [
    [{ summary: 'Thai, keeping it cheap, Harvard Sq', n: 3, how: 'tap' }],
    [{ summary: 'Two said Thai, one said Mexican: two Thai spots and a Mexican place, halfway between Harvard Sq and Allston', n: 3, how: 'reply' }],
    [{ summary: 'Good food nearby', n: 1, how: 'tap' }],
  ],
  placeBubble: [
    [{ id: 1, name: 'Tasty Thai', cuisine: 'Thai', price: '~$ (est.)', walk: '4 min walk', open: 'open at 7pm' }],
    [{ id: 3, name: 'Taco Spot', cuisine: 'Mexican', price: '$', walk: '3 min walk', open: 'hours unknown', check: 'nut allergy' }],
  ],
  foodNoResults: [[]],
  foodGiveUp: [[]],
  foodHeaderNoMatch: [
    [{ cuisine: 'Thai', where: 'Harvard Sq', n: 3, price: 'keeping it cheap', how: 'tap' }],
    [{ cuisine: 'Ethiopian', n: 2, how: 'reply' }],
  ],
  placeClose: [
    [{ name: 'Tasty Thai', address: '1234 Mass Ave', url: 'https://maps.example/?q=1', noVotes: false, remindOffer: true, emoji: '🍜' }],
    [{ name: 'Tasty Thai', address: '1234 Mass Ave', url: 'https://maps.example/?q=1', noVotes: true, remindOffer: false }],
    [{ name: 'Tasty Thai', noVotes: false, remindOffer: false }],
  ],
  remindDay: [
    [{ day: 'Tomorrow', time: '7pm', what: 'Tasty Thai, 1234 Mass Ave', url: 'https://maps.example/?q=1', rain: true }],
    [{ day: 'Tomorrow', time: '11am', what: 'hike, place still open', rain: false }],
  ],
  remindHour: [[{ what: 'Tasty Thai, 1234 Mass Ave' }]],
  remind30: [[{ what: 'Tasty Thai, 1234 Mass Ave' }]],
  dumpPlan: [[{ parts: 'plan "dinner" (next week) · options Thu Oct 22 · 7pm, Fri Oct 23 · 7pm · 5 people' }]],
  dumpNoPlan: [[{ settings: 'settings only (tone normal, time zone America/New_York, notice off)' }]],
};

/** Templates whose output must be a single fragment (bubbles). */
export const FRAGMENT_TEMPLATES: Array<keyof Tpl> = ['optionBubble', 'placeBubble'];
