import { StudioShell } from "@/components/shells/StudioShell";
import { DotsIcon, PeopleIcon } from "@/components/ui/icons";

// Two tabs, because the school does exactly two things: look at its pupils, and
// sign out. It is a read-only account by design — nothing here writes.
const tabs = [
  { href: "/school", label: "Pupils", icon: <PeopleIcon /> },
  { href: "/school/more", label: "More", icon: <DotsIcon /> },
];

export function SchoolShell({
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
