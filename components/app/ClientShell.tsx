import { Suspense } from "react";
import { StudioShell } from "@/components/shells/StudioShell";
import { PlayerRailLinks } from "@/components/app/PlayerRailLinks";
import type { TabItem } from "@/components/ui/BottomTabBar";

// The desktop rail lists players nested under the Players tab as direct
// shortcuts to each profile. The mobile bottom bar fits only 5 items, so it
// falls back to concise top-level tabs without the nesting or the split
// group/private booking entries.
const tabs: TabItem[] = [
  { href: "/app", label: "Home", icon: "●" },
  {
    href: "/app/players",
    label: "Players",
    icon: "✦",
    railChildren: (
      <Suspense fallback={null}>
        <PlayerRailLinks />
      </Suspense>
    ),
  },
  { href: "/app/book", label: "Book group class", icon: "◆" },
  { href: "/app/book/private", label: "Book private class", icon: "◈" },
  { href: "/app/schedule", label: "Schedule", icon: "▦" },
  { href: "/app/more", label: "More", icon: "≡" },
];

const mobileTabs: TabItem[] = [
  { href: "/app", label: "Home", icon: "●" },
  { href: "/app/players", label: "Players", icon: "✦" },
  { href: "/app/book", label: "Book", icon: "◆" },
  { href: "/app/schedule", label: "Schedule", icon: "▦" },
  { href: "/app/more", label: "More", icon: "≡" },
];

export function ClientShell({
  title,
  actions,
  children,
}: {
  title: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <StudioShell title={title} tabs={tabs} mobileTabs={mobileTabs} actions={actions}>
      {children}
    </StudioShell>
  );
}
