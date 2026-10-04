import type { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";
import { nowMs } from "@/lib/academy-time";

type Supabase = Awaited<ReturnType<typeof createClient>>;
type BookingStatus = Database["public"]["Enums"]["booking_status"];

export type AttendanceEntry = {
  id: string;
  startsAt: string;
  title: string;
  classType: "private" | "group";
  status: string;
};

type StudentStats = {
  attended: number;
  noShows: number;
  cancelled: number;
  upcoming: number;
  /** attended / (attended + no-shows), 0–100. Null until attendance has been marked. */
  attendanceRate: number | null;
  lastAttended: string | null;
};

export type StudentInsightsData = {
  stats: StudentStats;
  /** Past bookings, newest first. */
  history: AttendanceEntry[];
  /** Future confirmed/waitlisted bookings, soonest first. */
  upcoming: AttendanceEntry[];
};

/** What the insights card shows of each list; the counts cover everything. */
const UPCOMING_SHOWN = 5;
const HISTORY_SHOWN = 20;

const ENTRY_SELECT = "id,status,class_sessions!inner(starts_at,status,classes(title,class_type))";

/**
 * Attendance + stats for one player, from the caller's own view of `bookings`:
 * the founder sees everything, a coach only bookings on their own sessions
 * (RLS scopes every query, so this is safe to render on both admin and coach pages).
 *
 * The counts are head counts and the lists stop at what the card shows, so the
 * cost stays flat however long a player has been coming.
 */
export async function getStudentInsights(
  supabase: Supabase,
  playerId: string
): Promise<StudentInsightsData> {
  const nowIso = new Date(nowMs()).toISOString();
  const countFor = (statuses: BookingStatus[]) =>
    supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("player_id", playerId)
      .in("status", statuses);

  const [upcomingRes, historyRes, lastRes, attended, noShows, cancelled] = await Promise.all([
    supabase
      .from("bookings")
      .select(ENTRY_SELECT, { count: "exact" })
      .eq("player_id", playerId)
      .in("status", ["confirmed", "waitlisted"])
      .eq("class_sessions.status", "scheduled")
      .gt("class_sessions.starts_at", nowIso)
      .order("class_sessions(starts_at)")
      .limit(UPCOMING_SHOWN),
    supabase
      .from("bookings")
      .select(ENTRY_SELECT)
      .eq("player_id", playerId)
      .neq("status", "rescheduled")
      .lte("class_sessions.starts_at", nowIso)
      .order("class_sessions(starts_at)", { ascending: false })
      .limit(HISTORY_SHOWN),
    supabase
      .from("bookings")
      .select("class_sessions!inner(starts_at)")
      .eq("player_id", playerId)
      .eq("status", "attended")
      .order("class_sessions(starts_at)", { ascending: false })
      .limit(1),
    countFor(["attended"]),
    countFor(["no_show"]),
    countFor(["cancelled_by_client", "cancelled_by_academy"]),
  ]);

  const toEntry = (b: NonNullable<typeof historyRes.data>[number]): AttendanceEntry => ({
    id: b.id,
    startsAt: b.class_sessions.starts_at,
    title: b.class_sessions.classes?.title ?? "Session",
    classType: b.class_sessions.classes?.class_type ?? "group",
    status: b.status,
  });

  const attendedCount = attended.count ?? 0;
  const marked = attendedCount + (noShows.count ?? 0);

  return {
    stats: {
      attended: attendedCount,
      noShows: noShows.count ?? 0,
      cancelled: cancelled.count ?? 0,
      upcoming: upcomingRes.count ?? 0,
      attendanceRate: marked > 0 ? Math.round((attendedCount / marked) * 100) : null,
      lastAttended: lastRes.data?.[0]?.class_sessions.starts_at ?? null,
    },
    history: (historyRes.data ?? []).map(toEntry),
    upcoming: (upcomingRes.data ?? []).map(toEntry),
  };
}
