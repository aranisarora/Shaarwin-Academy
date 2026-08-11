import type { Metadata } from "next";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import {
  academyToday,
  academyWallToUtc,
  shiftWallDate,
  utcToAcademyWall,
} from "@/lib/academy-time";
import { AdminShell } from "@/components/app/AdminShell";
import { AdminActionSheet } from "@/components/app/AdminActionSheet";
import { AdminScheduleTabs } from "@/components/app/AdminScheduleTabs";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { fetchAttention } from "@/lib/admin-attention";
import type {
  ClientOption,
  InviteOption,
  SessionRow,
} from "@/components/app/admin-calendar-types";
import { asAddressDetails, fromDetails, type StructuredAddress } from "@/lib/address";
import { withVenueAddress } from "@/lib/venue-display";
import { modalTimeByClass } from "@/lib/session-deviation";

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

  // Round 1: everything in parallel — sessions, coaches, classes, venues, clients, invites
  const [
    { data: sessions },
    { data: coaches },
    { data: classes },
    { data: venues },
    { data: clients },
    { data: invites },
  ] = await Promise.all([
    // Cancelled sessions are fetched too. Leaving them out is what made a
    // called-off class vanish rather than read as cancelled, so the founder
    // could not tell "we don't run Tuesdays" from "Tuesday was called off" —
    // and had to go to a second tab to find out which.
    supabase
      .from("class_sessions")
      .select(
        "id,starts_at,ends_at,status,cancel_reason,coach_id,coach_arrived_at,coach_arrival_source,coach_arrival_distance_m,capacity_override,classes!inner(id,title,description,skill_level,capacity,duration_minutes,recurrence_rule,active,venue_id,class_type,is_school,location_label,venues(name,address,postcode,lat,lng,address_details),private_class_details(client_id,address,postcode,lat,lng,access_notes,address_details,players(full_name)))"
      )
      .in("status", ["scheduled", "completed", "cancelled"])
      .gte("starts_at", from.toISOString())
      .lt("starts_at", to.toISOString())
      .order("starts_at"),
    supabase
      .from("coaches")
      .select("id,active,profiles!inner(full_name)")
      .eq("active", true),
    supabase
      .from("classes")
      .select(
        "id,title,description,skill_level,capacity,duration_minutes,recurrence_rule,active,ends_on,venue_id,is_school,venues(name,unit)"
      )
      .eq("class_type", "group")
      .order("title"),
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
  ]);

  // Round 2: nextSessions and privProfiles are independent of each other but
  // both genuinely depend on round-1 data — nextSessions on the class ids,
  // privProfiles on the client ids embedded in the sessions — so this second
  // trip can't be folded into the first. They already run in parallel.
  const classIds = (classes ?? []).map((c) => c.id);

  const privateClientIds = [
    ...new Set(
      (sessions ?? [])
        .map((s) => {
          const cls = s.classes;
          return cls.class_type === "private"
            ? (cls.private_class_details?.client_id ?? null)
            : null;
        })
        .filter((id): id is string => id !== null)
    ),
  ];

  const [{ data: nextSessions }, { data: privProfiles }] = await Promise.all([
    classIds.length
      ? supabase
          .from("class_sessions")
          .select("class_id,starts_at")
          .in("class_id", classIds)
          .eq("status", "scheduled")
          .gt("starts_at", new Date().toISOString())
          .order("starts_at")
      : { data: [] as { class_id: string; starts_at: string }[] },
    privateClientIds.length > 0
      ? supabase
          .from("profiles")
          .select("id,full_name")
          .in("id", privateClientIds)
      : { data: [] as { id: string; full_name: string }[] },
  ]);

  const nextByClass = new Map<string, string>();
  for (const s of nextSessions ?? []) {
    if (!nextByClass.has(s.class_id)) nextByClass.set(s.class_id, s.starts_at);
  }

  // The slot each class actually keeps, from the very same rows — the mode over
  // every future session, not just the first. Free: this query already returns
  // all of them and we were throwing the rest away.
  const slotByClass = modalTimeByClass(nextSessions ?? []);
  const classTime = (classId: string, fallbackIso: string) => {
    const iso = nextByClass.get(classId) ?? fallbackIso;
    return utcToAcademyWall(new Date(iso)).time;
  };

  const clientNameMap = new Map<string, string>();
  for (const p of privProfiles ?? []) clientNameMap.set(p.id, p.full_name);

  const rows: SessionRow[] = (sessions ?? []).map((s) => {
    const cls = s.classes;
    const priv = cls.private_class_details;
    const address: StructuredAddress | null = cls.venues
      ? fromDetails(asAddressDetails(cls.venues.address_details), {
          address: cls.venues.address,
          postcode: cls.venues.postcode,
          lat: cls.venues.lat,
          lng: cls.venues.lng,
        })
      : priv
        ? fromDetails(asAddressDetails(priv.address_details), {
            address: priv.address,
            postcode: priv.postcode,
            lat: priv.lat,
            lng: priv.lng,
            access_notes: priv.access_notes,
          })
        : null;

    return {
      id: s.id,
      starts_at: s.starts_at,
      ends_at: s.ends_at,
      status: s.status,
      cancelReason: s.cancel_reason,
      coachId: s.coach_id,
      coachArrivedAt: s.coach_arrived_at,
      coachArrivalSource: s.coach_arrival_source,
      coachArrivalDistanceM: s.coach_arrival_distance_m,
      title: cls.title,
      capacity: s.capacity_override ?? cls.capacity,
      isPrivate: cls.class_type === "private",
      isSchool: cls.is_school,
      venueName: cls.location_label ?? null,
      playerName: priv?.client_id ? (clientNameMap.get(priv.client_id) ?? null) : null,
      privatePlayerName:
        (priv?.players as unknown as { full_name: string } | null)?.full_name ?? null,
      privateClientId: priv?.client_id ?? null,
      address,
      classId: cls.id,
      classActive: cls.active,
      classDescription: cls.description ?? "",
      classLevel: cls.skill_level,
      classCapacity: cls.capacity,
      classDuration: cls.duration_minutes,
      classVenueId: cls.venue_id,
      classWeekday: cls.recurrence_rule?.match(/BYDAY=(..)/)?.[1] ?? "MO",
      classTime: classTime(cls.id, s.starts_at),
      classSlotTime: slotByClass[cls.id] ?? null,
      classRecurring: !!cls.recurrence_rule,
    };
  });

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

  // Serialise the Map to a plain object for the client component prop.
  const nextByClassObj = Object.fromEntries(nextByClass);

  return (
    <AdminScheduleTabs
      initialAnchor={anchor}
      today={today}
      initialSessions={rows}
      nextByClass={nextByClassObj}
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
