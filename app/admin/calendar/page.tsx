import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { AdminShell } from "@/components/app/AdminShell";
import { AdminCalendar } from "@/components/app/AdminCalendar";

export const metadata: Metadata = { title: "Master calendar" };

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

  const [{ data: sessions }, { data: coaches }, { data: classes }] = await Promise.all([
    supabase
      .from("class_sessions")
      .select(
        "id,starts_at,ends_at,coach_id,capacity_override,classes!inner(title,capacity,class_type,venues(name))"
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
      .select("id,title")
      .eq("class_type", "group")
      .eq("active", true)
      .order("title"),
  ]);

  const coachList = (coaches ?? []).map((c) => ({
    id: c.id,
    name: (c.profiles as unknown as { full_name: string }).full_name,
  }));

  const rows = (sessions ?? []).map((s) => {
    const cls = s.classes as unknown as {
      title: string;
      capacity: number;
      class_type: string;
      venues: { name: string } | null;
    };
    return {
      id: s.id,
      starts_at: s.starts_at,
      ends_at: s.ends_at,
      coachId: s.coach_id,
      title: cls.title,
      capacity: s.capacity_override ?? cls.capacity,
      isPrivate: cls.class_type === "private",
      venueName: cls.venues?.name ?? null,
    };
  });

  const rangeLabel = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kolkata",
  });
  const navBtn =
    "rounded-[8px] border border-line px-4 py-2 text-sm hover:border-ember hover:text-ember";

  return (
    <AdminShell title="Master calendar">
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
      <AdminCalendar sessions={rows} coaches={coachList} classes={classes ?? []} />
    </AdminShell>
  );
}
