// Coach tools — the /coach surface over chat: schedule, rosters, availability
// windows, and time-off requests. Runs as the coach's own session (RLS).

import { getCoachSessions } from "@/lib/coach-data";
import { academyWallToUtc } from "@/lib/academy-time";
import { fail, fmtIST, ok, type WaTool } from "./types";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const mySessions: WaTool = {
  name: "my_coach_sessions",
  description:
    "The coach's assigned sessions with venue/address, headcount and whether they've confirmed they're taking each one. Default window is the next 7 days (max 28).",
  input_schema: {
    type: "object",
    properties: { days: { type: "number", description: "Days ahead (default 7)" } },
  },
  run: async (input, ctx) => {
    const days = Math.min(Math.max(Number(input.days) || 7, 1), 28);
    const sessions = await getCoachSessions(
      ctx.supabase!,
      ctx.profile!.id,
      new Date(),
      new Date(Date.now() + days * 86400000)
    );
    // Confirmation/arrival state lives on class_sessions; fetch it alongside.
    const flags = new Map<string, { confirmed: boolean; arrived: boolean }>();
    if (sessions.length) {
      const { data } = await ctx.supabase!
        .from("class_sessions")
        .select("id,coach_confirmed_at,coach_arrived_at")
        .in("id", sessions.map((s) => s.id));
      for (const row of data ?? []) {
        flags.set(row.id, {
          confirmed: row.coach_confirmed_at != null,
          arrived: row.coach_arrived_at != null,
        });
      }
    }
    return ok(
      sessions.map((s) => ({
        session_id: s.id,
        when: fmtIST(s.starts_at),
        title: s.classTitle,
        type: s.isPrivate ? "private" : "group",
        level: s.level,
        players: `${s.confirmed}/${s.capacity}`,
        where: s.isPrivate ? s.privateAddress : `${s.venueName ?? "?"} — ${s.venueAddress ?? ""}`,
        status: s.status,
        confirmed_coming: flags.get(s.id)?.confirmed ?? false,
        marked_arrived: flags.get(s.id)?.arrived ?? false,
      }))
    );
  },
};

const confirmSession: WaTool = {
  name: "confirm_session",
  description:
    "Confirm the coach IS taking an upcoming session ('yes, I'm coming') — session_id from my_coach_sessions. Tells the founder. Use when the coach says they'll take / confirm a session (e.g. replying 'confirm' to a reminder). If they CAN'T make it, use cant_make_session instead.",
  input_schema: {
    type: "object",
    properties: { session_id: { type: "string" } },
    required: ["session_id"],
  },
  run: async (input, ctx) => {
    const { error } = await ctx.supabase!.rpc("coach_confirm_session", {
      p_session: input.session_id,
    });
    if (error) {
      if (error.message.includes("not_your_session")) {
        return fail("That session isn't on this coach's schedule.");
      }
      if (error.message.includes("session_not_scheduled")) {
        return fail("That session is no longer scheduled.");
      }
      return fail("Couldn't confirm that session.");
    }
    return ok({ confirmed: true, note: "The founder has been told you're taking it." });
  },
};

const markArrival: WaTool = {
  name: "mark_arrival",
  description:
    "Mark that the coach has ARRIVED at a session's venue, or is RUNNING LATE (session_id from my_coach_sessions). Parents of booked players and the founder are notified straight away. Only makes sense around the session's start time.",
  input_schema: {
    type: "object",
    properties: {
      session_id: { type: "string" },
      running_late: {
        type: "boolean",
        description: "true = 'running a few minutes late' instead of 'arrived'",
      },
    },
    required: ["session_id"],
  },
  run: async (input, ctx) => {
    const { error } = await ctx.supabase!.rpc("coach_mark_arrival", {
      p_session: input.session_id,
      p_late: Boolean(input.running_late),
    });
    if (error) {
      if (error.message.includes("not_your_session")) {
        return fail("That session isn't on this coach's schedule.");
      }
      return fail("Couldn't send that.");
    }
    return ok({
      sent: true,
      note: input.running_late
        ? "Parents and the founder know you're running late."
        : "Parents and the founder know you've arrived.",
    });
  },
};

