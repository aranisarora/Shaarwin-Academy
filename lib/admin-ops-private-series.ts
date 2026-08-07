// Weekly private slots — the standing arrangement behind a family's private
// sessions, and the other half of what the Weekly classes tab shows.
//
// A `private_booking_series` row is NOT a class. It has no foreign key to
// `classes` at all; it is a template that the nightly generator turns into one
// `class_type='private'` class per week. So its ids live in a different space
// from class ids and the two must never be merged into one selection: a series
// id handed to the class cores matches nothing, is silently dropped, and the
// founder is told "Nothing changed."
//
// The rule that governs everything in here: REMOVAL IS DEACTIVATION, NOT
// DELETION. `generate_private_sessions` loops `where active` under a nightly
// cron, and its regeneration guard only blocks a week that already carries a
// booking row. Deleting the weeks therefore removes the very thing that keeps
// them dead, and the slot is back within a day — with a fresh coach assignment
// and a fresh debit against the family's minutes. Retire the template first.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { OpResult } from "@/lib/admin-ops-types";
import { CancellationNotice } from "@/lib/admin-ops-removal-notice";
import { chunked } from "@/lib/admin-ops-chunk";
import {
  academyWallToUtc,
  formatSessionDate,
  shiftWallDate,
  utcToAcademyWall,
} from "@/lib/academy-time";

