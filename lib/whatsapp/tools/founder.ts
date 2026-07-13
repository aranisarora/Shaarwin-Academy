// Founder tools — the /admin surface over chat. Every mutation goes through
// the same lib/admin-ops cores the webapp uses (audit-logged), and everything
// runs on the founder's own session so RLS founder policies apply.

import {
  adjustCreditsCore,
  cancelSessionCore,
  createGroupClassCore,
  decideTimeOffCore,
  grantCompCore,
} from "@/lib/admin-ops";
import { fail, fmtIST, ok, type WaTool } from "./types";
import { founderAdminTools } from "./founder-admin";

const overview: WaTool = {
  name: "academy_overview",
  description:
    "Snapshot of the academy: upcoming sessions, unassigned sessions needing a coach, pending time-off requests, client and active-membership counts.",
  input_schema: { type: "object", properties: {} },
  run: async (_input, ctx) => {
    const supabase = ctx.supabase!;
    const now = new Date().toISOString();
    const week = new Date(Date.now() + 7 * 86400000).toISOString();
    const [sessions, unassigned, timeOff, clients, activeSubs] = await Promise.all([
      supabase
        .from("class_sessions")
        .select("id", { count: "exact", head: true })
        .eq("status", "scheduled")
        .gt("starts_at", now)
        .lt("starts_at", week),
      supabase
        .from("class_sessions")
        .select("id", { count: "exact", head: true })
        .eq("status", "scheduled")
        .is("coach_id", null)
        .gt("starts_at", now),
      supabase
        .from("coach_time_off")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending"),
      supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "client"),
      supabase
        .from("subscriptions")
        .select("id", { count: "exact", head: true })
        .in("status", ["active", "trialing"]),
    ]);
    return ok({
      sessions_next_7_days: sessions.count ?? 0,
      unassigned_future_sessions: unassigned.count ?? 0,
      pending_time_off_requests: timeOff.count ?? 0,
      total_clients: clients.count ?? 0,
      active_memberships: activeSubs.count ?? 0,
    });
  },
};

const listSessions: WaTool = {
  name: "list_sessions",
  description:
    "Upcoming sessions with coach, venue, and headcount (session_id values included). Filter to only_unassigned to see sessions with no coach.",
  input_schema: {
    type: "object",
    properties: {
      days: { type: "number", description: "Days ahead (default 7, max 28)" },
      only_unassigned: { type: "boolean" },
    },
  },
  run: async (input, ctx) => {
    const supabase = ctx.supabase!;
    const days = Math.min(Math.max(Number(input.days) || 7, 1), 28);
    let query = supabase
      .from("class_sessions")
      .select("id,starts_at,coach_id,status,classes!inner(title,class_type),bookings(id,status)")
      .eq("status", "scheduled")
      .gt("starts_at", new Date().toISOString())
      .lt("starts_at", new Date(Date.now() + days * 86400000).toISOString())
      .order("starts_at")
      .limit(60);
    if (input.only_unassigned) query = query.is("coach_id", null);
    const { data: sessions } = await query;

    const coachIds = [...new Set((sessions ?? []).map((s) => s.coach_id).filter(Boolean))] as string[];
    const names = new Map<string, string>();
    if (coachIds.length) {
      const { data } = await supabase.from("profiles").select("id,full_name").in("id", coachIds);
      for (const p of data ?? []) names.set(p.id, p.full_name);
    }
    return ok(
      (sessions ?? []).map((s) => {
        const cls = s.classes as unknown as { title: string; class_type: string };
        const confirmed = ((s.bookings as { status: string }[]) ?? []).filter(
          (b) => b.status === "confirmed"
        ).length;
        return {
          session_id: s.id,
          when: fmtIST(s.starts_at),
          title: cls.title,
          type: cls.class_type,
          coach: s.coach_id ? (names.get(s.coach_id) ?? "?") : "UNASSIGNED",
          confirmed_bookings: confirmed,
        };
      })
    );
  },
};

const cancelSession: WaTool = {
  name: "cancel_session",
  description:
    "Cancel a whole session: bookings become cancelled_by_academy, private clients get minutes refunded, everyone affected is notified. DESTRUCTIVE — always restate the session and get an explicit yes first. Reason is optional (defaults to 'Cancelled by the academy').",
  input_schema: {
    type: "object",
    properties: {
      session_id: { type: "string" },
      reason: { type: "string", description: "Optional — defaults to 'Cancelled by the academy'" },
    },
    required: ["session_id"],
  },
  run: async (input, ctx) => {
    const result = await cancelSessionCore(
      ctx.supabase!,
      ctx.profile!.id,
      String(input.session_id),
      input.reason != null && String(input.reason).trim()
        ? String(input.reason)
        : "Cancelled by the academy"
    );
    return result.ok ? ok({ cancelled: true }) : fail(result.error ?? "Failed.");
  },
};

