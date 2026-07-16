// Session/calendar cores — reassign, move, capacity override, one-off session.
// Shared by admin actions and the WhatsApp bot; RLS enforces on the caller's
// client.

import type { SupabaseClient } from "@supabase/supabase-js";
import { academyWallToUtc } from "@/lib/academy-time";
import type { OpResult } from "@/lib/admin-ops-types";

function whenIST(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  }).format(d);
}

export async function reassignSessionCore(
  supabase: SupabaseClient,
  founderId: string,
  sessionId: string,
  coachId: string,
  lock: boolean,
  force = false
): Promise<OpResult> {
  const { error } = await supabase.rpc("founder_reassign", {
    p_session: sessionId,
    p_coach: coachId,
    p_lock: lock,
    p_force: force,
  });

  if (error && (error.code === "PGRST202" || error.code === "42883")) {
    // Engine RPC not applied yet — apply the assignment directly.
    const { error: e2 } = await supabase
      .from("class_sessions")
      .update({ coach_id: coachId })
      .eq("id", sessionId);
    if (e2) {
      return {
        ok: false,
        error: e2.message.includes("coach_no_overlap")
          ? "That coach already has an overlapping session."
          : "Reassign failed.",
      };
    }
    await supabase
      .from("coach_assignments")
      .update({ status: "superseded" })
      .eq("session_id", sessionId)
      .eq("status", "active");
    await supabase.from("coach_assignments").insert({
      session_id: sessionId,
      coach_id: coachId,
      assigned_by: founderId,
      locked: lock,
    });
  } else if (error) {
    if (error.message.includes("filter_failed")) {
      const reason = error.message.split("filter_failed_")[1] ?? "hard filter";
      const friendly: Record<string, string> = {
        inactive: "they're paused",
        time_off: "they're on approved time off",
        unavailable: "the slot is outside their availability hours",
        overlap: "they'd clash with another session (incl. travel buffer)",
        out_of_radius: "the address is outside their travel radius",
        level_too_high: "the class level is above what they teach",
        dbs_required: "a junior is booked and they have no DBS check",
      };
      return {
        ok: false,
        code: "filter_failed",
        error: `That coach doesn't fit: ${friendly[reason] ?? reason}.`,
      };
    }
    if (error.message.includes("coach_no_overlap")) {
      return { ok: false, error: "That coach already has an overlapping session." };
    }
    return { ok: false, error: "Reassign failed." };
  }
  return { ok: true };
}

/** Move one session to a new day/time; everyone booked (and the coach) is told. */
export async function moveSessionCore(
  supabase: SupabaseClient,
  founderId: string,
  sessionId: string,
  date: string, // YYYY-MM-DD academy wall clock
  time: string // HH:MM
): Promise<OpResult> {
  const { data: session } = await supabase
    .from("class_sessions")
    .select("id,coach_id,starts_at,classes!inner(title,duration_minutes)")
    .eq("id", sessionId)
    .eq("status", "scheduled")
    .maybeSingle();
  if (!session) return { ok: false, error: "Session not found." };
  const cls = session.classes as unknown as { title: string; duration_minutes: number };

  const newStart = academyWallToUtc(date, time);
  if (!(newStart > new Date())) return { ok: false, error: "Pick a time in the future." };
  const newEnd = new Date(newStart.getTime() + cls.duration_minutes * 60000);

  let coachCleared = false;
  const { error } = await supabase
    .from("class_sessions")
    .update({ starts_at: newStart.toISOString(), ends_at: newEnd.toISOString() })
    .eq("id", sessionId);
  if (error) {
    const { error: retryErr } = await supabase
      .from("class_sessions")
      .update({
        starts_at: newStart.toISOString(),
        ends_at: newEnd.toISOString(),
        coach_id: null,
      })
      .eq("id", sessionId);
    if (retryErr) return { ok: false, error: "Couldn't move the session." };
    coachCleared = true;
    await supabase.rpc("assign_unassigned_sessions");
  }

  const { data: bookings } = await supabase
    .from("bookings")
    .select("client_id")
    .eq("session_id", sessionId)
    .in("status", ["confirmed", "waitlisted"]);
  const when = whenIST(newStart);
  const notified = new Set<string>();
  for (const b of bookings ?? []) {
    if (notified.has(b.client_id)) continue;
    notified.add(b.client_id);
    await supabase.from("notifications").insert({
      user_id: b.client_id,
      type: "session_moved",
      title: "Session moved",
      body: `${cls.title} is now ${when}.`,
      data: { session_id: sessionId, url: "/app/schedule" },
    });
  }
  if (session.coach_id) {
    await supabase.from("notifications").insert({
      user_id: session.coach_id,
      type: "session_moved",
      title: coachCleared ? "Session moved off your calendar" : "Session moved",
      body: `${cls.title} — ${coachCleared ? "the new time clashed for you" : `now ${when}`}.`,
      data: { session_id: sessionId, url: "/coach" },
    });
  }

  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "session.move",
    entity: "class_sessions",
    entity_id: sessionId,
    meta: { new_start: newStart.toISOString(), coach_cleared: coachCleared },
  });
  return { ok: true };
}

