import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import {
  academyToday,
  formatDateFull,
  formatSessionDate,
  utcToAcademyWall,
} from "@/lib/academy-time";
import { AdminShell } from "@/components/app/AdminShell";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { SessionCard } from "@/components/app/ClassCard";
import { WhatsAppAssistantCard } from "@/components/app/WhatsAppAssistantCard";
import { fetchWeekSessions } from "@/app/admin/schedule/actions";
import { formatPrice } from "@/lib/format";

export const metadata: Metadata = { title: "Today" };

/** The whole dashboard, streamed so the shell paints before auth resolves. */
async function Today() {
  const { supabase } = await requireUser("/admin");
  const now = new Date();
  const weekAhead = new Date(now.getTime() + 7 * 86400000);
  const today = academyToday();

  const [
    week,
    subs,
    invoices,
    sessionsWeek,
    unassigned,
    pastDue,
    timeOff,
    issues,
    coaches,
    signups,
  ] = await Promise.all([
    // Reuse the Schedule's exact session shape (venue resolution, private-client
    // names, badges) — the empty nextByClass is fine, Today shows real times.
    fetchWeekSessions(today, {}),
    supabase
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .in("status", ["active", "trialing"]),
    supabase
      .from("invoices")
      .select("amount_pence")
      .eq("status", "paid")
      .gte("paid_at", new Date(now.getTime() - 30 * 86400000).toISOString()),
    supabase
      .from("class_sessions")
      .select("id", { count: "exact", head: true })
      .eq("status", "scheduled")
      .gte("starts_at", now.toISOString())
      .lt("starts_at", weekAhead.toISOString()),
    // Every coachless session ahead, not just the first ten — they are grouped
    // by class below, and a count is only honest if it counted everything.
    supabase
      .from("class_sessions")
      .select("id,starts_at,class_id,classes(title,class_type,is_school)")
      .is("coach_id", null)
      .eq("status", "scheduled")
      .gte("starts_at", now.toISOString())
      .order("starts_at")
      .limit(300),
    supabase
      .from("subscriptions")
      .select("id,client_id,profiles!subscriptions_client_id_fkey(full_name)")
      .eq("status", "past_due")
      .limit(10),
    supabase
      .from("coach_time_off")
      .select("id,coach_id,starts_at,ends_at,reason,profiles!coach_time_off_coach_id_fkey(full_name)")
      .eq("status", "pending")
      .limit(10),
    supabase
      .from("notifications")
      .select("id,type,title,body,created_at,data")
      .in("type", ["session_issue", "private_request_parked"])
      .is("read_at", null)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase.from("coaches").select("id,profiles!inner(full_name)"),
    // Someone waiting to be let in. This is by the app's own reckoning the most
    // action-demanding thing that exists (lib/notification-prefs.ts marks it
    // unmutable, "someone is waiting on you to act") and Today used to show the
    // all-clear card straight through it — the only alert was a WhatsApp.
    // Read from profiles rather than the notification, because opening
    // /app/notifications marks a notification read and would silently clear the
    // alert while the person is still stuck. Predicate mirrors ClientManager's.
    supabase
      .from("profiles")
      .select("id,full_name")
      .eq("role", "client")
      .eq("approval_status", "pending")
      .not("phone", "is", null)
      .is("deleted_at", null)
      .order("created_at")
      .limit(10),
  ]);

  // Only today's sessions (the week fetch is IST-midnight anchored on today).
  const todaySessions = week.sessions.filter(
    (s) => utcToAcademyWall(new Date(s.starts_at)).date === today
  );

  const coachName = new Map(
    (coaches.data ?? []).map((c) => [
      c.id,
      (c.profiles as unknown as { full_name: string }).full_name,
    ])
  );

  const revenue = (invoices.data ?? []).reduce((s, r) => s + r.amount_pence, 0);

  // ── One problem, one row ───────────────────────────────────────────────────
  // A weekly class with no coach generates a coachless session every week, and
  // listing each one turned a single gap ("Lakefront Juniors has nobody") into
  // ten identical red alarms the founder had to scroll past. Group them by
  // class: one row, the soonest date, and how many follow.
  type Gap = {
    classId: string;
    title: string;
    kind: { isPrivate: boolean; isSchool: boolean };
    firstId: string;
    firstStart: string;
    count: number;
  };
  const gaps = new Map<string, Gap>();
  for (const s of unassigned.data ?? []) {
    const cls = s.classes as unknown as {
      title: string;
      class_type: string;
      is_school: boolean;
    } | null;
    const existing = gaps.get(s.class_id);
    if (existing) {
      existing.count += 1;
      continue;
    }
    gaps.set(s.class_id, {
      classId: s.class_id,
      title: cls?.title ?? "Class",
      kind: { isPrivate: cls?.class_type === "private", isSchool: !!cls?.is_school },
      firstId: s.id,
      firstStart: s.starts_at,
      count: 1,
    });
  }
  const coachGaps = [...gaps.values()].sort((a, b) =>
    a.firstStart.localeCompare(b.firstStart)
  );

  // ── Notifications that actually say something ──────────────────────────────
  // These rows are written by a Postgres function and a coach action, and their
  // frozen body ("A private request has no available coach — resolve manually")
  // names nobody and no time, while their stored url points at /admin/calendar,
  // which only redirects to the Schedule — losing the session. Both are fixed
  // here at read time, which also repairs every row already in the table.
  const noteRows = (issues.data ?? []).map((n) => ({
    id: n.id,
    type: n.type as string,
    sessionId: ((n.data as { session_id?: string })?.session_id ?? null) as string | null,
  }));
  // The same unresolved problem re-notifies, so collapse to one row per session
  // — and drop anything the coach-gap rows above already cover. A parked private
  // request IS a session with no coach, so without this the founder gets told
  // twice about one gap and has to work out that they are the same thing.
  const gapSessionIds = new Set((unassigned.data ?? []).map((s) => s.id));
  const seenNote = new Set<string>();
  const notes = noteRows.filter((n) => {
    if (n.sessionId && gapSessionIds.has(n.sessionId)) return false;
    const key = `${n.type}:${n.sessionId ?? n.id}`;
    if (seenNote.has(key)) return false;
    seenNote.add(key);
    return true;
  });

  const noteSessionIds = notes.map((n) => n.sessionId).filter((v): v is string => !!v);
  const { data: noteSessions } = noteSessionIds.length
    ? await supabase
        .from("class_sessions")
        .select(
          "id,starts_at,ends_at,status,classes(title,class_type,is_school,location_label,private_class_details(players(full_name)))"
        )
        .in("id", noteSessionIds)
    : { data: [] };

  const noteDetail = new Map(
    (noteSessions ?? []).map((s) => {
      const cls = s.classes as unknown as {
        title: string;
        class_type: string;
        is_school: boolean;
        location_label: string | null;
        private_class_details: { players: { full_name: string } | null } | null;
      } | null;
      const who =
        cls?.class_type === "private"
          ? (cls.private_class_details?.players?.full_name ?? "a private client")
          : (cls?.title ?? "a class");
      return [
        s.id,
        {
          who,
          when: formatSessionDate(s.starts_at),
          where: cls?.location_label ?? null,
          date: utcToAcademyWall(new Date(s.starts_at)).date,
          endsAt: s.ends_at,
          status: s.status as string,
        },
      ];
    })
  );

  // Nothing in the admin app ever stamps `read_at` on these rows, so without a
  // rule they pile up for ever: he phones the coach, and next morning "A coach
  // reported a problem" is still there. Rather than add a dismiss button he'd
  // have to remember to press, derive it — a problem about a session that has
  // finished or been cancelled is not a problem any more.
  const liveNotes = notes.filter((n) => {
    if (!n.sessionId) return false; // nothing to show and nowhere to go
    const d = noteDetail.get(n.sessionId);
    if (!d) return false; // session deleted — the row is stale by definition
    return d.status === "scheduled" && new Date(d.endsAt) > now;
  });

  const exceptions =
    coachGaps.length +
    (pastDue.data?.length ?? 0) +
    (timeOff.data?.length ?? 0) +
    liveNotes.length +
    (signups.data?.length ?? 0);

  return (
    <>
      {/* ── Section 1: today's classes — the courtside glance ── */}
      <section>
        <h2 className="label mb-3">Today&apos;s classes</h2>
        {todaySessions.length === 0 ? (
          <Card>
            <Card.Content>
              <p className="text-fg-2">No classes today.</p>
            </Card.Content>
          </Card>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {/* Who is coaching it is the first thing he wants at 7am, so the
                coach goes on the card here exactly as it does on the Schedule. */}
            {todaySessions.map((s) => (
              <SessionCard
                key={s.id}
                session={s}
                coachName={s.coachId ? (coachName.get(s.coachId) ?? null) : null}
                href={`/admin/schedule?session=${s.id}&date=${utcToAcademyWall(new Date(s.starts_at)).date}`}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── Section 2: needs your attention — every row opens the item ── */}
      <section>
        <h2 className="label mb-3">Needs your attention</h2>
        {exceptions === 0 ? (
          <Card>
            <Card.Content>
              <p className="text-fg-2">
                Nothing needs you — reminders, bookings and reschedules are handled
                automatically.
              </p>
            </Card.Content>
          </Card>
        ) : (
          <div className="space-y-3">
            {coachGaps.map((g) => (
              <Link
                key={g.classId}
                href={`/admin/schedule?session=${g.firstId}&date=${utcToAcademyWall(new Date(g.firstStart)).date}`}
                className="flex items-center justify-between gap-3 rounded-[12px] border border-err bg-surface-2 px-4 py-3 hover:bg-surface"
              >
                <div className="min-w-0">
                  <p className="font-medium">No coach — {g.title}</p>
                  <p className="tnum text-sm text-fg-2">
                    {formatSessionDate(g.firstStart)}
                    {g.count > 1 && ` · and ${g.count - 1} more`}
                  </p>
                </div>
                <Badge tone="err">Assign</Badge>
              </Link>
            ))}
            {(timeOff.data ?? []).map((t) => (
              <Link
                key={t.id}
                href={`/admin/coaches?coach=${t.coach_id}`}
                className="flex items-center justify-between rounded-[12px] border border-line bg-surface-2 px-4 py-3 hover:bg-surface"
              >
                <div>
                  <p className="font-medium">
                    Time off —{" "}
                    {(t.profiles as unknown as { full_name: string } | null)?.full_name}
                  </p>
                  <p className="tnum text-sm text-fg-2">
                    {formatDateFull(t.starts_at)} – {formatDateFull(t.ends_at)}
                    {t.reason ? ` · ${t.reason}` : ""}
                  </p>
                </div>
                <Badge>Review</Badge>
              </Link>
            ))}
            {(pastDue.data ?? []).map((s) => (
              <Link
                key={s.id}
                href={`/admin/players?view=clients&client=${s.client_id}`}
                className="flex items-center justify-between rounded-[12px] border border-err bg-surface-2 px-4 py-3 hover:bg-surface"
              >
                <p className="font-medium">
                  Payment past due —{" "}
                  {(s.profiles as unknown as { full_name: string } | null)?.full_name}
                </p>
                <Badge tone="err">Payment overdue</Badge>
              </Link>
            ))}
            {/* One row however many are waiting — the list is on Players, and
                a queue of five people isn't five separate problems. */}
            {(signups.data?.length ?? 0) > 0 && (
              <Link
                href="/admin/players?view=clients"
                className="flex items-center justify-between gap-3 rounded-[12px] border border-line bg-surface-2 px-4 py-3 hover:bg-surface"
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    {signups.data!.length === 1
                      ? `${signups.data![0].full_name} wants to join`
                      : `${signups.data!.length} people want to join`}
                  </p>
                  <p className="text-sm text-fg-2">Waiting for you to let them in.</p>
                </div>
                <Badge>Review</Badge>
              </Link>
            )}
            {liveNotes.map((n) => {
              const d = n.sessionId ? noteDetail.get(n.sessionId) : null;
              const parked = n.type === "private_request_parked";
              return (
                <Link
                  key={n.id}
                  href={
                    d && n.sessionId
                      ? `/admin/schedule?session=${n.sessionId}&date=${d.date}`
                      : "/admin/schedule"
                  }
                  className="flex items-center justify-between gap-3 rounded-[12px] border border-line bg-surface-2 px-4 py-3 hover:bg-surface"
                >
                  <div className="min-w-0">
                    <p className="font-medium">
                      {parked ? "Private class needs a coach" : "A coach reported a problem"}
                      {d ? ` — ${d.who}` : ""}
                    </p>
                    <p className="tnum text-sm text-fg-2">
                      {d
                        ? `${d.when}${d.where ? ` · ${d.where}` : ""}`
                        : parked
                          ? "Nobody was free. Pick a coach on the Schedule."
                          : "Open the session to follow up."}
                    </p>
                  </div>
                  <Badge tone={parked ? "err" : "neutral"}>
                    {parked ? "Assign" : "Open"}
                  </Badge>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Section 3: the numbers, demoted to one glanceable strip ── */}
      <Link
        href="/admin/billing"
        className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[12px] border border-line bg-surface-2 px-4 py-3 text-sm text-fg-2 hover:bg-surface"
      >
        <span>
          <span className="tnum font-medium text-fg">{subs.count ?? 0}</span> members
        </span>
        <span aria-hidden>·</span>
        <span>
          <span className="tnum font-medium text-fg">
            {formatPrice(revenue)}
          </span>{" "}
          this month
        </span>
        <span aria-hidden>·</span>
        <span>
          <span className="tnum font-medium text-fg">{sessionsWeek.count ?? 0}</span>{" "}
          classes this week
        </span>
        <span aria-hidden className="ml-auto text-fg-2">
          →
        </span>
      </Link>

      <WhatsAppAssistantCard />
    </>
  );
}

export default function AdminTodayPage() {
  return (
    <AdminShell title="Today">
      <div className="mx-auto max-w-4xl space-y-6 lg:space-y-8">
        <Suspense fallback={<PageSkeleton />}>
          <Today />
        </Suspense>
      </div>
    </AdminShell>
  );
}