const rankCoaches: WaTool = {
  name: "rank_coaches_for_session",
  description: "Ranked list of suitable coaches for a session (assignment engine scores).",
  input_schema: {
    type: "object",
    properties: { session_id: { type: "string" } },
    required: ["session_id"],
  },
  run: async (input, ctx) => {
    const supabase = ctx.supabase!;
    const { data, error } = await supabase.rpc("rank_coaches", { p_session: input.session_id });
    if (error) return fail(error.message);
    const rows = (data as { coach_id: string; score: number }[]) ?? [];
    if (!rows.length) return ok({ coaches: [], note: "No eligible coaches." });
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id,full_name")
      .in("id", rows.map((r) => r.coach_id));
    const names = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
    return ok(
      rows.map((r) => ({
        coach_id: r.coach_id,
        name: names.get(r.coach_id) ?? "Coach",
        score: Number(r.score),
      }))
    );
  },
};

const reassign: WaTool = {
  name: "reassign_coach",
  description:
    "Assign or reassign a coach to a session (coach_id from rank_coaches_for_session or list_coaches). lock=true stops the engine from moving them later. If it fails with filter_failed_*, tell the founder why and ask before retrying with force=true, which overrides the rule (a hard time clash is still blocked). Confirm with the founder first.",
  input_schema: {
    type: "object",
    properties: {
      session_id: { type: "string" },
      coach_id: { type: "string" },
      lock: { type: "boolean" },
      force: { type: "boolean" },
    },
    required: ["session_id", "coach_id"],
  },
  run: async (input, ctx) => {
    const { error } = await ctx.supabase!.rpc("founder_reassign", {
      p_session: input.session_id,
      p_coach: input.coach_id,
      p_lock: Boolean(input.lock),
      p_force: Boolean(input.force),
    });
    if (error) return fail(error.message);
    return ok({ reassigned: true });
  },
};

const createClass: WaTool = {
  name: "create_group_class",
  description:
    "Create one or more weekly group classes — each repeats every week and the next 8 weeks of sessions go on the calendar. Supports multiselect days: pass weekdays as an array (e.g. ['MO','WE','FR']) to create one class per day in one shot — mirroring the admin 'Add to schedule' sheet. Only venue (list_venues for venue_id), at least one weekday and start time HH:MM (IST) are essential. Everything else has a sensible default the founder can override: skill_level → any, capacity → 8, duration_minutes → 60, title → auto-generated from the level (e.g. 'Beginner Group Class'). If the founder gives those essentials, just create and report defaults used. Coach optional — the engine assigns one otherwise.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Optional — auto-generated from the level if omitted" },
      description: { type: "string" },
      skill_level: { type: "string", description: "any | beginner | intermediate | advanced | elite — defaults to any" },
      capacity: { type: "number", description: "Defaults to 8 if omitted" },
      duration_minutes: { type: "number", description: "Defaults to 60 if omitted" },
      venue_id: { type: "string" },
      weekdays: {
        type: "array",
        items: { type: "string" },
        description: "One or more weekdays: MO, TU, WE, TH, FR, SA, SU. Creates one class per day. Preferred over weekday for multi-day creation.",
      },
      weekday: { type: "string", description: "Single weekday (MO..SU) — use weekdays[] for multi-day" },
      time: { type: "string", description: "HH:MM 24h, academy time" },
      coach_id: { type: "string" },
    },
    required: ["venue_id", "time"],
  },
  run: async (input, ctx) => {
    const skillLevel = input.skill_level != null ? String(input.skill_level) : "any";
    const capacity = input.capacity != null ? Number(input.capacity) : 8;
    const durationMinutes = input.duration_minutes != null ? Number(input.duration_minutes) : 60;
    const title =
      input.title != null && String(input.title).trim()
        ? String(input.title)
        : skillLevel === "any"
          ? "Group Class"
          : `${skillLevel.charAt(0).toUpperCase()}${skillLevel.slice(1)} Group Class`;

    // Resolve weekdays array — accept array or fall back to singular weekday.
    const rawDays: string[] = Array.isArray(input.weekdays) && input.weekdays.length > 0
      ? input.weekdays.map((d) => String(d).toUpperCase())
      : input.weekday
        ? [String(input.weekday).toUpperCase()]
        : [];
    if (rawDays.length === 0) return fail("Provide at least one weekday (weekdays or weekday).");

    const defaults_used: Record<string, unknown> = {};
    if (input.title == null || !String(input.title).trim()) defaults_used.title = title;
    if (input.skill_level == null) defaults_used.skill_level = "any";
    if (input.capacity == null) defaults_used.capacity = 8;
    if (input.duration_minutes == null) defaults_used.duration_minutes = 60;

    const created: string[] = [];
    const failed: { weekday: string; error: string }[] = [];
    for (const weekday of rawDays) {
      const result = await createGroupClassCore(ctx.supabase!, ctx.profile!.id, {
        title,
        description: String(input.description ?? ""),
        skillLevel,
        capacity,
        durationMinutes,
        venueId: String(input.venue_id),
        weekday,
        time: String(input.time),
        coachId: input.coach_id ? String(input.coach_id) : undefined,
      });
      if (result.ok) {
        created.push(weekday);
      } else {
        failed.push({ weekday, error: result.error ?? "Failed." });
      }
    }

    if (created.length === 0) return fail(failed.map((f) => `${f.weekday}: ${f.error}`).join("; "));
    return ok({
      created: created.length,
      weekdays: created,
      ...(failed.length > 0 && { partial_failures: failed }),
      defaults_used,
    });
  },
};

