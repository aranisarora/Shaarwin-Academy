// Class lifecycle cores — shared by the admin server actions and the WhatsApp
// bot. Caller supplies the user-scoped client + founder id; RLS enforces.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { academyWallToUtc, utcToAcademyWall } from "@/lib/academy-time";
import { reassignSessionCore } from "@/lib/admin-ops-calendar";
import { toSkillLevel, type OpResult } from "@/lib/admin-ops-types";

const WEEKDAY_NUM: Record<string, number> = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 };
const WEEKDAY_LABEL: Record<string, string> = {
  MO: "Monday", TU: "Tuesday", WE: "Wednesday", TH: "Thursday",
  FR: "Friday", SA: "Saturday", SU: "Sunday",
};

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
  supabase: SupabaseClient<Database>,
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
      skill_level: toSkillLevel(input.skillLevel),
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

  // Capture the OLD slot before the loop below moves the sessions, so the
  // notification can say what the class changed FROM. Previously it only ever
  // said "has a new time or place — check your schedule", which forces the
  // member to go and diff it themselves. (notification-fix-plan 2.5.)
  const oldWeekdayCode = /BYDAY=([A-Z]{2})/.exec(cls.recurrence_rule ?? "")?.[1] ?? "";
  const firstOldWall = sessions?.[0] ? utcToAcademyWall(new Date(sessions[0].starts_at)) : null;
  const oldSlot =
    oldWeekdayCode && firstOldWall
      ? `${WEEKDAY_LABEL[oldWeekdayCode] ?? oldWeekdayCode}s at ${firstOldWall.time}`
      : null;
  const newSlot = `${WEEKDAY_LABEL[input.weekday] ?? input.weekday}s at ${input.time}`;
  const slotMoved = oldSlot !== null && oldSlot !== newSlot;
  const changed = {
    class_id: input.classId,
    class_title: input.title,
    old_slot: oldSlot,
    new_slot: newSlot,
    venue_changed: venueChanged,
  };

  // "Thursdays at 18:30 → Fridays at 18:30", "now at a new venue", or both.
  const whatChanged = slotMoved
    ? venueChanged
      ? `has moved from ${oldSlot} to ${newSlot}, and is at a new venue`
      : `has moved from ${oldSlot} to ${newSlot}`
    : venueChanged
      ? `is at a new venue (still ${newSlot})`
      : "has changed";

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
      // A school player's booking has no account behind it — nobody to notify.
      if (b.client_id === null) continue;
      if (notified.has(b.client_id)) continue;
      notified.add(b.client_id);
      await supabase.from("notifications").insert({
        user_id: b.client_id,
        type: "class_updated",
        title: "Class schedule changed",
        body: `${input.title} ${whatChanged} — check your schedule.`,
        data: { ...changed, url: "/app/schedule" },
      });
    }
    for (const coachId of affectedCoaches) {
      await supabase.from("notifications").insert({
        user_id: coachId,
        type: "class_updated",
        title: "Class schedule changed",
        body: `${input.title} ${whatChanged} — check your calendar.`,
        data: { ...changed, url: "/coach" },
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
  supabase: SupabaseClient<Database>,
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
      // The booking is still cancelled above; only the notification needs an
      // account holder, which a school player's booking doesn't have.
      if (b.client_id === null) continue;
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

/**
 * Put one coach on every upcoming session of a class. Each session goes
 * through the normal reassignment rules (with the founder's force override);
 * sessions the coach genuinely can't take (hard time clash) are skipped and
 * counted rather than failing the whole change.
 */
export async function reassignClassCoachCore(
  supabase: SupabaseClient<Database>,
  founderId: string,
  classId: string,
  coachId: string,
  lock: boolean,
  force = false
): Promise<OpResult & { changed?: number; skipped?: number }> {
  const { data: sessions } = await supabase
    .from("class_sessions")
    .select("id,coach_id")
    .eq("class_id", classId)
    .eq("status", "scheduled")
    .gt("starts_at", new Date().toISOString())
    .order("starts_at");
  if (!sessions?.length)
    return { ok: false, error: "No upcoming sessions to assign the coach to." };

  let changed = 0;
  let skipped = 0;
  let firstFilterError: string | undefined;
  for (const s of sessions) {
    if (s.coach_id === coachId) {
      changed += 1;
      continue;
    }
    const r = await reassignSessionCore(supabase, founderId, s.id, coachId, lock, force);
    if (r.ok) changed += 1;
    else {
      skipped += 1;
      if (r.code === "filter_failed" && !firstFilterError) firstFilterError = r.error;
    }
  }

  // All blocked by the rules and no force yet — let the caller offer override.
  if (changed === 0 && firstFilterError && !force)
    return { ok: false, code: "filter_failed", error: firstFilterError };
  if (changed === 0) return { ok: false, error: "Couldn't assign that coach to any session." };

  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "class.reassign_coach",
    entity: "classes",
    entity_id: classId,
    meta: { coach_id: coachId, changed, skipped, locked: lock },
  });
  return { ok: true, changed, skipped };
}

/**
 * Bring an ended class back: reactivate it, revive the future sessions that
 * "end class" cancelled, and top up the 8-week horizon. Bookings cancelled by
 * the ending are not resurrected — clients were already told to rebook.
 */
export async function restoreGroupClassCore(
  supabase: SupabaseClient<Database>,
  founderId: string,
  classId: string
): Promise<OpResult> {
  const { data: cls } = await supabase
    .from("classes")
    .select("id,title,active,ends_on")
    .eq("id", classId)
    .eq("class_type", "group")
    .maybeSingle();
  if (!cls) return { ok: false, error: "Class not found." };
  if (cls.active && !cls.ends_on) return { ok: false, error: "This class is already running." };

  const { error: clsErr } = await supabase
    .from("classes")
    .update({ active: true, ends_on: null })
    .eq("id", classId);
  if (clsErr) return { ok: false, error: "Couldn't restore the class." };

  // Future sessions cancelled by "end class" come back as scheduled — they
  // would otherwise block generate_class_sessions from refilling those slots.
  const { data: revived } = await supabase
    .from("class_sessions")
    .update({ status: "scheduled", cancel_reason: null })
    .eq("class_id", classId)
    .eq("status", "cancelled")
    .eq("cancel_reason", "class ended")
    .gt("starts_at", new Date().toISOString())
    .select("id,coach_id");

  // Fill any weeks still missing (and let the engine assign coaches).
  await supabase.rpc("generate_class_sessions", { p_weeks: 8 });

  const coachIds = new Set(
    (revived ?? []).map((s) => s.coach_id).filter((c): c is string => !!c)
  );
  for (const coachId of coachIds) {
    await supabase.from("notifications").insert({
      user_id: coachId,
      type: "session_booked",
      title: "Class restored",
      body: `${cls.title} is back on — its sessions are on your calendar again.`,
      data: { url: "/coach" },
    });
  }

  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "class.restore",
    entity: "classes",
    entity_id: classId,
    meta: { revived_sessions: (revived ?? []).length },
  });
  return { ok: true };
}

