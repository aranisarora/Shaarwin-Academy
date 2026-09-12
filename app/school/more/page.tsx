import type { Metadata } from "next";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { SchoolShell } from "@/components/app/SchoolShell";
import { SignOutButton } from "@/components/app/SignOutButton";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { InstallAppCard } from "@/components/app/InstallAppCard";
import { getCampuses } from "@/lib/school";

export const metadata: Metadata = { title: "More" };

/**
 * Who this account is and which campuses it covers. Nothing editable — a school
 * login is read-only, so there is no profile form here. To change the email or
 * the password, the academy does it and re-shares the credentials.
 */
async function Account() {
  const { supabase, profile } = await requireUser("/school/more");
  const campuses = await getCampuses(supabase);

  return (
    <div className="space-y-6">
      <div className="rounded-[12px] border border-line bg-surface-2 px-5 py-4">
        <p className="label mb-1">Signed in as</p>
        <p className="font-medium">{profile.full_name}</p>
        <p className="text-sm text-fg-2">{profile.email}</p>
      </div>

      <div>
        <p className="label mb-3">{campuses.length === 1 ? "Campus" : "Campuses"}</p>
        {campuses.length === 0 ? (
          <p className="text-sm text-fg-2">
            No campus is linked to this account yet — the academy can put that right.
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-[12px] border border-line bg-surface-2">
            {campuses.map((c) => (
              <li key={c.venueId} className="px-5 py-4">
                <p className="font-medium">{c.name}</p>
                {c.unit && <p className="text-sm text-fg-2">{c.unit}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-sm text-fg-2">
        Pupils are registered by the coaches during a session, so this list keeps
        itself up to date. If someone is missing or shouldn&apos;t be here, tell the
        academy and they&apos;ll sort it.
      </p>
    </div>
  );
}

export default function SchoolMorePage() {
  return (
    <SchoolShell title="More" actions={<SignOutButton />}>
      <div className="mx-auto max-w-2xl space-y-8">
        <Suspense fallback={<PageSkeleton />}>
          <Account />
        </Suspense>
        <InstallAppCard />
      </div>
    </SchoolShell>
  );
}
