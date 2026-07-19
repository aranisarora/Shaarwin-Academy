import { StudioShell } from "@/components/shells/StudioShell";

// Desktop sidebar shows all tabs, "More" last. The mobile bottom bar fits 5,
// so it keeps "More" (→ settings) in place of the tabs that don't fit.
// Weekly classes is left off the bottom bar — the Schedule tab links to it.
const tabs = [
  { href: "/admin", label: "Inbox", icon: "●" },
  { href: "/admin/schedule", label: "Schedule", icon: "▦" },
  { href: "/admin/weekly", label: "Weekly classes", icon: "↻" },
  { href: "/admin/players", label: "Players", icon: "◉" },
  { href: "/admin/coaches", label: "Coaches", icon: "◎" },
  { href: "/admin/venues", label: "Venues", icon: "▲" },
  { href: "/admin/billing", label: "Billing", icon: "£" },
  { href: "/admin/settings", label: "More", icon: "≡" },
];

const mobileTabs = [tabs[0], tabs[1], tabs[3], tabs[4], tabs[tabs.length - 1]];

export function AdminShell({
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