/** One-off capacity change for a single session (null = back to class default). */
export async function setSessionCapacityCore(
  supabase: SupabaseClient,
  founderId: string,
  sessionId: string,
  capacity: number | null
): Promise<OpResult> {
  if (capacity !== null && (!Number.isFinite(capacity) || capacity < 1)) {
    return { ok: false, error: "Spots must be at least 1." };
  }
  const { error } = await supabase
    .from("class_sessions")
    .update({ capacity_override: capacity })
    .eq("id", sessionId);
  if (error) return { ok: false, error: "Couldn't update the spots." };
  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "session.capacity",
    entity: "class_sessions",
    entity_id: sessionId,
    meta: { capacity },
  });
  return { ok: true };
}

export type PrivateSessionInput = {
  /**
   * The client this session is booked for. Omit to hold an "open" private slot
   * (coach + venue + time, no client) — no booking or minutes debit until a
   * client is assigned later via assignPrivateSessionClientCore.
   */
  clientId?: string;
  playerId?: string; // defaults to the client's first player
  date: string; // YYYY-MM-DD academy wall clock
  time: string; // HH:MM
  durationMinutes: number; // 60 | 90
  address: string;
  postcode?: string;
  lat: number;
  lng: number;
  hasTable?: boolean;
  accessNotes?: string;
  addressDetails?: Record<string, unknown> | null;
  coachId?: string;
  /** Founder comp: skip the client's plan duration/weekly-frequency checks. */
  overridePlanLimits?: boolean;
  /**
   * Repeat the session weekly. 1 (or unset) books a single one-off session; N
   * stands up a recurring weekly slot — a private_booking_series booked N weeks
   * ahead, which the nightly generator then keeps rolling. All-or-nothing.
   */
  recurWeeks?: number;
};

/** A wall-clock date (YYYY-MM-DD) shifted forward by whole weeks. */
function addWeeksToWallDate(date: string, weeks: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}

/** Start of the ISO week containing `d`, at midnight Asia/Kolkata, as UTC. */
function istWeekWindow(d: Date): { from: Date; to: Date } {
  const IST_MS = 5.5 * 3600000;
  const ist = new Date(d.getTime() + IST_MS);
  const dow = (ist.getUTCDay() + 6) % 7; // 0 = Monday
  const monday = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() - dow);
  const from = new Date(monday - IST_MS);
  return { from, to: new Date(from.getTime() + 7 * 86400000) };
}

/**
 * Founder books a private session on a client's behalf — same shape the
 * client-side request_private_class RPC produces (private class + details +
 * session + confirmed booking + minutes debit), but founder-initiated so the
 * 24h lead time and balance check don't apply. The debit keeps the ledger
 * symmetric with the cancel-refund path; the balance may go negative and the
 * founder can top it up via adjustCreditsCore.
 *
 * With `recurWeeks > 1` this creates a real private_booking_series (the same
 * model as the client-side create_private_series): the slot shows as "Weekly",
 * the client can cancel all future weeks from their schedule, and the nightly
 * generate_private_sessions keeps rolling the horizon while their plan is live.
 * The initial `recurWeeks` weeks are booked here; the whole run rolls back if
 * any week fails.
 */
