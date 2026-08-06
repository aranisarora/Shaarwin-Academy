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

  const nowIso = new Date().toISOString();
  const { data: sessions } = await supabase
    .from("class_sessions")
    .select("id,coach_id")
    .eq("class_id", classId)
    .eq("status", "scheduled")
    .gt("starts_at", nowIso);
  const ids = (sessions ?? []).map((s) => s.id);

  await supabase
    .from("classes")
    .update({ active: false, ends_on: nowIso.slice(0, 10) })
    .eq("id", classId);

  await settlePastSessions(supabase, [classId], nowIso);

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
 * Two very different things live in `bookings.status`, and the delete guard has
 * to tell them apart or it ends up protecting nothing that matters and blocking
 * things that don't.
 *
 * A RECORD — attended, no_show, rescheduled — is somebody having written down
 * what actually happened. Deleting the class throws that away, so it is always
 * worth asking about.
 *
 * A HELD PLACE — confirmed, waitlisted — is only a claim on a session that
 * hasn't happened yet. Once that session's hour has passed with nobody marking
 * a register, the row means neither thing any more: nobody is waiting for it,
 * and nobody wrote down whether they came. Two classes on prod rotted in
 * exactly that state — ended in August, each still holding one 'confirmed'
 * booking on a session from July that nothing ever settled — and the old guard
 * read that leftover as live history and would not let either class go. So a
 * held place counts only while the session it holds is still ahead of us.
 *
 * Which leaves the third count, LAPSED, and the reason it has to exist rather
 * than just falling off the end of the sum. A held place on a session already
 * behind us should not pin a class to the list — but it is still a row about a
 * child, and it does not stop being one because nobody marked the register.
 * `sweep_session_status` now runs hourly, but it closes the *session* and
 * deliberately stops there — it no longer guesses at the register. So a held
 * place on a session that has been and gone stays exactly that, and this is the
 * ordinary end-state of a class rather than a rare rot: dozens of prod bookings
 * sit 'confirmed' on sessions long past. Counting them as nothing at all made
 * the screen say
 * "no bookings — nobody is messaged" over a class whose whole attendance
 * history one tap would destroy. So we count them separately: they don't block
 * the delete, they just stop us calling the class empty.
 *
 * A cancelled booking counts as neither: it says somebody once had a spot and
 * gave it up, which is not attendance and shouldn't pin a class to the list.
 */
const RECORDED_BOOKING_STATUSES = ["attended", "no_show", "rescheduled"] as const;
const HELD_BOOKING_STATUSES = ["confirmed", "waitlisted"] as const;

/** What one class holds, split the three ways the copy has to talk about it. */
type BookingWeight = { recorded: number; held: number; lapsed: number };

/**
 * How much every class in a selection holds, in one pair of queries rather than
 * two per class. `!inner` makes the embed a join so the filters land on
 * class_sessions rather than on the bookings rows.
 */
async function classBookingWeights(
  supabase: SupabaseClient<Database>,
  classIds: string[]
): Promise<Map<string, BookingWeight>> {
  const weights = new Map<string, BookingWeight>();
  if (!classIds.length) return weights;
  const nowIso = new Date().toISOString();

  const owningClass = (row: { class_sessions: unknown }) =>
    (row.class_sessions as { class_id: string | null } | null)?.class_id ?? null;
  const bump = (classId: string, kind: keyof BookingWeight) => {
    const w = weights.get(classId) ?? { recorded: 0, held: 0, lapsed: 0 };
    w[kind] += 1;
    weights.set(classId, w);
  };

  for (const part of chunked(classIds)) {
    const { data: recorded } = await supabase
      .from("bookings")
      .select("id,class_sessions!inner(class_id)")
      .in("class_sessions.class_id", part)
      .in("status", RECORDED_BOOKING_STATUSES);
    for (const b of recorded ?? []) {
      const id = owningClass(b);
      if (id) bump(id, "recorded");
    }

    // One query for both sides of the same row, split here rather than by two
    // opposite `starts_at` filters — the cut has to be the same instant for
    // "still ahead of us" and "already behind us" or a session on the boundary
    // is counted twice or not at all.
    const { data: held } = await supabase
      .from("bookings")
      .select("id,class_sessions!inner(class_id,starts_at)")
      .in("class_sessions.class_id", part)
      .in("status", HELD_BOOKING_STATUSES);
    for (const b of held ?? []) {
      const s = b.class_sessions as unknown as {
        class_id: string | null;
        starts_at: string;
      } | null;
      if (s?.class_id) bump(s.class_id, s.starts_at > nowIso ? "held" : "lapsed");
    }
  }
  return weights;
}

