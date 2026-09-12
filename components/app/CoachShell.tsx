import { StudioShell } from "@/components/shells/StudioShell";
import { BellIcon, CalendarIcon, DotsIcon, PeopleIcon } from "@/components/ui/icons";

// Notifications earns a tab because a push banner has no history. Someone who
// swipes one away mid-class has no other way back to what it said, and the only
// link to the list used to sit inside the push card on /coach/more — the one
// screen a coach in that position is not looking at.
const tabs = [
  { href: "/coach", label: "Schedule", icon: <CalendarIcon /> },
  { href: "/coach/players", label: "Players", icon: <PeopleIcon /> },
  { href: "/coach/notifications", label: "Notifications", icon: <BellIcon /> },
  { href: "/coach/more", label: "More", icon: <DotsIcon /> },
];

// "Notifications" doesn't fit an 11px uppercase tab label on a narrow phone,
// and the bar is where a coach reads it. Same destination, shorter word.
const mobileTabs = [tabs[0], tabs[1], { ...tabs[2], label: "Alerts" }, tabs[3]];

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
    <StudioShell title={title} tabs={tabs} mobileTabs={mobileTabs} actions={actions}>
      {children}
    </StudioShell>
  );
}