const roster: WaTool = {
  name: "session_roster",
  description: "Who's booked into one of the coach's sessions (session_id from my_coach_sessions).",
  input_schema: {
    type: "object",
    properties: { session_id: { type: "string" } },
    required: ["session_id"],
  },
  run: async (input, ctx) => {
    // RLS limits visibility to the coach's own sessions; the explicit coach_id
    // check keeps the error message honest either way.
    const { data: session } = await ctx.supabase!
      .from("class_sessions")
      .select("id,coach_id,starts_at")
      .eq("id", input.session_id)
      .maybeSingle();
    if (!session || session.coach_id !== ctx.profile!.id) {
      return fail("That session isn't on this coach's schedule.");
    }
    const { data } = await ctx.supabase!
      .from("bookings")
      .select("status,waitlist_position,players(full_name)")
      .eq("session_id", input.session_id)
      .in("status", ["confirmed", "waitlisted", "attended", "no_show"]);
    return ok(
      (data ?? []).map((b) => ({
        player: (b.players)?.full_name ?? "?",
        status: b.status,
        waitlist_position: b.waitlist_position,
      }))
    );
  },
};

const myAvailability: WaTool = {
  name: "my_availability",
  description:
    "The coach's weekly availability windows (with window_id values) and their time-off requests.",
  input_schema: { type: "object", properties: {} },
  run: async (_input, ctx) => {
    const [{ data: windows }, { data: timeOff }] = await Promise.all([
      ctx.supabase!
        .from("coach_availability")
        .select("id,weekday,start_time,end_time")
        .eq("coach_id", ctx.profile!.id)
        .order("weekday"),
      ctx.supabase!
        .from("coach_time_off")
        .select("id,starts_at,ends_at,reason,status")
        .eq("coach_id", ctx.profile!.id)
        .gte("ends_at", new Date().toISOString())
        .order("starts_at"),
    ]);
    return ok({
      weekly_windows: (windows ?? []).map((w) => ({
        window_id: w.id,
        day: WEEKDAYS[w.weekday] ?? `day ${w.weekday}`,
        from: w.start_time,
        to: w.end_time,
      })),
      time_off: (timeOff ?? []).map((t) => ({
        time_off_id: t.id,
        from: fmtIST(t.starts_at),
        to: fmtIST(t.ends_at),
        reason: t.reason,
        status: t.status,
      })),
    });
  },
};

const addWindow: WaTool = {
  name: "add_availability_window",
  description:
    "Add a weekly availability window. weekday: 0=Monday … 6=Sunday. Times are 24h HH:MM in academy time (IST).",
  input_schema: {
    type: "object",
    properties: {
      weekday: { type: "number", description: "0=Monday … 6=Sunday" },
      start_time: { type: "string", description: "HH:MM" },
      end_time: { type: "string", description: "HH:MM" },
    },
    required: ["weekday", "start_time", "end_time"],
  },
  run: async (input, ctx) => {
    const weekday = Number(input.weekday);
    const start = String(input.start_time);
    const end = String(input.end_time);
    if (!(weekday >= 0 && weekday <= 6)) return fail("weekday must be 0 (Monday) to 6 (Sunday).");
    if (start >= end) return fail("The window must start before it ends.");
    const { error } = await ctx.supabase!.from("coach_availability").insert({
      coach_id: ctx.profile!.id,
      weekday,
      start_time: start,
      end_time: end,
    });
    if (error) return fail("Couldn't add that window.");
    return ok({ added: `${WEEKDAYS[weekday]} ${start}–${end}` });
  },
};

