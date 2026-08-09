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
  notifyUsersCore,
  NOTIFY_TYPES,
} from "@/lib/admin-ops";
import { formatSessionDate, utcToAcademyWall } from "@/lib/academy-time";
import { BENGALURU } from "@/lib/coverage";
import { geocode } from "@/lib/whatsapp/geocode";
import { venueDisplayName } from "@/lib/venue-display";
import { bulkTool, idList } from "./bulk";
import { fail, ok, type ToolContext, type WaTool } from "./types";

const SUBSCRIPTION_STATUSES = [
  "incomplete",
  "trialing",
  "active",
  "past_due",
  "canceled",
  "paused",
] as const;

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
      .select("id,title,skill_level,capacity,duration_minutes,recurrence_rule,active,class_type,venues(name,unit)")
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
        venue: c.venues ? venueDisplayName(c.venues) : null,
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

// Two calls, like the admin sheet: the first prices the delete, the second goes
// through with it. Without `force` this tool was a dead end — every booked class
// came back "confirm to delete it" and there was nothing the assistant could
// confirm with, where the old wording at least pointed at end_class.
const deleteClass: WaTool = {
  name: "delete_class",
  description:
    "Permanently delete a class — the record itself, not just its sessions. On a class that holds bookings the first call deletes nothing and reports exactly what it would cost (live places that get cancelled, history that is destroyed). Relay that cost to the founder, and only call again with force:true once he has said yes to it. Deleting a class people still hold places in cancels those sessions and tells everyone affected first. To stop a class but keep its record and its history, use end_class instead.",
  input_schema: {
    type: "object",
    properties: {
      class_id: { type: "string" },
      force: {
        type: "boolean",
        description:
          "Set force:true only after the founder has confirmed the cost the previous call reported. Never on the first call.",
      },
    },
    required: ["class_id"],
  },
  run: async (input, ctx) => {
    const result = await deleteGroupClassCore(
      ctx.supabase!,
      ctx.profile!.id,
      String(input.class_id),
      Boolean(input.force)
    );
    return result.ok
      ? ok({ deleted: true, cancelled_bookings: result.cancelledBookings ?? 0 })
      : fail(result.error ?? "Failed.");
  },
};

const setClassActive: WaTool = {
  name: "set_class_active",
  description:
    "Activate or deactivate one class or several (class_ids from find or list_classes). The same active flag applies to every class listed.",
  input_schema: {
    type: "object",
    properties: {
      class_ids: { type: "array", items: { type: "string" }, description: "One or more class ids" },
      active: { type: "boolean" },
    },
    required: ["class_ids", "active"],
  },
  run: async (input, ctx) =>
    bulkTool(
      input.class_ids ?? input.class_id,
      (id) => setClassActiveCore(ctx.supabase!, ctx.profile!.id, id, Boolean(input.active)),
      { noun: "class" }
    ),
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
    "Move sessions — the JUST-THIS-SESSION scope: other weeks of the class stay put (use update_class to move every week). Two ways to say where: date + time puts EVERY listed session at that same moment (only sensible for one), or shift_minutes moves each one relative to where it already is — that's what 'push Tuesday's classes back 30 minutes' means (shift_minutes: 30; negative moves earlier). Notifies booked members and the coach. Date is YYYY-MM-DD, time HH:MM, both academy time (IST). If it's ambiguous whether the founder means one week or every week, ask before calling. Confirm first.",
  input_schema: {
    type: "object",
    properties: {
      session_ids: {
        type: "array",
        items: { type: "string" },
        description: "One or more session ids",
      },
      date: { type: "string", description: "YYYY-MM-DD (IST) — absolute move" },
      time: { type: "string", description: "HH:MM (IST) — absolute move" },
      shift_minutes: {
        type: "number",
        description: "Relative move: minutes to add to each session's current start (negative = earlier)",
      },
    },
    required: ["session_ids"],
  },
  run: async (input, ctx) => {
    const supabase = ctx.supabase!;
    const shift = input.shift_minutes != null ? Number(input.shift_minutes) : null;
    const absolute = input.date != null && input.time != null;
    if (shift === null && !absolute) {
      return fail("Give either date and time, or shift_minutes.");
    }
    if (shift !== null && !Number.isFinite(shift)) {
      return fail("shift_minutes must be a number.");
    }
    // Both would be ambiguous, and shift 0 used to win over a real date/time —
    // silently re-writing each session to the time it already had and firing a
    // "session moved" notification at every booked parent for no change.
    if (shift !== null && absolute) {
      return fail("Give date and time, or shift_minutes — not both.");
    }
    if (shift === 0) return fail("A shift of 0 minutes wouldn't move anything.");

    return bulkTool(
      input.session_ids ?? input.session_id,
      async (id) => {
        let date = String(input.date ?? "");
        let time = String(input.time ?? "");
        if (shift !== null) {
          // A relative move has to be computed per session, and in academy wall
          // clock — the core takes a date and a time, not an offset.
          const { data } = await supabase
            .from("class_sessions")
            .select("starts_at")
            .eq("id", id)
            .maybeSingle();
          if (!data) return { ok: false, error: "Session not found." };
          const wall = utcToAcademyWall(new Date(new Date(data.starts_at).getTime() + shift * 60000));
          date = wall.date;
          time = wall.time;
        }
        return moveSessionCore(supabase, ctx.profile!.id, id, date, time);
      },
      { noun: "session" }
    );
  },
};