/**
 * Booking statuses that are a real record of someone's place in a class, and so
 * are worth refusing to destroy. A cancelled booking is not one: it says
 * somebody once held a spot and gave it up, which is not attendance history and
 * shouldn't make a class undeletable forever.
 */
const HISTORIC_BOOKING_STATUSES = [
  "confirmed",
  "waitlisted",
  "attended",
  "no_show",
  "rescheduled",
] as const;

/** A class is "ended" (rather than merely paused) exactly as the UI reads it. */
const isEnded = (c: { active: boolean; ends_on: string | null }) => !c.active && !!c.ends_on;

/**
 * Hard delete. Safe when the class carries no booking history; when it does,
 * deleting cascades that history away, so it is allowed only for a class that
 * has already been *ended* and only with `force` — the founder saying "I don't
 * want this record either". A running class must be ended first.
 */
export async function deleteGroupClassCore(
  supabase: SupabaseClient<Database>,
  founderId: string,
  classId: string,
  force = false
): Promise<OpResult> {
  const { data: cls } = await supabase
    .from("classes")
    .select("id,active,ends_on")
    .eq("id", classId)
    .maybeSingle();
  if (!cls) return { ok: false, error: "Class not found." };

  const { data: sessions } = await supabase
    .from("class_sessions")
    .select("id")
    .eq("class_id", classId);
  const ids = (sessions ?? []).map((s) => s.id);
  let historic = 0;
  for (const part of chunked(ids)) {
    const { count } = await supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .in("session_id", part)
      .in("status", HISTORIC_BOOKING_STATUSES);
    historic += count ?? 0;
  }

  if (historic > 0 && !(isEnded(cls) && force)) {
    return {
      ok: false,
      // Never tell someone to end a class they have already ended — that was a
      // dead end with no way out of the list.
      error: isEnded(cls)
        ? `This class has ${historic} booking${historic === 1 ? "" : "s"} on record. Deleting it removes ${historic === 1 ? "that" : "those"} too — confirm to delete it and its history.`
        : "People are booked on this class, so it can't be deleted. End it instead — history stays safe, and you can delete it afterwards.",
      code: isEnded(cls) ? "needs_force" : "has_bookings",
    };
  }

  const { error } = await supabase.from("classes").delete().eq("id", classId);
  if (error) return { ok: false, error: "Couldn't delete the class." };
  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "class.delete",
    entity: "classes",
    entity_id: classId,
    meta: { purged_bookings: historic },
  });
  return { ok: true };
}

