import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import {
  academyToday,
  academyWallToUtc,
  shiftWallDate,
  utcToAcademyWall,
} from "@/lib/academy-time";
import { AdminShell } from "@/components/app/AdminShell";
import { AdminCalendarNav } from "@/components/app/AdminCalendarNav";
import type {
  ClientOption,
  InviteOption,
  SessionRow,
} from "@/components/app/admin-calendar-types";
import { fromDetails, type StructuredAddress } from "@/lib/address";
import { makeVenueResolver } from "@/lib/venue-display";

export const metadata: Metadata = { title: "Schedule" };

export default async function AdminCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; week?: string; session?: string }>;
}) {
  const { supabase } = await requireUser("/admin/schedule");
  const { date, week, session: openSessionId } = await searchParams;

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
        "id,starts_at,ends_at,coach_id,coach_arrived_at,capacity_override,classes!inner(id,title,description,skill_level,capacity,duration_minutes,recurrence_rule,active,venue_id,class_type,is_school,venues(name,address,postcode,lat,lng,address_details),private_class_details(client_id,address,postcode,lat,lng,access_notes,address_details))"
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
  // both depend on round-1 data — run them in parallel.
  const classIds = (classes ?? []).map((c) => c.id);

  type PrivDetail = {
    client_id: string | null;
    address: string;
    postcode: string;
    lat: number;
    lng: number;
    access_notes: string | null;
    address_details: Partial<StructuredAddress> | null;
  };
  type ClsShape = {
    id: string;
    title: string;
    description: string | null;
    skill_level: string;
    capacity: number;
    duration_minutes: number;
    recurrence_rule: string | null;
    active: boolean;
    venue_id: string | null;
    class_type: string;
    is_school: boolean;
    venues: {
      name: string;
      address: string;
      postcode: string;
      lat: number;
      lng: number;
      address_details: Partial<StructuredAddress> | null;
    } | null;
    private_class_details: PrivDetail | PrivDetail[] | null;
  };

  const privOf = (cls: ClsShape): PrivDetail | null => {
    const d = cls.private_class_details;
    return Array.isArray(d) ? (d[0] ?? null) : (d ?? null);
  };

  const privateClientIds = [
    ...new Set(
      (sessions ?? [])
        .map((s) => {
          const cls = s.classes as unknown as ClsShape;
          return cls.class_type === "private"
            ? (privOf(cls)?.client_id ?? null)
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
    const cls = s.classes as unknown as ClsShape;
    const priv = privOf(cls);
    const address: StructuredAddress | null = cls.venues
      ? fromDetails(cls.venues.address_details, {
          address: cls.venues.address,
          postcode: cls.venues.postcode,
          lat: cls.venues.lat,
          lng: cls.venues.lng,
        })
      : priv
        ? fromDetails(priv.address_details, {
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
    name: (c.profiles as unknown as { full_name: string }).full_name,
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

  const fmt = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kolkata",
  });
  // The "(this week)" suffix is owned by AdminCalendarNav so SSR and
  // client-side week navigation render the label identically.
  const rangeLabel = `${fmt.format(from)} – ${fmt.format(new Date(to.getTime() - 86400000))}`;

  // Serialise the Map to a plain object for the client component prop.
  const nextByClassObj = Object.fromEntries(nextByClass);

  return (
    <AdminShell title="Schedule">
      <AdminCalendarNav
        initialAnchor={anchor}
        today={today}
        initialSessions={rows}
        initialRangeLabel={rangeLabel}
        nextByClass={nextByClassObj}
        coaches={coachList}
        venues={venues ?? []}
        clients={clientRows}
        invites={inviteRows}
        openSessionId={openSessionId ?? null}
      />
    </AdminShell>
  );
}
