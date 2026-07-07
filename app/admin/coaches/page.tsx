import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { AdminShell } from "@/components/app/AdminShell";
import { TimeOffDecision } from "@/components/app/TimeOffDecision";
import { CoachManager, type CoachRow } from "@/components/app/CoachManager";

export const metadata: Metadata = { title: "Coaches" };

export default async function AdminCoachesPage() {
  const { supabase } = await requireUser("/admin/coaches");
  const [{ data: coaches }, { data: pendingTimeOff }, { data: candidates }] = await Promise.all([
    supabase
      .from("coaches")
      .select(
        "id,bio,travel_radius_km,max_teachable_level,dbs_checked,tier,active,profiles!inner(full_name,email)"
      )
      .order("active", { ascending: false })
      .order("tier", { ascending: false }),
    supabase
      .from("coach_time_off")
      .select("id,coach_id,starts_at,ends_at,reason,profiles!coach_time_off_coach_id_fkey(full_name)")
      .eq("status", "pending"),
    supabase
      .from("profiles")
      .select("id,full_name,email")
      .eq("role", "client")
      .is("deleted_at", null)
      .order("full_name")
      .limit(300),
  ]);

  const rows: CoachRow[] = (coaches ?? []).map((c) => {
    const profile = c.profiles as unknown as { full_name: string; email: string };
    return {
      id: c.id,
      name: profile.full_name,
      email: profile.email,
      bio: c.bio ?? "",
      travelRadiusKm: Number(c.travel_radius_km),
      maxTeachableLevel: c.max_teachable_level,
      tier: c.tier,
      dbsChecked: c.dbs_checked,
      active: c.active,
    };
  });

  return (
    <AdminShell title="Coaches">
      <div className="mx-auto max-w-3xl space-y-8">
        {(pendingTimeOff ?? []).length > 0 && (
          <div>
            <p className="label mb-3">Time off — waiting on you</p>
            <div className="space-y-2">
              {(pendingTimeOff ?? []).map((t) => (
                <TimeOffDecision
                  key={t.id}
                  id={t.id}
                  coachName={
                    (t.profiles as unknown as { full_name: string } | null)?.full_name ?? "Coach"
                  }
                  range={`${new Date(t.starts_at).toLocaleDateString("en-GB")} – ${new Date(t.ends_at).toLocaleDateString("en-GB")}`}
                  reason={t.reason}
                />
              ))}
            </div>
          </div>
        )}

        <CoachManager
          coaches={rows}
          candidates={(candidates ?? []).map((c) => ({
            id: c.id,
            name: c.full_name,
            email: c.email,
          }))}
        />
      </div>
    </AdminShell>
  );
}
