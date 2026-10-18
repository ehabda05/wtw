// Engine contracts. The engine is pure: applyEvent(state, event, ctx) -> { state, actions }.
// Nothing in GroupState may ever contain message text (see docs/PRIVACY.md §2).
// Times are epoch milliseconds (UTC). Calendar math uses ctx.tz.

// ───────────────────────── identities ─────────────────────────

/** HMAC-SHA256(ID_SALT, platform:spaceId:handle), hex. Different in every group by construction. */
export type MemberKey = string;
/** HMAC-SHA256(ID_SALT, platform:spaceId), hex. */
export type SpaceKey = string;
/** Opaque platform message id, as returned by the channel. Stored only inside the sealed plan blob. */
export type MsgRef = string;

export interface MemberRef {
  key: MemberKey;
  /** Display name the platform itself provides (e.g. Telegram first name/handle). Never a phone number. */
  platformName?: string;
}

// ───────────────────────── capabilities ─────────────────────────

export type Surface = 'sim' | 'terminal' | 'imessage-shared' | 'imessage-dedicated' | 'imessage-local' | 'telegram';

export interface Capabilities {
  surface: Surface;
  groups: boolean;          // can read + post in group chats
  reactionsIn: boolean;     // receives reactions as events
  reactionsOut: boolean;    // can react to messages
  inlineReply: boolean;     // threaded reply to a specific message
  edit: boolean;            // can edit its own sent messages
  editWindowMs: number;     // 0 = unlimited (only meaningful if edit)
  polls: boolean;           // native multi-answer polls with per-member votes
  roster: boolean;          // can list group members
  leave: boolean;           // can leave a group
  files: boolean;           // can send attachments (.ics)
  dm: boolean;              // can message one member privately
  typing: boolean;
}

// ───────────────────────── plan model ─────────────────────────

export type PlanState =
  | 'idle'
  | 'collecting_dates'
  | 'collecting_availability'
  | 'date_chosen'
  | 'collecting_details'
  | 'collecting_place'
  | 'confirmed'
  | 'reminded'
  | 'completed'
  | 'purged';

export type Vote = 'yes' | 'maybe' | 'no';
export type Tone = 'gentle' | 'normal' | 'ruthless';

export interface Option {
  id: number;              // 1-based, stable for the life of the plan (bridge options get 4, 5, ...)
  startsAt: number;        // epoch ms
  day: string;             // ISO date in group tz, e.g. "2026-10-23"
  time: string;            // "19:00" in group tz
  label: string;           // "Fri Oct 23 · 7pm"
  removed?: boolean;       // vetoed after confirmation (veto-and-swap)
}

export interface DayPref {
  vote: Vote;
  notBefore?: string;      // "20:30"
  notAfter?: string;       // "22:00"
}

export type MemberStatus = 'pending' | 'answered' | 'out';

export interface Member {
  key: MemberKey;
  name?: string;                          // only if the member said "homi I'm Sam" or platform gave one
  status: MemberStatus;
  dayPrefs: Record<string, DayPref>;      // by ISO date
  optionVotes: Record<number, Vote>;      // explicit per-option answers (numbers, tapbacks, polls) override dayPrefs
  lowConfidence?: boolean;                // e.g. bare "I'm in" read as all = yes
  lastMsgRef?: MsgRef;                    // id of their latest message, for inline-reply nudges (never text)
  optInDm: boolean;
  optInCall: boolean;
  hasDelivery: boolean;                   // runner has a sealed handle for DMs/calls
  nudgeCount: number;
  joinedAt: number;
}

export interface Place {
  name: string;
  cuisine?: string;
  priceBand?: 1 | 2 | 3 | 4;
  address?: string;
  lat?: number;
  lon?: number;
  mapsUrl?: string;
  source: 'osm' | 'fallback' | 'google' | 'user' | string;
  /** OSM diet tags normalized: "vegetarian", "vegan", "halal", "kosher", "gluten_free" ... */
  diet?: string[];
  /** true when priceBand is a team estimate (OSM has no price data); render as "~$$ (est.)". */
  priceEstimated?: boolean;
  /** opening_hours string (OSM syntax) when known; evaluated by the runner, not the engine. */
  hours?: string;
  osmId?: string;
}

