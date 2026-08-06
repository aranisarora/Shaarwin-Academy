import type { Metadata } from "next";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { AdminShell } from "@/components/app/AdminShell";
import { SchoolManager } from "@/components/app/SchoolManager";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { listSchoolsCore } from "@/lib/admin-ops-schools";

export const metadata: Metadata = { title: "Schools" };

/** Streamed under the shell — the list needs auth, the chrome does not. */
async function Schools() {
  const { supabase } = await requireUser("/admin/schools");
  return <SchoolManager schools={await listSchoolsCore(supabase)} />;
}

export default function AdminSchoolsPage() {
  return (
    <AdminShell title="Schools">
      <div className="mx-auto max-w-3xl space-y-6">
        <p className="text-sm text-fg-2">
          Every campus you&apos;ve marked as a school in the Venues tab. Each one
          has a login that sees its own pupils — progress, attendance and coach
          notes — and can change nothing. Tap a school to read its password back
          and send it on. Everyone there shares the same login, so the last line
          of each row tells you whether anyone has used it yet.
        </p>
        <Suspense fallback={<PageSkeleton />}>
          <Schools />
        </Suspense>
      </div>
    </AdminShell>
  );
}