const setSessionCapacity: WaTool = {
  name: "set_session_capacity",
  description:
    "Override the spots for one session or several — the JUST-THIS-SESSION scope (use update_class capacity to change every week). session_ids from find or list_sessions. Pass capacity=0 or omit it to CLEAR the override and fall back to the class default.",
  input_schema: {
    type: "object",
    properties: {
      session_ids: {
        type: "array",
        items: { type: "string" },
        description: "One or more session ids",
      },
      capacity: { type: "number", description: "Seats; 0 or omitted clears the override" },
    },
    required: ["session_ids"],
  },
  run: async (input, ctx) => {
    // 0 and omitted both mean "clear the override" — a sentinel, not a capacity
    // of zero, which would create a session nobody can book.
    const cap =
      input.capacity == null || Number(input.capacity) === 0 ? null : Number(input.capacity);
    return bulkTool(
      input.session_ids ?? input.session_id,
      (id) => setSessionCapacityCore(ctx.supabase!, ctx.profile!.id, id, cap),
      { noun: "session" }
    );
  },
};

const createOneOff: WaTool = {
  name: "create_one_off_session",
  description:
    "Add one or more extra sessions to an existing class (class_id from list_classes), e.g. holiday specials. Supports multiselect dates: pass dates as an array (e.g. ['2025-12-25','2025-12-26']) to create multiple sessions in one shot — mirroring the admin 'Add to schedule' sheet. Time HH:MM (IST). coach_id optional — the engine assigns one otherwise.",
  input_schema: {
    type: "object",
    properties: {
      class_id: { type: "string" },
      dates: {
        type: "array",
        items: { type: "string" },
        description: "One or more dates YYYY-MM-DD (IST). Creates one session per date. Preferred over date for multi-date creation.",
      },
      date: { type: "string", description: "Single date YYYY-MM-DD (IST) — use dates[] for multi-date" },
      time: { type: "string" },
      coach_id: { type: "string" },
    },
    required: ["class_id", "time"],
  },
  run: async (input, ctx) => {
    // Resolve dates array — accept array or fall back to singular date.
    const rawDates: string[] = Array.isArray(input.dates) && input.dates.length > 0
      ? input.dates.map((d) => String(d))
      : input.date
        ? [String(input.date)]
        : [];
    if (rawDates.length === 0) return fail("Provide at least one date (dates or date).");

    const created: string[] = [];
    const failed: { date: string; error: string }[] = [];
    for (const date of rawDates) {
      const result = await createOneOffSessionCore(
        ctx.supabase!,
        ctx.profile!.id,
        String(input.class_id),
        date,
        String(input.time),
        input.coach_id ? String(input.coach_id) : ""
      );
      if (result.ok) {
        created.push(date);
      } else {
        failed.push({ date, error: result.error ?? "Failed." });
      }
    }

    if (created.length === 0) return fail(failed.map((f) => `${f.date}: ${f.error}`).join("; "));
    return ok({
      created: created.length,
      dates: created,
      ...(failed.length > 0 && { partial_failures: failed }),
    });
  },
};

