// What the generic `find` tool is allowed to look at.
//
// This file is DATA, not logic: adding a queryable field is one line here, and
// that is the whole point of the exercise — the bot stops needing a bespoke
// list_* tool per question someone thought of in advance.
//
// TWO GATES, on purpose
// --------------------
// RLS on the caller's own session is the security boundary, exactly as it is
// everywhere else in this codebase. This registry is a second, narrower gate in
// front of it, and it is not redundant:
//
//   * Column allow-list. Several tables are safe row-wise but carry one field
//     that shouldn't reach a chat transcript — players.notes and
//     class_sessions.coach_notes (free text about children),
//     coaches.base_address (a coach's home address), the payment-processor ids
//     on profiles/subscriptions/orders. RLS has no column granularity, so this
//     is the only place that distinction can live.
//
//   * Role allow-list. A handful of the app's read policies are broader than
//     the UI that relies on them — `student_notes`, `skill_assessments` and
//     `skill_ratings` are all bare `is_coach() OR is_founder()` with no roster
//     scoping, and `settings` is readable by any signed-in user. Screen by
//     screen the app never notices; a free-form filter would. Those tables are
//     simply absent below, and the entities that are present are restricted to
//     the roles that have a reason to ask.
//
// NOT EXPOSED, for two reasons that must not be confused
// ------------------------------------------------------
//   (a) A judgement call, and revisitable. `student_notes`,
//       `skill_assessments`, `skill_ratings`, `skills` and `settings` are
//       readable well past the screens that rely on them (the role gate above);
//       `school_admins`, `push_subscriptions`, `webhook_events`,
//       `client_invites` and `coach_invites` are plumbing nobody asks a
//       question about. Both views too — `coach_client_view` is declared
//       without security_invoker, so it reads through the view owner and
//       bypasses the profiles policies entirely (see the security note in the
//       PR).
//
//   (b) Not readable at all, so there is nothing to decide. `wa_messages` and
//       `wa_inbound_seen` have RLS enabled and no policy whatsoever: they are
//       service-role only, and the chat transcript stays out of the chat's own
//       reach on purpose. Registering either would advertise an entity that can
//       only ever answer nothing — the failure mode this tool exists to end.

import type { Database } from "@/lib/database.types";
import { fromRupees, istEnd, istStart, phoneNumber, type Operator } from "./query-core";

export type Role = "client" | "coach" | "founder";

/**
 * Real tables only — no views. Typing it this way means a typo in the registry
 * is a build error rather than a runtime "relation does not exist", and it also
 * makes the exclusion of `coach_client_view` structural rather than a habit
 * someone has to remember.
 */
export type TableName = keyof Database["public"]["Tables"];

export type FilterDef = {
  /** PostgREST column path, e.g. "starts_at" or "classes.venues.name". */
  path: string;
  /**
   * Select fragment that must be in the query for this filter to restrict the
   * PARENT rows. PostgREST only filters the outer table through an embed marked
   * `!inner`, so a filter on an embedded column has to bring its own spelling of
   * that embed rather than relying on whatever `include` the caller picked.
   */
  requires?: string;
  description: string;
  values?: readonly string[];
  /** Defaults to the full operator set; narrow it where only equality is sane. */
  ops?: readonly Operator[];
  /**
   * Text that is searched rather than matched: `op` defaults to ilike. Every
   * field described below as "matched loosely" still defaulted to eq, so the
   * loose match only happened when the model remembered to ask for it — and a
   * name typed with the wrong capitalisation or a stray space found nothing.
   */
  loose?: boolean;
} & Normalizable;

/**
 * The value canonicalizer, paired with the sentence the model is shown when it
 * rejects a value. A union rather than two optional fields so one can never ship
 * without the other: a filter that cannot read its value has to say what it
 * wanted, or it is only a quieter way of answering nothing.
 */
type Normalizable =
  | { normalize?: undefined; expects?: undefined }
  | { normalize: (value: unknown, op: Operator) => unknown | null; expects: string };

export type EntityDef = {
  table: TableName;
  description: string;
  roles: readonly Role[];
  /** Base select list — the column allow-list, applied on every query. */
  columns: string;
  /** Optional extra select fragments the caller can name. */
  includes: Record<string, string>;
  /** Applied when the caller names none. */
  defaultIncludes: readonly string[];
  filters: Record<string, FilterDef>;
  order: { path: string; ascending: boolean };
  /** Paths (in the RETURNED row shape) that group_by and aggregates may use. */
  groupable: readonly string[];
};

const ALL: readonly Role[] = ["client", "coach", "founder"];
const STAFF: readonly Role[] = ["coach", "founder"];
const FOUNDER: readonly Role[] = ["founder"];

const SKILL_LEVELS = ["beginner", "intermediate", "advanced", "elite", "any"] as const;

// Canonicalizers, spread onto the filters that need one. A bound is a pair: the
// lower one takes the first instant of an academy day, the upper one the last,
// so a month asked for at both ends covers the whole month rather than one
// midnight of it.
const IST_FORMS = "a date (2026-06-14), a month (2026-06), or a full ISO instant";