export interface PlaceOption extends Place {
  id: number;              // 1..3
  walkMinutes?: number;
  openAtPlanTime?: boolean | null; // null = unknown hours
  why?: string;            // short reason for "homi why"
}

export type PriceBand = 1 | 2 | 3 | 4;

export interface HungryState {
  phase: 'asking' | 'searching' | 'voting' | 'done';
  askedAt: number;
  cuisineVotes: Record<string, number>;   // "thai" -> 2
  vetoes: string[];                       // cuisines someone ruled out
  priceMax?: PriceBand;                   // tightest stated budget wins
  diet: string[];                         // "vegetarian", "halal", "gluten_free", "nut_allergy" ...
  neighborhoods: Record<string, number>;  // normalized neighborhood -> mentions
  answeredBy: MemberKey[];
  requestId?: string;
  options: PlaceOption[];
  votes: Record<MemberKey, number[]>;     // member -> place option ids
  deadlineAt?: number;
  instant?: boolean;                      // started from idle: "where should we eat" right now
}

export interface BridgeState {
  kind: 'day_conflict' | 'time_shift' | 'stranded';
  createdAt: number;
  optionId?: number;                      // option to shift or winner under question
  proposedTime?: string;                  // for time_shift
  altOptionId?: number;                   // for stranded
}

export interface NudgeLog {
  at: number;
  kind: 'collective' | 'individual' | 'dm' | 'call' | 'details' | 'dates';
  target?: MemberKey;
}

export interface HomiRefs {
  header?: MsgRef;                        // availability header / living tally
  headerSentAt?: number;
  options: Record<number, MsgRef>;        // date option bubbles
  poll?: MsgRef;
  placeOptions: Record<number, MsgRef>;   // place option bubbles
  placePoll?: MsgRef;
}

export interface Plan {
  id: string;
  state: PlanState;
  stack: PlanState[];                     // return stack for collecting_place
  activity: string;                       // "dinner", "drinks", "hang out", ...
  outdoor: boolean;
  windowLabel?: string;                   // "next week"
  initiator: MemberKey;
  options: Option[];
  deadlineAt?: number;
  threshold?: number;                     // "lock it when 4 say yes"
  expectedHeadcount?: number;             // "we're 6"
  members: Record<MemberKey, Member>;
  chosenOptionId?: number;
  eventAt?: number;
  place?: Place;
  neighborhood?: string;                  // one string per plan, never per person
  notes: Record<string, string>;          // "parking" -> "behind the building" (explicitly given to Homi)
  hungry?: HungryState;
  bridge?: BridgeState;
  nudges: NudgeLog[];
  refs: HomiRefs;
  remindReq30?: boolean;                  // someone asked for a 30-min reminder
  forcedBy?: MemberKey;                   // "homi lock fri"
  createdAt: number;
  updatedAt: number;
  purgeAt?: number;
  /** Plan-level extension data (commitment pledges), deleted with the plan. */
  ext?: Partial<Record<ExtName, unknown>>;
}

export interface SpaceSettings {
  spaceKey: SpaceKey;
  introSent: boolean;
  tone: Tone;
  tz: string;                             // IANA
  notice: boolean;                        // opt-in "offer when a plan is forming"
  lastNoticeOfferAt?: number;
  muted: boolean;                         // tombstone after stop on platforms that can't leave
  /**
   * Last roster the platform reported (surfaces with `roster`), kept so a plan that starts later knows who is in the
   * group and waits for them, instead of treating the first speaker as "everyone". Hashed keys + display names only.
   */
  roster?: MemberRef[];
  /** Member count from a platform that cannot list members (Telegram); the next plan's expected head count. */
  headcount?: number;
  /**
   * Names people gave Homi ("homi I'm Ana"), by hashed member key, kept from one plan to the next so nobody has to
   * introduce themselves twice. Sealed with the settings; deleted by "homi stop".
   */
  names?: Record<MemberKey, string>;
  /** Group-level extension data (bill tab, trip, album), sealed with the settings. Each extension types its slot. */
  ext?: Partial<Record<ExtName, unknown>>;
}

export interface GroupState {
  space: SpaceSettings;
  plan: Plan | null;
  /** Noise budget: epoch ms of the last unprompted group message. */
  lastUnpromptedAt?: number;
}

