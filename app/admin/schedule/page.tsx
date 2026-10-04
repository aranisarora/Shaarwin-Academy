import type { Metadata } from "next";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { academyToday, academyWallToUtc, shiftWallDate } from "@/lib/academy-time";
import { AdminShell } from "@/components/app/AdminShell";
import { AdminActionSheet } from "@/components/app/AdminActionSheet";
import { AdminScheduleTabs } from "@/components/app/AdminScheduleTabs";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { fetchAttention } from "@/lib/admin-attention";
import type { ClientOption, InviteOption } from "@/components/app/admin-calendar-types";
import { withVenueAddress } from "@/lib/venue-display";
import { modalTimeByClass } from "@/lib/session-deviation";
import { buildSessionRows, fetchWeekRaw } from "@/lib/session-week";

export const metadata: Metadata = { title: "Schedule" };

type SearchParams = Promise<{
  date?: string;
  week?: string;
  session?: string;
  /** "timetable" opens on the repeating classes; anything else on this week. */
  view?: string;
  /** Deep link straight to a class's editor, from a session sheet. */
  class?: string;
}>;

async function Schedule({ searchParams }: { searchParams: SearchParams }) {
  const [
    { supabase },
    { date, week, session: openSessionId, view, class: openClassId },
  ] = await Promise.all([requireUser("/admin/schedule"), searchParams]);

  // The schedule shows a 7-day window starting on an anchor date. Prefer an
  // explicit ?date=, fall back to a legacy ?week= offset (old links / stored
  // notification URLs), otherwise start today. The window runs from academy
  // (IST) midnight of the anchor to IST midnight seven days later.
  const today = academyToday();
  const validDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
  const legacyOffset = !validDate && week ? Number.parseInt(week, 10) : Number.NaN;
  const anchor = validDate
    ? validDate
    : Number.isFinite(legacyOffset)
      ? shiftWallDate(today, legacyOffset * 7)
      : today;

  const from = academyWallToUtc(anchor, "00:00");
  const to = new Date(from.getTime() + 7 * 86400000);

  // Round 1: everything in parallel — sessions, coaches, venues, clients,
  // invites, and every group class's future sessions for its next time and slot.
  const [
    { data: sessions },
    { data: coaches },
    { data: venues },
    { data: clients },
    { data: invites },
    { data: nextSessions },
  ] = await Promise.all([
    fetchWeekRaw(supabase, from, to),
    supabase
      .from("coaches")
      .select("id,active,profiles!inner(full_name)")
      .eq("active", true),
    supabase.from("venues").select("id,name,unit,is_public,address,postcode,lat,lng,address_details").order("name"),
    supabase
      .from("profiles")
      .select("id,full_name,players(id,full_name)")
      .eq("role", "client")
      .order("full_name"),
    supabase
      .from("client_invites")
      .select("id,phone,full_name")
      .is("claimed_at", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("class_sessions")
      .select("class_id,starts_at,classes!inner(class_type)")
      .eq("classes.class_type", "group")
      .eq("status", "scheduled")
      .gt("starts_at", new Date().toISOString())
      .order("starts_at"),
  ]);

  const nextByClass: Record<string, string> = {};
  for (const s of nextSessions ?? []) nextByClass[s.class_id] ??= s.starts_at;

  // The slot each class actually keeps, from the very same rows — the mode over
  // every future session, not just the first. Free: this query already returns
  // all of them and we were throwing the rest away.
  const slotByClass = modalTimeByClass(nextSessions ?? []);

  // Round 2: what each session still owes, keyed on the session ids above.
  const rows = await buildSessionRows(supabase, sessions ?? [], nextByClass, slotByClass);

  const coachList = (coaches ?? []).map((c) => ({
    id: c.id,
    name: c.profiles.full_name,
  }));

  const clientRows: ClientOption[] = (clients ?? []).map((c) => ({
    id: c.id,
    name: c.full_name,
    players: ((c.players as { id: string; full_name: string }[]) ?? []).map((p) => ({
      id: p.id,
      name: p.full_name,
    })),
  }));

  const inviteRows: InviteOption[] = (invites ?? []).map((i) => ({
    id: i.id,
    name: (i.full_name ?? "").trim(),
    phone: i.phone,
  }));

  return (
    <AdminScheduleTabs
      initialAnchor={anchor}
      today={today}
      initialSessions={rows}
      nextByClass={nextByClass}
      slotByClass={slotByClass}
      coaches={coachList}
      venues={withVenueAddress(venues)}
      clients={clientRows}
      invites={inviteRows}
      openSessionId={openSessionId ?? null}
      openClassId={openClassId ?? null}
      initialView={view === "timetable" ? "timetable" : "week"}
    />
  );
}

/**
 * The one thing waiting on him, if there is exactly one. Streamed in its own
 * boundary so a queue that needs five queries never holds up the schedule —
 * `requireUser` is React-cached, so this costs no second auth round trip.
 */
async function ArrivalPrompt() {
  const { supabase } = await requireUser("/admin/schedule");
  return <AdminActionSheet items={await fetchAttention(supabase)} />;
}

export default function AdminCalendarPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  return (
    <AdminShell title="Schedule">
      <Suspense fallback={<PageSkeleton />}>
        <Schedule searchParams={searchParams} />
      </Suspense>
      {/* This route is the founder's home — /admin redirects here — so it is
          where an arrival prompt belongs. */}
      <Suspense fallback={null}>
        <ArrivalPrompt />
      </Suspense>
    </AdminShell>
  );
}
