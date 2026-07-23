import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { AdminShell } from "@/components/app/AdminShell";
import { SignOutButton } from "@/components/app/SignOutButton";

export const metadata: Metadata = { title: "More" };

const items = [
  {
    href: "/admin/coaches",
    label: "Coaches",
    hint: "Profiles, availability & time off",
  },
  {
    href: "/admin/skills",
    label: "Skills",
    hint: "Skill categories & rating metrics",
  },
  {
    href: "/admin/venues",
    label: "Venues",
    hint: "Locations & courts",
  },
  {
    href: "/admin/billing",
    label: "Billing",
    hint: "Invoices, overdue payments & billing",
  },
  {
    href: "/admin/settings",
    label: "Settings",
    hint: "Booking rules, buffers & install app",
  },
];

export default async function AdminMorePage() {
  await requireUser("/admin/more");

  return (
    <AdminShell title="More" actions={<SignOutButton />}>
      <div className="mx-auto max-w-xl space-y-6">
        <nav aria-label="More sections">
          <ul className="divide-y divide-line rounded-[12px] border border-line bg-surface-2">
            {items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="flex items-center justify-between gap-3 px-5 py-4 transition-colors hover:text-ember"
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
      </div>
    </AdminShell>
  );
}
