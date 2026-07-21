import { StudioShell } from "@/components/shells/StudioShell";

// Desktop sidebar shows all sections directly. The mobile bottom bar fits 5,
// so it shows Inbox/Schedule/Players/Coaches and a "More" tab (→ /admin/more)
// whose hub page lists the sections that don't fit (Weekly, Venues, Billing,
// Settings), keeping every section reachable on mobile.
const tabs = [
  { href: "/admin", label: "Inbox", icon: "●" },
  { href: "/admin/schedule", label: "Schedule", icon: "▦" },
  { href: "/admin/weekly", label: "Weekly classes", icon: "↻" },
  { href: "/admin/players", label: "Players", icon: "◉" },
  { href: "/admin/coaches", label: "Coaches", icon: "◎" },
  { href: "/admin/venues", label: "Venues", icon: "▲" },
  { href: "/admin/billing", label: "Billing", icon: "£" },
  { href: "/admin/settings", label: "Settings", icon: "≡" },
];

const mobileMore = { href: "/admin/more", label: "More", icon: "≡" };
const mobileTabs = [tabs[0], tabs[1], tabs[3], tabs[4], mobileMore];

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
