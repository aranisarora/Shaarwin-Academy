import { StudioShell } from "@/components/shells/StudioShell";

const tabs = [
  { href: "/app", label: "Home", icon: "●" },
  { href: "/app/book", label: "Book", icon: "◆" },
  { href: "/app/schedule", label: "Schedule", icon: "▦" },
  { href: "/app/membership", label: "More", icon: "≡" },
];

export function ClientShell({
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