export async function createPrivateSessionCore(
  supabase: SupabaseClient,
  founderId: string,
  input: PrivateSessionInput
): Promise<OpResult> {
  // No client → an open slot: no player, no booking, no minutes debit.
  const isOpen = !input.clientId;
  const clientId = input.clientId;

  let playerId = input.playerId;
  if (!isOpen && clientId) {
    if (playerId) {
      const { data: p } = await supabase
        .from("players")
        .select("id")
        .eq("id", playerId)
        .eq("client_id", clientId)
        .maybeSingle();
      if (!p) return { ok: false, error: "That player doesn't belong to this client." };
    } else {
      const { data: p } = await supabase
        .from("players")
        .select("id")
        .eq("client_id", clientId)
        .order("created_at")
        .limit(1)
        .maybeSingle();
      if (!p) {
        // Founder-initiated booking for an account that never added a player —
        // create one from the client's name so the session has someone on it.
        const { data: prof } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("id", clientId)
          .maybeSingle();
        const { data: fresh, error: freshErr } = await supabase
          .from("players")
          .insert({
            client_id: clientId,
            full_name: prof?.full_name?.trim() || "Player",
          })
          .select("id")
          .single();
        if (freshErr || !fresh)
          return { ok: false, error: "That client has no player profile yet." };
        playerId = fresh.id;
      } else {
        playerId = p.id;
      }
    }
  }

  const duration = input.durationMinutes === 90 ? 90 : 60;
  const weeks = Math.min(Math.max(Math.trunc(input.recurWeeks ?? 1), 1), 12);
  // >1 week means a standing weekly slot, not a fixed block: we create a real
  // private_booking_series (same model as the client-side create_private_series)
  // so it shows as "Weekly", the client can cancel all future weeks, and the
  // nightly generate_private_sessions keeps rolling the horizon. Open slots have
  // no client to key a series to, so they're always a single held session.
  const recurring = weeks > 1 && !isOpen;
  // ISO weekday (Mon=1..Sun=7) of the first occurrence, in the IST wall date.
  const isoWeekday = (((new Date(`${input.date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1);

  // One occurrence per week from the chosen start date, same weekday/time.
  const occurrences = Array.from({ length: weeks }, (_, i) => {
    const date = addWeeksToWallDate(input.date, i);
    const start = academyWallToUtc(date, input.time);
    return { date, start, end: new Date(start.getTime() + duration * 60000) };
  });
  if (!(occurrences[0].start > new Date()))
    return { ok: false, error: "Pick a time in the future." };

  // Mirror the client-side plan enforcement (duration + weekly frequency)
  // unless the founder explicitly overrides to comp a session. Open slots have
  // no client, so there's no plan to enforce.
  if (!isOpen && clientId && !input.overridePlanLimits) {
    const { data: limitRows } = await supabase.rpc("private_plan_limits", {
      p_client: clientId,
    });
    const limits = (Array.isArray(limitRows) ? limitRows[0] : limitRows) as
      | { sessions_per_week: number | null; session_minutes: number | null }
      | undefined;
    if (limits?.session_minutes != null && duration !== limits.session_minutes) {
      return {
        ok: false,
        error: `Their plan covers ${limits.session_minutes}-minute sessions — tick "ignore plan limits" to book a different length.`,
      };
    }
    if (limits?.sessions_per_week != null) {
      // Each occurrence lands in its own week, so check every week we'd fill.
      for (let i = 0; i < occurrences.length; i++) {
        const { from, to } = istWeekWindow(occurrences[i].start);
        const { count } = await supabase
          .from("bookings")
          .select("id,class_sessions!inner(starts_at,classes!inner(class_type))", {
            count: "exact",
            head: true,
          })
          .eq("client_id", clientId)
          .eq("status", "confirmed")
          .eq("class_sessions.classes.class_type", "private")
          .gte("class_sessions.starts_at", from.toISOString())
          .lt("class_sessions.starts_at", to.toISOString());
        if ((count ?? 0) >= limits.sessions_per_week) {
          const lead =
            weeks > 1 ? `Week ${i + 1}: they've` : "They've";
          return {
            ok: false,
            error: `${lead} already got their plan's ${limits.sessions_per_week} private session${limits.sessions_per_week > 1 ? "s" : ""} that week — tick "ignore plan limits" to add another.`,
          };
        }
      }
    }
  }

  // Create each occurrence. Track what we made so a mid-run failure can undo
  // the whole series — a half-booked recurring run shouldn't linger.
  const createdClassIds: string[] = [];
  const createdLedgerIds: string[] = [];
  const createdSessions: { id: string; start: Date }[] = [];
  let seriesId: string | null = null;

  async function rollback() {
    if (createdLedgerIds.length)
      await supabase.from("private_credit_ledger").delete().in("id", createdLedgerIds);
    // Deleting the class cascades to its details, session and booking.
    if (createdClassIds.length)
      await supabase.from("classes").delete().in("id", createdClassIds);
    if (seriesId)
      await supabase.from("private_booking_series").delete().eq("id", seriesId);
  }

  // Stand up the standing series first, so every occurrence below links to it.
  if (recurring) {
    const { data: series, error: seriesErr } = await supabase
      .from("private_booking_series")
      .insert({
        client_id: clientId,
        player_id: playerId,
        preferred_coach: input.coachId || null,
        weekday: isoWeekday,
        start_time: input.time,
        duration_minutes: duration,
        address: input.address,
        postcode: input.postcode ?? "",
        lat: input.lat,
        lng: input.lng,
        has_table: input.hasTable ?? true,
        access_notes: input.accessNotes || null,
        address_details: input.addressDetails ?? null,
      })
      .select("id")
      .single();
    if (seriesErr || !series) {
      return {
        ok: false,
        error:
          seriesErr?.code === "23505"
            ? "This client already has a weekly slot at that day and time."
            : "Couldn't set up the weekly series.",
      };
    }
    seriesId = series.id;
  }

  for (const occ of occurrences) {
    const { data: cls, error: clsErr } = await supabase
      .from("classes")
      .insert({
        class_type: "private",
        title: isOpen ? "Private — unassigned" : "Private session",
        skill_level: "beginner",
        capacity: 1,
        duration_minutes: duration,
        starts_on: occ.date,
        created_by: founderId,
      })
      .select("id")
      .single();
    if (clsErr || !cls) {
      await rollback();
      return { ok: false, error: "Couldn't create the session." };
    }
    createdClassIds.push(cls.id);

    const { error: detErr } = await supabase.from("private_class_details").insert({
      class_id: cls.id,
      client_id: clientId ?? null,
      player_id: playerId ?? null,
      address: input.address,
      postcode: input.postcode ?? "",
      lat: input.lat,
      lng: input.lng,
      has_table: input.hasTable ?? true,
      access_notes: input.accessNotes || null,
      address_details: input.addressDetails ?? null,
    });
    if (detErr) {
      await rollback();
      return { ok: false, error: "Couldn't save the address." };
    }

    const { data: session, error: sessErr } = await supabase
      .from("class_sessions")
      .insert({
        class_id: cls.id,
        coach_id: input.coachId || null,
        starts_at: occ.start.toISOString(),
        ends_at: occ.end.toISOString(),
      })
      .select("id")
      .single();
    if (sessErr || !session) {
      await rollback();
      return {
        ok: false,
        error: sessErr?.message.includes("coach_no_overlap")
          ? "That coach is already busy then — pick another coach or leave it on automatic."
          : "Couldn't create the session.",
      };
    }
    createdSessions.push({ id: session.id, start: occ.start });

    // Open slot: no client yet, so no booking and no minutes debit. The empty
    // held session is filled later via assignPrivateSessionClientCore.
    if (clientId) {
      const { data: booking, error: bookErr } = await supabase
        .from("bookings")
        .insert({
          session_id: session.id,
          client_id: clientId,
          player_id: playerId,
          status: "confirmed",
          private_series_id: seriesId,
        })
        .select("id")
        .single();
      if (bookErr || !booking) {
        await rollback();
        return { ok: false, error: "Couldn't book the client in." };
      }

      const { data: ledger } = await supabase
        .from("private_credit_ledger")
        .insert({
          client_id: clientId,
          booking_id: booking.id,
          delta_minutes: -duration,
          reason: "booking",
          note: "booked by academy",
        })
        .select("id")
        .single();
      if (ledger) createdLedgerIds.push(ledger.id);
    }
  }

  if (!input.coachId) await supabase.rpc("assign_unassigned_sessions");

  const firstWhen = whenIST(occurrences[0].start);
  if (clientId) {
    await supabase.from("notifications").insert({
      user_id: clientId,
      type: "new_private_session",
      title: recurring ? "Weekly private sessions booked" : "Private session booked",
      body:
        recurring
          ? `We've set up a weekly private slot starting ${firstWhen} — it's on your schedule, and you can manage it there.`
          : `We've set up a private session for ${firstWhen} — it's on your schedule.`,
      data: { session_id: createdSessions[0].id, url: "/app/schedule" },
    });
  }
  if (input.coachId) {
    for (const s of createdSessions) {
      await supabase.from("notifications").insert({
        user_id: input.coachId,
        type: "new_private_session",
        title: "New private session",
        body: `${whenIST(s.start)} — ${input.address}`,
        data: { session_id: s.id, url: `/coach/session/${s.id}` },
      });
    }
  }

  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "session.create_private",
    entity: "class_sessions",
    entity_id: createdSessions[0].id,
    meta: {
      client_id: clientId ?? null,
      minutes: duration,
      weeks: recurring ? weeks : 1,
      sessions: createdSessions.length,
      private_series_id: seriesId,
    },
  });
  return { ok: true };
}

