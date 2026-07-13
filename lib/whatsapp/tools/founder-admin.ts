// Founder parity tools — the rest of the /admin surface over chat: class
// lifecycle, session logistics, coach/client/venue management, settings and
// billing visibility. Every mutation goes through the same lib/admin-ops cores
// the webapp uses (audit-logged), on the founder's own RLS-scoped session.

import {
  addClientInviteCore,
  addCoachCore,
  broadcastNotificationCore,
  createOneOffSessionCore,
  createPrivateSessionCore,
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
    "All weekly group classes with class_id values, their weekly slot, venue, capacity and whether they're active. Each class repeats every week on the calendar. Use to find the class_id for editing/ending/deleting a class or adding a one-off session.",
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
    "Edit a weekly class — the EVERY-WEEK scope: changes apply to all upcoming weeks of the class (like Google Calendar's 'all events'). For a one-week-only change use move_session or set_session_capacity instead. class_id from list_classes; only pass the fields you're changing. Changing weekday/time/duration/venue moves all upcoming sessions and notifies booked members, so confirm the scope ('just this session, or every week?') and the change first.",
  input_schema: {
    type: "object",
    properties: {
      class_id: { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      skill_level: { type: "string", description: "any | beginner | intermediate | advanced | elite" },
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
    "Move one session to a new day/time — the JUST-THIS-SESSION scope: other weeks of the class stay put (use update_class to move every week). session_id from list_sessions. Notifies booked members and the coach. Date is YYYY-MM-DD, time HH:MM, both academy time (IST). If it's ambiguous whether the founder means one week or every week, ask before calling. Confirm first.",
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
    "Override the spots for a single session — the JUST-THIS-SESSION scope (use update_class capacity to change every week). session_id from list_sessions. Pass capacity=0 or omit to clear the override and use the class default.",
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

const createPrivate: WaTool = {
  name: "create_private_session",
  description:
    "Book a private one-to-one session FOR a client (client_id from list_clients). Creates the session, books the client in, notifies them, and debits the session's minutes from their private balance (which may go negative — top up via adjust_private_credits). Location: pass EITHER venue_id (from list_venues — reuses the venue's saved address) OR a free-text address to geocode. Sensible defaults fill anything the founder didn't state — duration_minutes → 60, has_table → true, player → the client's default; the reply lists every default used. MONEY-ADJACENT: if the founder's request is complete and unambiguous, just book it and report what you did (defaults used + minutes debited) — no separate yes needed. Only pause to confirm when something is genuinely ambiguous or missing. Date YYYY-MM-DD, time HH:MM (IST). coach_id optional — the engine assigns one otherwise.",
  input_schema: {
    type: "object",
    properties: {
      client_id: { type: "string" },
      player_name: { type: "string", description: "Which household player — omit for the default" },
      date: { type: "string", description: "YYYY-MM-DD (IST)" },
      time: { type: "string", description: "HH:MM (IST)" },
      duration_minutes: { type: "number", description: "60 or 90 — defaults to 60 if omitted" },
      venue_id: { type: "string", description: "A saved venue (from list_venues) — used instead of address" },
      address: { type: "string", description: "Free-text address to geocode — omit if venue_id is given" },
      access_notes: { type: "string", description: "Entry instructions, if any" },
      has_table: { type: "boolean", description: "Does the address have a table? Default true" },
      coach_id: { type: "string" },
    },
    required: ["client_id", "date", "time"],
  },
  run: async (input, ctx) => {
    // Location: a saved venue (preferred — reuses its geocoded coords) or
    // free-text to geocode now. Exactly one of the two is required.
    let address: string;
    let lat: number;
    let lng: number;
    let resolvedPlace: string | undefined;
    if (input.venue_id) {
      const { data: venue } = await ctx.supabase!
        .from("venues")
        .select("name,address,lat,lng")
        .eq("id", String(input.venue_id))
        .maybeSingle();
      if (!venue) return fail("No venue with that id — check list_venues.");
      address = venue.address;
      lat = Number(venue.lat);
      lng = Number(venue.lng);
      resolvedPlace = venue.name;
    } else if (input.address) {
      const geo = await geocode(String(input.address));
      if (!geo) return fail("Couldn't locate that address — ask for a fuller address.");
      address = String(input.address);
      lat = geo.lat;
      lng = geo.lng;
      resolvedPlace = geo.place;
    } else {
      return fail("Need a location — pass a venue_id (from list_venues) or an address.");
    }

    let playerId: string | undefined;
    if (input.player_name) {
      const { data: players } = await ctx.supabase!
        .from("players")
        .select("id,full_name")
        .eq("client_id", String(input.client_id));
      const match = (players ?? []).find(
        (p) => p.full_name.toLowerCase().includes(String(input.player_name).toLowerCase())
      );
      if (!match) return fail("No player by that name in the client's household.");
      playerId = match.id;
    }

    const durationMinutes = Number(input.duration_minutes) === 90 ? 90 : 60;
    const hasTable = input.has_table != null ? Boolean(input.has_table) : true;
    const result = await createPrivateSessionCore(ctx.supabase!, ctx.profile!.id, {
      clientId: String(input.client_id),
      playerId,
      date: String(input.date),
      time: String(input.time),
      durationMinutes,
      address,
      lat,
      lng,
      hasTable,
      accessNotes: input.access_notes ? String(input.access_notes) : undefined,
      addressDetails: {
        formatted: resolvedPlace ?? address,
        lat,
        lng,
        accessNotes: input.access_notes ?? null,
        label: input.venue_id ? "venue" : "home",
      },
      coachId: input.coach_id ? String(input.coach_id) : undefined,
    });
    if (!result.ok) return fail(result.error ?? "Failed.");
    // Surface which values were defaulted so the reply can name them.
    const defaults_used: Record<string, unknown> = {};
    if (input.duration_minutes == null) defaults_used.duration_minutes = 60;
    if (input.has_table == null) defaults_used.has_table = true;
    if (!input.player_name) defaults_used.player = "client's default";
    return ok({
      created: true,
      location: resolvedPlace,
      duration_minutes: durationMinutes,
      defaults_used,
      note: "Client notified; minutes debited.",
    });
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
      travel_radius_km: { type: "number" },
      base_address: { type: "string" },
      base_lat: { type: "number" },
      base_lng: { type: "number" },
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
      travelRadiusKm: input.travel_radius_km != null ? Number(input.travel_radius_km) : 10,
      baseAddress: input.base_address != null ? String(input.base_address) : "",
      baseLat: input.base_lat != null ? Number(input.base_lat) : 12.9716,
      baseLng: input.base_lng != null ? Number(input.base_lng) : 77.5946,
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
      base_address: { type: "string" },
      base_lat: { type: "number" },
      base_lng: { type: "number" },
      tier: { type: "number" },
    },
    required: ["coach_id"],
  },
  run: async (input, ctx) => {
    const { data: cur } = await ctx.supabase!
      .from("coaches")
      .select("bio,travel_radius_km,base_address,base_lat,base_lng,tier")
      .eq("id", input.coach_id)
      .maybeSingle();
    if (!cur) return fail("Coach not found.");
    const result = await saveCoachCore(ctx.supabase!, ctx.profile!.id, {
      id: String(input.coach_id),
      bio: input.bio != null ? String(input.bio) : (cur.bio ?? ""),
      travelRadiusKm:
        input.travel_radius_km != null ? Number(input.travel_radius_km) : cur.travel_radius_km,
      baseAddress:
        input.base_address != null ? String(input.base_address) : (cur.base_address ?? ""),
      baseLat: input.base_lat != null ? Number(input.base_lat) : Number(cur.base_lat),
      baseLng: input.base_lng != null ? Number(input.base_lng) : Number(cur.base_lng),
      tier: input.tier != null ? Number(input.tier) : cur.tier,
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

const addClient: WaTool = {
  name: "add_client",
  description:
    "Pre-register an existing (offline) client by phone number, before they've signed up. When they sign up on the website or message this WhatsApp assistant from that number, their account connects automatically and any name/notes apply. Optionally gift a free plan (plan_id from list_plans) — a 30-day comp subscription granted the moment they connect. Confirm the number first.",
  input_schema: {
    type: "object",
    properties: {
      phone: { type: "string", description: "Their WhatsApp number, e.g. +91…" },
      full_name: { type: "string" },
      notes: { type: "string", description: "Saved onto their student record when they join" },
      plan_id: {
        type: "string",
        description: "Optional — free plan gifted on signup (from list_plans)",
      },
    },
    required: ["phone"],
  },
  run: async (input, ctx) => {
    const result = await addClientInviteCore(ctx.supabase!, ctx.profile!.id, {
      phone: String(input.phone ?? ""),
      fullName: input.full_name != null ? String(input.full_name) : "",
      notes: input.notes != null ? String(input.notes) : "",
      planId: input.plan_id != null ? String(input.plan_id) : "",
    });
    if (!result.ok) return fail(result.error ?? "Failed.");
    return ok({
      added: true,
      note: "Saved. Their account connects automatically when they sign up or message this assistant from that number.",
    });
  },
};

const clientAttendance: WaTool = {
  name: "client_attendance",
  description:
    "Attendance record for a client's students (client_id from list_clients): attended / no-show / cancelled counts and the most recent sessions per student.",
  input_schema: {
    type: "object",
    properties: { client_id: { type: "string" } },
    required: ["client_id"],
  },
  run: async (input, ctx) => {
    const supabase = ctx.supabase!;
    const { data: players } = await supabase
      .from("players")
      .select("id,full_name,skill_level")
      .eq("client_id", String(input.client_id));
    if (!players?.length) return fail("No students found for that client.");

    const { data: bookings } = await supabase
      .from("bookings")
      .select("player_id,status,class_sessions!inner(starts_at,classes(title))")
      .in("player_id", players.map((p) => p.id));

    const byPlayer = new Map<string, { status: string; when: string; title: string }[]>();
    for (const b of bookings ?? []) {
      const s = b.class_sessions as unknown as {
        starts_at: string;
        classes: { title: string } | null;
      };
      const list = byPlayer.get(b.player_id) ?? [];
      list.push({ status: b.status, when: s.starts_at, title: s.classes?.title ?? "Session" });
      byPlayer.set(b.player_id, list);
    }

    return ok(
      players.map((p) => {
        const rows = (byPlayer.get(p.id) ?? []).sort((a, b) => b.when.localeCompare(a.when));
        const count = (status: string) => rows.filter((r) => r.status === status).length;
        return {
          player_id: p.id,
          student: p.full_name,
          level: p.skill_level,
          attended: count("attended"),
          no_shows: count("no_show"),
          cancelled:
            count("cancelled_by_client") + count("cancelled_by_academy"),
          upcoming: rows.filter(
            (r) =>
              (r.status === "confirmed" || r.status === "waitlisted") &&
              new Date(r.when).getTime() > Date.now()
          ).length,
          recent: rows
            .filter((r) => r.status !== "rescheduled")
            .slice(0, 10)
            .map((r) => ({ when: fmtIST(r.when), class: r.title, status: r.status })),
        };
      })
    );
  },
};

const clientNotes: WaTool = {
  name: "client_notes",
  description:
    "Coach notes for a client's students (client_id from list_clients), newest first, plus any admin note saved on the student record.",
  input_schema: {
    type: "object",
    properties: { client_id: { type: "string" } },
    required: ["client_id"],
  },
  run: async (input, ctx) => {
    const supabase = ctx.supabase!;
    const { data: players } = await supabase
      .from("players")
      .select("id,full_name,notes")
      .eq("client_id", String(input.client_id));
    if (!players?.length) return fail("No students found for that client.");

    const result = [];
    for (const p of players) {
      const { data: notes } = await supabase.rpc("get_player_notes", { p_player: p.id });
      result.push({
        player_id: p.id,
        student: p.full_name,
        record_note: p.notes,
        coach_notes: (
          (notes as { body: string; created_at: string; author_name: string }[] | null) ?? []
        ).map((n) => ({ when: fmtIST(n.created_at), author: n.author_name, note: n.body })),
      });
    }
    return ok(result);
  },
};

const clientPayments: WaTool = {
  name: "client_payments",
  description:
    "Payment details for a client (client_id from list_clients): membership and status, total paid, recent invoices and one-off purchases, private-minutes balance.",
  input_schema: {
    type: "object",
    properties: { client_id: { type: "string" } },
    required: ["client_id"],
  },
  run: async (input, ctx) => {
    const supabase = ctx.supabase!;
    const clientId = String(input.client_id);
    const [{ data: subs }, { data: invoices }, { data: orders }, { data: ledger }] =
      await Promise.all([
        supabase
          .from("subscriptions")
          .select("status,source,current_period_end,plans(name,price_pence)")
          .eq("client_id", clientId)
          .in("status", ["active", "trialing", "past_due", "paused"]),
        supabase
          .from("invoices")
          .select("amount_pence,status,paid_at,created_at")
          .eq("client_id", clientId)
          .order("created_at", { ascending: false })
          .limit(12),
        supabase
          .from("orders")
          .select("status,amount_pence,created_at,products(name)")
          .eq("client_id", clientId)
          .order("created_at", { ascending: false })
          .limit(12),
        supabase
          .from("private_credit_ledger")
          .select("delta_minutes")
          .eq("client_id", clientId),
      ]);

    const paidPence = (invoices ?? [])
      .filter((i) => i.status === "paid")
      .reduce((sum, i) => sum + i.amount_pence, 0);
    return ok({
      memberships: (subs ?? []).map((s) => ({
        plan: (s.plans as unknown as { name: string } | null)?.name ?? "?",
        status: s.status,
        source: s.source,
        renews: s.current_period_end ? fmtIST(s.current_period_end) : null,
      })),
      total_paid_inr: Math.round(paidPence / 100),
      private_minutes_balance: (ledger ?? []).reduce((sum, l) => sum + l.delta_minutes, 0),
      recent_invoices: (invoices ?? []).map((i) => ({
        amount_inr: Math.round(i.amount_pence / 100),
        status: i.status,
        when: fmtIST(i.paid_at ?? i.created_at),
      })),
      recent_purchases: (orders ?? []).map((o) => ({
        product: (o.products as unknown as { name: string } | null)?.name ?? "?",
        amount_inr: Math.round(o.amount_pence / 100),
        status: o.status,
        when: fmtIST(o.created_at),
      })),
    });
  },
};

const broadcastMessage: WaTool = {
  name: "broadcast_message",
  description:
    "Send an announcement to EVERY active coach or EVERY active client (delivered by push/WhatsApp/email per each person's preferences). e.g. 'notify all coaches that Saturday sessions move indoors'. Restate the audience and exact message and get an explicit yes BEFORE calling — this cannot be unsent.",
  input_schema: {
    type: "object",
    properties: {
      audience: { type: "string", enum: ["coaches", "clients"] },
      message: { type: "string", description: "The announcement text, sent verbatim" },
      title: { type: "string", description: "Optional heading; defaults to 'Message from the academy'" },
    },
    required: ["audience", "message"],
  },
  run: async (input, ctx) => {
    const audience = input.audience === "coaches" ? "coaches" : "clients";
    const result = await broadcastNotificationCore(
      ctx.supabase!,
      ctx.profile!.id,
      audience,
      String(input.message ?? ""),
      input.title != null ? String(input.title) : undefined
    );
    if (!result.ok) return fail(result.error ?? "Failed.");
    return ok({ sent: true, audience, recipients: result.recipients });
  },
};

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
  createPrivate,
  promoteCoach,
  addCoach,
  updateCoach,
  setCoachActive,
  addClient,
  updateClient,
  blockClient,
  archiveClient,
  clientAttendance,
  clientNotes,
  clientPayments,
  broadcastMessage,
  saveVenue,
  setVenueActive,
  deleteVenue,
  getSettings,
  updateSettings,
  listSubscriptions,
  listDunning,
];