// ───────────────────────── context ─────────────────────────

export interface Ctx {
  now: number;
  caps: Capabilities;
  retentionHours: number;     // default 24
  quietHours: [number, number]; // [23, 9]
  newId: () => string;        // injected so the engine stays deterministic in tests
  /** Public base URL for member-only links (shared album). Unset in tests; the sim uses a labeled demo URL. */
  publicBaseUrl?: string;
  /**
   * Demo quorum (QUORUM_DM_AFTER_MS > 0): `dmAfterMs` after the options go out, everyone who has not answered is
   * asked privately (or named in the group); `replyMs` later the silent count as not coming, and the plan locks
   * with at least `minYes` yes votes or is cancelled. Off in production unless set.
   */
  quorum?: { dmAfterMs: number; replyMs: number; minYes: number };
  /**
   * DEMO_SIMPLE=on: one flow only. A plan is a hangout with a date; the moment it locks Homi posts the three curated
   * Mexican spots (src/engine/curated.ts) and the group votes. Bills, pledges, trips, albums, notes and the food
   * questionnaire are off; "where are we at", "forget" and a short help stay.
   */
  simple?: boolean;
  hostedLlm?: false;          // the pure engine never calls an LLM; runner may pre-annotate events
}

// ───────────────────────── events ─────────────────────────

export type JobKind =
  | 'quorum_dm'               // demo quorum: ping everyone who has not answered (DM where possible)
  | 'quorum_close'            // demo quorum: count the silent as not coming, then lock (>= minYes) or cancel
  | 'availability_nudge'      // 50% of window
  | 'availability_escalate'   // ~2h before deadline (opt-in DM/call)
  | 'availability_deadline'
  | 'bridge_timeout'
  | 'dates_nudge'
  | 'dates_abandon'
  | 'details_nudge'
  | 'hungry_deadline'
  | 'remind_day'
  | 'remind_hour'
  | 'remind_30'
  | 'complete'
  | 'purge'
  /** Extension-owned jobs (bills, travel, commitments, album): payload { ext: ExtName, name: string, ... }. */
  | 'ext';

export interface MessageEvent {
  kind: 'message';
  from: MemberRef;
  /** Raw text. Transient: never copy into state. */
  text: string;
  msgRef: MsgRef;
  /** Mentions Homi, uses the "homi" prefix, a /command, or replies to a Homi message. */
  addressed: boolean;
  replyTo?: MsgRef;
  /** Optional pre-annotation from the runner's gated hosted-LLM fallback (redacted input only). */
  llmVote?: { optionIds: number[]; vote: Vote } | null;
}

export type EngineEvent =
  | MessageEvent
  | { kind: 'reaction'; from: MemberRef; emoji: string; target: MsgRef; removed?: boolean }
  | { kind: 'poll_vote'; from: MemberRef; poll: MsgRef; optionIndexes: number[] }
  | { kind: 'member_seen'; from: MemberRef; msgRef?: MsgRef }
  | { kind: 'members_snapshot'; members: MemberRef[] }
  /** The platform only knows how many people are in the chat (Telegram getChatMemberCount, minus the bot). */
  | { kind: 'headcount'; n: number }
  | { kind: 'added_to_group' }
  | { kind: 'sent'; tag: string; msgRef: MsgRef; at: number }
  | { kind: 'timer'; job: JobKind; planId: string; payload?: Record<string, unknown> }
  | { kind: 'places_result'; requestId: string; options: PlaceOption[]; source: string }
  | { kind: 'weather_result'; requestId: string; rainLikely: boolean; summary?: string }
  | { kind: 'call_result'; planId: string; member: MemberKey; answerText?: string; optionIds?: number[]; ok: boolean; simulated?: boolean }
  /** A member shared a photo. The runner already stored the bytes (opaque photoId); the engine keeps or deletes it. */
  | { kind: 'photo'; from: MemberRef; msgRef: MsgRef; photoId: string; mime: string; caption?: string; addressed: boolean; replyTo?: MsgRef }
  | { kind: 'travel_result'; requestId: string; result: TravelResult }
  | { kind: 'payment_result'; ref: string; planId: string; member: MemberKey; op: PaymentOp; amountCents: number; ok: boolean; simulated: boolean; error?: string };

// ───────────────────────── actions ─────────────────────────

