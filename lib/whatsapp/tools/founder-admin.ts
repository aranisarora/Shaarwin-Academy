// Founder parity tools — the rest of the /admin surface over chat: class
// lifecycle, session logistics, coach/client/venue management, settings and
// billing visibility. Every mutation goes through the same lib/admin-ops cores
// the webapp uses (audit-logged), on the founder's own RLS-scoped session.

import {
  addCoachCore,
  createOneOffSessionCore,
  deleteGroupClassCore,
  deleteVenueCore,
  endGroupClassCore,
  moveSessionCore,
  promoteToCoachCore,
  saveCoachCore,
  saveVenueCore,
  setClassActiveCore,
  setClientArchivedCore,
  setClientBlockedCore,
  setCoachActiveCore,
  setSessionCapacityCore,
  setVenueActiveCore,
  topUpSessionsCore,
  updateClientCore,
  updateGroupClassCore,
  getSettingsCore,
  saveSettingsCore,
} from "@/lib/admin-ops";
import { utcToAcademyWall } from "@/lib/academy-time";
import { geocode } from "@/lib/whatsapp/geocode";
import { fail, fmtIST, ok, type ToolContext, type WaTool } from "./types";

const SETTING_KEYS = [
  "cancellation_window_hours",
  "booking_cutoff_minutes",
  "travel_buffer_minutes",
  "reschedule_max_hops",
  "dunning_grace_days",
  "waitlist_claim_minutes",
] as const;

// ── Classes ────────────────────────────────────────────────────────────────

const listClasses: WaTool = {
  name: "list_classes",
  description:
    "All group classes with class_id values, their weekly slot, venue, capacity and whether they're active. Use to find the class_id for editing/ending/deleting a class or adding a one-off session.",
  input_schema: { type: "object", properties: {} },
  run: async (_input, ctx) => {
    const { data } = await ctx.supabase!
      .from("classes")
      .select("id,title,skill_level,capacity,duration_minutes,recurrence_rule,active,class_type,venues(name)")
      .eq("class_type", "group")
      .order("title");
    return ok(
      (data ?? []).map((c) => ({
        class_id: c.id,
        title: c.title,
        level: c.skill_level,
        capacity: c.capacity,
        duration_minutes: c.duration_minutes,
        weekday: /BYDAY=([A-Z]{2})/.exec(c.recurrence_rule ?? "")?.[1] ?? null,
        venue: (c.venues as unknown as { name: string } | null)?.name ?? null,
        active: c.active,
      }))
    );
  },
};

/** Load a full ClassUpdate baseline so partial edits keep the untouched fields. */
async function classBaseline(ctx: ToolContext, classId: string) {
  const { data: cls } = await ctx.supabase!
    .from("classes")
    .select("id,title,description,skill_level,capacity,duration_minutes,venue_id,recurrence_rule")
    .eq("id", classId)
    .maybeSingle();
  if (!cls) return null;
  const { data: next } = await ctx.supabase!
    .from("class_sessions")
    .select("starts_at")
    .eq("class_id", classId)
    .gt("starts_at", new Date().toISOString())
    .order("starts_at")
    .limit(1)
    .maybeSingle();
  const time = next ? utcToAcademyWall(new Date(next.starts_at)).time : "18:00";
  return {
    classId,
    title: cls.title as string,
    description: (cls.description as string) ?? "",
    skillLevel: cls.skill_level as string,
    capacity: cls.capacity as number,
    durationMinutes: cls.duration_minutes as number,
    venueId: cls.venue_id as string,
    weekday: /BYDAY=([A-Z]{2})/.exec(cls.recurrence_rule ?? "")?.[1] ?? "MO",
    time,
  };
}

