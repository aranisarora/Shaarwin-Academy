import Link from "next/link";

// Group vs private booking used to live in two unrelated places — the "Book"
// tab opened group only, and private was reachable just from a Home button and
// the desktop rail. This pill switch sits at the top of both booking screens so
// a parent can flip between them from either page. Pure links, no state; the
// caller says which side is active.
export function BookModeSwitch({ active }: { active: "group" | "private" }) {
  const tabs = [
    { key: "group", label: "Group classes", href: "/app/book" },
    { key: "private", label: "Private coaching", href: "/app/book/private" },
  ] as const;
  return (
    <div className="mb-6 flex w-full max-w-sm rounded-full border border-line bg-surface-2 p-1">
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <Link
            key={t.key}
            href={t.href}
            aria-current={on ? "page" : undefined}
            className={`inline-flex min-h-9 flex-1 items-center justify-center rounded-full px-4 text-sm font-medium transition-colors ${
              on ? "bg-ember text-ivory" : "text-fg-2 hover:text-fg"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
