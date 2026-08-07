// What is actually waiting on the founder, in one place.
//
// This used to live inline on /admin, the "Today" tab, whose other half was a
// list of today's classes — the same rows, through the same card, as the first
// day of the Schedule. That duplication is why Today is gone. This half was the
// only thing on it that existed nowhere else, so it moved to Alerts, beside the
// notification feed it was always a curated subset of.
//
// Everything here obeys one rule: a row names the thing and opens the exact
// item. Never a generic list the founder then has to search.

import type { createClient } from "@/lib/supabase/server";
import { formatDateFull, formatSessionDate, utcToAcademyWall } from "@/lib/academy-time";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type AttentionItem = {
  key: string;
  href: string;
  title: string;
  detail: string | null;
  /** The badge: what he is being asked to do. */
  action: string;
  /** Red border + red badge. Per globals.css, red means "act now" and nothing
   *  else — so this is true only when someone is genuinely blocked. */
  urgent: boolean;
  /** Lower sorts first, and the popup only ever offers rank 0 items. */
  rank: number;
};

/**
 * Everything waiting on the founder, most urgent first.
 *
 * Ranking is the founder's own order of pain: somebody locked out of the app,
 * then a class with nobody to teach it, then money, then admin. The one-question
 * popup reads the top of this list and shows nothing when more than one thing
 * is tied at the top — see AdminActionSheet.
 */
export async function fetchAttention(supabase: Supabase): Promise<AttentionItem[]> {
  const now = new Date();

  const [unassigned, pastDue, timeOff, issues, signups] = await Promise.all([
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
      .select(
        "id,coach_id,starts_at,ends_at,reason,profiles!coach_time_off_coach_id_fkey(full_name)"
      )
      .eq("status", "pending")
      .limit(10),
    supabase
      .from("notifications")
      .select("id,type,title,body,created_at,data")
      .in("type", ["session_issue", "private_request_parked"])
      .is("read_at", null)
      .order("created_at", { ascending: false })
      .limit(50),
    // Someone waiting to be let in. By the app's own reckoning this is the most
    // action-demanding thing that exists (lib/notification-prefs.ts marks it
    // unmutable, "someone is waiting on you to act") and the old dashboard
    // showed its all-clear card straight through it — the only alert was a
    // WhatsApp. Read from profiles rather than the notification, because opening
    // the feed marks a notification read and would silently clear the alert
    // while the person is still stuck. Predicate mirrors ClientManager's.
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

  const items: AttentionItem[] = [];

  // ── One problem, one row ───────────────────────────────────────────────────
  // A weekly class with no coach generates a coachless session every week, and
  // listing each one turned a single gap ("Lakefront Juniors has nobody") into
  // ten identical red alarms to scroll past. Group them by class: one row, the
  // soonest date, and how many follow.
  type Gap = { title: string; firstId: string; firstStart: string; count: number };
  const gaps = new Map<string, Gap>();
  for (const s of unassigned.data ?? []) {
    const existing = gaps.get(s.class_id);
    if (existing) {
      existing.count += 1;
      continue;
    }
    const cls = s.classes as unknown as { title: string } | null;
    gaps.set(s.class_id, {
      title: cls?.title ?? "Class",
      firstId: s.id,
      firstStart: s.starts_at,
      count: 1,
    });
  }

  // One row however many are waiting — the list is on Players, and a queue of
  // five people isn't five separate problems.
  const waiting = signups.data ?? [];
  if (waiting.length > 0) {
    items.push({
      key: "signups",
      href: "/admin/players?view=clients",
      title:
        waiting.length === 1
          ? `${waiting[0].full_name} wants to join`
          : `${waiting.length} people want to join`,
      detail: "Waiting for you to let them in.",
      action: "Review",
      urgent: true,
      rank: 0,
    });
  }

  for (const [classId, g] of gaps) {
    items.push({
      key: `gap:${classId}`,
      href: `/admin/schedule?session=${g.firstId}&date=${utcToAcademyWall(new Date(g.firstStart)).date}`,
      title: `No coach — ${g.title}`,
      detail: `${formatSessionDate(g.firstStart)}${g.count > 1 ? ` · and ${g.count - 1} more` : ""}`,
      action: "Assign",
      urgent: true,
      rank: 1,
    });
  }

  // ── Notifications that actually say something ──────────────────────────────
  // The same unresolved problem re-notifies, so collapse to one row per session
  // — and drop anything the coach-gap rows above already cover. A parked private
  // request IS a session with no coach, so without this he is told twice about
  // one gap and has to work out that they are the same thing.
  const gapSessionIds = new Set((unassigned.data ?? []).map((s) => s.id));
  const seenNote = new Set<string>();
  const notes = (issues.data ?? [])
    .map((n) => ({
      id: n.id,
      type: n.type as string,
      sessionId: ((n.data as { session_id?: string })?.session_id ?? null) as string | null,
    }))
    .filter((n) => {
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
  for (const n of notes) {
    if (!n.sessionId) continue; // nothing to show and nowhere to go
    const d = noteDetail.get(n.sessionId);
    if (!d) continue; // session deleted — the row is stale by definition
    if (d.status !== "scheduled" || new Date(d.endsAt) <= now) continue;
    const parked = n.type === "private_request_parked";
    items.push({
      key: `note:${n.id}`,
      href: `/admin/schedule?session=${n.sessionId}&date=${d.date}`,
      title: `${parked ? "Private class needs a coach" : "A coach reported a problem"} — ${d.who}`,
      detail: `${d.when}${d.where ? ` · ${d.where}` : ""}`,
      action: parked ? "Assign" : "Open",
      urgent: parked,
      rank: parked ? 1 : 3,
    });
  }

  for (const s of pastDue.data ?? []) {
    const name = (s.profiles as unknown as { full_name: string } | null)?.full_name;
    items.push({
      key: `pastdue:${s.id}`,
      href: `/admin/players?view=clients&client=${s.client_id}`,
      title: `Payment past due — ${name}`,
      detail: null,
      action: "Payment overdue",
      urgent: true,
      rank: 2,
    });
  }

  for (const t of timeOff.data ?? []) {
    const name = (t.profiles as unknown as { full_name: string } | null)?.full_name;
    items.push({
      key: `timeoff:${t.id}`,
      href: `/admin/coaches?coach=${t.coach_id}`,
      title: `Time off — ${name}`,
      detail: `${formatDateFull(t.starts_at)} – ${formatDateFull(t.ends_at)}${t.reason ? ` · ${t.reason}` : ""}`,
      action: "Review",
      urgent: false,
      rank: 3,
    });
  }

  return items.sort((a, b) => a.rank - b.rank);
}
