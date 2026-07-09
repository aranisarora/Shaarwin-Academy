// Class lifecycle cores — shared by the admin server actions and the WhatsApp
// bot. Caller supplies the user-scoped client + founder id; RLS enforces.

import type { SupabaseClient } from "@supabase/supabase-js";
import { academyWallToUtc, utcToAcademyWall } from "@/lib/academy-time";
import type { OpResult } from "@/lib/admin-ops";

const WEEKDAY_NUM: Record<string, number> = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 };

export type ClassUpdate = {
  classId: string;
  title: string;
  description: string;
  skillLevel: string;
  capacity: number;
  durationMinutes: number;
  venueId: string;
  weekday: string; // MO..SU
  time: string; // HH:MM academy wall clock
};

/**
 * Save class details. If the day, time, duration or venue changed, every
 * upcoming session moves with it and booked clients/coaches are told. Coaches
 * who no longer fit are cleared for the engine to refill.
 */
export async function updateGroupClassCore(
  supabase: SupabaseClient,
  founderId: string,
  input: ClassUpdate
): Promise<OpResult> {
  const { data: cls } = await supabase
    .from("classes")
    .select("id,title,duration_minutes,venue_id,recurrence_rule")
    .eq("id", input.classId)
    .eq("class_type", "group")
    .maybeSingle();
  if (!cls) return { ok: false, error: "Class not found." };

  const newWd = WEEKDAY_NUM[input.weekday] ?? 1;
  const { error: clsErr } = await supabase
    .from("classes")
    .update({
      title: input.title,
      description: input.description || null,
      skill_level: input.skillLevel,
      capacity: input.capacity,
      duration_minutes: input.durationMinutes,
      venue_id: input.venueId,
      recurrence_rule: `FREQ=WEEKLY;BYDAY=${input.weekday}`,
    })
    .eq("id", input.classId);
  if (clsErr) return { ok: false, error: "Couldn't save the class." };

  const venueChanged = cls.venue_id !== input.venueId;

  const { data: sessions } = await supabase
    .from("class_sessions")
    .select("id,starts_at,coach_id")
    .eq("class_id", input.classId)
    .eq("status", "scheduled")
    .gt("starts_at", new Date().toISOString());

  const movedSessionIds: string[] = [];
  const affectedCoaches = new Set<string>();
  let needsEngine = false;

  for (const s of sessions ?? []) {
    const start = new Date(s.starts_at);
    const wall = utcToAcademyWall(start);
    const durationChanged = input.durationMinutes !== cls.duration_minutes;
    const slotChanged = wall.isoWeekday !== newWd || wall.time !== input.time;
    if (!slotChanged && !durationChanged) continue;

    const shifted = new Date(start.getTime() + (newWd - wall.isoWeekday) * 86400000);
    const newDate = utcToAcademyWall(shifted).date;
    const newStart = academyWallToUtc(newDate, input.time);
    if (newStart <= new Date()) continue;
    const newEnd = new Date(newStart.getTime() + input.durationMinutes * 60000);

    const { error: moveErr } = await supabase
      .from("class_sessions")
      .update({ starts_at: newStart.toISOString(), ends_at: newEnd.toISOString() })
      .eq("id", s.id);

    if (moveErr) {
      const { error: retryErr } = await supabase
        .from("class_sessions")
        .update({
          starts_at: newStart.toISOString(),
          ends_at: newEnd.toISOString(),
          coach_id: null,
        })
        .eq("id", s.id);
      if (retryErr) continue;
      if (s.coach_id) affectedCoaches.add(s.coach_id);
      needsEngine = true;
    }
    if (slotChanged) movedSessionIds.push(s.id);
    if (s.coach_id) affectedCoaches.add(s.coach_id);
  }

  if (needsEngine) await supabase.rpc("assign_unassigned_sessions");

  const notifySessionIds = venueChanged
    ? (sessions ?? []).map((s) => s.id)
    : movedSessionIds;
  if (notifySessionIds.length) {
    const { data: bookings } = await supabase
      .from("bookings")
      .select("client_id,session_id")
      .in("session_id", notifySessionIds)
      .in("status", ["confirmed", "waitlisted"]);
    const notified = new Set<string>();
    for (const b of bookings ?? []) {
      if (notified.has(b.client_id)) continue;
      notified.add(b.client_id);
      await supabase.from("notifications").insert({
        user_id: b.client_id,
        type: "class_updated",
        title: "Class schedule changed",
        body: `${input.title} has a new time or place — check your schedule.`,
        data: { url: "/app/schedule" },
      });
    }
    for (const coachId of affectedCoaches) {
      await supabase.from("notifications").insert({
        user_id: coachId,
        type: "class_updated",
        title: "Class schedule changed",
        body: `${input.title} moved — check your calendar.`,
        data: { url: "/coach" },
      });
    }
  }

  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "class.update",
    entity: "classes",
    entity_id: input.classId,
    meta: { moved_sessions: movedSessionIds.length },
  });
  return { ok: true };
}