/** prompted = direct answer to a member within 10 min, asked-for reminder, call result, stop/forget confirmation. */
export type Prompting = 'prompted' | 'unprompted';

export interface PlacesQuery {
  cuisines: string[];        // ordered by votes, already minus vetoes
  priceMax?: PriceBand;
  diet: string[];
  near: string;              // neighborhood string; runner geocodes it with the local gazetteer
  at?: number;               // check opening hours at plan time if known, else now
}

export type Action =
  | { type: 'send'; text: string; prompting: Prompting; tag?: string }
  | { type: 'reply'; to: MsgRef; text: string; prompting: Prompting; tag?: string }
  | { type: 'poll'; question: string; options: string[]; prompting: Prompting; tag: string }
  | { type: 'edit'; target: MsgRef; text: string }
  | { type: 'react'; to: MsgRef; emoji: string }
  | { type: 'dm'; member: MemberKey; text: string; planId?: string }
  | { type: 'call'; member: MemberKey; question: string; options: string[]; callRef: string; planId?: string }
  | { type: 'file'; name: string; mime: string; content: string; caption?: string; prompting: Prompting }
  | { type: 'schedule'; key: string; job: JobKind; at: number; planId: string; payload?: Record<string, unknown> }
  | { type: 'cancel'; keyPrefix: string }
  | { type: 'lookup_places'; requestId: string; query: PlacesQuery }
  | { type: 'lookup_weather'; requestId: string; near: string; at: number }
  | { type: 'lookup_travel'; requestId: string; query: TravelQuery }
  /** Commitment deposits. SIMULATED unless a real payment provider is configured (docs/COMMITMENTS.md). */
  | { type: 'payment'; op: PaymentOp; ref: string; planId: string; member: MemberKey; amountCents: number; currency: 'USD'; memo: string }
  /** Shared album: keep a stored photo (member + album known) or delete stored photos (removed, rejected, album deleted). */
  | { type: 'album_keep'; albumId: string; photoId: string }
  | { type: 'album_delete'; photoIds: string[] }
  /** A member just opted in to DMs/calls: the runner seals the CURRENT event sender's raw handle into `delivery`. */
  | { type: 'remember_handle'; member: MemberKey; planId: string }
  | { type: 'purge'; planId: string }
  | { type: 'leave' }
  | { type: 'tombstone' };

export interface ApplyResult {
  state: GroupState;
  actions: Action[];
}

export type ApplyEvent = (state: GroupState, event: EngineEvent, ctx: Ctx) => ApplyResult;

// ───────────────────────── extensions (bills, travel, commitments, album) ─────────────────────────

export type ExtName = 'bills' | 'travel' | 'commit' | 'album';
export type PaymentOp = 'hold' | 'refund' | 'forfeit';

export interface TravelQuery {
  destination: string;          // "Japan"
  origin: string;               // "Boston"
  year: number;                 // 2030
  month?: number;               // 1-12 when known
  nights: number;
  travelers: number;
  budgetPerPersonUsd?: number;
  tier: 'budget' | 'comfort';
  interests: string[];          // "food", "temples", "onsen", ...
}

export interface TravelListing {
  kind: 'flight' | 'stay' | 'transport' | 'activity' | 'food';
  title: string;                // "Example: 3-bedroom apartment near Asakusa (Airbnb-style)"
  pricePerPersonUsd: number;    // whole-trip cost per person for this line, rounded to dollars
  detail?: string;
  /** Representative example, NOT a real bookable listing (always true for estimates). */
  example: boolean;
  /** Price is an estimate (dates too far ahead to book, or no live search). */
  estimate: boolean;
  /** Verifiable source / listing URL when this came from a real search. */
  url?: string;
}

export interface TravelResult {
  query: TravelQuery;
  /** True when dates are too far ahead to book or no live provider is configured: everything is an estimate. */
  estimates: boolean;
  basis: string;                // e.g. "rough estimates in today's prices"
  itinerary: string[];          // "Days 1-4 · Tokyo", ...
  listings: TravelListing[];
  savings: string[];            // less obvious savings
  lastMinute: string[];         // last-minute offers (empty when none are available or relevant)
  totalPerPersonUsd: number;
  source: string;               // provider id: "estimates" | "duffel" | ...
}
