import Image from "next/image";
import Link from "next/link";
import logo from "@/public/images/logo.png";
import { BottomTabBar, type TabItem } from "@/components/ui/BottomTabBar";
import { OfflineBanner } from "@/components/app/OfflineBanner";

/**
 * Ivory app shell: top bar + BottomTabBar on mobile, left rail on ≥1024px.
 * Used by the client (/app), coach (/coach) and founder (/admin) apps.
 */
export function StudioShell({
  title,
  tabs,
  mobileTabs,
  actions,
  children,
}: {
  title: React.ReactNode;
  tabs: TabItem[];
  /** Optional override for the mobile bottom bar (max 5 shown); defaults to `tabs`. */
  mobileTabs?: TabItem[];
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
          {tabs.map((t, i) => {
            // A group header renders once, above the first tab that carries it.
            const showHeader = t.group && t.group !== tabs[i - 1]?.group;
            return (
              <div key={t.href}>
                {showHeader && (
                  <p className="label px-3 pb-1 pt-4 text-fg-2">{t.group}</p>
                )}
                <Link
                  href={t.href}
                  className="pressable-row flex min-h-11 items-center gap-3 rounded-[8px] px-3 text-sm font-medium text-fg-2 hover:bg-surface hover:text-fg"
                >
                  <span aria-hidden className="text-fg-2">
                    {t.icon}
                  </span>
                  {t.label}
                </Link>
                {t.railChildren}
              </div>
            );
          })}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        {/* The offline strip lives here, in flow, rather than pinned over the
            page by whichever layout mounted it. Anything floating at
            --header-h lands on the admin week pager and hides the arrows it
            was reassuring you still work; from here it simply pushes the
            header — and everything measured off it — down by its own height,
            and only for as long as the connection is gone. Inside the content
            column, too, so it stops short of the desktop rail. */}
        <OfflineBanner />
        {/* --header-h (globals.css) is the one place this height is written down;
            the admin week pager hangs off it. */}
        <header className="sticky top-0 z-30 flex h-[var(--header-h)] items-center justify-between border-b border-line bg-surface/90 px-5 backdrop-blur">
          <h1 className="font-display text-lg">{title}</h1>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
        {/* With viewport-fit=cover the tab bar is 56px plus the home indicator,
            so the old flat pb-24 (96px) would have left the last card six pixels
            clear of it. Measure from the inset instead of guessing. */}
        <main className="flex-1 px-5 pb-[calc(env(safe-area-inset-bottom)+7rem)] pt-6 lg:pb-10">
          {children}
        </main>
      </div>
      <BottomTabBar items={mobileTabs ?? tabs} />
    </div>
  );
}
