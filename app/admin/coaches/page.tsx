import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { AdminShell } from "@/components/app/AdminShell";
import { TimeOffDecision } from "@/components/app/TimeOffDecision";
import {
  CoachManager,
  type CoachRow,
  type PendingCoachRow,
} from "@/components/app/CoachManager";

export const metadata: Metadata = { title: "Coaches" };

export default async function AdminCoachesPage() {
  const { supabase } = await requireUser("/admin/coaches");
  const [{ data: coaches }, { data: pendingTimeOff }, { data: invites }] = await Promise.all([
    supabase
      .from("coaches")
      .select(
        "id,bio,travel_radius_km,max_teachable_level,dbs_checked,tier,active,profiles!inner(full_name,email,phone)"
      )
      .order("active", { ascending: false })
      .order("tier", { ascending: false }),
    supabase
      .from("coach_time_off")
      .select("id,coach_id,starts_at,ends_at,reason,profiles!coach_time_off_coach_id_fkey(full_name)")
      .eq("status", "pending"),
    supabase
      .from("coach_invites")
      .select("id,full_name,email,phone,bio,tier,max_teachable_level,travel_radius_km,dbs_checked")
      .is("claimed_at", null)
      .order("created_at", { ascending: false }),
  ]);

  const rows: CoachRow[] = (coaches ?? []).map((c) => {
    const profile = c.profiles as unknown as {
      full_name: string;
      email: string;
      phone: string | null;
    };
    return {
      id: c.id,
      name: profile.full_name,
      email: profile.email,
      phone: profile.phone ?? "",
      bio: c.bio ?? "",
      travelRadiusKm: Number(c.travel_radius_km),
      maxTeachableLevel: c.max_teachable_level,
      tier: c.tier,
      dbsChecked: c.dbs_checked,
      active: c.active,
    };
  });

  const pending: PendingCoachRow[] = (invites ?? []).map((i) => ({
    id: i.id,
    name: i.full_name ?? "",
    email: i.email,
    phone: i.phone ?? "",
    bio: i.bio ?? "",
    travelRadiusKm: Number(i.travel_radius_km),
    maxTeachableLevel: i.max_teachable_level,
    tier: i.tier,
    dbsChecked: i.dbs_checked,
  }));

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

        <CoachManager coaches={rows} pending={pending} />
      </div>
    </AdminShell>
  );
}