/**
 * Cancelling the future is only half of ending a class. The other half is the
 * past: a session whose hour came and went while nobody marked a register is
 * still sitting at 'scheduled', which every screen in the app reads as "this is
 * still to come", and the confirmed bookings hanging off it read as places
 * somebody is still holding in a class that stopped running. That is how two
 * classes ended in August ended up pinned to the list by one booking on a
 * session from July.
 *
 * So ending settles those sessions as completed — the honest half, because the
 * hour genuinely did pass. Their bookings are left exactly as they are. Whether
 * a child actually turned up is not something we can work out at the moment
 * somebody clears a timetable. Nothing decides that for us any more either:
 * `sweep_session_status` used to default an unmarked register to attended after
 * 48 hours, and that half was deliberately dropped when it was scheduled,
 * because inventing a register feeds parents' attendance figures and the
 * school's view of its own pupils. An unmarked session stays unmarked. What we
 * do instead is stop
 * *counting* a held place on a session that is already behind us as though it
 * were live — see the two status lists above.
 *
 * The cut is `ends_at`, the same one the sweep uses, not `starts_at`: a session
 * that is halfway through when the founder ends the class is neither cancelled
 * (it's happening) nor finished, and calling it completed would take it off the
 * coach's screen while he is still standing in the hall.
 */
async function settlePastSessions(
  supabase: SupabaseClient<Database>,
  classIds: string[],
  nowIso: string
): Promise<void> {
  for (const part of chunked(classIds)) {
    await supabase
      .from("class_sessions")
      .update({ status: "completed" })
      .in("class_id", part)
      .eq("status", "scheduled")
      .lt("ends_at", nowIso);
  }
}

/** A class is "ended" (rather than merely paused) exactly as the UI reads it. */
const isEnded = (c: { active: boolean; ends_on: string | null }) => !c.active && !!c.ends_on;

/**
 * Hard delete. Safe when the class carries nothing worth keeping; when it does,
 * deleting cascades that away, so it asks for `force` — the founder saying "I
 * don't want this record either".
 *
 * `force` clears the guard for a *running* class too. The founder is the admin
 * and must be able to remove any class outright, but a class people are booked
 * on cannot simply vanish: we end it first, which cancels its upcoming sessions
 * and sends everyone affected exactly one message, and only then delete it. So
 * the destructive path still owes the same courtesy the safe path does — it
 * just no longer takes two separate trips through the UI to get there.
 */