/**
 * Assign a client to an "open" private slot created without one. Fills the held
 * session in place: sets the client/player on the details, books them in, debits
 * their minutes and notifies them — the mirror of the booking half of
 * createPrivateSessionCore. Only touches this one session (open slots are single
 * held sessions, never a standing series).
 */
export async function assignPrivateSessionClientCore(
  supabase: SupabaseClient,
  founderId: string,
  sessionId: string,
  clientId: string,
  playerId?: string,
  overridePlanLimits = false
): Promise<OpResult> {
  const { data: session } = await supabase
    .from("class_sessions")
    .select(
      "id,starts_at,coach_id,status,classes!inner(id,class_type,duration_minutes,private_class_details(client_id))"
    )
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) return { ok: false, error: "Session not found." };
  if (session.status !== "scheduled")
    return { ok: false, error: "That session isn't open for booking." };

  const cls = session.classes as unknown as {
    id: string;
    class_type: string;
    duration_minutes: number;
    private_class_details: { client_id: string | null }[] | { client_id: string | null } | null;
  };
  if (cls.class_type !== "private") return { ok: false, error: "Not a private session." };
  const det = cls.private_class_details;
  const existing = Array.isArray(det) ? det[0]?.client_id : det?.client_id;
  if (existing) return { ok: false, error: "This session already has a client." };

  const duration = cls.duration_minutes;
  const start = new Date(session.starts_at);
  if (!(start > new Date())) return { ok: false, error: "That session is in the past." };

  // Resolve the player: given one (must belong to the client), the client's
  // first, or a fresh one made from their name.
  let resolvedPlayer = playerId;
  if (resolvedPlayer) {
    const { data: p } = await supabase
      .from("players")
      .select("id")
      .eq("id", resolvedPlayer)
      .eq("client_id", clientId)
      .maybeSingle();
    if (!p) return { ok: false, error: "That player doesn't belong to this client." };
  } else {
    const { data: p } = await supabase
      .from("players")
      .select("id")
      .eq("client_id", clientId)
      .order("created_at")
      .limit(1)
      .maybeSingle();
    if (p) {
      resolvedPlayer = p.id;
    } else {
      const { data: prof } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", clientId)
        .maybeSingle();
      const { data: fresh, error: freshErr } = await supabase
        .from("players")
        .insert({ client_id: clientId, full_name: prof?.full_name?.trim() || "Player" })
        .select("id")
        .single();
      if (freshErr || !fresh)
        return { ok: false, error: "That client has no player profile yet." };
      resolvedPlayer = fresh.id;
    }
  }

  // Mirror the plan check (duration + this week's frequency) unless overridden.
  if (!overridePlanLimits) {
    const { data: limitRows } = await supabase.rpc("private_plan_limits", {
      p_client: clientId,
    });
    const limits = (Array.isArray(limitRows) ? limitRows[0] : limitRows) as
      | { sessions_per_week: number | null; session_minutes: number | null }
      | undefined;
    if (limits?.session_minutes != null && duration !== limits.session_minutes) {
      return {
        ok: false,
        error: `Their plan covers ${limits.session_minutes}-minute sessions — tick "ignore plan limits" to assign a different length.`,
      };
    }
    if (limits?.sessions_per_week != null) {
      const { from, to } = istWeekWindow(start);
      const { count } = await supabase
        .from("bookings")
        .select("id,class_sessions!inner(starts_at,classes!inner(class_type))", {
          count: "exact",
          head: true,
        })
        .eq("client_id", clientId)
        .eq("status", "confirmed")
        .eq("class_sessions.classes.class_type", "private")
        .gte("class_sessions.starts_at", from.toISOString())
        .lt("class_sessions.starts_at", to.toISOString());
      if ((count ?? 0) >= limits.sessions_per_week) {
        return {
          ok: false,
          error: `They've already got their plan's ${limits.sessions_per_week} private session${limits.sessions_per_week > 1 ? "s" : ""} that week — tick "ignore plan limits" to add another.`,
        };
      }
    }
  }

  // Attach the client to the slot, then book them in. If the booking fails,
  // roll the details back to unassigned so the slot stays clean.
  const { error: detErr } = await supabase
    .from("private_class_details")
    .update({ client_id: clientId, player_id: resolvedPlayer })
    .eq("class_id", cls.id);
  if (detErr) return { ok: false, error: "Couldn't assign the client." };

  const { data: booking, error: bookErr } = await supabase
    .from("bookings")
    .insert({
      session_id: sessionId,
      client_id: clientId,
      player_id: resolvedPlayer,
      status: "confirmed",
    })
    .select("id")
    .single();
  if (bookErr || !booking) {
    await supabase
      .from("private_class_details")
      .update({ client_id: null, player_id: null })
      .eq("class_id", cls.id);
    return { ok: false, error: "Couldn't book the client in." };
  }

  await supabase
    .from("classes")
    .update({ title: "Private session" })
    .eq("id", cls.id);

  await supabase.from("private_credit_ledger").insert({
    client_id: clientId,
    booking_id: booking.id,
    delta_minutes: -duration,
    reason: "booking",
    note: "booked by academy",
  });

  await supabase.from("notifications").insert({
    user_id: clientId,
    type: "new_private_session",
    title: "Private session booked",
    body: `We've set up a private session for ${whenIST(start)} — it's on your schedule.`,
    data: { session_id: sessionId, url: "/app/schedule" },
  });

  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "session.assign_private",
    entity: "class_sessions",
    entity_id: sessionId,
    meta: { client_id: clientId, minutes: duration },
  });
  return { ok: true };
}