const listClients: WaTool = {
  name: "list_clients",
  description:
    "Search or list client accounts with membership status and private-minutes balance (client_id values included). Pass search to filter by name or email.",
  input_schema: {
    type: "object",
    properties: { search: { type: "string" } },
  },
  run: async (input, ctx) => {
    const supabase = ctx.supabase!;
    let query = supabase
      .from("profiles")
      .select("id,full_name,email,phone")
      .eq("role", "client")
      .order("full_name")
      .limit(25);
    if (input.search) {
      const s = String(input.search).replaceAll("%", "");
      query = query.or(`full_name.ilike.%${s}%,email.ilike.%${s}%`);
    }
    const { data: clients } = await query;
    if (!clients?.length) return ok({ clients: [] });

    const ids = clients.map((c) => c.id);
    const [{ data: subs }, { data: ledger }] = await Promise.all([
      supabase
        .from("subscriptions")
        .select("client_id,status,plans(name)")
        .in("client_id", ids)
        .in("status", ["active", "trialing", "past_due"]),
      supabase.from("private_credit_ledger").select("client_id,delta_minutes").in("client_id", ids),
    ]);
    const subByClient = new Map(
      (subs ?? []).map((s) => [
        s.client_id,
        `${(s.plans as unknown as { name: string } | null)?.name ?? "?"} (${s.status})`,
      ])
    );
    const minutes = new Map<string, number>();
    for (const row of ledger ?? []) {
      minutes.set(row.client_id, (minutes.get(row.client_id) ?? 0) + row.delta_minutes);
    }
    return ok(
      clients.map((c) => ({
        client_id: c.id,
        name: c.full_name,
        email: c.email,
        phone: c.phone,
        membership: subByClient.get(c.id) ?? "none",
        private_minutes: minutes.get(c.id) ?? 0,
      }))
    );
  },
};

const listCoaches: WaTool = {
  name: "list_coaches",
  description: "All coaches with tier, level, radius and active flag (coach_id values included).",
  input_schema: { type: "object", properties: {} },
  run: async (_input, ctx) => {
    const supabase = ctx.supabase!;
    const { data: coaches } = await supabase
      .from("coaches")
      .select("id,tier,travel_radius_km,base_address,active");
    const ids = (coaches ?? []).map((c) => c.id);
    const names = new Map<string, string>();
    if (ids.length) {
      const { data } = await supabase.from("profiles").select("id,full_name").in("id", ids);
      for (const p of data ?? []) names.set(p.id, p.full_name);
    }
    return ok(
      (coaches ?? []).map((c) => ({
        coach_id: c.id,
        name: names.get(c.id) ?? "?",
        tier: c.tier,
        radius_km: c.travel_radius_km,
        base_address: c.base_address,
        active: c.active,
      }))
    );
  },
};

