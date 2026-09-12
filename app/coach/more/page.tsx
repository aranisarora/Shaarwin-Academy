import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { effectiveCoachId } from "@/lib/coach-preview";
import { CoachShell } from "@/components/app/CoachShell";
import { CoachProfileEditor } from "@/components/app/CoachProfileEditor";
import { WhatsAppAssistantCard } from "@/components/app/WhatsAppAssistantCard";
import { InstallAppCard } from "@/components/app/InstallAppCard";
import { SignOutButton } from "@/components/app/SignOutButton";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { BENGALURU } from "@/lib/coverage";

export const metadata: Metadata = { title: "More" };

/** Profile only — streamed, so the shell and its links paint first. */
async function Settings() {
  const { supabase, user, profile } = await requireUser("/coach/more");
  const coachId = await effectiveCoachId(user.id);
  const { data: coach } = await supabase
    .from("coaches")
    .select("bio,base_lat,base_lng,base_address")
    .eq("id", coachId)
    .maybeSingle();

  return (
    <CoachProfileEditor
      fullName={profile.full_name}
      bio={coach?.bio ?? ""}
      baseLat={coach?.base_lat ?? BENGALURU.lat}
      baseLng={coach?.base_lng ?? BENGALURU.lng}
      baseAddress={coach?.base_address ?? ""}
    />
  );
}

export default function CoachMorePage() {
  return (
    <CoachShell title="More" actions={<SignOutButton />}>
      <div className="mx-auto max-w-2xl space-y-8">
        <Suspense fallback={<PageSkeleton />}>
          <Settings />
        </Suspense>
        {/* Everything below needs no data, so it stays outside the boundary and
            lands in the first flush. */}
        <WhatsAppAssistantCard />
        <Link
          href="/coach/skills"
          className="flex items-center justify-between gap-3 rounded-[12px] border border-line bg-surface-2 px-5 py-4 transition-colors hover:text-ember"
        >
          <span>
            <span className="block font-medium">Skills</span>
            <span className="block text-sm text-fg-2">
              Rating metrics for assessments
            </span>
          </span>
          <span aria-hidden className="text-fg-2">
            →
          </span>
        </Link>
        <InstallAppCard />
      </div>
    </CoachShell>
  );
}