const createPrivate: WaTool = {
  name: "create_private_session",
  description:
    "Book a private one-to-one session FOR a client (client_id from list_clients). Supports recurring: pass recur_weeks (2–12) to stand up a weekly private slot — a standing series booked that many weeks ahead that the client sees as 'Weekly', can cancel all future weeks of, and that the nightly generator keeps rolling while their plan is live (same as the admin 'Add to schedule' recurring toggle). The whole run rolls back if any week fails. Creates sessions, books the client, notifies them, and debits minutes from their private balance per session (balance may go negative — top up via adjust_private_credits). Location: pass EITHER venue_id (from list_venues) OR a free-text address to geocode. Defaults: duration_minutes → 60, has_table → true, player → client's default, recur_weeks → 1 (single session). MONEY-ADJACENT: if the request is complete and unambiguous, just book it and report defaults used + minutes debited — no separate yes needed. Date YYYY-MM-DD, time HH:MM (IST). coach_id optional.",
  input_schema: {
    type: "object",
    properties: {
      client_id: { type: "string" },
      player_name: { type: "string", description: "Which household player — omit for the default" },
      date: { type: "string", description: "YYYY-MM-DD (IST) — first (or only) session date" },
      time: { type: "string", description: "HH:MM (IST)" },
      duration_minutes: { type: "number", description: "How long, in minutes — 30 to 360, usually 60 or 90. Defaults to 60 if omitted." },
      recur_weeks: {
        type: "number",
        description: "1–12. Stands up a weekly private slot starting on date (same weekday/time), booked N weeks ahead as a managed series the nightly generator keeps rolling. Default 1 (single one-off session). Mirrors admin recurring toggle.",
      },
      venue_id: { type: "string", description: "A saved venue (from list_venues) — used instead of address" },
      address: { type: "string", description: "Free-text address to geocode — omit if venue_id is given" },
      unit: { type: "string", description: "Where inside the venue — \"Clubhouse\", \"Villa 659\", \"Tower 1, flat 171\". Matters when a complex has several: the villas' clubhouse and the apartments' clubhouse are different places." },
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
        .select("name,unit,address,lat,lng")
        .eq("id", String(input.venue_id))
        .maybeSingle();
      if (!venue) return fail("No venue with that id — check list_venues.");
      address = venue.address;
      lat = Number(venue.lat);
      lng = Number(venue.lng);
      resolvedPlace = venueDisplayName(venue);
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

    // 30–360, the range the classes table allows and the admin sheet offers.
    // Pinned to 60/90 before this, which quietly booked an hour when the
    // founder asked over WhatsApp for two.
    const durationMinutes =
      input.duration_minutes != null
        ? Math.min(Math.max(Math.trunc(Number(input.duration_minutes)) || 60, 30), 360)
        : 60;
    const hasTable = input.has_table != null ? Boolean(input.has_table) : true;
    const recurWeeks = input.recur_weeks != null ? Math.min(Math.max(Math.trunc(Number(input.recur_weeks)), 1), 12) : 1;
    const result = await createPrivateSessionCore(ctx.supabase!, ctx.profile!.id, {
      clientId: String(input.client_id),
      playerId,
      date: String(input.date),
      time: String(input.time),
      durationMinutes,
      recurWeeks,
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
      // Keep the venue id rather than only its copied address: that is what
      // makes the coach's message say "Adarsh Palm Retreat Villas" without
      // anything downstream parsing the address back into a name.
      venueId: input.venue_id ? String(input.venue_id) : undefined,
      venueLabel: input.venue_id ? undefined : resolvedPlace,
      unitLabel: input.unit ? String(input.unit) : undefined,
      coachId: input.coach_id ? String(input.coach_id) : undefined,
    });
    if (!result.ok) return fail(result.error ?? "Failed.");
    const defaults_used: Record<string, unknown> = {};
    if (input.duration_minutes == null) defaults_used.duration_minutes = 60;
    if (input.has_table == null) defaults_used.has_table = true;
    if (!input.player_name) defaults_used.player = "client's default";
    if (input.recur_weeks == null) defaults_used.recur_weeks = 1;
    return ok({
      created: recurWeeks,
      sessions: recurWeeks === 1 ? "1 session booked" : `${recurWeeks} weekly sessions booked`,
      location: resolvedPlace,
      duration_minutes: durationMinutes,
      minutes_debited: recurWeeks * durationMinutes,
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
      baseAddress: input.base_address != null ? String(input.base_address) : "",
      baseLat: input.base_lat != null ? Number(input.base_lat) : BENGALURU.lat,
      baseLng: input.base_lng != null ? Number(input.base_lng) : BENGALURU.lng,
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
      base_address: { type: "string" },
      base_lat: { type: "number" },
      base_lng: { type: "number" },
    },
    required: ["coach_id"],
  },
  run: async (input, ctx) => {
    const { data: cur } = await ctx.supabase!
      .from("coaches")
      .select("bio,base_address,base_lat,base_lng")
      .eq("id", input.coach_id)
      .maybeSingle();
    if (!cur) return fail("Coach not found.");
    const result = await saveCoachCore(ctx.supabase!, ctx.profile!.id, {
      id: String(input.coach_id),
      bio: input.bio != null ? String(input.bio) : (cur.bio ?? ""),
      baseAddress:
        input.base_address != null ? String(input.base_address) : (cur.base_address ?? ""),
      baseLat: input.base_lat != null ? Number(input.base_lat) : Number(cur.base_lat),
      baseLng: input.base_lng != null ? Number(input.base_lng) : Number(cur.base_lng),
      ...(input.full_name != null ? { fullName: String(input.full_name) } : {}),
      ...(input.phone != null ? { phone: String(input.phone) } : {}),
    });
    return result.ok ? ok({ updated: true }) : fail(result.error ?? "Failed.");
  },
};

const setCoachActive: WaTool = {
  name: "set_coach_active",
  description:
    "Activate or pause one coach or several (coach_ids from find or list_coaches). Pausing stops new assignments; existing sessions stay until reassigned.",
  input_schema: {
    type: "object",
    properties: {
      coach_ids: { type: "array", items: { type: "string" }, description: "One or more coach ids" },
      active: { type: "boolean" },
    },
    required: ["coach_ids", "active"],
  },
  run: async (input, ctx) =>
    bulkTool(
      input.coach_ids ?? input.coach_id,
      (id) => setCoachActiveCore(ctx.supabase!, ctx.profile!.id, id, Boolean(input.active)),
      { noun: "coach" }
    ),
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
      const s = b.class_sessions;
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
            .map((r) => ({ when: formatSessionDate(r.when), class: r.title, status: r.status })),
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
        ).map((n) => ({ when: formatSessionDate(n.created_at), author: n.author_name, note: n.body })),
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
        plan: (s.plans)?.name ?? "?",
        status: s.status,
        source: s.source,
        renews: s.current_period_end ? formatSessionDate(s.current_period_end) : null,
      })),
      total_paid_inr: Math.round(paidPence / 100),
      private_minutes_balance: (ledger ?? []).reduce((sum, l) => sum + l.delta_minutes, 0),
      recent_invoices: (invoices ?? []).map((i) => ({
        amount_inr: Math.round(i.amount_pence / 100),
        status: i.status,
        when: formatSessionDate(i.paid_at ?? i.created_at),
      })),
      recent_purchases: (orders ?? []).map((o) => ({
        product: (o.products)?.name ?? "?",
        amount_inr: Math.round(o.amount_pence / 100),
        status: o.status,
        when: formatSessionDate(o.created_at),
      })),
    });
  },
};

