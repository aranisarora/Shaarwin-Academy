import type { Metadata } from "next";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { formatDate, formatDateFull } from "@/lib/academy-time";
import { AdminShell } from "@/components/app/AdminShell";
import { DeepLinkFocus } from "@/components/app/DeepLinkFocus";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { TimeOffDecision } from "@/components/app/TimeOffDecision";
import {
  CoachManager,
  type CoachRow,
  type PendingCoachRow,
} from "@/components/app/CoachManager";
import { BENGALURU } from "@/lib/coverage";

export const metadata: Metadata = { title: "Coaches" };

type SearchParams = Promise<{ coach?: string }>;

async function Coaches({ searchParams }: { searchParams: SearchParams }) {
  // Deep-link from Today's "Time off — …" alert: focus that coach's request.
  const [{ supabase }, { coach: focusCoach }] = await Promise.all([
    requireUser("/admin/coaches"),
    searchParams,
  ]);
  const now = new Date().getTime();
  const [
    { data: coaches },
    { data: pendingTimeOff },
    { data: invites },
    { data: approvedTimeOff },
  ] = await Promise.all([
    supabase
      .from("coaches")
      .select(
        "id,bio,quote,credentials,photo_url,base_address,base_lat,base_lng,active,profiles!inner(full_name,email,phone)"
      )
      .order("active", { ascending: false })
      .order("created_at"),
    supabase
      .from("coach_time_off")
      .select("id,coach_id,starts_at,ends_at,reason,profiles!coach_time_off_coach_id_fkey(full_name)")
      .eq("status", "pending"),
    supabase
      .from("coach_invites")
      .select("id,full_name,email,phone,bio,base_address,base_lat,base_lng")
      .is("claimed_at", null)
      .order("created_at", { ascending: false }),
    // Leave he has already approved. Without this the request vanishes on
    // approval and the coach's row goes back to looking perfectly available —
    // there was no screen anywhere that answered "who is away next week".
    // Bounded to a month so leave booked for November isn't noise all autumn.
    supabase
      .from("coach_time_off")
      .select("coach_id,starts_at,ends_at")
      .eq("status", "approved")
      .gte("ends_at", new Date(now).toISOString())
      .lte("starts_at", new Date(now + 30 * 86400000).toISOString())
      .order("starts_at"),
  ]);

  // One label per coach — the soonest stretch of leave, in his words.
  const away = new Map<string, string>();
  for (const t of approvedTimeOff ?? []) {
    if (away.has(t.coach_id)) continue;
    // Short form — this sits in a badge beside the coach's name on a phone.
    away.set(
      t.coach_id,
      new Date(t.starts_at).getTime() <= now
        ? `Away till ${formatDate(t.ends_at)}`
        : `Away ${formatDate(t.starts_at)}`
    );
  }

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
      baseAddress: c.base_address ?? "",
      baseLat: Number(c.base_lat),
      baseLng: Number(c.base_lng),
      active: c.active,
    };
  });

  const pending: PendingCoachRow[] = (invites ?? []).map((i) => ({
    id: i.id,
    name: i.full_name ?? "",
    email: i.email,
    phone: i.phone ?? "",
    bio: i.bio ?? "",
    baseAddress: (i as unknown as { base_address: string | null }).base_address ?? "",
    baseLat: Number((i as unknown as { base_lat: number | null }).base_lat) || BENGALURU.lat,
    baseLng: Number((i as unknown as { base_lng: number | null }).base_lng) || BENGALURU.lng,
  }));

  return (
    <>
      <DeepLinkFocus targetId={focusCoach ? `coach-${focusCoach}` : null} />
      {(pendingTimeOff ?? []).length > 0 && (
        <div>
          <p className="mb-3 font-medium">Time off — waiting on you</p>
          <div className="space-y-2">
            {(pendingTimeOff ?? []).map((t) => (
              <div key={t.id} id={`coach-${t.coach_id}`}>
                <TimeOffDecision
                  id={t.id}
                  coachName={
                    (t.profiles as unknown as { full_name: string } | null)?.full_name ?? "Coach"
                  }
                  range={`${formatDateFull(t.starts_at)} – ${formatDateFull(t.ends_at)}`}
                  reason={t.reason}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <CoachManager coaches={rows} pending={pending} away={Object.fromEntries(away)} />
    </>
  );
}

export default function AdminCoachesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  return (
    <AdminShell title="Coaches">
      <div className="mx-auto max-w-3xl space-y-8">
        <Suspense fallback={<PageSkeleton />}>
          <Coaches searchParams={searchParams} />
        </Suspense>
      </div>
    </AdminShell>
  );
}
