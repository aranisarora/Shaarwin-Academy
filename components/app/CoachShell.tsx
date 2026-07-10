import { StudioShell } from "@/components/shells/StudioShell";

const tabs = [
  { href: "/coach", label: "Schedule", icon: "▦" },
  { href: "/coach/clients", label: "Clients", icon: "◎" },
  { href: "/coach/more", label: "More", icon: "≡" },
];

export function CoachShell({
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
