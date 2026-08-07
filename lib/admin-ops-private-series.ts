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
