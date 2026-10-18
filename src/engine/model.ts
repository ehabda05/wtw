// Engine-local types. These extend the frozen contract in ./types.ts with a few optional fields the
// state machine needs. They are plain JSON (they survive the sealed-blob round trip) and none of them
// holds message text. Each one is listed as a contract change request in the engine report.

import type { HungryState, MemberKey, Plan, PriceBand, Tone, Vote, DayPref } from './types.js';

export interface EngineHungry extends HungryState {
  /** member -> cuisine tags they voted for (dedupes "+1 per member per cuisine"). */
  memberCuisines?: Record<MemberKey, string[]>;
  /** member -> neighborhoods they mentioned (dedupes mentions). */
  memberPlaces?: Record<MemberKey, string[]>;
  /** "Which neighborhood? I never use your location." is asked at most once. */
  askedWhere?: boolean;
  /** places_result.source ("osm" | "fallback" | "google"), shown by `homi why`. */
  source?: string;
  /** Lookups made so far (an empty result is retried once with new answers, then the flow gives up). */
  searches?: number;
  /** DEMO_SIMPLE deliberation: how many times the cuisine window was extended for lack of a majority. */
  extensions?: number;
  /** DEMO_SIMPLE deliberation: the last split tally Homi announced, so it is not repeated verbatim. */
  lastSplit?: string;
}

export type LockReason = 'deadline' | 'everyone' | 'threshold' | 'forced' | 'bridge';

export interface EnginePlan extends Plan {
  hungry?: EngineHungry;
  /** A proposed date/time is waiting for a distinct member's explicit vote before automatic locking resumes. */
  pendingProposal?: {
    optionId?: number;
    day?: string;
    time?: string;
    member: MemberKey;
    createdAt: number;
    needsClarification?: boolean;
    needsMeridiem?: boolean;
  };
  /** Members seeded from the platform roster at plan start (core.ts seedRoster); the place vote waits for a majority of them. */
  rosterSize?: number;
  /** The trigger named no activity ("homi plan something"); Homi asked, and the next answer sets it. */
  activityUnknown?: boolean;
  /** A window named before the activity was known; opened once the activity arrives. */
  pendingWindow?: WindowSpec;
  /** Demo quorum: when the silent were asked; a pending member's bare "yes"/"no"/"1" after that counts even unaddressed. */
  quorumAskedAt?: number;
  /** Cuisine tags named in the plan trigger ("thai dinner next week?"), seeded into the hungry flow. */
  cuisineHint?: string[];
  /** Bridge questions already asked ("day_conflict", "time_shift:2"); each is asked once per plan. */
  bridgesAsked?: string[];
  remindDaySent?: boolean;
  remindHourSent?: boolean;
  remind30Sent?: boolean;
  rainLikely?: boolean;
  weatherReq?: string;
  lockedBy?: LockReason;
  /** Days removed by veto-and-swap; never proposed again for this plan. */
  excludedDays?: string[];
  /** ISO days of the requested window, so veto-and-swap can re-propose inside it. */
  windowDays?: string[];
  /** Explicit time from the trigger ("at 8"), "HH:mm". */
  preferredTime?: string;
  /** Short windows: members called/DM'd at the deadline; the lock waits for their results (or +10 min). */
  escalationPending?: MemberKey[];
}

export interface ParsedAvailability {
  /** Day-level answers by ISO date (apply to every option on that day, including later ones). */
  dayPrefs: Record<string, DayPref>;
  /** Explicit per-option answers (numbers, ordinals). */
  optionVotes: Record<number, Vote>;
  /** Quantifier: "either" / "none" / "anything but sat" sets every option first. */
  all?: Vote;
  /** Bare "I'm in" / "down" read as all = yes. */
  lowConfidence: boolean;
  /** Anything usable was found. */
  matched: boolean;
  /** DATE_FINDING §3 rule 6: reference + polarity cue, or references only. */
  voteLike: boolean;
  /** Qualified slots ("sat brunch", "fri late", "fri after 8:30") -> canonical time, for bridges. */
  slots: Array<{ day: string; time: string; vote: Vote }>;
}

export type Command =
  | { kind: 'stop' }
  | { kind: 'forget' }
  | { kind: 'privacy' }
  | { kind: 'dump' }
  | { kind: 'help' }
  | { kind: 'status' }
  | { kind: 'why'; ref?: string }
  | { kind: 'food' }
  | { kind: 'plan'; rest: string }
  | { kind: 'threshold'; n: number }
  | { kind: 'lock'; ref: string }
  | { kind: 'name'; name: string }
  | { kind: 'out' }
  | { kind: 'optin'; mode: 'dm' | 'call' }
  | { kind: 'tone'; tone: Tone }
  | { kind: 'note_set'; key: string; value: string }
  | { kind: 'note_get'; key: string }
  | { kind: 'notes' }
  | { kind: 'ics' }
  | { kind: 'split'; amount: number; ways?: number }
  | { kind: 'notice'; on: boolean }
  | { kind: 'tz'; place: string }
  | { kind: 'headcount'; n: number }
  | { kind: 'place_set'; place: string }
  | { kind: 'set_time'; time: string }
  | { kind: 'no_place' }
  | { kind: 'change_place'; cuisines?: string[] }
  | { kind: 'remind' }
  | { kind: 'go' }
  | { kind: 'yes' }
  | { kind: 'no' };

export type CommandKind = Command['kind'];

export interface Taste {
  cuisines: string[];
  vetoes: string[];
  price?: PriceBand;
  diet: string[];
  neighborhoods: string[];
  category?: 'cafe' | 'bowling' | 'museum' | 'park' | 'activity';
  wildcard: boolean;
  vague: boolean;
  go: boolean;
}

export interface WindowSpec {
  /** Human label: "next week", "this weekend", "tomorrow", "Thu, Fri or Sat". */
  label: string;
  /** Candidate ISO days in group tz, in order. */
  days: string[];
  /** One-day window -> three times on that day. */
  single: boolean;
  /** Days were named explicitly ("thu, fri or sat?"): use them as-is. */
  explicit?: boolean;
  /** The whole requested window ("this week" even when days were named), for veto-and-swap. */
  range?: string[];
}

export interface ActivityInfo {
  activity: string;
  /** true when the text named it (vs the "hang out" default). */
  named: boolean;
  outdoor: boolean;
  weekendPref: boolean;
}
