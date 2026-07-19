import { StudioShell } from "@/components/shells/StudioShell";

// Desktop sidebar shows all tabs, "More" last. The mobile bottom bar fits 5,
// so it keeps "More" (→ settings) in place of the tabs that don't fit.
const tabs = [
  { href: "/admin", label: "Inbox", icon: "●" },
  { href: "/admin/schedule", label: "Schedule", icon: "▦" },
  { href: "/admin/players", label: "Players", icon: "◉" },
  { href: "/admin/coaches", label: "Coaches", icon: "◎" },
  { href: "/admin/venues", label: "Venues", icon: "▲" },
  { href: "/admin/billing", label: "Billing", icon: "£" },
  { href: "/admin/settings", label: "More", icon: "≡" },
];

const mobileTabs = [...tabs.slice(0, 4), tabs[tabs.length - 1]];

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
