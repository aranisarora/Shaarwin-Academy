import { StudioShell } from "@/components/shells/StudioShell";

const tabs = [
  { href: "/coach", label: "Today", icon: "●" },
  { href: "/coach/calendar", label: "Calendar", icon: "▦" },
  { href: "/coach/clients", label: "Clients", icon: "◎" },
  { href: "/coach/more", label: "More", icon: "≡" },
];

export function CoachShell({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <StudioShell title={title} tabs={tabs} actions={actions}>
      {children}
    </StudioShell>
  );
}