const updateClass: WaTool = {
  name: "update_class",
  description:
    "Edit a group class (class_id from list_classes). Only pass the fields you're changing — the rest stay as they are. Changing weekday/time/duration/venue moves all upcoming sessions and notifies booked members, so confirm first.",
  input_schema: {
    type: "object",
    properties: {
      class_id: { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      skill_level: { type: "string", description: "beginner | intermediate | advanced" },
      capacity: { type: "number" },
      duration_minutes: { type: "number" },
      venue_id: { type: "string" },
      weekday: { type: "string", description: "MO, TU, WE, TH, FR, SA or SU" },
      time: { type: "string", description: "HH:MM 24h academy time" },
    },
    required: ["class_id"],
  },
  run: async (input, ctx) => {
    const base = await classBaseline(ctx, String(input.class_id));
    if (!base) return fail("Class not found.");
    const result = await updateGroupClassCore(ctx.supabase!, ctx.profile!.id, {
      classId: base.classId,
      title: input.title != null ? String(input.title) : base.title,
      description: input.description != null ? String(input.description) : base.description,
      skillLevel: input.skill_level != null ? String(input.skill_level) : base.skillLevel,
      capacity: input.capacity != null ? Number(input.capacity) : base.capacity,
      durationMinutes:
        input.duration_minutes != null ? Number(input.duration_minutes) : base.durationMinutes,
      venueId: input.venue_id != null ? String(input.venue_id) : base.venueId,
      weekday: input.weekday != null ? String(input.weekday).toUpperCase() : base.weekday,
      time: input.time != null ? String(input.time) : base.time,
    });
    return result.ok ? ok({ updated: true }) : fail(result.error ?? "Failed.");
  },
};

const endClass: WaTool = {
  name: "end_class",
  description:
    "End a class: cancels all its upcoming sessions and notifies everyone, keeping history. DESTRUCTIVE — confirm first.",
  input_schema: {
    type: "object",
    properties: { class_id: { type: "string" } },
    required: ["class_id"],
  },
  run: async (input, ctx) => {
    const result = await endGroupClassCore(ctx.supabase!, ctx.profile!.id, String(input.class_id));
    return result.ok ? ok({ ended: true }) : fail(result.error ?? "Failed.");
  },
};

const deleteClass: WaTool = {
  name: "delete_class",
  description:
    "Permanently delete a class that nobody ever booked (created by mistake). Fails if it has bookings — end it instead. Confirm first.",
  input_schema: {
    type: "object",
    properties: { class_id: { type: "string" } },
    required: ["class_id"],
  },
  run: async (input, ctx) => {
    const result = await deleteGroupClassCore(ctx.supabase!, ctx.profile!.id, String(input.class_id));
    return result.ok ? ok({ deleted: true }) : fail(result.error ?? "Failed.");
  },
};

const setClassActive: WaTool = {
  name: "set_class_active",
  description: "Activate or deactivate a class (class_id from list_classes).",
  input_schema: {
    type: "object",
    properties: { class_id: { type: "string" }, active: { type: "boolean" } },
    required: ["class_id", "active"],
  },
  run: async (input, ctx) => {
    const result = await setClassActiveCore(
      ctx.supabase!,
      ctx.profile!.id,
      String(input.class_id),
      Boolean(input.active)
    );
    return result.ok ? ok({ active: Boolean(input.active) }) : fail(result.error ?? "Failed.");
  },
};

const topUpSessions: WaTool = {
  name: "top_up_sessions",
  description: "Generate the next 8 weeks of sessions for every running class.",
  input_schema: { type: "object", properties: {} },
  run: async (_input, ctx) => {
    const result = await topUpSessionsCore(ctx.supabase!, ctx.profile!.id);
    return result.ok ? ok({ created: result.created ?? 0 }) : fail(result.error ?? "Failed.");
  },
};

// ── Sessions / calendar ──────────────────────────────────────────────────────

const moveSession: WaTool = {
  name: "move_session",
  description:
    "Move one session to a new day/time (session_id from list_sessions). Notifies booked members and the coach. Date is YYYY-MM-DD, time HH:MM, both academy time (IST). Confirm first.",
  input_schema: {
    type: "object",
    properties: {
      session_id: { type: "string" },
      date: { type: "string", description: "YYYY-MM-DD (IST)" },
      time: { type: "string", description: "HH:MM (IST)" },
    },
    required: ["session_id", "date", "time"],
  },
  run: async (input, ctx) => {
    const result = await moveSessionCore(
      ctx.supabase!,
      ctx.profile!.id,
      String(input.session_id),
      String(input.date),
      String(input.time)
    );
    return result.ok ? ok({ moved: true }) : fail(result.error ?? "Failed.");
  },
};

const setSessionCapacity: WaTool = {
  name: "set_session_capacity",
  description:
    "Override the spots for a single session (session_id from list_sessions). Pass capacity=0 or omit to clear the override and use the class default.",
  input_schema: {
    type: "object",
    properties: { session_id: { type: "string" }, capacity: { type: "number" } },
    required: ["session_id"],
  },
  run: async (input, ctx) => {
    const cap =
      input.capacity == null || Number(input.capacity) === 0 ? null : Number(input.capacity);
    const result = await setSessionCapacityCore(
      ctx.supabase!,
      ctx.profile!.id,
      String(input.session_id),
      cap
    );
    return result.ok ? ok({ capacity: cap }) : fail(result.error ?? "Failed.");
  },
};

const createOneOff: WaTool = {
  name: "create_one_off_session",
  description:
    "Add a single extra session to an existing class (class_id from list_classes), e.g. a holiday special. Date YYYY-MM-DD, time HH:MM (IST). coach_id optional — the engine assigns one otherwise.",
  input_schema: {
    type: "object",
    properties: {
      class_id: { type: "string" },
      date: { type: "string" },
      time: { type: "string" },
      coach_id: { type: "string" },
    },
    required: ["class_id", "date", "time"],
  },
  run: async (input, ctx) => {
    const result = await createOneOffSessionCore(
      ctx.supabase!,
      ctx.profile!.id,
      String(input.class_id),
      String(input.date),
      String(input.time),
      input.coach_id ? String(input.coach_id) : ""
    );
    return result.ok ? ok({ created: true }) : fail(result.error ?? "Failed.");
  },
};

// ── Coaches ────────────────────────────────────────────────────────────────

const promoteCoach: WaTool = {
  name: "promote_client_to_coach",
  description:
    "Promote an existing client account to coach (client_id from list_clients). They keep the same login. Confirm first.",
  input_schema: {
    type: "object",
    properties: { client_id: { type: "string" } },
    required: ["client_id"],
  },
  run: async (input, ctx) => {
    const result = await promoteToCoachCore(ctx.supabase!, ctx.profile!.id, String(input.client_id));
    return result.ok ? ok({ promoted: true }) : fail(result.error ?? "Failed.");
  },
};

const addCoach: WaTool = {
  name: "add_coach",
  description:
    "Register a new coach by their details (name + email required). If an account already exists for that email it's promoted to coach now; otherwise they become a coach automatically the moment they sign up on the website with that email. Share the plain website signup link with them. Confirm details first.",
  input_schema: {
    type: "object",
    properties: {
      full_name: { type: "string" },
      email: { type: "string" },
      phone: { type: "string" },
      bio: { type: "string" },
      tier: { type: "number", description: "1 Junior | 2 Senior | 3 Head coach" },
      max_teachable_level: {
        type: "string",
        description: "beginner | intermediate | advanced | elite",
      },
      travel_radius_km: { type: "number" },
      dbs_checked: { type: "boolean" },
    },
    required: ["full_name", "email"],
  },
  run: async (input, ctx) => {
    const result = await addCoachCore(ctx.supabase!, ctx.profile!.id, {
      fullName: String(input.full_name ?? ""),
      email: String(input.email ?? ""),
      phone: input.phone != null ? String(input.phone) : "",
      bio: input.bio != null ? String(input.bio) : "",
      tier: input.tier != null ? Number(input.tier) : 1,
      maxTeachableLevel:
        input.max_teachable_level != null ? String(input.max_teachable_level) : "advanced",
      travelRadiusKm: input.travel_radius_km != null ? Number(input.travel_radius_km) : 10,
      dbsChecked: input.dbs_checked != null ? Boolean(input.dbs_checked) : false,
    });
    if (!result.ok) return fail(result.error ?? "Failed.");
    return ok({
      added: true,
      pending: Boolean(result.pending),
      note: result.pending
        ? "Saved to the coach list. They become a coach as soon as they sign up on the website with that email — send them the signup link."
        : "That account already existed and is now a coach.",
    });
  },
};

const updateCoach: WaTool = {
  name: "update_coach",
  description:
    "Edit a coach's details, including name and phone (coach_id from list_coaches). Only pass what you're changing; the rest stay put.",
  input_schema: {
    type: "object",
    properties: {
      coach_id: { type: "string" },
      full_name: { type: "string" },
      phone: { type: "string" },
      bio: { type: "string" },
      travel_radius_km: { type: "number" },
      max_teachable_level: { type: "string", description: "beginner | intermediate | advanced" },
      tier: { type: "number" },
      dbs_checked: { type: "boolean" },
    },
    required: ["coach_id"],
  },
  run: async (input, ctx) => {
    const { data: cur } = await ctx.supabase!
      .from("coaches")
      .select("bio,travel_radius_km,max_teachable_level,tier,dbs_checked")
      .eq("id", input.coach_id)
      .maybeSingle();
    if (!cur) return fail("Coach not found.");
    const result = await saveCoachCore(ctx.supabase!, ctx.profile!.id, {
      id: String(input.coach_id),
      bio: input.bio != null ? String(input.bio) : (cur.bio ?? ""),
      travelRadiusKm:
        input.travel_radius_km != null ? Number(input.travel_radius_km) : cur.travel_radius_km,
      maxTeachableLevel:
        input.max_teachable_level != null
          ? String(input.max_teachable_level)
          : cur.max_teachable_level,
      tier: input.tier != null ? Number(input.tier) : cur.tier,
      dbsChecked: input.dbs_checked != null ? Boolean(input.dbs_checked) : cur.dbs_checked,
      ...(input.full_name != null ? { fullName: String(input.full_name) } : {}),
      ...(input.phone != null ? { phone: String(input.phone) } : {}),
    });
    return result.ok ? ok({ updated: true }) : fail(result.error ?? "Failed.");
  },
};

const setCoachActive: WaTool = {
  name: "set_coach_active",
  description:
    "Activate or pause a coach (coach_id from list_coaches). Pausing stops new assignments; existing sessions stay until reassigned.",
  input_schema: {
    type: "object",
    properties: { coach_id: { type: "string" }, active: { type: "boolean" } },
    required: ["coach_id", "active"],
  },
  run: async (input, ctx) => {
    const result = await setCoachActiveCore(
      ctx.supabase!,
      ctx.profile!.id,
      String(input.coach_id),
      Boolean(input.active)
    );
    return result.ok ? ok({ active: Boolean(input.active) }) : fail(result.error ?? "Failed.");
  },
};

// ── Clients ──────────────────────────────────────────────────────────────────

const updateClient: WaTool = {
  name: "update_client",
  description:
    "Edit a client's name and/or phone (client_id from list_clients). Only pass what you're changing.",
  input_schema: {
    type: "object",
    properties: {
      client_id: { type: "string" },
      full_name: { type: "string" },
      phone: { type: "string" },
    },
    required: ["client_id"],
  },
  run: async (input, ctx) => {
    const { data: cur } = await ctx.supabase!
      .from("profiles")
      .select("full_name,phone")
      .eq("id", input.client_id)
      .maybeSingle();
    if (!cur) return fail("Client not found.");
    const result = await updateClientCore(
      ctx.supabase!,
      ctx.profile!.id,
      String(input.client_id),
      input.full_name != null ? String(input.full_name) : cur.full_name,
      input.phone != null ? String(input.phone) : (cur.phone ?? "")
    );
    return result.ok ? ok({ updated: true }) : fail(result.error ?? "Failed.");
  },
};

const blockClient: WaTool = {
  name: "block_client",
  description:
    "Block or unblock a client (payment-dispute freeze — they can sign in but can't book). client_id from list_clients. Confirm first.",
  input_schema: {
    type: "object",
    properties: { client_id: { type: "string" }, blocked: { type: "boolean" } },
    required: ["client_id", "blocked"],
  },
  run: async (input, ctx) => {
    const result = await setClientBlockedCore(
      ctx.supabase!,
      ctx.profile!.id,
      String(input.client_id),
      Boolean(input.blocked)
    );
    return result.ok ? ok({ blocked: Boolean(input.blocked) }) : fail(result.error ?? "Failed.");
  },
};

const archiveClient: WaTool = {
  name: "archive_client",
  description:
    "Archive or restore a client (archiving hides them from lists; reversible). client_id from list_clients. Confirm first.",
  input_schema: {
    type: "object",
    properties: { client_id: { type: "string" }, archived: { type: "boolean" } },
    required: ["client_id", "archived"],
  },
  run: async (input, ctx) => {
    const result = await setClientArchivedCore(
      ctx.supabase!,
      ctx.profile!.id,
      String(input.client_id),
      Boolean(input.archived)
    );
    return result.ok ? ok({ archived: Boolean(input.archived) }) : fail(result.error ?? "Failed.");
  },
};

// ── Venues ─────────────────────────────────────────────────────────────────

const saveVenue: WaTool = {
  name: "save_venue",
  description:
    "Create a new venue or edit an existing one (pass venue_id to edit — from list_venues). The address is geocoded automatically. Confirm details first.",
  input_schema: {
    type: "object",
    properties: {
      venue_id: { type: "string", description: "Omit to create a new venue" },
      name: { type: "string" },
      address: { type: "string" },
      postcode: { type: "string" },
    },
    required: ["name", "address"],
  },
  run: async (input, ctx) => {
    const geo = await geocode(String(input.address));
    if (!geo) return fail("Couldn't locate that address — try a fuller address.");
    const result = await saveVenueCore(ctx.supabase!, ctx.profile!.id, {
      id: input.venue_id ? String(input.venue_id) : undefined,
      name: String(input.name),
      address: String(input.address),
      postcode: String(input.postcode ?? ""),
      lat: geo.lat,
      lng: geo.lng,
    });
    return result.ok ? ok({ saved: true, resolved_address: geo.place }) : fail(result.error ?? "Failed.");
  },
};

const setVenueActive: WaTool = {
  name: "set_venue_active",
  description: "Show or hide a venue (venue_id from list_venues).",
  input_schema: {
    type: "object",
    properties: { venue_id: { type: "string" }, active: { type: "boolean" } },
    required: ["venue_id", "active"],
  },
  run: async (input, ctx) => {
    const result = await setVenueActiveCore(
      ctx.supabase!,
      ctx.profile!.id,
      String(input.venue_id),
      Boolean(input.active)
    );
    return result.ok ? ok({ active: Boolean(input.active) }) : fail(result.error ?? "Failed.");
  },
};

const deleteVenue: WaTool = {
  name: "delete_venue",
  description:
    "Delete a venue that has no classes attached (venue_id from list_venues). Fails otherwise — hide it instead. Confirm first.",
  input_schema: {
    type: "object",
    properties: { venue_id: { type: "string" } },
    required: ["venue_id"],
  },
  run: async (input, ctx) => {
    const result = await deleteVenueCore(ctx.supabase!, ctx.profile!.id, String(input.venue_id));
    return result.ok ? ok({ deleted: true }) : fail(result.error ?? "Failed.");
  },
};

// ── Settings ─────────────────────────────────────────────────────────────────

const getSettings: WaTool = {
  name: "get_settings",
  description:
    "The academy's operational settings: cancellation window (hours), booking cutoff (minutes), travel buffer (minutes), reschedule max hops, dunning grace (days), waitlist claim (minutes).",
  input_schema: { type: "object", properties: {} },
  run: async (_input, ctx) => ok(await getSettingsCore(ctx.supabase!)),
};

const updateSettings: WaTool = {
  name: "update_settings",
  description:
    "Change one or more operational settings. Only pass the ones you're changing. All values are non-negative numbers. Confirm the change first.",
  input_schema: {
    type: "object",
    properties: Object.fromEntries(
      SETTING_KEYS.map((k) => [k, { type: "number" }])
    ),
  },
  run: async (input, ctx) => {
    const values: Record<string, number> = {};
    for (const k of SETTING_KEYS) {
      if (input[k] != null) values[k] = Number(input[k]);
    }
    if (Object.keys(values).length === 0) return fail("No settings provided.");
    const result = await saveSettingsCore(ctx.supabase!, ctx.profile!.id, values);
    return result.ok ? ok({ updated: values }) : fail(result.error ?? "Failed.");
  },
};

// ── Billing / visibility ─────────────────────────────────────────────────────

const listSubscriptions: WaTool = {
  name: "list_subscriptions",
  description:
    "Current subscriptions with client name, plan, status and renewal date. Optional status filter (active, trialing, past_due, canceled).",
  input_schema: {
    type: "object",
    properties: { status: { type: "string" } },
  },
  run: async (input, ctx) => {
    let q = ctx.supabase!
      .from("subscriptions")
      .select("id,status,current_period_end,client_id,plans(name),profiles(full_name)")
      .order("current_period_end", { ascending: false })
      .limit(50);
    if (input.status) q = q.eq("status", String(input.status));
    const { data } = await q;
    return ok(
      (data ?? []).map((s) => ({
        client: (s.profiles as unknown as { full_name: string } | null)?.full_name ?? "?",
        plan: (s.plans as unknown as { name: string } | null)?.name ?? "?",
        status: s.status,
        renews: s.current_period_end ? fmtIST(s.current_period_end) : null,
      }))
    );
  },
};

const listDunning: WaTool = {
  name: "list_dunning",
  description: "Clients whose payments are past due (needing follow-up).",
  input_schema: { type: "object", properties: {} },
  run: async (_input, ctx) => {
    const { data } = await ctx.supabase!
      .from("subscriptions")
      .select("id,status,current_period_end,plans(name),profiles(full_name,phone)")
      .eq("status", "past_due")
      .order("current_period_end");
    return ok(
      (data ?? []).map((s) => {
        const p = s.profiles as unknown as { full_name: string; phone: string | null } | null;
        return {
          client: p?.full_name ?? "?",
          phone: p?.phone ?? null,
          plan: (s.plans as unknown as { name: string } | null)?.name ?? "?",
          since: s.current_period_end ? fmtIST(s.current_period_end) : null,
        };
      })
    );
  },
};

export const founderAdminTools: WaTool[] = [
  listClasses,
  updateClass,
  endClass,
  deleteClass,
  setClassActive,
  topUpSessions,
  moveSession,
  setSessionCapacity,
  createOneOff,
  promoteCoach,
  addCoach,
  updateCoach,
  setCoachActive,
  updateClient,
  blockClient,
  archiveClient,
  saveVenue,
  setVenueActive,
  deleteVenue,
  getSettings,
  updateSettings,
  listSubscriptions,
  listDunning,
];
