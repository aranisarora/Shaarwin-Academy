import type { createClient } from "@/lib/supabase/server";
import { nowMs } from "@/lib/academy-time";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type AttendanceEntry = {
  id: string;
  startsAt: string;
  title: string;
  classType: "private" | "group";
  status: string;
};

export type StudentStats = {
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

/**
 * Attendance + stats for one player, from the caller's own view of `bookings`:
 * the founder sees everything, a coach only bookings on their own sessions
 * (RLS scopes the query, so this is safe to render on both admin and coach pages).
 */
export async function getStudentInsights(
  supabase: Supabase,
  playerId: string
): Promise<StudentInsightsData> {
  const { data } = await supabase
    .from("bookings")
    .select(
      "id,status,class_sessions!inner(starts_at,status,classes(title,class_type))"
    )
    .eq("player_id", playerId);

  const now = nowMs();
  const rows = (data ?? []).map((b) => {
    const session = b.class_sessions as unknown as {
      starts_at: string;
      status: string;
      classes: { title: string; class_type: "private" | "group" } | null;
    };
    return {
      id: b.id as string,
      status: b.status as string,
      sessionStatus: session.status,
      startsAt: session.starts_at,
      title: session.classes?.title ?? "Session",
      classType: session.classes?.class_type ?? "group",
    };
  });

  const attended = rows.filter((r) => r.status === "attended");
  const noShows = rows.filter((r) => r.status === "no_show");
  const cancelled = rows.filter(
    (r) => r.status === "cancelled_by_client" || r.status === "cancelled_by_academy"
  );
  const upcoming = rows
    .filter(
      (r) =>
        (r.status === "confirmed" || r.status === "waitlisted") &&
        r.sessionStatus === "scheduled" &&
        new Date(r.startsAt).getTime() > now
    )
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const history = rows
    .filter(
      (r) =>
        r.status !== "rescheduled" &&
        !(upcoming as { id: string }[]).some((u) => u.id === r.id) &&
        new Date(r.startsAt).getTime() <= now
    )
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt));

  const marked = attended.length + noShows.length;
  const lastAttended = attended
    .map((r) => r.startsAt)
    .sort()
    .at(-1);

  const toEntry = (r: (typeof rows)[number]): AttendanceEntry => ({
    id: r.id,
    startsAt: r.startsAt,
    title: r.title,
    classType: r.classType,
    status: r.status,
  });

  return {
    stats: {
      attended: attended.length,
      noShows: noShows.length,
      cancelled: cancelled.length,
      upcoming: upcoming.length,
      attendanceRate: marked > 0 ? Math.round((attended.length / marked) * 100) : null,
      lastAttended: lastAttended ?? null,
    },
    history: history.map(toEntry),
    upcoming: upcoming.map(toEntry),
  };
}
