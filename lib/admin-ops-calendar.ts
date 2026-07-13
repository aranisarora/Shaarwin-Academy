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
  clientId: string;
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
   * Repeat the session weekly. 1 (or unset) books a single session; N books the
   * same weekday/time for N consecutive weeks, each its own private class,
   * session, booking and minutes debit — all-or-nothing.
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
 * With `recurWeeks > 1` this repeats the same weekday/time for that many weeks,
 * one independent private class per week (mirroring the client-side weekly
 * series), rolling the whole run back if any week fails.
 */
export async function createPrivateSessionCore(
  supabase: SupabaseClient,
  founderId: string,
  input: PrivateSessionInput
): Promise<OpResult> {
  let playerId = input.playerId;
  if (playerId) {
    const { data: p } = await supabase
      .from("players")
      .select("id")
      .eq("id", playerId)
      .eq("client_id", input.clientId)
      .maybeSingle();
    if (!p) return { ok: false, error: "That player doesn't belong to this client." };
  } else {
    const { data: p } = await supabase
      .from("players")
      .select("id")
      .eq("client_id", input.clientId)
      .order("created_at")
      .limit(1)
      .maybeSingle();
    if (!p) {
      // Founder-initiated booking for an account that never added a player —
      // create one from the client's name so the session has someone on it.
      const { data: prof } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", input.clientId)
        .maybeSingle();
      const { data: fresh, error: freshErr } = await supabase
        .from("players")
        .insert({
          client_id: input.clientId,
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

  const duration = input.durationMinutes === 90 ? 90 : 60;
  const weeks = Math.min(Math.max(Math.trunc(input.recurWeeks ?? 1), 1), 12);

  // One occurrence per week from the chosen start date, same weekday/time.
  const occurrences = Array.from({ length: weeks }, (_, i) => {
    const date = addWeeksToWallDate(input.date, i);
    const start = academyWallToUtc(date, input.time);
    return { date, start, end: new Date(start.getTime() + duration * 60000) };
  });
  if (!(occurrences[0].start > new Date()))
    return { ok: false, error: "Pick a time in the future." };

  // Mirror the client-side plan enforcement (duration + weekly frequency)
  // unless the founder explicitly overrides to comp a session.
  if (!input.overridePlanLimits) {
    const { data: limitRows } = await supabase.rpc("private_plan_limits", {
      p_client: input.clientId,
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
          .eq("client_id", input.clientId)
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

  async function rollback() {
    if (createdLedgerIds.length)
      await supabase.from("private_credit_ledger").delete().in("id", createdLedgerIds);
    // Deleting the class cascades to its details, session and booking.
    if (createdClassIds.length)
      await supabase.from("classes").delete().in("id", createdClassIds);
  }

  for (const occ of occurrences) {
    const { data: cls, error: clsErr } = await supabase
      .from("classes")
      .insert({
        class_type: "private",
        title: "Private session",
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
      client_id: input.clientId,
      player_id: playerId,
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

    const { data: booking, error: bookErr } = await supabase
      .from("bookings")
      .insert({
        session_id: session.id,
        client_id: input.clientId,
        player_id: playerId,
        status: "confirmed",
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
        client_id: input.clientId,
        booking_id: booking.id,
        delta_minutes: -duration,
        reason: "booking",
        note: "booked by academy",
      })
      .select("id")
      .single();
    if (ledger) createdLedgerIds.push(ledger.id);
  }

  if (!input.coachId) await supabase.rpc("assign_unassigned_sessions");

  const firstWhen = whenIST(occurrences[0].start);
  await supabase.from("notifications").insert({
    user_id: input.clientId,
    type: "new_private_session",
    title: weeks > 1 ? "Weekly private sessions booked" : "Private session booked",
    body:
      weeks > 1
        ? `We've set up ${weeks} weekly private sessions starting ${firstWhen} — they're on your schedule.`
        : `We've set up a private session for ${firstWhen} — it's on your schedule.`,
    data: { session_id: createdSessions[0].id, url: "/app/schedule" },
  });
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
      client_id: input.clientId,
      minutes: duration,
      weeks,
      sessions: createdSessions.length,
    },
  });
  return { ok: true };
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