const removeWindow: WaTool = {
  name: "remove_availability_window",
  description: "Remove a weekly availability window (window_id from my_availability). Confirm first.",
  input_schema: {
    type: "object",
    properties: { window_id: { type: "string" } },
    required: ["window_id"],
  },
  run: async (input, ctx) => {
    await ctx.supabase!
      .from("coach_availability")
      .delete()
      .eq("id", input.window_id)
      .eq("coach_id", ctx.profile!.id);
    return ok({ removed: true });
  },
};

const requestTimeOff: WaTool = {
  name: "request_time_off",
  description:
    "Request time off. Dates/times are academy wall-clock (IST) as 'YYYY-MM-DD HH:MM'. Tell the coach how many booked sessions overlap (returned) and that the founder must approve before cover is arranged. Confirm the range before calling.",
  input_schema: {
    type: "object",
    properties: {
      starts_at: { type: "string", description: "YYYY-MM-DD HH:MM (IST)" },
      ends_at: { type: "string", description: "YYYY-MM-DD HH:MM (IST)" },
      reason: { type: "string" },
    },
    required: ["starts_at", "ends_at"],
  },
  run: async (input, ctx) => {
    const parse = (s: string) => {
      const m = String(s).trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})$/);
      return m ? academyWallToUtc(m[1], m[2]) : null;
    };
    const from = parse(input.starts_at);
    const to = parse(input.ends_at);
    if (!from || !to) return fail("Times must look like 2026-07-20 09:00 (IST).");
    if (from >= to) return fail("The range must start before it ends.");

    const supabase = ctx.supabase!;
    const { data: overlapping } = await supabase
      .from("class_sessions")
      .select("id")
      .eq("coach_id", ctx.profile!.id)
      .eq("status", "scheduled")
      .gte("starts_at", from.toISOString())
      .lt("starts_at", to.toISOString());

    const { error } = await supabase.from("coach_time_off").insert({
      coach_id: ctx.profile!.id,
      starts_at: from.toISOString(),
      ends_at: to.toISOString(),
      reason: (input.reason as string) || null,
    });
    if (error) return fail("Couldn't submit the request.");

    // Same founder heads-up the webapp sends.
    const { data: founders } = await supabase.from("profiles").select("id").eq("role", "founder");
    if (founders?.length) {
      await supabase.from("notifications").insert(
        founders.map((f) => ({
          user_id: f.id,
          type: "time_off_requested",
          title: "Time-off request",
          body: "A coach requested time off — review it.",
          data: {
            coach_id: ctx.profile!.id,
            starts_at: from.toISOString(),
            ends_at: to.toISOString(),
            url: "/admin/coaches",
          },
        }))
      );
    }
    return ok({
      submitted: true,
      overlapping_booked_sessions: overlapping?.length ?? 0,
      note: "Pending founder approval.",
    });
  },
};

