import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { utcToAcademyWall } from "@/lib/academy-time";
import { AdminShell } from "@/components/app/AdminShell";
import { AdminWeeklyClasses } from "@/components/app/AdminWeeklyClasses";
import type { ClassRow, ClientOption, InviteOption } from "@/components/app/admin-calendar-types";

export const metadata: Metadata = { title: "Weekly classes" };

// The repeating classes behind the schedule — create, edit, pause and end
// them here. The Schedule tab shows the sessions they generate.
export default async function AdminWeeklyPage() {
  const { supabase } = await requireUser("/admin/weekly");

  const [{ data: classes }, { data: coaches }, { data: venues }, { data: clients }, { data: invites }] =
    await Promise.all([
      supabase
        .from("classes")
        .select(
          "id,title,description,skill_level,capacity,duration_minutes,recurrence_rule,active,ends_on,venue_id,is_school,venues(name)"
        )
        .eq("class_type", "group")
        .order("title"),
      supabase
        .from("coaches")
        .select("id,active,profiles!inner(full_name)")
        .eq("active", true),
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

  // Each class's canonical slot time = its next scheduled session's wall time.
  const classIds = (classes ?? []).map((c) => c.id);
  const { data: nextSessions } = classIds.length
    ? await supabase
        .from("class_sessions")
        .select("class_id,starts_at")
        .in("class_id", classIds)
        .eq("status", "scheduled")
        .gt("starts_at", new Date().toISOString())
        .order("starts_at")
    : { data: [] as { class_id: string; starts_at: string }[] };

  const nextByClass = new Map<string, string>();
  for (const s of nextSessions ?? []) {
    if (!nextByClass.has(s.class_id)) nextByClass.set(s.class_id, s.starts_at);
  }

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
      endsOn: c.ends_on,
      venueId: c.venue_id,
      venueName: (c.venues as unknown as { name: string } | null)?.name ?? null,
      isSchool: c.is_school,
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

  return (
    <AdminShell title="Weekly classes">
      <AdminWeeklyClasses
        classes={classRows}
        coaches={coachList}
        venues={venues ?? []}
        clients={clientRows}
        invites={inviteRows}
      />
    </AdminShell>
  );
}
