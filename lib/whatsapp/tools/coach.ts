// Coach tools — the /coach surface over chat: schedule, rosters, cover and
// attendance. Runs as the coach's own session (RLS).

import { getCoachSessions } from "@/lib/coach-data";
import { formatSessionDate, istDayBounds } from "@/lib/academy-time";
import { fail, ok, type WaTool } from "./types";

const mySessions: WaTool = {
  name: "my_coach_sessions",
  description:
    "The coach's assigned sessions — group, private AND school — with venue/address, headcount and whether they've confirmed they're taking each one. Covers WHOLE academy days starting at 00:00 today, so sessions earlier today are included. Default window is 7 days (max 28).",
  input_schema: {
    type: "object",
    properties: { days: { type: "number", description: "Days covered, including today (default 7)" } },
  },
  run: async (input, ctx) => {
    const days = Math.min(Math.max(Number(input.days) || 7, 1), 28);
    // Whole IST days, not a window starting at this instant. Previously a coach
    // asking "do I have coaching today?" at 3pm was told no when their session
    // had already started — production caught exactly that, with the coach
    // pushing back and naming the venue. getCoachSessions applies no class_type
    // filter, so private and school sessions are already included.
    const { start, end } = istDayBounds(days);
    const sessions = await getCoachSessions(
      ctx.supabase!,
      ctx.profile!.id,
      new Date(start),
      new Date(end)
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
        when: formatSessionDate(s.starts_at),
        title: s.classTitle,
        type: s.isPrivate ? "private" : "group",
        level: s.level,
        players: `${s.confirmed}/${s.capacity}`,
        // Both halves for either kind: the name the coach recognises AND the
        // address they navigate to. A private used to return the bare address,
        // so the bot could only answer "where?" with a geocoded line even when
        // getCoachSessions had already resolved it to "APR Apartments".
        where: [s.venueName ?? "?", s.isPrivate ? s.privateAddress : s.venueAddress]
          .filter(Boolean)
          .join(" — "),
        status: s.status,
        confirmed_coming: flags.get(s.id)?.confirmed ?? false,
        marked_arrived: flags.get(s.id)?.arrived ?? false,
      }))
    );
  },
};

/**
 * K8 — take an offered uncovered session. First tap wins, so the honest failure
 * mode ("someone beat you to it") matters as much as the success path.
 */
const claimCover: WaTool = {
  name: "claim_cover_session",
  description:
    "Claim an uncovered session the coach was offered (session_id from the cover offer, or from list_cover_offers). First coach to claim it takes it. Use when the coach says they can cover / take / pick up an offered session.",
  input_schema: {
    type: "object",
    properties: { session_id: { type: "string" } },
    required: ["session_id"],
  },
  run: async (input, ctx) => {
    const { error } = await ctx.supabase!.rpc("claim_cover_session", {
      p_session: input.session_id,
    });
    if (error) {
      if (error.message.includes("already_taken")) {
        return fail("Another coach already picked that one up — it's covered.");
      }
      if (error.message.includes("session_started")) {
        return fail("That session has already started.");
      }
      if (error.message.includes("session_not_available")) {
        return fail("That session isn't open for cover any more.");
      }
      if (error.message.includes("filter_failed")) {
        const reason = error.message.split("filter_failed_")[1] ?? "";
        return fail(
          `They can't take that one: ${
            {
              overlap: "it clashes with another session",
              level_too_high: "the class level is above what they teach",
              inactive: "their account is paused",
            }[reason] ?? reason
          }.`
        );
      }
      return fail("Couldn't claim that session.");
    }
    return ok({
      claimed: true,
      note: "It's yours — the founder and the booked families have been told, and you're marked as confirmed.",
    });
  },
};

/** The offers still open to this coach, so they can ask "what needs cover?". */
const coverOffers: WaTool = {
  name: "list_cover_offers",
  description:
    "Uncovered sessions currently offered to this coach, with session_id values for claim_cover_session.",
  input_schema: { type: "object", properties: {} },
  run: async (_input, ctx) => {
    const { data } = await ctx.supabase!
      .from("notifications")
      .select("body,data,created_at")
      .eq("user_id", ctx.profile!.id)
      .eq("type", "cover_offer")
      .is("read_at", null)
      .order("created_at", { ascending: false })
      .limit(10);

    const offers = (data ?? []).map((n) => {
      const d = (n.data ?? {}) as Record<string, unknown>;
      return {
        session_id: d.session_id,
        title: d.class_title,
        when: d.time_str,
        where: d.location_str,
      };
    });
    return ok(offers.length ? { offers } : { offers: [], note: "Nothing needs cover right now." });
  },
};

const confirmSession: WaTool = {
  name: "confirm_session",
  description:
    "Confirm the coach IS taking an upcoming session ('yes, I'm coming') — session_id from my_coach_sessions. Records the confirmation; it does not message anyone. Use when the coach says they'll take / confirm a session (e.g. replying 'confirm' to a reminder). If they CAN'T make it, use cant_make_session instead.",
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
    // coach_confirm_session stamps coach_confirmed_at and returns — its own
    // comment says founders are "intentionally NOT notified", because a routine
    // confirmation needs no action from them. Saying otherwise here put a
    // fabricated delivery in front of the model on every confirmation.
    // What confirming actually buys the coach is silence, so say that.
    return ok({
      confirmed: true,
      note: "Recorded. No one is messaged — this just stops the reminders and the founder alert for this session.",
    });
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
      // Migration 0079's guards. Named so the model can explain the refusal
      // instead of inventing a reason for a bare "couldn't send that".
      if (error.message.includes("session_cancelled")) {
        return fail("That session was cancelled, so there's no arrival to record.");
      }
      if (error.message.includes("outside_arrival_window")) {
        return fail(
          "That's more than two hours from the session's start time — arrival can only be marked around it. Check they picked the right session."
        );
      }
      return fail("Couldn't send that.");
    }
    // What the RPC actually does, not what would be nice to say. It QUEUES
    // notification rows; a separate worker delivers them later over whichever
    // channel each person allows. And the founder is pinged ONLY on lateness —
    // coach_mark_arrival's founder insert sits inside `if p_late`, because a
    // routine on-time arrival needs nothing from them.
    //
    // The model is told (agent.ts) never to upgrade "queued" to "notified", and
    // never to claim more than the tool returned. It can only honour that if
    // the tool stops handing it the overclaim ready-made.
    return ok({
      marked: input.running_late ? "running_late" : "arrived",
      note: input.running_late
        ? "Queued to the parents booked on this session, and to the founder."
        : "Queued to the parents booked on this session. The founder isn't pinged for an on-time arrival.",
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
      // Through the same queue site as the SQL writers (migration 0069), so
      // this fallback inherits the once-per-founder-per-day collapse instead of
      // being the one path that still sends a message per dropped session. On
      // `admin` because the queue is a system alert, not a coach's write — and
      // because 0069 revokes it from `authenticated`.
      await ctx.admin.rpc("alert_founders_session", {
        p_type: "session_unassigned",
        p_title: "Cover needed",
        p_body: "A coach dropped a session.",
        p_url: "/admin/schedule",
        p_session: input.session_id,
        p_summary_fmt: "%s sessions need cover",
      });
    }
    return ok({ reported: true, note: "Cover is being arranged and the founder has been alerted." });
  },
};

export const coachTools: WaTool[] = [
  mySessions,
  roster,
  coverOffers,
  claimCover,
  confirmSession,
  markArrival,
  markAttendance,
  saveSessionNotes,
  cantMakeSession,
];
