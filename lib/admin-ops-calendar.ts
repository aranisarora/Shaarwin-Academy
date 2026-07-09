// Session/calendar cores — reassign, move, capacity override, one-off session.
// Shared by admin actions and the WhatsApp bot; RLS enforces on the caller's
// client.

import type { SupabaseClient } from "@supabase/supabase-js";
import { academyWallToUtc } from "@/lib/academy-time";
import type { OpResult } from "@/lib/admin-ops";

function whenIST(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(d);
}

export async function reassignSessionCore(
  supabase: SupabaseClient,
  founderId: string,
  sessionId: string,
  coachId: string,
  lock: boolean
): Promise<OpResult> {
  const { error } = await supabase.rpc("founder_reassign", {
    p_session: sessionId,
    p_coach: coachId,
    p_lock: lock,
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
      return {
        ok: false,
        error: `That coach doesn't fit: ${error.message.split("filter_failed_")[1] ?? "hard filter"}.`,
      };
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