/**
 * Cancel all future scheduled private sessions for the same client as the
 * given session. Refunds minutes and notifies the client + affected coaches.
 * Used by the admin "Cancel all upcoming sessions" action on the session sheet.
 */
export async function cancelFuturePrivateSessionsCore(
  supabase: SupabaseClient,
  founderId: string,
  sessionId: string
): Promise<OpResult & { cancelled?: number }> {
  // Resolve the client from this session's class.
  const { data: anchor } = await supabase
    .from("class_sessions")
    .select("id,classes!inner(class_type,private_class_details(client_id))")
    .eq("id", sessionId)
    .maybeSingle();
  if (!anchor) return { ok: false, error: "Session not found." };

  const cls = anchor.classes as unknown as {
    class_type: string;
    private_class_details: { client_id: string }[] | { client_id: string } | null;
  };
  if (cls.class_type !== "private") return { ok: false, error: "Not a private session." };
  const det = cls.private_class_details;
  const clientId = Array.isArray(det) ? det[0]?.client_id : det?.client_id;
  if (!clientId) return { ok: false, error: "Client not found." };

  // All future class IDs for this client's private sessions.
  const { data: clientClasses } = await supabase
    .from("private_class_details")
    .select("class_id")
    .eq("client_id", clientId);
  const classIds = (clientClasses ?? []).map((c) => c.class_id);
  if (!classIds.length) return { ok: true, cancelled: 0 };

  // Future scheduled sessions across those classes.
  const { data: futureSessions } = await supabase
    .from("class_sessions")
    .select("id,coach_id,classes!inner(title,duration_minutes)")
    .in("class_id", classIds)
    .eq("status", "scheduled")
    .gt("starts_at", new Date().toISOString());

  const sessions = futureSessions ?? [];
  if (!sessions.length) return { ok: true, cancelled: 0 };

  const sessionIds = sessions.map((s) => s.id);

  // Cancel all the sessions.
  await supabase
    .from("class_sessions")
    .update({ status: "cancelled", cancel_reason: "cancelled by academy" })
    .in("id", sessionIds);

  // Find bookings, cancel them, and refund minutes.
  const { data: bookings } = await supabase
    .from("bookings")
    .select("id,client_id,session_id")
    .in("session_id", sessionIds)
    .in("status", ["confirmed", "waitlisted"]);

  const durationBySession = new Map<string, number>(
    sessions.map((s) => [
      s.id,
      (s.classes as unknown as { duration_minutes: number }).duration_minutes,
    ])
  );

  for (const b of bookings ?? []) {
    await supabase
      .from("bookings")
      .update({
        status: "cancelled_by_academy",
        cancelled_at: new Date().toISOString(),
        cancel_reason: "cancelled by academy",
      })
      .eq("id", b.id);

    const mins = durationBySession.get(b.session_id) ?? 60;
    await supabase.from("private_credit_ledger").insert({
      client_id: b.client_id,
      booking_id: b.id,
      delta_minutes: mins,
      reason: "cancellation_refund",
      note: "academy cancelled all upcoming sessions",
    });
  }

  // One notification to the client.
  await supabase.from("notifications").insert({
    user_id: clientId,
    type: "session_cancelled",
    title: "Upcoming sessions cancelled",
    body: `Your upcoming private sessions have been cancelled — your minutes have been returned.`,
    data: { url: "/app/schedule" },
  });

  // Notify affected coaches (de-duped).
  const coachIds = new Set(
    sessions.map((s) => s.coach_id).filter((c): c is string => !!c)
  );
  for (const coachId of coachIds) {
    await supabase.from("notifications").insert({
      user_id: coachId,
      type: "session_cancelled",
      title: "Private sessions cancelled",
      body: `All upcoming private sessions for this client have been cancelled.`,
      data: { url: "/coach" },
    });
  }

  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "session.cancel_private_series",
    entity: "class_sessions",
    entity_id: sessionId,
    meta: { client_id: clientId, cancelled: sessions.length },
  });

  return { ok: true, cancelled: sessions.length };
}