const WEEKDAY_LABEL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** "Monday 5:00 pm" — how a weekly slot names itself in a message. */
export function seriesLabel(weekday: number, startTime: string): string {
  const day = WEEKDAY_LABEL[weekday - 1] ?? "Weekly";
  const [hRaw, m] = String(startTime).slice(0, 5).split(":");
  const h = Number(hRaw);
  if (!Number.isFinite(h)) return `${day} private`;
  const suffix = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${day} ${h12}:${m} ${suffix}`;
}

/** What the founder can change about a standing slot. Undefined means "leave it". */
export type PrivateSeriesPatch = {
  /** ISO weekday, 1 = Monday. */
  weekday?: number;
  /** "HH:MM" academy wall clock. */
  startTime?: string;
  /** null hands the slot back to automatic assignment. */
  preferredCoach?: string | null;
};

/**
 * Move a family's standing weekly slot — and take the weeks already on the
 * calendar with it.
 *
 * The template alone is not the slot. `generate_private_sessions` materialises
 * `active` series into real sessions weeks ahead, and its regeneration guard
 * skips any week that already carries a booking. So updating only the row here
 * would leave every week already generated sitting at the OLD time, with new
 * weeks appearing at the new one — the family's Tuesday would be Tuesday until
 * some date in the future and Thursday after it, and nothing on any screen
 * would explain why. Whatever is already out there has to move too.
 *
 * ONE message per person, not one per week. Moving eight generated weeks
 * through `moveSessionCore` would be eight "your session moved" notifications
 * for a single decision — the founder changed one thing, so the family hears
 * one thing.
 *
 * Length and location are deliberately not here. Both change what the family is
 * charged or where a coach is sent, and both are set through the booking wizard
 * that geocodes an address — a slot that needs those changed is a slot to end
 * and re-book, and the panel says so rather than offering a Save that would
 * quietly do less than it looked like.
 */
export async function updatePrivateSeriesCore(
  supabase: SupabaseClient<Database>,
  founderId: string,
  seriesId: string,
  patch: PrivateSeriesPatch
): Promise<
  OpResult & {
    /** Generated weeks carried across to the new slot. */
    movedSessions?: number;
    /** Weeks whose new time clashed for the coach, so they lost him and go
     *  back through automatic assignment. */
    coachCleared?: number;
  }
> {
  const { data: series } = await supabase
    .from("private_booking_series")
    .select("id,active,weekday,start_time,duration_minutes,preferred_coach,client_id")
    .eq("id", seriesId)
    .maybeSingle();
  if (!series) return { ok: false, error: "That weekly slot is no longer there." };
  if (!series.active)
    return { ok: false, error: "That slot has ended. Restore it before changing it." };

  const oldWeekday = series.weekday;
  const oldTime = String(series.start_time).slice(0, 5);
  const newWeekday = patch.weekday ?? oldWeekday;
  const newTime = patch.startTime ?? oldTime;
  const coachChanged = patch.preferredCoach !== undefined;
  const newCoach = coachChanged ? patch.preferredCoach : series.preferred_coach;
  const slotMoved = newWeekday !== oldWeekday || newTime !== oldTime;

  if (!slotMoved && !coachChanged) return { ok: true, movedSessions: 0, coachCleared: 0 };

  const { error: updateErr } = await supabase
    .from("private_booking_series")
    .update({
      weekday: newWeekday,
      start_time: `${newTime}:00`,
      ...(coachChanged ? { preferred_coach: newCoach } : {}),
    })
    .eq("id", seriesId);
  if (updateErr) return { ok: false, error: "Couldn't change that weekly slot." };

  // The weeks already on the calendar. Reached through the booking, because
  // that is the only link a session has back to the series it came from.
  const nowIso = new Date().toISOString();
  const { data: bookingRows } = await supabase
    .from("bookings")
    .select("client_id,session_id,class_sessions!inner(id,starts_at,coach_id,status)")
    .eq("private_series_id", seriesId)
    .in("status", ["confirmed", "waitlisted"])
    .eq("class_sessions.status", "scheduled")
    .gt("class_sessions.starts_at", nowIso);

  const sessions = new Map<string, { startsAt: string; coachId: string | null }>();
  const clientIds = new Set<string>();
  for (const b of bookingRows ?? []) {
    const s = b.class_sessions as unknown as {
      id: string;
      starts_at: string;
      coach_id: string | null;
    } | null;
    if (!s) continue;
    sessions.set(s.id, { startsAt: s.starts_at, coachId: s.coach_id });
    if (b.client_id) clientIds.add(b.client_id);
  }

  // Every coach who had a week of this slot hears about it, plus whoever is
  // taking it from now on — the one losing it and the one gaining it are two
  // different people the moment the coach changes.
  const affectedCoaches = new Set<string>();
  for (const s of sessions.values()) if (s.coachId) affectedCoaches.add(s.coachId);

  let movedSessions = 0;
  let coachCleared = 0;
  const dayShift = newWeekday - oldWeekday;

  for (const [sessionId, s] of sessions) {
    const wall = utcToAcademyWall(new Date(s.startsAt));
    // Shift within the week the session already sits in, so a slot that moves
    // Tuesday → Thursday keeps its run of weeks rather than collapsing them all
    // onto the next single date.
    let newDate = shiftWallDate(wall.date, dayShift);
    let newStart = academyWallToUtc(newDate, newTime);
    // Moving earlier in the week can land a session in the past. Push that one
    // week on rather than failing the whole change or silently dropping it.
    if (newStart <= new Date()) {
      newDate = shiftWallDate(newDate, 7);
      newStart = academyWallToUtc(newDate, newTime);
    }
    const newEnd = new Date(newStart.getTime() + series.duration_minutes * 60000);

    const nextCoach = coachChanged ? newCoach : s.coachId;
    const base = {
      starts_at: newStart.toISOString(),
      ends_at: newEnd.toISOString(),
      ...(coachChanged ? { coach_id: nextCoach } : {}),
    };

    const { error } = await supabase.from("class_sessions").update(base).eq("id", sessionId);
    if (error) {
      // `coach_no_overlap` refused it — the coach is already teaching then.
      // Same fallback moveSessionCore uses: the week still moves, it just
      // arrives with nobody on it and goes back through assignment.
      const { error: retryErr } = await supabase
        .from("class_sessions")
        .update({ ...base, coach_id: null })
        .eq("id", sessionId);
      if (retryErr) continue;
      coachCleared += 1;
    }
    movedSessions += 1;
    if (nextCoach) affectedCoaches.add(nextCoach);
  }

  if (coachCleared > 0) await supabase.rpc("assign_unassigned_sessions");

  // ── One message each ───────────────────────────────────────────────────────
  const label = seriesLabel(newWeekday, newTime);
  const wasLabel = seriesLabel(oldWeekday, oldTime);
  const nextIso = [...sessions.keys()].length
    ? formatSessionDate(
        academyWallToUtc(
          shiftWallDate(
            utcToAcademyWall(
              new Date(
                [...sessions.values()].map((s) => s.startsAt).sort()[0] ?? nowIso
              )
            ).date,
            dayShift
          ),
          newTime
        )
      )
    : null;

  if (slotMoved) {
    for (const clientId of clientIds) {
      await supabase.from("notifications").insert({
        user_id: clientId,
        type: "session_moved",
        title: "Weekly session moved",
        body: `Your weekly private session has moved from ${wasLabel} to ${label}${
          nextIso ? `, starting ${nextIso}` : ""
        }.`,
        data: {
          series_id: seriesId,
          old_slot: wasLabel,
          new_slot: label,
          url: "/app/schedule",
        },
      });
    }
  }

  for (const coachId of affectedCoaches) {
    await supabase.from("notifications").insert({
      user_id: coachId,
      type: "session_moved",
      title: slotMoved ? "Weekly private slot moved" : "Weekly private slot reassigned",
      body: slotMoved
        ? `A weekly private has moved from ${wasLabel} to ${label}. Check your calendar.`
        : `A weekly private on ${label} has changed coach. Check your calendar.`,
      data: { series_id: seriesId, old_slot: wasLabel, new_slot: label, url: "/coach" },
    });
  }

  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "private_series.update",
    entity: "private_booking_series",
    entity_id: seriesId,
    meta: {
      old: { weekday: oldWeekday, start_time: oldTime, preferred_coach: series.preferred_coach },
      new: { weekday: newWeekday, start_time: newTime, preferred_coach: newCoach },
      moved_sessions: movedSessions,
      coach_cleared: coachCleared,
    },
  });

  return { ok: true, movedSessions, coachCleared };
}

/**
 * What ending a selection of weekly private slots would cost, so the confirm
 * step can say it before anything happens — the same job `ClassRemovalPlan`
 * does for the other id space.
 */
export type PrivateSeriesRemovalPlan = {
  /** active — the ones that will actually go. */
  endable: string[];
  /** already retired; ending them is a no-op, but they are still counted so the
   * founder is never told a number that silently excludes them. */
  alreadyEnded: string[];
  /** matched no row at all. Reported, never dropped. */
  missing: string[];
  cost: {
    futureSessions: number;
    minutesReturned: number;
    /** distinct families who get a message. */
    families: number;
    /** distinct coaches who get a message. */
    coaches: number;
  };
};

const EMPTY_PLAN: PrivateSeriesRemovalPlan = {
  endable: [],
  alreadyEnded: [],
  missing: [],
  cost: { futureSessions: 0, minutesReturned: 0, families: 0, coaches: 0 },
};

export async function planPrivateSeriesRemovalCore(
  supabase: SupabaseClient<Database>,
  seriesIds: string[]
): Promise<PrivateSeriesRemovalPlan> {
  if (!seriesIds.length) return EMPTY_PLAN;

  const rows: { id: string; active: boolean; client_id: string }[] = [];
  for (const part of chunked(seriesIds)) {
    const { data } = await supabase
      .from("private_booking_series")
      .select("id,active,client_id")
      .in("id", part);
    rows.push(...((data ?? []) as typeof rows));
  }

  const found = new Set(rows.map((r) => r.id));
  const endable = rows.filter((r) => r.active).map((r) => r.id);
  const alreadyEnded = rows.filter((r) => !r.active).map((r) => r.id);
  const missing = seriesIds.filter((id) => !found.has(id));

  // What the ending actually takes away: the weeks still ahead of us, the
  // minutes they cost, and who hears about it. Counted from the bookings rather
  // than from the series, because a slot that has not generated yet takes
  // nothing away and must not be priced as though it had.
  const nowIso = new Date().toISOString();
  const families = new Set<string>();
  const coaches = new Set<string>();
  let futureSessions = 0;
  let minutesReturned = 0;

  for (const part of chunked(endable)) {
    const { data } = await supabase
      .from("bookings")
      .select("client_id,class_sessions!inner(starts_at,coach_id,classes!inner(duration_minutes))")
      .in("private_series_id", part)
      .in("status", ["confirmed", "waitlisted"])
      .gt("class_sessions.starts_at", nowIso);
    for (const b of data ?? []) {
      const s = b.class_sessions as unknown as {
        coach_id: string | null;
        classes: { duration_minutes: number } | null;
      } | null;
      futureSessions += 1;
      if (b.client_id) {
        families.add(b.client_id);
        minutesReturned += s?.classes?.duration_minutes ?? 0;
      }
      if (s?.coach_id) coaches.add(s.coach_id);
    }
  }

  return {
    endable,
    alreadyEnded,
    missing,
    cost: { futureSessions, minutesReturned, families: families.size, coaches: coaches.size },
  };
}

/**
 * End weekly private slots as the ACADEMY.
 *
 * Deliberately NOT `cancel_private_series`. That RPC is the CLIENT's: it loops
 * `cancel_booking` over the future weeks, which writes 'cancelled_by_client',
 * messages only the coach — once per week, saying the client cancelled — tells
 * the family nothing at all, and refunds only outside the cancellation window,
 * so a founder ending a slot would silently burn the family's minutes for this
 * week. It also trips `ops_notify_booking_status`, which fires an
 * `ops_cancellation` per booking; that type and `session_cancelled` are both
 * transactional, so a handful of slots is a burst of uncapped, un-deferred
 * pushes at whatever hour the button was tapped.
 *
 * `end_private_series_as_academy` does the whole thing in one transaction —
 * retire the template, cancel the weeks as 'cancelled_by_academy' (the one
 * status the ops feed ignores), refund in full regardless of the window, drop
 * the reminders already queued — and deliberately sends NOTHING. It returns the
 * people affected instead, so they can be collapsed together with everybody
 * losing a group class in the same operation.
 */
export async function endPrivateSeriesCore(
  supabase: SupabaseClient<Database>,
  founderId: string,
  seriesIds: string[],
  /** When given, recipients accumulate here and nothing is sent — the caller
   * flushes once for the whole operation. Omitted, this makes its own and
   * flushes, so a standalone call still keeps the one-message guarantee. */
  notice?: CancellationNotice
): Promise<
  OpResult & {
    ended?: number;
    cancelled?: number;
    minutesReturned?: number;
    /** Slots that could not be ended, so the caller can say so rather than
     * quietly reporting a smaller number than the founder picked. */
    failed?: number;
  }
> {
  if (!seriesIds.length) return { ok: true, ended: 0, cancelled: 0, minutesReturned: 0 };

  const own = notice == null;
  const acc = notice ?? new CancellationNotice();

  let ended = 0;
  let cancelled = 0;
  let minutesReturned = 0;
  let failed = 0;
  let firstError: string | undefined;
  const endedIds: string[] = [];

  // One RPC per series rather than one for the whole list: each is atomic on its
  // own, so a slot that fails leaves the others ended rather than taking a whole
  // timetable clear-out down with it.
  for (const id of seriesIds) {
    const { data, error } = await supabase.rpc("end_private_series_as_academy", {
      p_series: id,
    });
    if (error) {
      failed += 1;
      if (!firstError)
        firstError = error.message.includes("series_not_found")
          ? "That weekly slot is no longer there — refresh the list."
          : "Couldn't end that weekly private slot.";
      continue;
    }
    const r = (data ?? {}) as {
      cancelled?: number;
      minutes_returned?: number;
      client_ids?: string[];
      coach_ids?: string[];
      weekday?: number;
      start_time?: string;
    };
    ended += 1;
    endedIds.push(id);
    cancelled += r.cancelled ?? 0;
    minutesReturned += r.minutes_returned ?? 0;

    const label = seriesLabel(r.weekday ?? 0, r.start_time ?? "");
    // The minutes are attributed to the slot, not split per family, because the
    // message says what THIS person got back and a slot belongs to one family.
    const item = {
      kind: "series" as const,
      id,
      label,
      minutesReturned: r.minutes_returned ?? 0,
    };
    for (const clientId of r.client_ids ?? []) acc.add("client", clientId, item);
    // A coach hears that the slot stopped; the minutes are not his business, so
    // his copy of the item carries none.
    for (const coachId of r.coach_ids ?? [])
      acc.add("coach", coachId, { kind: "series", id, label, minutesReturned: 0 });
  }

  if (ended === 0 && failed > 0) return { ok: false, error: firstError ?? "Couldn't end those slots." };

  if (own) await acc.flush(supabase);

  if (endedIds.length) {
    await supabase.from("audit_log").insert({
      actor_id: founderId,
      action: "private_series.end",
      entity: "private_booking_series",
      entity_id: endedIds.length === 1 ? endedIds[0] : null,
      meta: {
        series_ids: endedIds,
        ended,
        cancelled_bookings: cancelled,
        minutes_returned: minutesReturned,
        failed,
      },
    });
  }

  return { ok: true, ended, cancelled, minutesReturned, failed };
}