export async function deleteGroupClassCore(
  supabase: SupabaseClient<Database>,
  founderId: string,
  classId: string,
  force = false
): Promise<OpResult & { cancelledBookings?: number; unmarkedBookings?: number }> {
  // Group only, and the same filter the plan uses. `endGroupClassesCore` ends
  // group classes and nothing else, so anything this function will hand it has
  // to have been filtered the same way or the two disagree about what exists.
  const { data: cls } = await supabase
    .from("classes")
    .select("id,active,ends_on")
    .eq("id", classId)
    .eq("class_type", "group")
    .maybeSingle();
  if (!cls) return { ok: false, error: "Class not found." };

  const weight = (await classBookingWeights(supabase, [classId])).get(classId) ?? {
    recorded: 0,
    held: 0,
    lapsed: 0,
  };
  const historic = weight.recorded + weight.held;
  // Lapsed places don't stand in the way of the delete — that is the whole
  // point of counting them apart — but they do go with it, so the audit row and
  // the ✓ line both have to know they existed.
  const destroyed = historic + weight.lapsed;

  if (historic > 0 && !force) {
    // Both branches are recoverable now — each names its cost and asks once
    // more. Neither is a dead end: the running class used to say "end it
    // instead", which left the founder two operations away from a delete he
    // had already asked for twice.
    return {
      ok: false,
      error:
        weight.held > 0
          ? `This class still has ${weight.held} live booking${weight.held === 1 ? "" : "s"} on it. Deleting it cancels those sessions, tells everyone affected once, and removes ${historic} booking${historic === 1 ? "" : "s"} of history for good.`
          : `This class has ${historic} booking${historic === 1 ? "" : "s"} on record. Deleting it removes ${historic === 1 ? "that" : "those"} too — confirm to delete it and its history.`,
      code: "needs_force",
    };
  }

  // A running class people still hold places in is ended before it is deleted,
  // so its members get the cancellation they are owed. `endGroupClassesCore`
  // collapses that to one message per person however many sessions they held.
  // Here the end has to succeed: deleting the class while the message failed
  // would take their sessions away without a word, which is the one outcome
  // this whole path exists to prevent.
  if (weight.held > 0 && !isEnded(cls)) {
    const ending = await endGroupClassesCore(supabase, founderId, [classId]);
    if (!ending.ok) {
      return { ok: false, error: ending.error ?? "Couldn't cancel the sessions first." };
    }
  }

  // Ask for the deleted rows back. A delete that matches nothing is not an
  // error to PostgREST, so without the `.select()` this reported success while
  // the class stayed exactly where it was — the silent no-op the founder kept
  // meeting.
  const { data: removed, error } = await supabase
    .from("classes")
    .delete()
    .eq("id", classId)
    .select("id");
  if (error) return { ok: false, error: "Couldn't delete the class." };
  if (!removed?.length)
    return { ok: false, error: "That class is no longer there — refresh the list." };
  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "class.delete",
    entity: "classes",
    entity_id: classId,
    meta: { purged_bookings: destroyed, cancelled_bookings: weight.held },
  });
  // These two let the sheet's ✓ line be true in all three cases: a class people
  // were on has to say they were told, one nobody was on must not claim a
  // message that never went, and one carrying only unmarked registers must not
  // claim nobody was ever booked on it.
  return {
    ok: true,
    cancelledBookings: isEnded(cls) ? 0 : weight.held,
    unmarkedBookings: weight.lapsed,
  };
}

/**
 * Split a selection four ways, so the confirm step can say exactly what each
 * class is about to get and never offer a button that can't work:
 *
 *   deletable        — stopped, and nobody is holding a place in it; goes for
 *                      good on the plain button, nobody is told
 *   deletableRunning — still running, but nobody has booked it yet; goes only
 *                      if the founder ticks for it, and the coaches rostered on
 *                      its remaining hours are told before it goes
 *   endable          — still running and holds bookings; ended (everyone on it
 *                      is told), and deleted too if the founder asks for that
 *   purgeable        — already ended, but still holds history; deleting
 *                      destroys it
 *
 * Every bucket can leave the list. That wasn't always true: an ended class with
 * an old booking could once neither be deleted (guard) nor ended again (already
 * done), and a running one could only ever be ended — so either way a class
 * could sit there with no way off.
 *
 * The line between the first two buckets is the one that matters most, and I
 * put it in the wrong place. "Nothing booked" says nothing at all about whether
 * a class is alive: a school class runs on a register a coach marks in the
 * hall, so a whole term of TCIS, Neev, Christ University, Raya, Vagdevi,
 * Valistus and Aspire Bee sessions looks — to a count of bookings — exactly
 * like a husk somebody created by mistake. On prod that put 36 running classes
 * — 28 of them school classes — into a bucket that deletes with no tick and no
 * warning, one tap behind "Select all 47". So the bucket splits on `active`. A
 * class that has stopped and holds nothing is still the ordinary case and still
 * goes in one tap; a class that is still on the timetable has to be asked for by
 * name, however empty it looks.
 *
 * "Deletable" is deliberately not the same as "empty" either: a class can land
 * in either bucket still carrying held places on sessions that came and went
 * unmarked. It goes without a warning because nothing about it is live, but
 * `purgeCost.unmarked` counts what goes with it so the confirm step never
 * claims there was nothing.
 */
