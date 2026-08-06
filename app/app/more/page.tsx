import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { ClientShell } from "@/components/app/ClientShell";
import { SignOutButton } from "@/components/app/SignOutButton";
import { Skeleton } from "@/components/ui/Skeleton";

export const metadata: Metadata = { title: "More" };

const items = [
  {
    href: "/app/membership",
    label: "Membership & payments",
    hint: "Your plan, free trial, one-off classes",
  },
  {
    href: "/app/players",
    label: "Players",
    hint: "Attendance, progress & coach notes",
  },
  {
    href: "/app/profile",
    label: "Profile & household",
    hint: "Your details, address, add or remove players",
  },
  {
    href: "/app/notifications",
    label: "Notifications",
    hint: "What we send you, and where",
  },
];

/** The only part of this screen that reads anything — everything else is links. */
async function Identity() {
  const { profile } = await requireUser("/app/more");
  return (
    <>
      <p className="font-display text-2xl">{profile.full_name}</p>
      <p className="text-sm text-fg-2">{profile.email}</p>
    </>
  );
}

export default function MorePage() {
  return (
    <ClientShell title="More">
      <div className="mx-auto max-w-xl space-y-6">
        <div>
          <Suspense
            fallback={
              <>
                <Skeleton className="h-8 w-48" />
                <Skeleton className="mt-1 h-4 w-56" />
              </>
            }
          >
            <Identity />
          </Suspense>
        </div>

        <nav aria-label="Account">
          <ul className="divide-y divide-line rounded-[12px] border border-line bg-surface-2">
            {items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="pressable-row flex items-center justify-between gap-3 px-5 py-4 hover:text-ember"
                >
                  <span>
                    <span className="block font-medium">{item.label}</span>
                    <span className="block text-sm text-fg-2">{item.hint}</span>
                  </span>
                  <span aria-hidden className="text-fg-2">
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <SignOutButton />
      </div>
    </ClientShell>
  );
}