const listVenues: WaTool = {
  name: "list_venues",
  description: "All venues with venue_id values (needed to create classes).",
  input_schema: { type: "object", properties: {} },
  run: async (_input, ctx) => {
    const { data } = await ctx.supabase!
      .from("venues")
      .select("id,name,address,postcode,active")
      .order("name");
    return ok(
      (data ?? []).map((v) => ({
        venue_id: v.id,
        name: v.name,
        address: v.address,
        postcode: v.postcode,
        active: v.active,
      }))
    );
  },
};

const listPlans: WaTool = {
  name: "list_plans",
  description: "Membership plans with plan_id values (needed for comp grants).",
  input_schema: { type: "object", properties: {} },
  run: async (_input, ctx) => {
    const { data } = await ctx.supabase!
      .from("plans")
      .select("id,name,price_pence,group_sessions_per_week,private_minutes_per_cycle,active")
      .order("price_pence");
    return ok(
      (data ?? []).map((p) => ({
        plan_id: p.id,
        name: p.name,
        price_pence: p.price_pence,
        group_sessions_per_week: p.group_sessions_per_week,
        private_minutes_per_cycle: p.private_minutes_per_cycle,
        active: p.active,
      }))
    );
  },
};

const grantComp: WaTool = {
  name: "grant_comp_subscription",
  description:
    "Grant a client a free 30-day membership (plus the plan's private minutes). MONEY-ADJACENT — restate client and plan, get an explicit yes first.",
  input_schema: {
    type: "object",
    properties: { client_id: { type: "string" }, plan_id: { type: "string" } },
    required: ["client_id", "plan_id"],
  },
  run: async (input, ctx) => {
    const result = await grantCompCore(
      ctx.supabase!,
      ctx.profile!.id,
      String(input.client_id),
      String(input.plan_id)
    );
    return result.ok ? ok({ granted: true }) : fail(result.error ?? "Failed.");
  },
};

const adjustCredits: WaTool = {
  name: "adjust_private_credits",
  description:
    "Add or remove private-coaching minutes for a client (positive or negative delta). MONEY-ADJACENT — restate client and delta, get an explicit yes first. Note is optional (defaults to 'Adjusted by admin').",
  input_schema: {
    type: "object",
    properties: {
      client_id: { type: "string" },
      delta_minutes: { type: "number" },
      note: { type: "string", description: "Optional — defaults to 'Adjusted by admin'" },
    },
    required: ["client_id", "delta_minutes"],
  },
  run: async (input, ctx) => {
    const result = await adjustCreditsCore(
      ctx.supabase!,
      ctx.profile!.id,
      String(input.client_id),
      Number(input.delta_minutes),
      input.note != null && String(input.note).trim() ? String(input.note) : "Adjusted by admin"
    );
    return result.ok ? ok({ adjusted: true }) : fail(result.error ?? "Failed.");
  },
};

const pendingTimeOff: WaTool = {
  name: "pending_time_off",
  description: "Coach time-off requests awaiting a decision (time_off_id values included).",
  input_schema: { type: "object", properties: {} },
  run: async (_input, ctx) => {
    const supabase = ctx.supabase!;
    const { data } = await supabase
      .from("coach_time_off")
      .select("id,coach_id,starts_at,ends_at,reason,profiles!coach_time_off_coach_id_fkey(full_name)")
      .eq("status", "pending")
      .order("starts_at");
    return ok(
      (data ?? []).map((t) => ({
        time_off_id: t.id,
        coach: (t.profiles as unknown as { full_name: string } | null)?.full_name ?? "?",
        from: fmtIST(t.starts_at),
        to: fmtIST(t.ends_at),
        reason: t.reason,
      }))
    );
  },
};

const decideTimeOff: WaTool = {
  name: "decide_time_off",
  description:
    "Approve or reject a coach time-off request. Approving triggers the dropout cascade (overlapping sessions get reassigned or parked) — confirm before approving.",
  input_schema: {
    type: "object",
    properties: { time_off_id: { type: "string" }, approve: { type: "boolean" } },
    required: ["time_off_id", "approve"],
  },
  run: async (input, ctx) => {
    const result = await decideTimeOffCore(
      ctx.supabase!,
      ctx.profile!.id,
      String(input.time_off_id),
      Boolean(input.approve)
    );
    return result.ok ? ok({ decided: true }) : fail(result.error ?? "Failed.");
  },
};

export const founderTools: WaTool[] = [
  overview,
  listSessions,
  cancelSession,
  rankCoaches,
  reassign,
  createClass,
  listClients,
  listCoaches,
  listVenues,
  listPlans,
  grantComp,
  adjustCredits,
  pendingTimeOff,
  decideTimeOff,
  ...founderAdminTools,
];