/**
 * Split a selection three ways, so the confirm step can say exactly what each
 * class is about to get and never offer a button that can't work:
 *
 *   deletable — no booking history, goes for good, nobody is told
 *   endable   — still running with people on it; must be ended (they're told)
 *   purgeable — already ended, but still holds history; deleting destroys it
 *
 * The third bucket is the one that used to be a dead end: an ended class with
 * an old booking could neither be deleted (guard) nor ended again (already
 * done), so it sat on the list forever with no way off.
 */
export type ClassRemovalPlan = {
  deletable: string[];
  endable: string[];
  purgeable: string[];
  /** What deleting the `purgeable` classes would destroy, for the warning copy. */
  purgeCost: { sessions: number; bookings: number };
};

export async function planClassRemovalCore(
  supabase: SupabaseClient<Database>,
  classIds: string[]
): Promise<ClassRemovalPlan> {
  const empty = { deletable: [], endable: [], purgeable: [], purgeCost: { sessions: 0, bookings: 0 } };
  if (!classIds.length) return empty;

  const { data: classes } = await supabase
    .from("classes")
    .select("id,active,ends_on")
    .in("id", classIds);
  if (!classes?.length) return empty;

  // One query, not one per class: every booking that counts as history whose
  // session belongs to the selection, narrowed to the owning class id. `!inner`
  // makes the embed a join so the filter applies to class_sessions rather than
  // to the bookings rows.
  const { data } = await supabase
    .from("bookings")
    .select("id,class_sessions!inner(class_id)")
    .in("class_sessions.class_id", classIds)
    .in("status", HISTORIC_BOOKING_STATUSES);

  const withHistory = new Set<string>();
  for (const b of data ?? []) {
    const cs = b.class_sessions as unknown as { class_id: string | null } | null;
    if (cs?.class_id) withHistory.add(cs.class_id);
  }

  const deletable: string[] = [];
  const endable: string[] = [];
  const purgeable: string[] = [];
  for (const c of classes) {
    if (!withHistory.has(c.id)) deletable.push(c.id);
    else if (isEnded(c)) purgeable.push(c.id);
    else endable.push(c.id);
  }

  // Only the purge needs a price tag — the other two buckets destroy nothing
  // the founder would miss.
  let sessions = 0;
  let bookings = 0;
  if (purgeable.length) {
    const { count: sc } = await supabase
      .from("class_sessions")
      .select("id", { count: "exact", head: true })
      .in("class_id", purgeable);
    sessions = sc ?? 0;
    const { count: bc } = await supabase
      .from("bookings")
      .select("id,class_sessions!inner(class_id)", { count: "exact", head: true })
      .in("class_sessions.class_id", purgeable);
    bookings = bc ?? 0;
  }

  return { deletable, endable, purgeable, purgeCost: { sessions, bookings } };
}

