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
      {/* No preamble. It explained what a school login is, what it can see and
          what the third line of each row means — to the one person who already
          knows, on the screen he opens to fetch a password. The rows say it. */}
      <div className="mx-auto max-w-3xl">
        <Suspense fallback={<PageSkeleton />}>
          <Schools />
        </Suspense>
      </div>
    </AdminShell>
  );
}
