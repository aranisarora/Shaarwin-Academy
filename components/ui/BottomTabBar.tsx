"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type TabItem = {
  href: string;
  label: string;
  icon?: React.ReactNode;
  /** Optional section header shown above this tab in the desktop rail only
   * (visual grouping — no route change). Consecutive tabs sharing a group
   * render one header; an undefined group renders no header. */
  group?: string;
  /** Nested shortcuts rendered indented under this tab in the desktop rail only. */
  railChildren?: React.ReactNode;
  /** Extra routes that light this tab — how "More" claims the pages that live
   * under it. Without it every screen reached through More (Coaches, Schools,
   * Venues, Skills, Billing, Settings) left the whole bar grey, so on six of
   * the eleven admin screens nothing told the founder where he was. */
  match?: string[];
};

/** Fixed bottom tab bar — max 5 items, 44px+ targets, safe-area inset. */
export function BottomTabBar({ items }: { items: TabItem[] }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface-2 lg:hidden"
    >
      <div className="grid auto-cols-fr grid-flow-col">
        {items.slice(0, 5).map((item) => {
          // `=== p || startsWith(p + "/")` rather than a bare startsWith, so a
          // future /admin/schoolsomething can't light the /admin/schools tab.
          const active =
            pathname === item.href ||
            (item.href !== "/app" &&
              item.href !== "/coach" &&
              item.href !== "/admin" &&
              pathname.startsWith(item.href)) ||
            (item.match?.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ?? false);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`pressable-row flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium uppercase tracking-[0.08em] ${
                active ? "text-ember" : "text-fg-2"
              }`}
            >
              <span aria-hidden className="text-lg leading-none">
                {item.icon}
              </span>
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
