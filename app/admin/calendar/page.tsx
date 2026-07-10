import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { utcToAcademyWall } from "@/lib/academy-time";
import { AdminShell } from "@/components/app/AdminShell";
import { AdminCalendar } from "@/components/app/AdminCalendar";
import type {
  ClassRow,
  ClientOption,
  SessionRow,
} from "@/components/app/admin-calendar-types";
import { fromDetails, type StructuredAddress } from "@/lib/address";

export const metadata: Metadata = { title: "Calendar" };

export default async function AdminCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { supabase } = await requireUser("/admin/calendar");
  const { week } = await searchParams;
  const weekOffset = Number.parseInt(week ?? "0", 10) || 0;

  const from = new Date();
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() + weekOffset * 7);
  const to = new Date(from.getTime() + 7 * 86400000);

  const [{ data: sessions }, { data: coaches }, { data: classes }, { data: venues }, { data: clients }] =
    await Promise.all([
      supabase
        .from("class_sessions")
        .select(
          "id,starts_at,ends_at,coach_id,coach_arrived_at,capacity_override,classes!inner(id,title,description,skill_level,capacity,duration_minutes,recurrence_rule,active,venue_id,class_type,venues(name,address,postcode,lat,lng,address_details),private_class_details(address,postcode,lat,lng,access_notes,address_details))"
        )
        .eq("status", "scheduled")
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
          "id,title,description,skill_level,capacity,duration_minutes,recurrence_rule,active,venue_id,venues(name)"
        )
        .eq("class_type", "group")
        .order("title"),
      supabase.from("venues").select("id,name").eq("active", true).order("name"),
      supabase
        .from("profiles")
        .select("id,full_name,players(id,full_name)")
        .eq("role", "client")
        .order("full_name"),
    ]);

  // Each class's next scheduled session gives its canonical wall-clock slot —
  // the baseline for "every week" edits and the weekly-classes list.
  const classIds = (classes ?? []).map((c) => c.id);
  const { data: nextSessions } = classIds.length
    ? await supabase
        .from("class_sessions")
        .select("class_id,starts_at")
        .in("class_id", classIds)
        .eq("status", "scheduled")
        .gt("starts_at", new Date().toISOString())
        .order("starts_at")
    : { data: [] };
  const nextByClass = new Map<string, string>();
  for (const s of nextSessions ?? []) {
    if (!nextByClass.has(s.class_id)) nextByClass.set(s.class_id, s.starts_at);
  }
  const classTime = (classId: string, fallbackIso: string) => {
    const iso = nextByClass.get(classId) ?? fallbackIso;
    return utcToAcademyWall(new Date(iso)).time;
  };

  const rows: SessionRow[] = (sessions ?? []).map((s) => {
    const cls = s.classes as unknown as {
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
      venues: {
        name: string;
        address: string;
        postcode: string;
        lat: number;
        lng: number;
        address_details: Partial<StructuredAddress> | null;
      } | null;
      private_class_details:
        | {
            address: string;
            postcode: string;
            lat: number;
            lng: number;
            access_notes: string | null;
            address_details: Partial<StructuredAddress> | null;
          }[]
        | null;
    };
    const priv = cls.private_class_details?.[0] ?? null;
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
    return {
      id: s.id,
      starts_at: s.starts_at,
      ends_at: s.ends_at,
      coachId: s.coach_id,
      coachArrivedAt: s.coach_arrived_at,
      title: cls.title,
      capacity: s.capacity_override ?? cls.capacity,
      isPrivate: cls.class_type === "private",
      venueName: cls.venues?.name ?? null,
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
    };
  });

  const coachList = (coaches ?? []).map((c) => ({
    id: c.id,
    name: (c.profiles as unknown as { full_name: string }).full_name,
  }));

  const classRows: ClassRow[] = (classes ?? []).map((c) => {
    const next = nextByClass.get(c.id);
    return {
      id: c.id,
      title: c.title,
      description: c.description ?? "",
      level: c.skill_level,
      capacity: c.capacity,
      duration: c.duration_minutes,
      weekday: c.recurrence_rule?.match(/BYDAY=(..)/)?.[1] ?? "MO",
      time: next ? utcToAcademyWall(new Date(next)).time : "18:30",
      active: c.active,
      venueId: c.venue_id,
      venueName: (c.venues as unknown as { name: string } | null)?.name ?? null,
    };
  });

  const clientRows: ClientOption[] = (clients ?? [])
    .map((c) => ({
      id: c.id,
      name: c.full_name,
      players: ((c.players as { id: string; full_name: string }[]) ?? []).map((p) => ({
        id: p.id,
        name: p.full_name,
      })),
    }))
    .filter((c) => c.players.length > 0);

  const rangeLabel = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kolkata",
  });
  const navBtn =
    "rounded-[8px] border border-line px-4 py-2 text-sm hover:border-ember hover:text-ember";

  return (
    <AdminShell title="Calendar">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href={`/admin/calendar?week=${weekOffset - 1}`} className={navBtn}>
            ← Earlier
          </Link>
          {weekOffset !== 0 && (
            <Link href="/admin/calendar" className={navBtn}>
              This week
            </Link>
          )}
          <Link href={`/admin/calendar?week=${weekOffset + 1}`} className={navBtn}>
            Later →
          </Link>
        </div>
        <p className="tnum text-sm text-fg-2">
          {rangeLabel.format(from)} – {rangeLabel.format(new Date(to.getTime() - 86400000))}
          {weekOffset === 0 ? " (this week)" : ""}
        </p>
      </div>
      <AdminCalendar
        sessions={rows}
        coaches={coachList}
        classes={classRows}
        venues={venues ?? []}
        clients={clientRows}
      />
    </AdminShell>
  );
}
