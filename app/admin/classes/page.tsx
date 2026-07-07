import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { utcToAcademyWall } from "@/lib/academy-time";
import { AdminShell } from "@/components/app/AdminShell";
import { ClassManager, type ClassRow } from "@/components/app/ClassManager";

export const metadata: Metadata = { title: "Classes" };

export default async function AdminClassesPage() {
  const { supabase } = await requireUser("/admin/classes");
  const [{ data: classes }, { data: venues }, { data: coaches }] = await Promise.all([
    supabase
      .from("classes")
      .select(
        "id,title,description,skill_level,capacity,duration_minutes,recurrence_rule,active,venue_id,venues(name)"
      )
      .eq("class_type", "group")
      .order("title"),
    supabase.from("venues").select("id,name").eq("active", true).order("name"),
    supabase
      .from("coaches")
      .select("id,profiles!inner(full_name)")
      .eq("active", true),
  ]);

  // Each class's next session gives us its wall-clock time for the edit form.
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

  const classRows: ClassRow[] = (classes ?? []).map((c) => {
    const next = nextByClass.get(c.id);
    const wall = next ? utcToAcademyWall(new Date(next)) : null;
    return {
      id: c.id,
      title: c.title,
      description: c.description ?? "",
      level: c.skill_level,
      capacity: c.capacity,
      duration: c.duration_minutes,
      weekday: c.recurrence_rule?.match(/BYDAY=(..)/)?.[1] ?? "MO",
      time: wall?.time ?? "18:30",
      active: c.active,
      venueId: c.venue_id,
      venueName: (c.venues as unknown as { name: string } | null)?.name ?? null,
    };
  });

  const coachRows = (coaches ?? []).map((c) => ({
    id: c.id,
    name: (c.profiles as unknown as { full_name: string }).full_name,
  }));

  return (
    <AdminShell title="Classes">
      <div className="mx-auto max-w-3xl">
        <ClassManager classes={classRows} venues={venues ?? []} coaches={coachRows} />
      </div>
    </AdminShell>
  );
}