const markAttendance: WaTool = {
  name: "mark_attendance",
  description:
    "Mark a player attended or a no-show for one of the coach's sessions (session_id from my_coach_sessions, player from session_roster). Only works from 15 minutes before the session up to 48 hours after. status: attended | no_show | confirmed (to undo).",
  input_schema: {
    type: "object",
    properties: {
      session_id: { type: "string" },
      player_name: { type: "string" },
      status: { type: "string", description: "attended | no_show | confirmed" },
    },
    required: ["session_id", "player_name", "status"],
  },
  run: async (input, ctx) => {
    // `find` rather than `includes` so the result is typed as the booking_status
    // enum the column expects, not a bare string the model chose.
    const attendance = ["attended", "no_show", "confirmed"] as const;
    const raw = String(input.status);
    const status = attendance.find((s) => s === raw);
    if (!status) {
      return fail("status must be attended, no_show or confirmed.");
    }
    const { data: session } = await ctx.supabase!
      .from("class_sessions")
      .select("id,coach_id,starts_at")
      .eq("id", input.session_id)
      .maybeSingle();
    if (!session || session.coach_id !== ctx.profile!.id) {
      return fail("That session isn't on this coach's schedule.");
    }
    const start = new Date(session.starts_at).getTime();
    if (Date.now() < start - 15 * 60000 || Date.now() > start + 48 * 3600000) {
      return fail("Attendance can only be set around the session (from 15 min before to 48h after).");
    }
    const needle = String(input.player_name).trim().toLowerCase();
    const { data: bookings } = await ctx.supabase!
      .from("bookings")
      .select("id,players(full_name)")
      .eq("session_id", input.session_id)
      .in("status", ["confirmed", "attended", "no_show"]);
    const matches = (bookings ?? []).filter((b) =>
      ((b.players)?.full_name ?? "")
        .toLowerCase()
        .includes(needle)
    );
    if (matches.length !== 1) {
      return fail(
        matches.length === 0
          ? "No booked player matches that name on this session."
          : "That name matches more than one player — be more specific."
      );
    }
    const { error } = await ctx.supabase!
      .from("bookings")
      .update({ status })
      .eq("id", matches[0].id);
    if (error) return fail("Couldn't save attendance.");
    return ok({ player: input.player_name, status });
  },
};

const saveSessionNotes: WaTool = {
  name: "save_session_notes",
  description: "Save coaching notes on one of the coach's sessions (session_id from my_coach_sessions).",
  input_schema: {
    type: "object",
    properties: { session_id: { type: "string" }, notes: { type: "string" } },
    required: ["session_id", "notes"],
  },
  run: async (input, ctx) => {
    const { data: session } = await ctx.supabase!
      .from("class_sessions")
      .select("id,coach_id")
      .eq("id", input.session_id)
      .maybeSingle();
    if (!session || session.coach_id !== ctx.profile!.id) {
      return fail("That session isn't on this coach's schedule.");
    }
    const { error } = await ctx.supabase!
      .from("class_sessions")
      .update({ coach_notes: String(input.notes) })
      .eq("id", input.session_id);
    return error ? fail("Couldn't save notes.") : ok({ saved: true });
  },
};

const cantMakeSession: WaTool = {
  name: "cant_make_session",
  description:
    "Report that the coach can't take an upcoming session (session_id from my_coach_sessions). Triggers cover arrangement and alerts the founder. Confirm first.",
  input_schema: {
    type: "object",
    properties: { session_id: { type: "string" } },
    required: ["session_id"],
  },
  run: async (input, ctx) => {
    const supabase = ctx.supabase!;
    const { data: session } = await supabase
      .from("class_sessions")
      .select("id,coach_id,starts_at,ends_at")
      .eq("id", input.session_id)
      .maybeSingle();
    if (!session || session.coach_id !== ctx.profile!.id) {
      return fail("That session isn't on this coach's schedule.");
    }
    const { error } = await supabase.rpc("handle_coach_dropout", {
      p_coach: ctx.profile!.id,
      p_from: session.starts_at,
      p_to: session.ends_at,
    });
    if (error) {
      // Engine not applied — unassign and alert founders directly.
      await supabase.from("class_sessions").update({ coach_id: null }).eq("id", input.session_id);
      const { data: founders } = await supabase.from("profiles").select("id").eq("role", "founder");
      if (founders?.length) {
        await supabase.from("notifications").insert(
          founders.map((f) => ({
            user_id: f.id,
            type: "session_unassigned",
            title: "Cover needed",
            body: "A coach dropped a session.",
            data: { session_id: input.session_id, url: "/admin/schedule" },
          }))
        );
      }
    }
    return ok({ reported: true, note: "Cover is being arranged and the founder has been alerted." });
  },
};

export const coachTools: WaTool[] = [
  mySessions,
  roster,
  confirmSession,
  markArrival,
  myAvailability,
  addWindow,
  removeWindow,
  requestTimeOff,
  markAttendance,
  saveSessionNotes,
  cantMakeSession,
];