/** PostgREST puts `.in()` lists in the query string, so a selection worth of
 * session ids can outgrow the URL. Every filter below that takes ids derived
 * from the selection (rather than the selection itself) goes through here. */
const ID_CHUNK = 100;
function chunked<T>(xs: T[], size = ID_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

/**
 * End several classes as ONE operation: cancel every upcoming session across
 * all of them, then tell each affected person once.
 *
 * Deliberately not a loop over `endGroupClassCore`. `session_cancelled` has no
 * collapse at the queue site (unlike `coach_changed`, which migration 0043
 * merges per user per day) and it is a TRANSACTIONAL type, so it skips quiet
 * hours and the daily send cap. Looping would therefore text a parent booked
 * into eight of the ended classes eight separate times, instantly, possibly at
 * 2am — the exact failure the Jul 22 mass-reassignment produced. Grouping the
 * recipients here keeps the guarantee at one message per household per bulk
 * operation, and collapses the round trips at the same time.
 */
export async function endGroupClassesCore(
  supabase: SupabaseClient<Database>,
  founderId: string,
  classIds: string[]
): Promise<OpResult & { ended?: number; cancelledSessions?: number }> {
  if (!classIds.length) return { ok: true, ended: 0, cancelledSessions: 0 };

  const { data: classes } = await supabase
    .from("classes")
    .select("id,title")
    .in("id", classIds)
    .eq("class_type", "group");
  if (!classes?.length) return { ok: false, error: "No classes found." };
  const titleById = new Map(classes.map((c) => [c.id, c.title]));
  const ids = classes.map((c) => c.id);

  const nowIso = new Date().toISOString();
  const { data: sessions } = await supabase
    .from("class_sessions")
    .select("id,class_id,coach_id")
    .in("class_id", ids)
    .eq("status", "scheduled")
    .gt("starts_at", nowIso);
  const sessionIds = (sessions ?? []).map((s) => s.id);

  await supabase
    .from("classes")
    .update({ active: false, ends_on: nowIso.slice(0, 10) })
    .in("id", ids);

  // Which classes each person is affected by, so their one message can name a
  // class and count the rest — same grammar as the collapsed coach_changed row.
  const classesByClient = new Map<string, Set<string>>();
  const classesByCoach = new Map<string, Set<string>>();

  if (sessionIds.length) {
    const classBySession = new Map((sessions ?? []).map((s) => [s.id, s.class_id]));

    const bookings: { id: string; client_id: string | null; session_id: string }[] = [];
    for (const part of chunked(sessionIds)) {
      const { data } = await supabase
        .from("bookings")
        .select("id,client_id,session_id")
        .in("session_id", part)
        .in("status", ["confirmed", "waitlisted"]);
      bookings.push(...(data ?? []));
    }

    for (const part of chunked(sessionIds)) {
      await supabase
        .from("class_sessions")
        .update({ status: "cancelled", cancel_reason: "class ended" })
        .in("id", part);
    }

    // One update per chunk rather than per booking — the previous per-row loop
    // was the slowest part of ending a single class.
    const bookingIds = bookings.map((b) => b.id);
    for (const part of chunked(bookingIds)) {
      await supabase
        .from("bookings")
        .update({
          status: "cancelled_by_academy",
          cancelled_at: nowIso,
          cancel_reason: "class ended",
        })
        .in("id", part);
    }

    for (const b of bookings) {
      // School players have no account holder — the booking still cancels
      // above, there is just nobody to message.
      if (!b.client_id) continue;
      const clsId = classBySession.get(b.session_id);
      if (!clsId) continue;
      (classesByClient.get(b.client_id) ?? classesByClient.set(b.client_id, new Set()).get(b.client_id)!).add(clsId);
    }
    for (const s of sessions ?? []) {
      if (!s.coach_id) continue;
      (classesByCoach.get(s.coach_id) ?? classesByCoach.set(s.coach_id, new Set()).get(s.coach_id)!).add(s.class_id);
    }
  }

  /** "Monday 6pm Andheri and 3 other classes" — names one, counts the rest. */
  const subject = (clsIds: Set<string>) => {
    const [first] = [...clsIds];
    const title = titleById.get(first) ?? "Your class";
    const rest = clsIds.size - 1;
    if (rest <= 0) return title;
    return `${title} and ${rest} other ${rest === 1 ? "class" : "classes"}`;
  };

  for (const [clientId, clsIds] of classesByClient) {
    const many = clsIds.size > 1;
    await supabase.from("notifications").insert({
      user_id: clientId,
      type: "session_cancelled",
      title: many ? "Classes ended" : "Class ended",
      body: `${subject(clsIds)} ${many ? "have" : "has"} finished ${many ? "their" : "its"} run. Your remaining sessions in ${many ? "them" : "it"} are cancelled — your allowance is unaffected.`,
      data: { url: "/app/book", class_count: clsIds.size, collapsed: many },
    });
  }
  for (const [coachId, clsIds] of classesByCoach) {
    const many = clsIds.size > 1;
    await supabase.from("notifications").insert({
      user_id: coachId,
      type: "session_cancelled",
      title: many ? "Classes ended" : "Class ended",
      body: `${subject(clsIds)} ${many ? "have" : "has"} ended — ${many ? "their" : "its"} sessions are off your calendar.`,
      data: { url: "/coach", class_count: clsIds.size, collapsed: many },
    });
  }

  return { ok: true, ended: ids.length, cancelledSessions: sessionIds.length };
}

/**
 * Clear a whole selection of weekly classes in one go — the founder resetting a
 * timetable rather than correcting one class.
 *
 * Classes with no booking history are deleted outright, always. The two risky
 * buckets are opt-in and independent: `endBooked` ends the running classes
 * people are on (telling each person once, via `endGroupClassesCore`), and
 * `purgeEnded` deletes already-ended classes together with the history they
 * still hold. Anything the founder didn't opt into is left exactly as it was
 * and reported back as `kept`.
 */
export async function bulkRemoveClassesCore(
  supabase: SupabaseClient<Database>,
  founderId: string,
  classIds: string[],
  opts: { endBooked?: boolean; purgeEnded?: boolean } = {}
): Promise<OpResult & { deleted?: number; ended?: number; purged?: number; kept?: number }> {
  if (!classIds.length) return { ok: false, error: "Nothing selected." };
  const { endBooked = false, purgeEnded = false } = opts;
  const plan = await planClassRemovalCore(supabase, classIds);

  const toDelete = [...plan.deletable, ...(purgeEnded ? plan.purgeable : [])];
  let removed = 0;
  if (toDelete.length) {
    const { data, error } = await supabase
      .from("classes")
      .delete()
      .in("id", toDelete)
      .select("id");
    if (error) return { ok: false, error: "Couldn't delete the classes." };
    removed = (data ?? []).length;
  }
  // Report the two kinds separately — "3 deleted" and "2 ended classes wiped
  // along with their history" are very different sentences.
  const purged = purgeEnded ? Math.min(removed, plan.purgeable.length) : 0;
  const deleted = removed - purged;

  let ended = 0;
  if (endBooked && plan.endable.length) {
    const r = await endGroupClassesCore(supabase, founderId, plan.endable);
    if (!r.ok && !removed) return { ok: false, error: r.error ?? "Couldn't end those classes." };
    ended = r.ended ?? 0;
  }

  const kept =
    (endBooked ? plan.endable.length - ended : plan.endable.length) +
    (purgeEnded ? plan.purgeable.length - purged : plan.purgeable.length);

  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "class.bulk_remove",
    entity: "classes",
    meta: { selected: classIds.length, deleted, ended, purged, kept },
  });

  return { ok: true, deleted, ended, purged, kept };
}

export async function setClassActiveCore(
  supabase: SupabaseClient<Database>,
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
  supabase: SupabaseClient<Database>,
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
