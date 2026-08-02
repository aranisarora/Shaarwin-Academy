import type { Metadata } from "next";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { SchoolShell } from "@/components/app/SchoolShell";
import { PlayerRoster } from "@/components/app/PlayerRoster";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageSkeleton, Skeleton } from "@/components/ui/Skeleton";
import { getCampuses, getRoster, campusLabel, pupilMeta } from "@/lib/school";

export const metadata: Metadata = { title: "Pupils" };

/** Streamed under the shell — the roll-up needs auth, the chrome does not. */
async function Roster() {
  const { supabase } = await requireUser("/school");
  const campuses = await getCampuses(supabase);
  const pupils = await getRoster(
    supabase,
    campuses.map((c) => c.venueId)
  );

  if (pupils.length === 0) {
    return (
      <EmptyState
        image="/images/empty-ivory.jpg"
        copy="Your pupils will appear here once the coaches have registered them in a session."
      />
    );
  }

  return (
    <PlayerRoster
      hrefBase="/school/players"
      players={pupils.map((p) => ({ ...p, meta: pupilMeta(p) }))}
    />
  );
}

/** The campus name, streamed separately so the bar paints before the query. */
async function Title() {
  const { supabase } = await requireUser("/school");
  return <>{campusLabel(await getCampuses(supabase))}</>;
}

export default function SchoolPupilsPage() {
  return (
    <SchoolShell
      title={
        <Suspense fallback={<Skeleton className="h-6 w-32" />}>
          <Title />
        </Suspense>
      }
    >
      <div className="mx-auto max-w-2xl">
        <Suspense fallback={<PageSkeleton />}>
          <Roster />
        </Suspense>
      </div>
    </SchoolShell>
  );
}