const broadcastMessage: WaTool = {
  name: "broadcast_message",
  description:
    "Send an announcement to EVERY active coach or EVERY active client (delivered by push/WhatsApp/email per each person's preferences). e.g. 'notify all coaches that Saturday sessions move indoors'. Restate the audience and exact message and get an explicit yes BEFORE calling — this cannot be unsent. This QUEUES the announcement, it doesn't send it: delivery bypasses nobody's preferences, so never tell the founder it reached everyone. The result names who has this kind of message muted — they'll only see it in the app, and you must pass that on so he can reach them another way.",
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
    return ok({
      // "queued", not "sent", for the same reason as notify below — and it bit
      // hardest here, where the audience is a whole role and a flat success read
      // as "all 8 coaches got it" when 2 did.
      queued: result.recipients,
      audience,
      skipped_deleted: result.skipped_deleted || undefined,
      muted_for: result.muted?.length ? result.muted : undefined,
      note: result.muted?.length
        ? `Queued. ${result.muted.join(" and ")} ${result.muted.length === 1 ? "has" : "have"} this kind of message muted, so they will only see it in the app — tell the founder, and offer to call instead if it's urgent.`
        : undefined,
    });
  },
};

/** Ceiling on a model-chosen recipient set. broadcast_message has no cap because
 *  its audience is a role the founder named out loud, not a query result. */