/**
 * Which edge of the named day to take follows the OPERATOR, not the field.
 *
 * "before the 15th" (lt) means before the 15th BEGINS; "up to the 15th" (lte)
 * means up to the instant it ends. Binding the edge to the field name made lt
 * behave exactly like lte and hand back a whole extra day, silently, for every
 * date range in the registry. `eq` has no answer here — a stored timestamp is
 * never exactly midnight, so equality against a day is a query that cannot
 * match — so it is refused rather than answered with zero rows.
 */
function istBound(value: unknown, op: Operator): unknown {
  if (op === "lte" || op === "gt") return istEnd(value);
  if (op === "gte" || op === "lt") return istStart(value);
  return null;
}

const DATE_OPS = ["gte", "lte", "gt", "lt"] as const;
const FROM_IST = { normalize: istBound, expects: IST_FORMS } as const;
const TO_IST = { normalize: istBound, expects: IST_FORMS } as const;
const PHONE = {
  normalize: phoneNumber,
  expects: "a phone number — a 10-digit Indian mobile, or any number with its country code",
} as const;
const RUPEES = { normalize: fromRupees, expects: "an amount in rupees, e.g. 1599" } as const;

export const ENTITIES: Record<string, EntityDef> = {
  // ── Scheduling ───────────────────────────────────────────────────────────
  sessions: {
    table: "class_sessions",
    description:
      "Individual sessions on the calendar (one dated occurrence of a class). The thing you cancel, move, reassign or take a register for.",
    roles: ALL,
    // coach_notes / coach_arrival_source / coach_arrival_distance_m withheld.
    columns:
      "id,class_id,coach_id,starts_at,ends_at,status,capacity_override,cancel_reason,coach_confirmed_at,coach_arrived_at",
    includes: {
      class: "classes(title,class_type,skill_level,is_school,capacity,duration_minutes,venue_id,venues(id,name,unit))",
      coach: "coaches(id,active,profiles(id,full_name))",
      bookings: "bookings(id,status,player_id,players(id,full_name))",
    },
    defaultIncludes: ["class", "coach"],
    filters: {
      id: { path: "id", description: "Session id", ops: ["eq", "in", "not_in"] },
      class_id: { path: "class_id", description: "Only sessions of this class" },
      coach_id: { path: "coach_id", description: "Only sessions taught by this coach" },
      unassigned: {
        path: "coach_id",
        description: "Use with op is_null to find sessions with no coach yet",
        ops: ["is_null", "not_null"],
      },
      status: {
        path: "status",
        description: "scheduled | completed | cancelled",
        values: ["scheduled", "completed", "cancelled"],
      },
      from: {
        path: "starts_at",
        description: "Sessions starting at or after",
        ops: ["gte", "gt"],
        ...FROM_IST,
      },
      to: {
        path: "starts_at",
        description: "Sessions starting at or before",
        ops: ["lte", "lt"],
        ...TO_IST,
      },
      starts_at: {
        path: "starts_at",
        description: "Session start time",
        ops: DATE_OPS,
        ...FROM_IST,
      },
      confirmed: {
        path: "coach_confirmed_at",
        description: "Use with is_null / not_null to find sessions the coach has or hasn't confirmed",
        ops: ["is_null", "not_null"],
      },
      arrived: {
        path: "coach_arrived_at",
        description: "Use with is_null / not_null for coach arrival",
        ops: ["is_null", "not_null"],
      },
      title: {
        path: "classes.title",
        requires: "classes!inner(title)",
        description: "Class title, e.g. 'Beginner'",
        loose: true,
      },
      venue: {
        path: "classes.venues.name",
        requires: "classes!inner(title,venues!inner(id,name))",
        description: "Venue name, e.g. 'La Plazza' — matches loosely",
        loose: true,
      },
      venue_id: {
        path: "classes.venue_id",
        requires: "classes!inner(title,venue_id)",
        description: "Venue id (exact)",
      },
      level: {
        path: "classes.skill_level",
        requires: "classes!inner(title,skill_level)",
        description: "Skill level of the class",
        values: SKILL_LEVELS,
      },
      type: {
        path: "classes.class_type",
        requires: "classes!inner(title,class_type)",
        description: "group | private",
        values: ["group", "private"],
      },
      is_school: {
        path: "classes.is_school",
        requires: "classes!inner(title,is_school)",
        description: "true for school-programme classes",
      },
    },
    order: { path: "starts_at", ascending: true },
    groupable: [
      "status",
      "coach_id",
      "class_id",
      "classes.title",
      "classes.class_type",
      "classes.skill_level",
      "classes.venues.name",
      "coaches.profiles.full_name",
      // The roster fallback writes coach_name onto the row when profiles is
      // unreadable, so grouping "sessions per coach" works for a coach too —
      // without it that grouping is all-null for everyone but the founder.
      "coach_name",
    ],
  },

  classes: {
    table: "classes",
    description:
      "The weekly (or one-off) class definitions that generate sessions. Editing one changes every future week.",
    roles: ALL,
    columns:
      "id,class_type,is_school,title,description,skill_level,capacity,duration_minutes,venue_id,recurrence_rule,starts_on,ends_on,active,location_label",
    includes: {
      venue: "venues(id,name,unit,address,postcode,active)",
      sessions: "class_sessions(id,starts_at,status,coach_id)",
    },
    defaultIncludes: ["venue"],
    filters: {
      id: { path: "id", description: "Class id", ops: ["eq", "in", "not_in"] },
      title: { path: "title", description: "Class title", loose: true },
      type: { path: "class_type", description: "group | private", values: ["group", "private"] },
      level: { path: "skill_level", description: "Skill level", values: SKILL_LEVELS },
      active: { path: "active", description: "true for live classes" },
      is_school: { path: "is_school", description: "true for school-programme classes" },
      venue_id: { path: "venue_id", description: "Venue id" },
      venue: {
        path: "venues.name",
        requires: "venues!inner(id,name)",
        description: "Venue name, matched loosely",
        loose: true,
      },
      capacity: { path: "capacity", description: "Seats per session" },
    },
    order: { path: "title", ascending: true },
    groupable: ["class_type", "skill_level", "active", "venue_id", "venues.name", "is_school"],
  },

  // ── Bookings and attendance ──────────────────────────────────────────────
  bookings: {
    table: "bookings",
    description:
      "A player's place in a session — confirmed, waitlisted, attended, no_show or cancelled. Attendance history lives here too.",
    roles: ALL,
    // coach_note withheld.
    columns:
      "id,session_id,client_id,player_id,status,waitlist_position,booked_at,cancelled_at,cancel_reason",
    includes: {
      session:
        "class_sessions(id,starts_at,ends_at,status,coach_id,classes(title,class_type,venue_id,venues(name)))",
      player: "players(id,full_name,skill_level)",
      client: "profiles(id,full_name)",
    },
    defaultIncludes: ["session", "player"],
    filters: {
      id: { path: "id", description: "Booking id", ops: ["eq", "in", "not_in"] },
      session_id: { path: "session_id", description: "Bookings for this session (a register)" },
      client_id: { path: "client_id", description: "Bookings belonging to this account" },
      player_id: { path: "player_id", description: "Bookings for this player" },
      status: {
        path: "status",
        description:
          "confirmed | waitlisted | attended | no_show | rescheduled | cancelled_by_client | cancelled_by_academy",
        values: [
          "confirmed",
          "waitlisted",
          "attended",
          "no_show",
          "rescheduled",
          "cancelled_by_client",
          "cancelled_by_academy",
        ],
      },
      from: {
        path: "class_sessions.starts_at",
        requires: "class_sessions!inner(id,starts_at)",
        description: "Bookings for sessions at or after",
        ops: ["gte", "gt"],
        ...FROM_IST,
      },
      to: {
        path: "class_sessions.starts_at",
        requires: "class_sessions!inner(id,starts_at)",
        description: "Bookings for sessions at or before",
        ops: ["lte", "lt"],
        ...TO_IST,
      },
      coach_id: {
        path: "class_sessions.coach_id",
        requires: "class_sessions!inner(id,coach_id)",
        description: "Bookings in sessions taught by this coach",
      },
      title: {
        path: "class_sessions.classes.title",
        requires: "class_sessions!inner(id,classes!inner(title))",
        description: "Class title of the booked session",
        loose: true,
      },
      booked_at: {
        path: "booked_at",
        description: "When the booking was made",
        ops: DATE_OPS,
        ...FROM_IST,
      },
    },
    order: { path: "booked_at", ascending: false },
    groupable: [
      "status",
      "player_id",
      "client_id",
      "session_id",
      "players.full_name",
      "class_sessions.coach_id",
      "class_sessions.classes.title",
    ],
  },

  // Both series tables are here because of 2 August: asked three times to clear
  // the calendar, the bot cancelled occurrences, watched the generator refill
  // them, and finally told the founder that the CLIENT would have to stop it.
  // It could see sessions and bookings and had no word for the thing producing
  // them. Naming a series is the first half of ending one.
  group_series: {
    table: "booking_series",
    description:
      "A standing enrolment in a class slot — one row per player per weekday and time. This is what keeps re-booking them: cancelling the sessions it produced does not stop it, only deactivating the series does.",
    roles: ALL,
    columns: "id,client_id,player_id,class_id,weekday,start_time,active,created_at,cancelled_at",
    includes: {
      class: "classes(id,title,class_type,skill_level,venue_id,venues(id,name))",
      player: "players(id,full_name)",
      client: "profiles(id,full_name)",
    },
    defaultIncludes: ["class", "player"],
    filters: {
      id: { path: "id", description: "Series id", ops: ["eq", "in", "not_in"] },
      client_id: { path: "client_id", description: "Series on this account" },
      player_id: { path: "player_id", description: "Series for this player" },
      class_id: { path: "class_id", description: "Series feeding this class" },
      active: { path: "active", description: "true for series still generating bookings" },
      weekday: {
        path: "weekday",
        description: "1=Monday … 7=Sunday — NOT the 0-based weekday coach_availability uses",
      },
      start_time: { path: "start_time", description: "HH:MM:SS, IST" },
      title: {
        path: "classes.title",
        requires: "classes!inner(title)",
        description: "Class title of the series",
        loose: true,
      },
      venue: {
        path: "classes.venues.name",
        requires: "classes!inner(title,venues!inner(id,name))",
        description: "Venue name, matched loosely",
        loose: true,
      },
      created_at: {
        path: "created_at",
        description: "When the series was set up",
        ops: DATE_OPS,
        ...FROM_IST,
      },
    },
    order: { path: "weekday", ascending: true },
    groupable: [
      "active",
      "weekday",
      "class_id",
      "client_id",
      "player_id",
      "classes.title",
      "players.full_name",
    ],
  },

  private_series: {
    table: "private_booking_series",
    description:
      "A standing weekly private (one-to-one) slot. While it is active the nightly generator keeps creating sessions for it and debiting the client's private minutes.",
    // No coach policy exists on this table — own-row for the client, is_founder()
    // for the founder, nothing else. A coach registered here would get an empty
    // list rather than an answer, which is the one thing worse than a refusal.
    roles: ["client", "founder"],
    // The address block — address, postcode, lat, lng, address_details,
    // access_notes, and the venue_label / unit_label pair a client types when
    // there is no venue_id — is withheld. A private slot is taught at the
    // child's home, and this row is where the schema says which one.
    columns:
      "id,client_id,player_id,preferred_coach,weekday,start_time,duration_minutes,has_table,venue_id,active,created_at,cancelled_at",
    includes: {
      player: "players(id,full_name)",
      client: "profiles(id,full_name)",
      coach: "coaches(id,active,profiles(id,full_name))",
      venue: "venues(id,name,unit)",
    },
    defaultIncludes: ["player", "coach"],
    filters: {
      id: { path: "id", description: "Series id", ops: ["eq", "in", "not_in"] },
      client_id: { path: "client_id", description: "Series on this account" },
      player_id: { path: "player_id", description: "Series for this player" },
      coach_id: { path: "preferred_coach", description: "Series that ask for this coach" },
      active: { path: "active", description: "true for series still generating sessions" },
      weekday: {
        path: "weekday",
        description: "1=Monday … 7=Sunday — NOT the 0-based weekday coach_availability uses",
      },
      start_time: { path: "start_time", description: "HH:MM:SS, IST" },
      venue_id: { path: "venue_id", description: "Venue id, when the slot is at a venue" },
      created_at: {
        path: "created_at",
        description: "When the series was set up",
        ops: DATE_OPS,
        ...FROM_IST,
      },
    },
    order: { path: "weekday", ascending: true },
    groupable: [
      "active",
      "weekday",
      "client_id",
      "player_id",
      "preferred_coach",
      // Same reason class_sessions carries it: grouping by the id gives a
      // founder a list of uuids and a client a list of uuids they can't resolve.
      "coach_name",
      "venue_id",
    ],
  },

  // ── People ───────────────────────────────────────────────────────────────
  players: {
    table: "players",
    description: "The children who attend. One account (client) can have several.",
    roles: ALL,
    // notes withheld — free-text commentary about a child.
    columns: "id,client_id,full_name,date_of_birth,skill_level,grade,school_venue_id,created_at",
    includes: {
      client: "profiles(id,full_name)",
      school: "venues(id,name,is_school)",
    },
    defaultIncludes: [],
    filters: {
      id: { path: "id", description: "Player id", ops: ["eq", "in", "not_in"] },
      client_id: { path: "client_id", description: "Players on this account" },
      full_name: { path: "full_name", description: "Player name, matched loosely", loose: true },
      level: { path: "skill_level", description: "Skill level", values: SKILL_LEVELS },
      grade: { path: "grade", description: "School grade" },
      school_venue_id: { path: "school_venue_id", description: "School venue id" },
    },
    order: { path: "full_name", ascending: true },
    groupable: ["skill_level", "grade", "client_id", "school_venue_id"],
  },

  clients: {
    table: "profiles",
    description:
      "Account holders and staff. role tells you which: client | coach | founder | school. Use this to resolve a name to an id.",
    roles: FOUNDER,
    // Payment-processor ids and the dispute flag withheld.
    columns:
      "id,role,full_name,email,phone,default_address,approval_status,wa_muted,onboarded_at,deleted_at,created_at",
    includes: {
      players: "players(id,full_name,skill_level)",
      subscriptions:
        "subscriptions(id,status,current_period_end,cancel_at_period_end,plans(name,price_pence))",
    },
    defaultIncludes: [],
    filters: {
      id: { path: "id", description: "Profile id", ops: ["eq", "in", "not_in"] },
      role: {
        path: "role",
        description: "client | coach | founder | school",
        values: ["client", "coach", "founder", "school"],
      },
      full_name: { path: "full_name", description: "Name, matched loosely", loose: true },
      email: { path: "email", description: "Email, matched loosely", loose: true },
      phone: { path: "phone", description: "Phone number, however it was written", ...PHONE },
      has_phone: {
        path: "phone",
        description:
          "Use with not_null for people this bot can reach on WhatsApp, is_null for those it cannot. The number IS the WhatsApp binding, so 'which coaches are on WhatsApp' is role=coach + has_phone not_null.",
        ops: ["is_null", "not_null"],
      },
      approval_status: {
        path: "approval_status",
        description: "pending | approved | denied",
        values: ["pending", "approved", "denied"],
      },
      deleted: {
        path: "deleted_at",
        description: "Use with is_null for live accounts, not_null for deleted",
        ops: ["is_null", "not_null"],
      },
      created_at: {
        path: "created_at",
        description: "Signup time",
        ops: DATE_OPS,
        ...FROM_IST,
      },
      wa_muted: { path: "wa_muted", description: "true if they opted out of WhatsApp" },
    },
    order: { path: "full_name", ascending: true },
    groupable: ["role", "approval_status", "wa_muted"],
  },

  coaches: {
    table: "coaches",
    description: "Coach records. Join to profiles for the name.",
    roles: STAFF,
    // base_address / base_lat / base_lng withheld — a coach's home address.
    columns: "id,bio,quote,credentials,photo_url,active,max_teachable_level,created_at",
    includes: {
      profile: "profiles(id,full_name,phone)",
      availability: "coach_availability(id,weekday,start_time,end_time)",
      sessions: "class_sessions(id,starts_at,status)",
    },
    defaultIncludes: ["profile"],
    filters: {
      id: { path: "id", description: "Coach id", ops: ["eq", "in", "not_in"] },
      active: { path: "active", description: "true for coaches currently teaching" },
      level: {
        path: "max_teachable_level",
        description: "Highest level they can teach",
        values: SKILL_LEVELS,
      },
      full_name: {
        path: "profiles.full_name",
        requires: "profiles!inner(id,full_name)",
        description: "Coach name, matched loosely",
        loose: true,
      },
    },
    order: { path: "created_at", ascending: true },
    groupable: ["active", "max_teachable_level"],
  },

  // ── Places ───────────────────────────────────────────────────────────────
  venues: {
    table: "venues",
    description: "Where sessions happen.",
    // Staff only. RLS lets anyone read active venues, but get_academy_info
    // treats `is_school = false` as a PRIVACY rule — never read a school campus
    // out to someone outside it. A client browsing the venue table would walk
    // straight past that; the venue they actually need rides on their session.
    roles: STAFF,
    // notes withheld — free text, and the table is readable by anon.
    columns: "id,name,unit,address,postcode,lat,lng,active,is_school,created_at",
    includes: { classes: "classes(id,title,active,class_type)" },
    defaultIncludes: [],
    filters: {
      id: { path: "id", description: "Venue id", ops: ["eq", "in", "not_in"] },
      name: { path: "name", description: "Venue name, matched loosely", loose: true },
      active: { path: "active", description: "true for venues in use" },
      is_school: { path: "is_school", description: "true for school sites" },
      postcode: { path: "postcode", description: "Postcode", loose: true },
    },
    order: { path: "name", ascending: true },
    groupable: ["active", "is_school"],
  },

  // ── Availability ─────────────────────────────────────────────────────────
  coach_availability: {
    table: "coach_availability",
    description: "Weekly windows a coach can teach in. weekday is 0=Monday … 6=Sunday.",
    roles: STAFF,
    columns: "id,coach_id,weekday,start_time,end_time",
    includes: { coach: "coaches(id,active,profiles(id,full_name))" },
    defaultIncludes: ["coach"],
    filters: {
      id: { path: "id", description: "Window id", ops: ["eq", "in", "not_in"] },
      coach_id: { path: "coach_id", description: "Windows for this coach" },
      weekday: { path: "weekday", description: "0=Monday … 6=Sunday" },
      start_time: { path: "start_time", description: "HH:MM:SS" },
      end_time: { path: "end_time", description: "HH:MM:SS" },
    },
    order: { path: "weekday", ascending: true },
    groupable: ["coach_id", "weekday"],
  },

  time_off: {
    table: "coach_time_off",
    description: "Coach time-off requests and their approval state.",
    roles: STAFF,
    // reason withheld — can be medical. The pending_time_off tool shows it to
    // the founder, who is the person entitled to weigh it.
    columns: "id,coach_id,starts_at,ends_at,status,created_at",
    includes: { coach: "coaches(id,profiles(id,full_name))" },
    defaultIncludes: ["coach"],
    filters: {
      id: { path: "id", description: "Request id", ops: ["eq", "in", "not_in"] },
      coach_id: { path: "coach_id", description: "Requests from this coach" },
      status: {
        path: "status",
        description: "pending | approved | rejected",
        values: ["pending", "approved", "rejected"],
      },
      from: { path: "starts_at", description: "At or after", ops: ["gte", "gt"], ...FROM_IST },
      to: { path: "ends_at", description: "At or before", ops: ["lte", "lt"], ...TO_IST },
    },
    order: { path: "starts_at", ascending: true },
    groupable: ["status", "coach_id"],
  },

  // ── Money ────────────────────────────────────────────────────────────────
  subscriptions: {
    table: "subscriptions",
    description: "Memberships. status past_due is the dunning list.",
    roles: FOUNDER,
    columns:
      "id,client_id,plan_id,source,status,current_period_start,current_period_end,cancel_at_period_end,created_at",
    includes: {
      client: "profiles(id,full_name,phone)",
      plan: "plans(id,name,price_pence,group_sessions_per_week,private_minutes_per_cycle)",
    },
    defaultIncludes: ["client", "plan"],
    filters: {
      id: { path: "id", description: "Subscription id", ops: ["eq", "in", "not_in"] },
      client_id: { path: "client_id", description: "Subscriptions for this account" },
      plan_id: { path: "plan_id", description: "Subscriptions on this plan" },
      status: {
        path: "status",
        description: "incomplete | trialing | active | past_due | canceled | paused",
        values: ["incomplete", "trialing", "active", "past_due", "canceled", "paused"],
      },
      source: { path: "source", description: "stripe | comp | razorpay", values: ["stripe", "comp", "razorpay"] },
      cancel_at_period_end: { path: "cancel_at_period_end", description: "true if set to lapse" },
      renews_before: {
        path: "current_period_end",
        description: "Period ends at or before (expiring soon)",
        ops: ["lte", "lt"],
        ...TO_IST,
      },
      renews_after: {
        path: "current_period_end",
        description: "Period ends at or after",
        ops: ["gte", "gt"],
        ...FROM_IST,
      },
    },
    order: { path: "current_period_end", ascending: true },
    groupable: ["status", "source", "plan_id", "plans.name"],
  },

  plans: {
    table: "plans",
    description: "The membership catalogue.",
    roles: ALL,
    columns:
      "id,name,description,price_pence,currency,billing_interval_months,group_sessions_per_week,private_minutes_per_cycle,private_sessions_per_week,private_session_minutes,active",
    includes: {},
    defaultIncludes: [],
    filters: {
      id: { path: "id", description: "Plan id", ops: ["eq", "in", "not_in"] },
      name: { path: "name", description: "Plan name", loose: true },
      active: { path: "active", description: "true for plans on sale" },
      // Named for the unit the caller speaks. Asking for plans under 5000 with
      // the column's own name meant plans under ₹50, and every plan is dearer
      // than that, so "we have nothing that cheap" was the answer.
      price_inr: { path: "price_pence", description: "Monthly price in rupees", ...RUPEES },
    },
    order: { path: "price_pence", ascending: true },
    groupable: ["active", "billing_interval_months"],
  },

  credits: {
    table: "private_credit_ledger",
    description:
      "Every movement of private-coaching minutes. Sum delta_minutes for a client to get their balance.",
    roles: ["client", "founder"],
    // `note` withheld: it is founder free text on the client's account
    // ("comp grant", "goodwill after the Diwali mess"), written for internal
    // eyes and readable by the client under their own-row policy.
    columns: "id,client_id,subscription_id,booking_id,delta_minutes,reason,created_at",
    includes: { client: "profiles(id,full_name)" },
    defaultIncludes: [],
    filters: {
      id: { path: "id", description: "Ledger row id", ops: ["eq", "in", "not_in"] },
      client_id: { path: "client_id", description: "Rows for this account" },
      reason: {
        path: "reason",
        description: "grant | booking | cancellation_refund | refund_adjustment | expiry | manual",
        values: ["grant", "booking", "cancellation_refund", "refund_adjustment", "expiry", "manual"],
      },
      from: { path: "created_at", description: "At or after", ops: ["gte", "gt"], ...FROM_IST },
      to: { path: "created_at", description: "At or before", ops: ["lte", "lt"], ...TO_IST },
    },
    order: { path: "created_at", ascending: false },
    groupable: ["reason", "client_id"],
  },

  orders: {
    table: "orders",
    description: "One-off purchases (drop-in classes, intro promos).",
    roles: FOUNDER,
    columns: "id,client_id,player_id,product_id,amount_pence,currency,status,paid_at,created_at",
    includes: {
      client: "profiles(id,full_name)",
      player: "players(id,full_name)",
      product: "products(id,name,kind)",
    },
    defaultIncludes: ["client", "product"],
    filters: {
      id: { path: "id", description: "Order id", ops: ["eq", "in", "not_in"] },
      client_id: { path: "client_id", description: "Orders for this account" },
      status: { path: "status", description: "Order status" },
      amount_inr: { path: "amount_pence", description: "Amount in rupees", ...RUPEES },
      from: { path: "created_at", description: "At or after", ops: ["gte", "gt"], ...FROM_IST },
      to: { path: "created_at", description: "At or before", ops: ["lte", "lt"], ...TO_IST },
      paid: {
        path: "paid_at",
        description: "Use with not_null for paid orders, is_null for unpaid",
        ops: ["is_null", "not_null"],
      },
    },
    order: { path: "created_at", ascending: false },
    groupable: ["status", "product_id", "products.name", "client_id"],
  },

  invoices: {
    table: "invoices",
    description: "Membership invoices.",
    roles: FOUNDER,
    columns: "id,client_id,subscription_id,amount_pence,currency,status,paid_at,created_at",
    includes: {
      client: "profiles(id,full_name)",
      subscription: "subscriptions(id,status,plan_id,plans(name))",
    },
    defaultIncludes: ["client"],
    filters: {
      id: { path: "id", description: "Invoice id", ops: ["eq", "in", "not_in"] },
      client_id: { path: "client_id", description: "Invoices for this account" },
      status: { path: "status", description: "Invoice status" },
      amount_inr: { path: "amount_pence", description: "Amount in rupees", ...RUPEES },
      from: { path: "created_at", description: "At or after", ops: ["gte", "gt"], ...FROM_IST },
      to: { path: "created_at", description: "At or before", ops: ["lte", "lt"], ...TO_IST },
      paid: {
        path: "paid_at",
        description: "Use with not_null for paid, is_null for outstanding",
        ops: ["is_null", "not_null"],
      },
    },
    order: { path: "created_at", ascending: false },
    groupable: ["status", "client_id"],
  },

  // ── Operations ───────────────────────────────────────────────────────────
  audit_log: {
    table: "audit_log",
    description:
      "Append-only record of what was done to a row and by whom — coach assignments and reassignments, cover claims, calendar wipes. This is where 'who changed this class, and when' is answered.",
    roles: FOUNDER,
    columns: "id,actor_id,action,entity,entity_id,meta,created_at",
    // actor_id alone answers the "when" and leaves the "who" as a uuid, which is
    // the half of the question actually being asked.
    includes: { actor: "profiles(id,full_name,role)" },
    defaultIncludes: ["actor"],
    filters: {
      id: { path: "id", description: "Entry id", ops: ["eq", "in", "not_in"] },
      actor_id: {
        path: "actor_id",
        description: "Entries by this person; a null actor means the system did it",
      },
      action: {
        path: "action",
        description:
          "What happened, e.g. session.assign, session.reassign, session.cover_claimed, calendar.wipe",
        loose: true,
      },
      entity: {
        path: "entity",
        description: "Table the entry is about, e.g. class_sessions",
        loose: true,
      },
      entity_id: {
        path: "entity_id",
        description: "The row the entry is about — put a session id here to get its history",
      },
      from: { path: "created_at", description: "At or after", ops: ["gte", "gt"], ...FROM_IST },
      to: { path: "created_at", description: "At or before", ops: ["lte", "lt"], ...TO_IST },
    },
    order: { path: "created_at", ascending: false },
    groupable: ["action", "entity", "actor_id", "profiles.full_name"],
  },

  // wa_links used to live here — "which phone numbers are linked for WhatsApp".
  // The link table is gone: profiles.phone IS the binding, for inbound identity
  // and outbound delivery alike. The question it answered now reads
  //   find clients role=coach has_phone=not_null
  // via the has_phone filter on `clients` above.

  // ── Delivery ─────────────────────────────────────────────────────────────
  notifications: {
    table: "notifications",
    description:
      "Every message the academy has sent, and what became of it: queued, sent, which channel carried it, and why it failed. This is how you answer 'did they actually get it'.",
    roles: FOUNDER,
    // `data` withheld: the delivery payload is routing internals (ids, deep
    // links) and says nothing a founder asked about.
    columns:
      "id,user_id,type,title,body,channel,channel_attempted,status,scheduled_for,sent_at,read_at,error,created_at",
    includes: { recipient: "profiles(id,full_name,role)" },
    defaultIncludes: ["recipient"],
    filters: {
      id: { path: "id", description: "Notification id", ops: ["eq", "in", "not_in"] },
      user_id: { path: "user_id", description: "Messages to this person" },
      type: { path: "type", description: "e.g. announcement, reminder_upcoming, session_cancelled" },
      status: {
        path: "status",
        description: "pending (still queued) | sent | failed",
        values: ["pending", "sent", "failed"],
      },
      channel_attempted: {
        path: "channel_attempted",
        description: "Which channel actually carried it — push, whatsapp, email",
      },
      failed: {
        path: "error",
        description: "Use with not_null for messages that hit a problem",
        ops: ["is_null", "not_null"],
      },
      full_name: {
        path: "profiles.full_name",
        requires: "profiles!inner(id,full_name)",
        description: "Recipient name, matched loosely",
        loose: true,
      },
      from: { path: "created_at", description: "At or after", ops: ["gte", "gt"], ...FROM_IST },
      to: { path: "created_at", description: "At or before", ops: ["lte", "lt"], ...TO_IST },
      sent_from: { path: "sent_at", description: "Sent at or after", ops: ["gte", "gt"], ...FROM_IST },
    },
    order: { path: "created_at", ascending: false },
    groupable: ["status", "type", "channel_attempted", "user_id", "profiles.full_name"],
  },

  // ── Catalogue and credits ────────────────────────────────────────────────
  products: {
    table: "products",
    description: "One-off purchases — drop-in classes, intro promos, private-minute top-ups.",
    // RLS is `active = true OR is_founder()`, so a client browsing sees only
    // what is on sale, which is what a client should see.
    roles: ALL,
    columns:
      "id,name,description,kind,price_pence,member_price_pence,grants_minutes,duration_minutes,active,created_at",
    includes: {},
    defaultIncludes: [],
    filters: {
      id: { path: "id", description: "Product slug", ops: ["eq", "in", "not_in"] },
      name: { path: "name", description: "Product name, matched loosely", loose: true },
      kind: { path: "kind", description: "What sort of product it is" },
      active: { path: "active", description: "true for products on sale" },
      price_inr: { path: "price_pence", description: "Price in rupees", ...RUPEES },
    },
    order: { path: "price_pence", ascending: true },
    groupable: ["kind", "active"],
  },

  credit_notes: {
    table: "class_credits",
    description:
      "Make-up credits for group classes — granted, and spent or still owing. `consumed_at` is null while a credit is still owed.",
    roles: ["client", "founder"],
    // `note` withheld — founder free text on a client's account, same reason
    // private_credit_ledger withholds its own.
    columns:
      "id,client_id,player_id,type,source,order_id,booking_id,consumed_at,created_at",
    includes: { client: "profiles(id,full_name)", player: "players(id,full_name)" },
    defaultIncludes: ["player"],
    filters: {
      id: { path: "id", description: "Credit id", ops: ["eq", "in", "not_in"] },
      client_id: { path: "client_id", description: "Credits on this account" },
      player_id: { path: "player_id", description: "Credits for this player" },
      type: { path: "type", description: "What kind of credit it is" },
      source: { path: "source", description: "How it came about" },
      unused: {
        path: "consumed_at",
        description: "Use with is_null for credits still owed, not_null for spent ones",
        ops: ["is_null", "not_null"],
      },
      from: { path: "created_at", description: "At or after", ops: ["gte", "gt"], ...FROM_IST },
      to: { path: "created_at", description: "At or before", ops: ["lte", "lt"], ...TO_IST },
    },
    order: { path: "created_at", ascending: false },
    groupable: ["type", "source", "client_id", "player_id"],
  },

  // ── Scheduling engine ────────────────────────────────────────────────────
  assignments: {
    table: "coach_assignments",
    description:
      "What the scheduling engine decided and why: the coach it picked for a session, the score it gave them, and whether the choice is locked against being moved.",
    // RLS is `coach_id = auth.uid() OR is_founder()`, so a coach sees only
    // their own — which is the honest answer to 'why was I given this'.
    roles: STAFF,
    columns: "id,session_id,coach_id,assigned_by,score,locked,status,created_at",
    includes: {
      session: "class_sessions(id,starts_at,status,classes(title,venues(name)))",
      coach: "profiles!coach_assignments_coach_id_fkey(id,full_name)",
    },
    defaultIncludes: ["session"],
    filters: {
      id: { path: "id", description: "Assignment id", ops: ["eq", "in", "not_in"] },
      session_id: { path: "session_id", description: "Assignments for this session" },
      coach_id: { path: "coach_id", description: "Assignments to this coach" },
      status: { path: "status", description: "Whether the assignment still stands" },
      locked: { path: "locked", description: "true if pinned against the engine moving it" },
      score: { path: "score", description: "The engine's score for the pick" },
      from: { path: "created_at", description: "At or after", ops: ["gte", "gt"], ...FROM_IST },
      to: { path: "created_at", description: "At or before", ops: ["lte", "lt"], ...TO_IST },
    },
    order: { path: "created_at", ascending: false },
    groupable: ["status", "locked", "coach_id"],
  },

  // ── Places, continued ────────────────────────────────────────────────────
  private_locations: {
    table: "private_class_details",
    description:
      "Where a private class actually happens — usually the client's home, with access notes and whether they have a table.",
    // The address IS the point: a coach has to drive there, and the coach app
    // already shows it. RLS scopes it properly — `client_id = auth.uid() OR
    // is_founder() OR coach_teaches_class(class_id)` — so this is one of the
    // rows where the policy, not the allow-list, is the right gate.
    roles: ALL,
    // `address_details` withheld: it is the same address as structured
    // components (building, flat, landmark…), so it doubles every row's size
    // to say what the flat columns already say.
    columns:
      "class_id,client_id,player_id,address,postcode,lat,lng,has_table,access_notes,venue_label,unit_label",
    includes: {
      class: "classes(id,title,class_type,active)",
      client: "profiles(id,full_name)",
      player: "players(id,full_name)",
    },
    defaultIncludes: ["class"],
    filters: {
      class_id: { path: "class_id", description: "The class held here", ops: ["eq", "in", "not_in"] },
      client_id: { path: "client_id", description: "Locations for this account" },
      player_id: { path: "player_id", description: "Locations for this player" },
      postcode: { path: "postcode", description: "Postcode, matched loosely", loose: true },
      address: { path: "address", description: "Address, matched loosely", loose: true },
      has_table: { path: "has_table", description: "true if the client has their own table" },
    },
    order: { path: "postcode", ascending: true },
    groupable: ["postcode", "has_table", "client_id"],
  },

  // ── Demand ───────────────────────────────────────────────────────────────
  area_interest: {
    table: "area_interest",
    description:
      "People who asked to be told when the academy reaches their area. Answers 'where is the demand we aren't serving'.",
    roles: FOUNDER,
    columns: "id,email,postcode,lat,lng,created_at",
    includes: {},
    defaultIncludes: [],
    filters: {
      id: { path: "id", description: "Entry id", ops: ["eq", "in", "not_in"] },
      email: { path: "email", description: "Email, matched loosely", loose: true },
      postcode: { path: "postcode", description: "Postcode, matched loosely", loose: true },
      from: { path: "created_at", description: "At or after", ops: ["gte", "gt"], ...FROM_IST },
      to: { path: "created_at", description: "At or before", ops: ["lte", "lt"], ...TO_IST },
    },
    order: { path: "created_at", ascending: false },
    groupable: ["postcode"],
  },
};

export type EntityName = keyof typeof ENTITIES;

export function entitiesForRole(role: Role): string[] {
  return Object.entries(ENTITIES)
    .filter(([, def]) => def.roles.includes(role))
    .map(([name]) => name)
    .sort();
}

/**
 * The entity catalogue, rendered into the tool description so the model can see
 * what exists without a discovery round-trip. Kept terse — it rides in every
 * request for the role.
 */
export function describeEntities(role: Role): string {
  return Object.entries(ENTITIES)
    .filter(([, def]) => def.roles.includes(role))
    .map(([name, def]) => {
      const filters = Object.keys(def.filters).join(", ");
      // Include names have to be listed: an unknown one is a hard error (it
      // would otherwise drop the defaults too), and several read like filter
      // names without being them — `venue` filters sessions, but the include
      // that carries the venue is called `class`.
      const includes = Object.keys(def.includes).join(", ");
      return `${name}: ${def.description} Filters: ${filters}.${includes ? ` Includes: ${includes}.` : ""}`;
    })
    .join("\n");
}