/** Add a single extra session to an existing class (e.g. a holiday special). */
export async function createOneOffSessionCore(
  supabase: SupabaseClient,
  founderId: string,
  classId: string,
  date: string,
  time: string,
  coachId: string
): Promise<OpResult> {
  const { data: cls } = await supabase
    .from("classes")
    .select("id,title,duration_minutes")
    .eq("id", classId)
    .maybeSingle();
  if (!cls) return { ok: false, error: "Class not found." };

  const start = academyWallToUtc(date, time);
  if (!(start > new Date())) return { ok: false, error: "Pick a time in the future." };
  const end = new Date(start.getTime() + cls.duration_minutes * 60000);

  const { data: created, error } = await supabase
    .from("class_sessions")
    .insert({
      class_id: classId,
      coach_id: coachId || null,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
    })
    .select("id")
    .single();
  if (error || !created) {
    return {
      ok: false,
      error: error?.message.includes("coach_no_overlap")
        ? "That coach is already busy then — pick another coach or leave it on automatic."
        : "Couldn't add the session.",
    };
  }
  if (!coachId) await supabase.rpc("assign_unassigned_sessions");

  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "session.create",
    entity: "class_sessions",
    entity_id: created.id,
    meta: { class_id: classId },
  });
  return { ok: true };
}
