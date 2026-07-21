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
        "id,bio,quote,credentials,photo_url,travel_radius_km,base_address,base_lat,base_lng,tier,active,profiles!inner(full_name,email,phone)"
      )
      .order("active", { ascending: false })
      .order("tier", { ascending: false }),
    supabase
      .from("coach_time_off")
      .select("id,coach_id,starts_at,ends_at,reason,profiles!coach_time_off_coach_id_fkey(full_name)")
      .eq("status", "pending"),
    supabase
      .from("coach_invites")
      .select("id,full_name,email,phone,bio,tier,travel_radius_km,base_address,base_lat,base_lng")
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
      quote: (c as unknown as { quote: string | null }).quote ?? "",
      credentials: (c as unknown as { credentials: string[] | null }).credentials ?? [],
      photoUrl: (c as unknown as { photo_url: string | null }).photo_url ?? "",
      travelRadiusKm: Number(c.travel_radius_km),
      baseAddress: c.base_address ?? "",
      baseLat: Number(c.base_lat),
      baseLng: Number(c.base_lng),
      tier: c.tier,
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
    baseAddress: (i as unknown as { base_address: string | null }).base_address ?? "",
    baseLat: Number((i as unknown as { base_lat: number | null }).base_lat) || 12.9716,
    baseLng: Number((i as unknown as { base_lng: number | null }).base_lng) || 77.5946,
    tier: i.tier,
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
