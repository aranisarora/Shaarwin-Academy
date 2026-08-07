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
// Deliberately NOT exposed: student_notes, skill_assessments, skill_ratings,
// skills, settings, school_admins, push_subscriptions, webhook_events,
// client_invites, coach_invites, wa_links, wa_messages, wa_inbound_seen, and
// BOTH views (`coach_client_view` is declared without security_invoker, so it
// reads through the view owner and bypasses the profiles policies entirely —
// see the security note in the PR).

import type { Database } from "@/lib/database.types";
import type { Operator } from "./query-core";

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
};

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
      from: { path: "starts_at", description: "ISO timestamp — sessions starting at or after", ops: ["gte", "gt"] },
      to: { path: "starts_at", description: "ISO timestamp — sessions starting at or before", ops: ["lte", "lt"] },
      starts_at: { path: "starts_at", description: "Session start time" },
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
      },
      venue: {
        path: "classes.venues.name",
        requires: "classes!inner(title,venues!inner(id,name))",
        description: "Venue name, e.g. 'La Plazza' — matches loosely with ilike",
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
      title: { path: "title", description: "Class title" },
      type: { path: "class_type", description: "group | private", values: ["group", "private"] },
      level: { path: "skill_level", description: "Skill level", values: SKILL_LEVELS },
      active: { path: "active", description: "true for live classes" },
      is_school: { path: "is_school", description: "true for school-programme classes" },
      venue_id: { path: "venue_id", description: "Venue id" },
      venue: {
        path: "venues.name",
        requires: "venues!inner(id,name)",
        description: "Venue name, matched loosely",
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
        description: "ISO timestamp — bookings for sessions at or after",
        ops: ["gte", "gt"],
      },
      to: {
        path: "class_sessions.starts_at",
        requires: "class_sessions!inner(id,starts_at)",
        description: "ISO timestamp — bookings for sessions at or before",
        ops: ["lte", "lt"],
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
      },
      booked_at: { path: "booked_at", description: "When the booking was made" },
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
      full_name: { path: "full_name", description: "Player name, matched loosely" },
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
      full_name: { path: "full_name", description: "Name, matched loosely" },
      email: { path: "email", description: "Email, matched loosely" },
      phone: { path: "phone", description: "E.164 phone" },
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
      created_at: { path: "created_at", description: "Signup time" },
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
      },
    },
    order: { path: "created_at", ascending: true },
    groupable: ["active", "max_teachable_level"],
  },

  // ── Places ───────────────────────────────────────────────────────────────
  venues: {
    table: "venues",
    description: "Where sessions happen.",
    roles: ALL,
    // notes withheld — free text, and the table is readable by anon.
    columns: "id,name,unit,address,postcode,lat,lng,active,is_school,created_at",
    includes: { classes: "classes(id,title,active,class_type)" },
    defaultIncludes: [],
    filters: {
      id: { path: "id", description: "Venue id", ops: ["eq", "in", "not_in"] },
      name: { path: "name", description: "Venue name, matched loosely" },
      active: { path: "active", description: "true for venues in use" },
      is_school: { path: "is_school", description: "true for school sites" },
      postcode: { path: "postcode", description: "Postcode" },
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
      from: { path: "starts_at", description: "ISO timestamp — at or after", ops: ["gte", "gt"] },
      to: { path: "ends_at", description: "ISO timestamp — at or before", ops: ["lte", "lt"] },
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
        description: "ISO timestamp — period ends at or before (expiring soon)",
        ops: ["lte", "lt"],
      },
      renews_after: {
        path: "current_period_end",
        description: "ISO timestamp — period ends at or after",
        ops: ["gte", "gt"],
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
      name: { path: "name", description: "Plan name" },
      active: { path: "active", description: "true for plans on sale" },
      price_pence: { path: "price_pence", description: "Price in the smallest currency unit" },
    },
    order: { path: "price_pence", ascending: true },
    groupable: ["active", "billing_interval_months"],
  },

  credits: {
    table: "private_credit_ledger",
    description:
      "Every movement of private-coaching minutes. Sum delta_minutes for a client to get their balance.",
    roles: ["client", "founder"],
    columns: "id,client_id,subscription_id,booking_id,delta_minutes,reason,note,created_at",
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
      from: { path: "created_at", description: "ISO timestamp — at or after", ops: ["gte", "gt"] },
      to: { path: "created_at", description: "ISO timestamp — at or before", ops: ["lte", "lt"] },
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
      from: { path: "created_at", description: "ISO timestamp — at or after", ops: ["gte", "gt"] },
      to: { path: "created_at", description: "ISO timestamp — at or before", ops: ["lte", "lt"] },
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
      from: { path: "created_at", description: "ISO timestamp — at or after", ops: ["gte", "gt"] },
      to: { path: "created_at", description: "ISO timestamp — at or before", ops: ["lte", "lt"] },
      paid: {
        path: "paid_at",
        description: "Use with not_null for paid, is_null for outstanding",
        ops: ["is_null", "not_null"],
      },
    },
    order: { path: "created_at", ascending: false },
    groupable: ["status", "client_id"],
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
      return `${name}: ${def.description} Filters: ${filters}.`;
    })
    .join("\n");
}
