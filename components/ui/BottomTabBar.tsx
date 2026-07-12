"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type TabItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
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
          const active =
            pathname === item.href ||
            (item.href !== "/app" &&
              item.href !== "/coach" &&
              item.href !== "/admin" &&
              pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium uppercase tracking-[0.08em] ${
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
