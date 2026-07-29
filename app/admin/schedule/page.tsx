import type { Metadata } from "next";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import {
  academyToday,
  academyWallToUtc,
  formatDate,
  shiftWallDate,
  utcToAcademyWall,
} from "@/lib/academy-time";
import { AdminShell } from "@/components/app/AdminShell";
import { AdminCalendarNav } from "@/components/app/AdminCalendarNav";
import { PageSkeleton } from "@/components/ui/Skeleton";
import type {
  ClientOption,
  InviteOption,
  SessionRow,
} from "@/components/app/admin-calendar-types";
import { asAddressDetails, fromDetails, type StructuredAddress } from "@/lib/address";
import { makeVenueResolver, withVenueAddress } from "@/lib/venue-display";

export const metadata: Metadata = { title: "Schedule" };

type SearchParams = Promise<{ date?: string; week?: string; session?: string }>;

async function Schedule({ searchParams }: { searchParams: SearchParams }) {
  const [{ supabase }, { date, week, session: openSessionId }] = await Promise.all([
    requireUser("/admin/schedule"),
    searchParams,
  ]);

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
    supabase
      .from("class_sessions")
      .select(
        "id,starts_at,ends_at,coach_id,coach_arrived_at,coach_arrival_source,coach_arrival_distance_m,capacity_override,classes!inner(id,title,description,skill_level,capacity,duration_minutes,recurrence_rule,active,venue_id,class_type,is_school,venues(name,address,postcode,lat,lng,address_details),private_class_details(client_id,address,postcode,lat,lng,access_notes,address_details))"
      )
      .in("status", ["scheduled", "completed"])
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
        "id,title,description,skill_level,capacity,duration_minutes,recurrence_rule,active,ends_on,venue_id,is_school,venues(name)"
      )
      .eq("class_type", "group")
      .order("title"),
    supabase.from("venues").select("id,name,active,address,postcode,lat,lng,address_details").order("name"),
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
  const classTime = (classId: string, fallbackIso: string) => {
    const iso = nextByClass.get(classId) ?? fallbackIso;
    return utcToAcademyWall(new Date(iso)).time;
  };

  const clientNameMap = new Map<string, string>();
  for (const p of privProfiles ?? []) clientNameMap.set(p.id, p.full_name);

  // Private classes store a raw client address, but most point at a known
  // venue — resolve to the venue's title so cards show "La Palazzo" rather than
  // "47/1, Bengaluru…". Shared with the session sheet + week refetch.
  const resolveVenueName = makeVenueResolver(venues ?? []);

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

    const privLocationName = priv ? resolveVenueName(priv) : null;

    return {
      id: s.id,
      starts_at: s.starts_at,
      ends_at: s.ends_at,
      coachId: s.coach_id,
      coachArrivedAt: s.coach_arrived_at,
      coachArrivalSource: s.coach_arrival_source,
      coachArrivalDistanceM: s.coach_arrival_distance_m,
      title: cls.title,
      capacity: s.capacity_override ?? cls.capacity,
      isPrivate: cls.class_type === "private",
      isSchool: cls.is_school,
      venueName: cls.venues?.name ?? privLocationName,
      playerName: priv?.client_id ? (clientNameMap.get(priv.client_id) ?? null) : null,
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

  // The "(this week)" suffix is owned by AdminCalendarNav so SSR and
  // client-side week navigation render the label identically.
  const rangeLabel = `${formatDate(from)} – ${formatDate(to.getTime() - 86400000)}`;

  // Serialise the Map to a plain object for the client component prop.
  const nextByClassObj = Object.fromEntries(nextByClass);

  return (
    <AdminCalendarNav
      initialAnchor={anchor}
      today={today}
      initialSessions={rows}
      initialRangeLabel={rangeLabel}
      nextByClass={nextByClassObj}
      coaches={coachList}
      venues={withVenueAddress(venues)}
      clients={clientRows}
      invites={inviteRows}
      openSessionId={openSessionId ?? null}
    />
  );
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
    </AdminShell>
  );
}
