import type { Metadata } from "next";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { AdminShell } from "@/components/app/AdminShell";
import { DeepLinkFocus } from "@/components/app/DeepLinkFocus";
import { PageSkeleton } from "@/components/ui/Skeleton";
import {
  CoachManager,
  type CoachRow,
  type PendingCoachRow,
} from "@/components/app/CoachManager";
import { BENGALURU } from "@/lib/coverage";

export const metadata: Metadata = { title: "Coaches" };

type SearchParams = Promise<{ coach?: string }>;

async function Coaches({ searchParams }: { searchParams: SearchParams }) {
  const [{ supabase }, { coach: focusCoach }] = await Promise.all([
    requireUser("/admin/coaches"),
    searchParams,
  ]);
  const [{ data: coaches }, { data: invites }] = await Promise.all([
    supabase
      .from("coaches")
      .select(
        "id,bio,quote,credentials,photo_url,base_address,base_lat,base_lng,active,profiles!inner(full_name,email,phone)"
      )
      .order("active", { ascending: false })
      .order("created_at"),
    supabase
      .from("coach_invites")
      .select("id,full_name,email,phone,bio,base_address,base_lat,base_lng")
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
      <CoachManager coaches={rows} pending={pending} />
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
