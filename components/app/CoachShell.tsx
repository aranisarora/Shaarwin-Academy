import { StudioShell } from "@/components/shells/StudioShell";
import { CalendarIcon, DotsIcon, PeopleIcon } from "@/components/ui/icons";

const tabs = [
  { href: "/coach", label: "Schedule", icon: <CalendarIcon /> },
  { href: "/coach/players", label: "Players", icon: <PeopleIcon /> },
  { href: "/coach/more", label: "More", icon: <DotsIcon /> },
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
