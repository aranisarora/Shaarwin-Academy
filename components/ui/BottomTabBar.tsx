import Link from "next/link";

export type TabItem = {
  href: string;
  label: string;
  icon?: React.ReactNode;
  /** Lit in ember. Decided by the page rather than read off the URL: there is
   *  one screen behind this bar now, so it knows where it is. */
  active?: boolean;
  /** Leaves the site — the WhatsApp thread. A plain anchor in a new tab, so
   *  the schedule is still here when he comes back. */
  external?: boolean;
};

/** Fixed bottom tab bar — max 5 items, 44px+ targets, safe-area inset. */
export function BottomTabBar({ items }: { items: TabItem[] }) {
  return (
    <nav
      aria-label="Primary"
      className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface-2 lg:hidden"
    >
      <div className="grid auto-cols-fr grid-flow-col">
        {items.slice(0, 5).map((item) => {
          const className = `pressable-row flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium uppercase tracking-[0.08em] ${
            item.active ? "text-ember" : "text-fg-2"
          }`;
          const inner = (
            <>
              <span aria-hidden className="text-lg leading-none">
                {item.icon}
              </span>
              {item.label}
            </>
          );
          return item.external ? (
            <a
              key={item.href}
              href={item.href}
              target="_blank"
              rel="noopener noreferrer"
              className={className}
            >
              {inner}
            </a>
          ) : (
            <Link
              key={item.href}
              href={item.href}
              aria-current={item.active ? "page" : undefined}
              className={className}
            >
              {inner}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
