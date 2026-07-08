import Image from "next/image";
import Link from "next/link";
import logo from "@/public/images/logo.png";
import { BottomTabBar, type TabItem } from "@/components/ui/BottomTabBar";

/**
 * Ivory app shell: top bar + BottomTabBar on mobile, left rail on ≥1024px.
 * Used by the client (/app), coach (/coach) and founder (/admin) apps.
 */
export function StudioShell({
  title,
  tabs,
  actions,
  children,
}: {
  title: string;
  tabs: TabItem[];
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div data-mood="studio" className="flex min-h-dvh bg-surface text-fg">
      <aside className="sticky top-0 hidden h-dvh w-60 flex-col border-r border-line bg-surface-2 lg:flex">
        <Link
          href="/"
          className="flex items-center gap-2 px-6 py-6 font-display text-lg"
        >
          <Image src={logo} alt="Sharwin Table Tennis Academy" className="h-16 w-auto" />
        </Link>
        <nav aria-label="Primary" className="flex flex-1 flex-col gap-1 px-3">
          {tabs.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className="flex min-h-11 items-center gap-3 rounded-[8px] px-3 text-sm font-medium text-fg-2 transition-colors hover:bg-surface hover:text-fg"
            >
              <span aria-hidden>{t.icon}</span>
              {t.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-surface/90 px-5 backdrop-blur">
          <h1 className="font-display text-lg">{title}</h1>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
        <main className="flex-1 px-5 pb-24 pt-6 lg:pb-10">{children}</main>
      </div>
      <BottomTabBar items={tabs} />
    </div>
  );
}