/** Stop a class: cancels every upcoming session, tells everyone, keeps history. */
export async function endGroupClassCore(
  supabase: SupabaseClient,
  founderId: string,
  classId: string
): Promise<OpResult> {
  const { data: cls } = await supabase
    .from("classes")
    .select("id,title")
    .eq("id", classId)
    .maybeSingle();
  if (!cls) return { ok: false, error: "Class not found." };

  const { data: sessions } = await supabase
    .from("class_sessions")
    .select("id,coach_id")
    .eq("class_id", classId)
    .eq("status", "scheduled")
    .gt("starts_at", new Date().toISOString());
  const ids = (sessions ?? []).map((s) => s.id);

  await supabase
    .from("classes")
    .update({ active: false, ends_on: new Date().toISOString().slice(0, 10) })
    .eq("id", classId);

  if (ids.length) {
    const { data: bookings } = await supabase
      .from("bookings")
      .select("id,client_id")
      .in("session_id", ids)
      .in("status", ["confirmed", "waitlisted"]);

    await supabase
      .from("class_sessions")
      .update({ status: "cancelled", cancel_reason: "class ended" })
      .in("id", ids);

    const notified = new Set<string>();
    for (const b of bookings ?? []) {
      await supabase
        .from("bookings")
        .update({
          status: "cancelled_by_academy",
          cancelled_at: new Date().toISOString(),
          cancel_reason: "class ended",
        })
        .eq("id", b.id);
      if (notified.has(b.client_id)) continue;
      notified.add(b.client_id);
      await supabase.from("notifications").insert({
        user_id: b.client_id,
        type: "session_cancelled",
        title: "Class ended",
        body: `${cls.title} has finished its run. Your remaining sessions in it are cancelled — your allowance is unaffected.`,
        data: { url: "/app/book" },
      });
    }
    const coachIds = new Set(
      (sessions ?? []).map((s) => s.coach_id).filter((c): c is string => !!c)
    );
    for (const coachId of coachIds) {
      await supabase.from("notifications").insert({
        user_id: coachId,
        type: "session_cancelled",
        title: "Class ended",
        body: `${cls.title} has ended — its sessions are off your calendar.`,
        data: { url: "/coach" },
      });
    }
  }

  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "class.end",
    entity: "classes",
    entity_id: classId,
    meta: { cancelled_sessions: ids.length },
  });
  return { ok: true };
}

/** Hard delete — only for classes nobody ever booked. */
export async function deleteGroupClassCore(
  supabase: SupabaseClient,
  founderId: string,
  classId: string
): Promise<OpResult> {
  const { data: sessions } = await supabase
    .from("class_sessions")
    .select("id")
    .eq("class_id", classId);
  const ids = (sessions ?? []).map((s) => s.id);
  if (ids.length) {
    const { count } = await supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .in("session_id", ids);
    if ((count ?? 0) > 0) {
      return {
        ok: false,
        error:
          "People have booked this class, so it can't be deleted. End it instead — history stays safe.",
      };
    }
  }
  const { error } = await supabase.from("classes").delete().eq("id", classId);
  if (error) return { ok: false, error: "Couldn't delete the class." };
  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "class.delete",
    entity: "classes",
    entity_id: classId,
  });
  return { ok: true };
}

export async function setClassActiveCore(
  supabase: SupabaseClient,
  founderId: string,
  classId: string,
  active: boolean
): Promise<OpResult> {
  const { error } = await supabase.from("classes").update({ active }).eq("id", classId);
  if (error) return { ok: false, error: "Couldn't update the class." };
  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: active ? "class.activate" : "class.deactivate",
    entity: "classes",
    entity_id: classId,
  });
  return { ok: true };
}

/** Refill the next 8 weeks of sessions for every running class. */
export async function topUpSessionsCore(
  supabase: SupabaseClient,
  founderId: string
): Promise<OpResult & { created?: number }> {
  const { data, error } = await supabase.rpc("generate_class_sessions", { p_weeks: 8 });
  if (error) return { ok: false, error: "Couldn't refresh sessions." };
  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "class.topup",
    entity: "classes",
    meta: { created: Number(data) || 0 },
  });
  return { ok: true, created: Number(data) || 0 };
}
