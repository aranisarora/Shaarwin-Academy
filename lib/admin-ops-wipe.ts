// Clear the whole calendar.
//
// Everything else the founder can do from the Weekly tab works on a SELECTION,
// and a selection can only ever contain what that screen renders — group classes
// with a weekly pattern, and now the weekly private slots beside them. That
// leaves the one-off classes, which run on a date and are deliberately not on
// that list, and the `class_type='private'` rows the private generator writes
// one of per week. So "Select all" has never meant "everything", and the founder
// who wants a clean sheet before a new term had no way of getting one.
//
// This is the only operation in the app that is a single RPC rather than a
// sequence of PostgREST calls. Three reasons, all of them specific:
//
//   • Every step of a TypeScript version is its own transaction. Half a wipe —
//     sessions cancelled, messages already out, most of the classes still on the
//     list — is the worst state the calendar can be in, and `bulkRemoveClasses`
//     already ships that outcome as a sentence. Over a whole calendar it is
//     near-certain under any transient error.
//   • `notifications` has no DELETE policy (INSERT/UPDATE/SELECT only), so the
//     reminders queued for sessions that are about to stop existing cannot be
//     cleaned up from the app at all.
//   • The `authenticated` role carries statement_timeout=8s, which a whole
//     calendar will not fit inside.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { OpResult } from "@/lib/admin-ops-types";

/** What is on the calendar right now, counted so the confirm step can name the
 * cost before the founder is anywhere near a destructive control. */
export type CalendarWipePreview = {
  /** class_type='group' with a weekly pattern — what the Weekly tab lists. */
  groupWeekly: number;
  /** class_type='group' on a date — the one-offs the Weekly tab only counts. */
  groupOneOff: number;
  /** class_type='private' — one row per generated week of a private slot. */
  privateClasses: number;
  /** Live weekly private slots (the templates behind those weeks). */
  privateSeries: number;
  futureSessions: number;
  /** Places people are still holding on hours ahead of us. */
  liveBookings: number;
  minutesReturned: number;
  families: number;
  coaches: number;
};

const EMPTY: CalendarWipePreview = {
  groupWeekly: 0,
  groupOneOff: 0,
  privateClasses: 0,
  privateSeries: 0,
  futureSessions: 0,
  liveBookings: 0,
  minutesReturned: 0,
  families: 0,
  coaches: 0,
};

/**
 * Read-only. Notifies nobody, changes nothing.
 *
 * Fetched before the confirm input is even rendered, so that a mis-tap into this
 * sheet lands on a paragraph of numbers rather than on a button.
 */
export async function planCalendarWipeCore(
  supabase: SupabaseClient<Database>
): Promise<OpResult & { preview?: CalendarWipePreview }> {
  const nowIso = new Date().toISOString();
  const preview = { ...EMPTY };

  const { data: classes, error: clsErr } = await supabase
    .from("classes")
    .select("id,class_type,recurrence_rule");
  if (clsErr) return { ok: false, error: "Couldn't read the calendar." };

  for (const c of classes ?? []) {
    if (c.class_type === "private") preview.privateClasses += 1;
    else if (c.recurrence_rule) preview.groupWeekly += 1;
    else preview.groupOneOff += 1;
  }

  const { count: seriesCount } = await supabase
    .from("private_booking_series")
    .select("id", { count: "exact", head: true })
    .eq("active", true);
  preview.privateSeries = seriesCount ?? 0;

  const { count: sessionCount } = await supabase
    .from("class_sessions")
    .select("id", { count: "exact", head: true })
    .eq("status", "scheduled")
    .gt("starts_at", nowIso);
  preview.futureSessions = sessionCount ?? 0;

  // Who is actually losing something, and what it cost them. Read from the
  // bookings rather than from the classes: a class with no live place on it
  // takes nothing away from anybody, and pricing it as though it did is how a
  // confirm step ends up frightening the founder off a clear-out that was free.
  const { data: live } = await supabase
    .from("bookings")
    .select("client_id,class_sessions!inner(coach_id,starts_at,classes!inner(class_type,duration_minutes))")
    .in("status", ["confirmed", "waitlisted"])
    .gt("class_sessions.starts_at", nowIso);

  const families = new Set<string>();
  const coaches = new Set<string>();
  for (const b of live ?? []) {
    const s = b.class_sessions as unknown as {
      coach_id: string | null;
      classes: { class_type: string; duration_minutes: number } | null;
    } | null;
    preview.liveBookings += 1;
    if (b.client_id) {
      families.add(b.client_id);
      // Only private minutes come back as minutes. A group place costs an
      // allowance, which the wipe leaves alone, so counting it here would
      // promise the family something they are not getting.
      if (s?.classes?.class_type === "private")
        preview.minutesReturned += s.classes.duration_minutes ?? 0;
    }
    if (s?.coach_id) coaches.add(s.coach_id);
  }
  preview.families = families.size;
  preview.coaches = coaches.size;

  return { ok: true, preview };
}

export type CalendarWipeResult = {
  classes: number;
  privateSeries: number;
  groupSeries: number;
  sessions: number;
  bookings: number;
  minutesReturned: number;
  creditsReturned: number;
  clientsMessaged: number;
  coachesMessaged: number;
  remindersDropped: number;
  keptHistory: boolean;
};

/**
 * Clear the calendar. `confirm` must be the literal string "WIPE" — the server
 * checks it too, so the guard is not client-side theatre.
 *
 * `keepHistory` ends everything instead of deleting it: the classes stay, marked
 * ended, their upcoming sessions are cancelled and everyone is told exactly the
 * same, and every class can still be restored. It is the preselected option,
 * because it is the one that is recoverable.
 */
export async function wipeCalendarCore(
  supabase: SupabaseClient<Database>,
  founderId: string,
  opts: { confirm: string; keepHistory: boolean }
): Promise<OpResult & { wiped?: CalendarWipeResult }> {
  const { data, error } = await supabase.rpc("wipe_calendar", {
    p_scope: "all",
    p_confirm: opts.confirm,
    p_keep_history: opts.keepHistory,
  });

  if (error) {
    const m = error.message ?? "";
    if (m.includes("confirm_required"))
      return { ok: false, error: "Type WIPE exactly to confirm.", code: "confirm_required" };
    if (m.includes("not_authorised")) return { ok: false, error: "Founder only." };
    // A statement or lock timeout is the one failure that is genuinely clean:
    // the whole thing is one transaction, so nothing at all has changed.
    return {
      ok: false,
      error: "Couldn't clear the calendar. Nothing changed — it is exactly as it was.",
    };
  }

  const r = (data ?? {}) as Record<string, unknown>;
  const n = (k: string) => Number(r[k] ?? 0) || 0;
  const wiped: CalendarWipeResult = {
    classes: n("classes"),
    privateSeries: n("private_series"),
    groupSeries: n("group_series"),
    sessions: n("sessions"),
    bookings: n("bookings"),
    minutesReturned: n("minutes_returned"),
    creditsReturned: n("credits_returned"),
    clientsMessaged: n("clients_messaged"),
    coachesMessaged: n("coaches_messaged"),
    remindersDropped: n("reminders_dropped"),
    keptHistory: Boolean(r["kept_history"]),
  };

  // The RPC writes its own audit row carrying the class ids — the only surviving
  // record of what the calendar held. This second one is the app's own trail,
  // consistent with every other action here, and cheap.
  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "calendar.wipe",
    entity: "classes",
    meta: { ...wiped, via: "admin" },
  });

  return { ok: true, wiped };
}
