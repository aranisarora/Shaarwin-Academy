import type { Metadata } from "next";
import Link from "next/link";
import { AdminShell } from "@/components/app/AdminShell";
import { SignOutButton } from "@/components/app/SignOutButton";
import { WhatsAppAssistantCard } from "@/components/app/WhatsAppAssistantCard";

export const metadata: Metadata = { title: "More" };

// Alerts and Coaches both moved into the bottom bar, so they come off this
// list — More owns what the bar doesn't, and listing a tab in both places is
// how you end up with two doors to one room.
const items = [
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
    href: "/admin/schools",
    label: "Schools",
    hint: "Logins that let a school see its own pupils",
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

/**
 * A static list of links, so this page reads nothing at all. The `requireUser`
 * that used to sit here was a guard, not a fetch — and the proxy already
 * performs that guard (signed-in check, then a role check that sends anyone but
 * a founder to their own home) before this file runs. Calling it again bought
 * nothing and cost a Supabase round trip on every visit.
 */
export default function AdminMorePage() {
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
        {/* Came off the old Today tab. It is a standing reference — how to reach
            the assistant — not something that needs answering, so it belongs
            with the other things you go and look up rather than above the list
            of what is on today. */}
        <WhatsAppAssistantCard />
      </div>
    </AdminShell>
  );
}
