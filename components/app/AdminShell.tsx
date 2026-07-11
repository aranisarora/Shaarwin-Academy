import { StudioShell } from "@/components/shells/StudioShell";

// Bottom tab bar shows the first 4; the desktop sidebar shows all of them.
const tabs = [
  { href: "/admin", label: "Inbox", icon: "●" },
  { href: "/admin/calendar", label: "Calendar", icon: "▦" },
  { href: "/admin/clients", label: "Clients", icon: "◉" },
  { href: "/admin/players", label: "Players", icon: "♟" },
  { href: "/admin/settings", label: "More", icon: "≡" },
  { href: "/admin/coaches", label: "Coaches", icon: "◎" },
  { href: "/admin/venues", label: "Venues", icon: "▲" },
  { href: "/admin/billing", label: "Billing", icon: "£" },
];

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
    <StudioShell title={title} tabs={tabs} actions={actions}>
      {children}
    </StudioShell>
  );
}
