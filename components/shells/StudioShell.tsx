import Image from "next/image";
import Link from "next/link";
import logo from "@/public/images/logo.png";
import { BottomTabBar, type TabItem } from "@/components/ui/BottomTabBar";

/**
 * Ivory app shell: top bar + BottomTabBar on mobile, left rail on ≥1024px.
 *
 * This is the shell the founder's admin lived in before the academy moved to
 * WhatsApp, kept for the one screen that stayed behind — the schedule — so the
 * page he opens from his thread is the page he already knows. Same bar, same
 * rail, same title; the tabs that used to fill it are gone.
 */
export function StudioShell({
  title,
  tabs,
  actions,
  children,
}: {
  title: React.ReactNode;
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
          {tabs.map((t) => {
            const className = `pressable-row flex min-h-11 items-center gap-3 rounded-[8px] px-3 text-sm font-medium hover:bg-surface hover:text-fg ${
              t.active ? "bg-surface text-fg" : "text-fg-2"
            }`;
            const inner = (
              <>
                <span aria-hidden className={t.active ? "text-ember" : "text-fg-2"}>
                  {t.icon}
                </span>
                {t.label}
              </>
            );
            return t.external ? (
              <a
                key={t.href}
                href={t.href}
                target="_blank"
                rel="noopener noreferrer"
                className={className}
              >
                {inner}
              </a>
            ) : (
              <Link
                key={t.href}
                href={t.href}
                aria-current={t.active ? "page" : undefined}
                className={className}
              >
                {inner}
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        {/* --header-h (globals.css) is the one place this height is written down;
            the week strip sticks to it. */}
        <header className="sticky top-0 z-30 flex h-[var(--header-h)] items-center justify-between border-b border-line bg-surface/90 px-5 backdrop-blur">
          <h1 className="font-display text-lg">{title}</h1>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
        {/* With viewport-fit=cover the tab bar is 56px plus the home indicator,
            so the bottom padding is measured from the inset instead of guessed. */}
        <main className="flex-1 px-5 pb-[calc(env(safe-area-inset-bottom)+7rem)] pt-6 lg:pb-10">
          {children}
        </main>
      </div>
      <BottomTabBar items={tabs} />
    </div>
  );
}