export type ClassRemovalPlan = {
  deletable: string[];
  deletableRunning: string[];
  endable: string[];
  purgeable: string[];
  /** The price of each destructive bucket, for the warning copy: `sessions` and
   * `bookings` are what deleting the `purgeable` classes destroys; `unmarked` is
   * what the plain `deletable` ones still carry; the `running*` pair is what the
   * opt-in running bucket takes with it — the sessions still ahead of it on the
   * schedule, and any places on hours that came and went unmarked. */
  purgeCost: {
    sessions: number;
    bookings: number;
    unmarked: number;
    runningSessions: number;
    runningUnmarked: number;
  };
};

const NO_PURGE_COST = {
  sessions: 0,
  bookings: 0,
  unmarked: 0,
  runningSessions: 0,
  runningUnmarked: 0,
};

export async function planClassRemovalCore(
  supabase: SupabaseClient<Database>,
  classIds: string[]
): Promise<ClassRemovalPlan> {
  const empty = {
    deletable: [],
    deletableRunning: [],
    endable: [],
    purgeable: [],
    purgeCost: NO_PURGE_COST,
  };
  if (!classIds.length) return empty;

  // Group classes only. The buckets feed straight into `endGroupClassesCore`,
  // which ends group classes and refuses outright when it is handed a list that
  // matches none — so a single private or school id slipping into `endable`
  // used to abort a removal that had nothing to do with it.
  const classes: { id: string; active: boolean; ends_on: string | null }[] = [];
  for (const part of chunked(classIds)) {
    const { data } = await supabase
      .from("classes")
      .select("id,active,ends_on")
      .in("id", part)
      .eq("class_type", "group");
    classes.push(...(data ?? []));
  }
  if (!classes.length) return empty;

  const weights = await classBookingWeights(
    supabase,
    classes.map((c) => c.id)
  );

  const deletable: string[] = [];
  const deletableRunning: string[] = [];
  const endable: string[] = [];
  const purgeable: string[] = [];
  for (const c of classes) {
    const w = weights.get(c.id);
    if (!w || w.recorded + w.held === 0) (c.active ? deletableRunning : deletable).push(c.id);
    else if (isEnded(c)) purgeable.push(c.id);
    else endable.push(c.id);
  }

  // What each unconditional-looking delete takes with it. Free — the weights are
  // already counted — and the one number standing between the founder and a card
  // that tells him these classes hold nothing.
  const lapsedIn = (ids: string[]) =>
    ids.reduce((n, id) => n + (weights.get(id)?.lapsed ?? 0), 0);
  const unmarked = lapsedIn(deletable);
  const runningUnmarked = lapsedIn(deletableRunning);

  // The purge needs a price tag of its own: `endable` is the only bucket that
  // destroys nothing on its own terms, because ending is reversible.
  let sessions = 0;
  let bookings = 0;
  for (const part of chunked(purgeable)) {
    const { count: sc } = await supabase
      .from("class_sessions")
      .select("id", { count: "exact", head: true })
      .in("class_id", part);
    sessions += sc ?? 0;
    const { count: bc } = await supabase
      .from("bookings")
      .select("id,class_sessions!inner(class_id)", { count: "exact", head: true })
      .in("class_sessions.class_id", part);
    bookings += bc ?? 0;
  }

  // A running class nobody has booked still has weeks of sessions ahead of it,
  // and those are the thing the founder will actually miss — the hall booked,
  // the coach rostered, the term already on the timetable. Counting them is what
  // lets the opt-in say how much of the schedule it is about to remove instead
  // of just how many rows. (On prod that is 261 hours behind one tick.)
  const nowIso = new Date().toISOString();
  let runningSessions = 0;
  for (const part of chunked(deletableRunning)) {
    const { count } = await supabase
      .from("class_sessions")
      .select("id", { count: "exact", head: true })
      .in("class_id", part)
      .eq("status", "scheduled")
      .gt("starts_at", nowIso);
    runningSessions += count ?? 0;
  }

  return {
    deletable,
    deletableRunning,
    endable,
    purgeable,
    purgeCost: { sessions, bookings, unmarked, runningSessions, runningUnmarked },
  };
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

  const classes: { id: string; title: string }[] = [];
  for (const part of chunked(classIds)) {
    const { data } = await supabase
      .from("classes")
      .select("id,title")
      .in("id", part)
      .eq("class_type", "group");
    classes.push(...(data ?? []));
  }
  if (!classes.length) return { ok: false, error: "No classes found." };
  const titleById = new Map(classes.map((c) => [c.id, c.title]));
  const ids = classes.map((c) => c.id);

  const nowIso = new Date().toISOString();
  const sessions: { id: string; class_id: string; coach_id: string | null }[] = [];
  for (const part of chunked(ids)) {
    const { data } = await supabase
      .from("class_sessions")
      .select("id,class_id,coach_id")
      .in("class_id", part)
      .eq("status", "scheduled")
      .gt("starts_at", nowIso);
    sessions.push(...(data ?? []));
  }
  const sessionIds = sessions.map((s) => s.id);

  for (const part of chunked(ids)) {
    await supabase
      .from("classes")
      .update({ active: false, ends_on: nowIso.slice(0, 10) })
      .in("id", part);
  }

  await settlePastSessions(supabase, ids, nowIso);

  // Which classes each person is affected by, so their one message can name a
  // class and count the rest — same grammar as the collapsed coach_changed row.
  const classesByClient = new Map<string, Set<string>>();
  const classesByCoach = new Map<string, Set<string>>();

  if (sessionIds.length) {
    const classBySession = new Map(sessions.map((s) => [s.id, s.class_id]));

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
    for (const s of sessions) {
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
 * Classes that have stopped and hold nothing are deleted outright, always —
 * clearing away husks is the ordinary job and it stays one tap. Every bucket
 * with a cost is opt-in: `deleteRunningEmpty` removes classes still on the
 * timetable that simply haven't been booked into (telling the coaches rostered
 * on them), `endBooked` ends the running classes people hold places in (telling
 * each person once, via `endGroupClassesCore`), `deleteBooked` does the same and
 * then removes the class as well, and `purgeEnded` deletes already-ended classes
 * together with the history they still hold. Anything the founder didn't opt
 * into is left exactly as it was and reported back as `kept`.
 *
 * `deleteBooked` is the option that was missing. Without it a founder who
 * selected his whole timetable and ticked "also end" watched the running
 * classes stay on the list, because `endable` was the one bucket nothing could
 * ever delete — he had asked to remove them and the screen quietly did half of
 * it.
 *
 * `deleteRunningEmpty` is the opposite mistake, and the worse one: it used to
 * be no option at all, because a running class nobody had booked was counted as
 * a husk. See the plan above for why a school class always looks like one.
 *
 * It is also the bucket where "nobody is booked" and "nobody is affected" quietly
 * came apart. A class nobody has booked still has a coach standing in a hall for
 * it every week: the 36 on prod carry 261 future sessions between six of them.
 * Deleting a class takes its sessions with it, so those hours leave six calendars
 * — and the first cut of this shipped that in silence, under a line that said
 * nobody is messaged. So the running bucket is ended before it is deleted, in the
 * SAME call as `endBooked`, which is what keeps the guarantee at one message per
 * person for the whole operation: a coach who teaches both a booked class and an
 * empty one hears once, not twice.
 */
export async function bulkRemoveClassesCore(
  supabase: SupabaseClient<Database>,
  founderId: string,
  classIds: string[],
  opts: {
    endBooked?: boolean;
    purgeEnded?: boolean;
    deleteBooked?: boolean;
    deleteRunningEmpty?: boolean;
  } = {}
): Promise<
  OpResult & {
    deleted?: number;
    deletedRunning?: number;
    ended?: number;
    purged?: number;
    deletedBooked?: number;
    kept?: number;
    /** Why part of the selection didn't move, when the rest of it did. */
    warning?: string;
  }
> {
  if (!classIds.length) return { ok: false, error: "Nothing selected." };
  const {
    endBooked = false,
    purgeEnded = false,
    deleteBooked = false,
    deleteRunningEmpty = false,
  } = opts;
  const plan = await planClassRemovalCore(supabase, classIds);

  // Deleting a class people are on *is* ending it and then removing the record,
  // so `deleteBooked` implies `endBooked` — the cancellation message is not
  // optional just because the founder also wants the row gone.
  const endFirst = endBooked || deleteBooked;

  // Ending is the only thing here that tells anybody, so everything that owes a
  // message goes through it in ONE call — that call is where the collapse lives,
  // and two calls would text a coach who teaches classes in both buckets twice.
  // The running-but-empty classes are on this list for the coaches alone: nobody
  // holds a place in them, but somebody is rostered on every remaining hour.
  const toEnd = [
    ...(endFirst ? plan.endable : []),
    ...(deleteRunningEmpty ? plan.deletableRunning : []),
  ];

  // If the ending fails, the classes it would have ended are the only ones that
  // lose out: everything else in the selection is a delete that owes nobody a
  // message, and refusing to run those as well would mean one awkward class
  // holding back a whole timetable clear-out. So the failure is remembered
  // rather than thrown, and only the buckets that depended on it are dropped.
  let endError: string | undefined;
  if (toEnd.length) {
    const r = await endGroupClassesCore(supabase, founderId, toEnd);
    if (!r.ok) endError = r.error ?? "Couldn't end those classes.";
  }
  // Which classes were actually told about — the one honest basis for both
  // "ended" and "kept" below. Counting instead of subtracting matters: a class
  // that vanished between the plan and now used to make `ended - deletedBooked`
  // go negative.
  const endedIds = new Set(endError ? [] : toEnd);

  // Four buckets can be deleted in one statement, but they have to be counted
  // apart: "3 deleted", "36 running classes nobody had booked", "2 ended classes
  // wiped with their history" and "1 class people were on, cancelled and
  // deleted" are four different sentences and the founder is owed the right one.
  const buckets = {
    deleted: plan.deletable,
    deletedRunning: deleteRunningEmpty && !endError ? plan.deletableRunning : [],
    purged: purgeEnded ? plan.purgeable : [],
    deletedBooked: deleteBooked && !endError ? plan.endable : [],
  };
  const toDelete = [
    ...buckets.deleted,
    ...buckets.deletedRunning,
    ...buckets.purged,
    ...buckets.deletedBooked,
  ];

  const removedIds = new Set<string>();
  for (const part of chunked(toDelete)) {
    const { data, error } = await supabase
      .from("classes")
      .delete()
      .in("id", part)
      .select("id");
    // A delete that fails after the ending went through is not "nothing
    // happened": the sessions are cancelled and the messages are out. Saying so
    // is the difference between a founder retrying and a founder wondering why
    // his coaches were told about classes that are still on the list.
    if (error)
      return {
        ok: false,
        error: endedIds.size
          ? "Those classes were ended and everyone affected was told, but removing them failed. They're still on the list — try again."
          : "Couldn't delete the classes.",
      };
    for (const c of data ?? []) removedIds.add(c.id);
  }
  const countIn = (ids: string[]) => ids.filter((id) => removedIds.has(id)).length;
  const deleted = countIn(buckets.deleted);
  const deletedRunning = countIn(buckets.deletedRunning);
  const purged = countIn(buckets.purged);
  const deletedBooked = countIn(buckets.deletedBooked);

  // Nothing moved at all and the ending is why — that is a failure, and the
  // founder should hear the real reason rather than a cheerful "nothing changed".
  if (endError && removedIds.size === 0) return { ok: false, error: endError };

  // A class that was ended and then deleted is reported as deleted, not as
  // ended — it was both, and counting it twice would overstate what is left.
  const endedOnly = [...endedIds].filter((id) => !removedIds.has(id)).length;

  // "Kept" is simply what the founder still has: everything he picked that we
  // neither deleted nor ended.
  const kept = [
    ...plan.deletable,
    ...plan.deletableRunning,
    ...plan.purgeable,
    ...plan.endable,
  ].filter((id) => !removedIds.has(id) && !endedIds.has(id)).length;

  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "class.bulk_remove",
    entity: "classes",
    meta: {
      selected: classIds.length,
      deleted,
      deleted_running: deletedRunning,
      ended: endedOnly,
      purged,
      deletedBooked,
      kept,
    },
  });

  // When something else did move, the run is a success with a hole in it, and
  // the reason has to travel with the counts. Counts alone are the same silent
  // half-completion this work exists to remove: he ticks "also end them", the
  // ending fails, and the screen says "3 classes deleted. 2 were left alone."
  // — worst under deleteBooked, where classes he asked to DELETE come back as
  // "left alone" with nothing to explain why.
  return {
    ok: true,
    deleted,
    deletedRunning,
    ended: endedOnly,
    purged,
    deletedBooked,
    kept,
    warning: endError,
  };
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