const NOTIFY_CAP = 50;

const notify: WaTool = {
  name: "notify",
  description:
    "Message specific people — one person or a chosen group. The result names anyone with no phone number saved (unreachable_on_whatsapp) — they cannot be reached on WhatsApp at all, so you MUST pass those names on rather than reporting a clean success. Use find to get the user ids first, then send: 'message the coach taking Saturday's La Plazza session', 'tell everyone booked into tomorrow's beginner class it's moved indoors', 'message the three clients whose payment failed'. For bookings, the person to message is the booking's client_id (the parent), not the player. To reach EVERY active coach or EVERY active client, use broadcast_message instead — it resolves the audience itself and skips deleted accounts. Restate who (by name, and the count) and the exact message, and get an explicit yes, before calling — this cannot be unsent.",
  input_schema: {
    type: "object",
    properties: {
      user_ids: {
        type: "array",
        items: { type: "string" },
        description: `Profile ids of the recipients (max ${NOTIFY_CAP})`,
      },
      message: { type: "string", description: "The message text, sent verbatim" },
      title: { type: "string", description: "Optional heading; defaults to 'Message from the academy'" },
      type: {
        type: "string",
        enum: [...NOTIFY_TYPES],
        description:
          "class_updated for anything operational — a session moved, a coach swapped, a venue changed — because it sits with reminders, which people keep on. announcement (the default) is for news and offers and is silenced by the News toggle, so DON'T use it for something someone needs to act on. Neither type bypasses a member's preferences: the result tells you who has it muted, and you must pass that on.",
      },
    },
    required: ["user_ids", "message"],
  },
  run: async (input, ctx) => {
    const ids = idList(input.user_ids);
    if (ids.length === 0) return fail("No recipients — use find to get the user ids first.");
    if (ids.length > NOTIFY_CAP) {
      return fail(
        `That's ${ids.length} people — more than the ${NOTIFY_CAP} a targeted message can reach. Narrow it down, or use broadcast_message if you really mean everyone.`
      );
    }
    const type = (NOTIFY_TYPES as readonly string[]).includes(String(input.type))
      ? (String(input.type) as (typeof NOTIFY_TYPES)[number])
      : "announcement";

    const result = await notifyUsersCore(
      ctx.supabase!,
      ctx.profile!.id,
      ids,
      String(input.message ?? ""),
      input.title != null ? String(input.title) : undefined,
      { action: "notify.targeted" },
      type
    );
    if (!result.ok) return fail(result.error ?? "Failed.");
    return ok({
      // "queued", not "sent": a separate worker delivers this over whichever
      // channel each person's preferences allow, so a message can be accepted
      // here and still not reach a phone.
      queued: result.recipients,
      type,
      skipped_deleted: result.skipped_deleted || undefined,
      muted_for: result.muted?.length ? result.muted : undefined,
      // No number on the profile means no WhatsApp, full stop — they will get
      // an email instead and very likely never read it. The founder has to
      // hear this by name, because the alternative is what already happened:
      // months of "why do my coaches never get your messages".
      unreachable_on_whatsapp: result.unreachable?.length ? result.unreachable : undefined,
      note: [
        result.muted?.length
          ? `${result.muted.join(" and ")} ${result.muted.length === 1 ? "has" : "have"} this kind of message muted, so they will only see it in the app.`
          : "",
        result.unreachable?.length
          ? `${result.unreachable.join(" and ")} ${result.unreachable.length === 1 ? "has" : "have"} no phone number saved, so this cannot reach ${result.unreachable.length === 1 ? "them" : "them"} on WhatsApp at all — it will go by email. Say so by name, and offer to call.`
          : "",
      ]
        .filter(Boolean)
        .join(" ") || undefined,
    });
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
    "Block or unblock one client or several (payment-dispute freeze — they can sign in but can't book). client_ids from find or list_clients. DESTRUCTIVE — name every client and get an explicit yes first.",
  input_schema: {
    type: "object",
    properties: {
      client_ids: { type: "array", items: { type: "string" }, description: "One or more client ids" },
      blocked: { type: "boolean" },
    },
    required: ["client_ids", "blocked"],
  },
  run: async (input, ctx) =>
    bulkTool(
      input.client_ids ?? input.client_id,
      (id) => setClientBlockedCore(ctx.supabase!, ctx.profile!.id, id, Boolean(input.blocked)),
      { noun: "client" }
    ),
};

const archiveClient: WaTool = {
  name: "archive_client",
  description:
    "Archive or restore one client or several (archiving hides them from lists; reversible). client_ids from find or list_clients. DESTRUCTIVE — name every client and get an explicit yes first.",
  input_schema: {
    type: "object",
    properties: {
      client_ids: { type: "array", items: { type: "string" }, description: "One or more client ids" },
      archived: { type: "boolean" },
    },
    required: ["client_ids", "archived"],
  },
  run: async (input, ctx) =>
    bulkTool(
      input.client_ids ?? input.client_id,
      (id) => setClientArchivedCore(ctx.supabase!, ctx.profile!.id, id, Boolean(input.archived)),
      { noun: "client" }
    ),
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
  description:
    "Show or hide one venue or several (venue_ids from find or list_venues) — 'deactivate every venue except La Plazza' is one call.",
  input_schema: {
    type: "object",
    properties: {
      venue_ids: { type: "array", items: { type: "string" }, description: "One or more venue ids" },
      active: { type: "boolean" },
    },
    required: ["venue_ids", "active"],
  },
  run: async (input, ctx) =>
    bulkTool(
      input.venue_ids ?? input.venue_id,
      (id) => setVenueActiveCore(ctx.supabase!, ctx.profile!.id, id, Boolean(input.active)),
      { noun: "venue" }
    ),
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
    if (input.status) {
      // The model supplies this as free text; only a real subscription_status
      // can reach the query, so a typo filters nothing instead of erroring.
      const raw = String(input.status);
      const status = SUBSCRIPTION_STATUSES.find((s) => s === raw);
      if (!status) return fail(`Unknown status "${raw}".`);
      q = q.eq("status", status);
    }
    const { data } = await q;
    return ok(
      (data ?? []).map((s) => ({
        client: (s.profiles)?.full_name ?? "?",
        plan: (s.plans)?.name ?? "?",
        status: s.status,
        renews: s.current_period_end ? formatSessionDate(s.current_period_end) : null,
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
        const p = s.profiles;
        return {
          client: p?.full_name ?? "?",
          phone: p?.phone ?? null,
          plan: (s.plans)?.name ?? "?",
          since: s.current_period_end ? formatSessionDate(s.current_period_end) : null,
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
  notify,
  saveVenue,
  setVenueActive,
  deleteVenue,
  getSettings,
  updateSettings,
  listSubscriptions,
  listDunning,
];
