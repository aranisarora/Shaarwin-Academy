import { StudioShell } from "@/components/shells/StudioShell";
import {
  CalendarIcon,
  CoachIcon,
  DotsIcon,
  GearIcon,
  HomeIcon,
  MapPinIcon,
  PeopleIcon,
  ReceiptIcon,
  RepeatIcon,
  StarIcon,
} from "@/components/ui/icons";

// Desktop rail groups the sections by frequency of use (daily loop → people →
// setup) so it reads like the founder's mental model, not a flat list of tables.
// The mobile bottom bar fits 5: Today · Schedule · Weekly · Players · More.
// Coaches lives in More — his coach interactions (approvals, covers) surface as
// deep-links on Today — so Weekly (where classes are created) keeps a bar slot
// during the migration phase when he needs it most.
const tabs = [
  { href: "/admin", label: "Today", icon: <HomeIcon /> },
  { href: "/admin/schedule", label: "Schedule", icon: <CalendarIcon /> },
  { href: "/admin/weekly", label: "Weekly classes", icon: <RepeatIcon /> },
  { href: "/admin/players", label: "Players", icon: <PeopleIcon />, group: "People" },
  { href: "/admin/coaches", label: "Coaches", icon: <CoachIcon />, group: "People" },
  { href: "/admin/skills", label: "Skills", icon: <StarIcon />, group: "Setup" },
  { href: "/admin/venues", label: "Venues", icon: <MapPinIcon />, group: "Setup" },
  { href: "/admin/billing", label: "Billing", icon: <ReceiptIcon />, group: "Setup" },
  { href: "/admin/settings", label: "Settings", icon: <GearIcon />, group: "Setup" },
];

const mobileMore = { href: "/admin/more", label: "More", icon: <DotsIcon /> };
// Today · Schedule · Weekly · Players · More
const mobileTabs = [tabs[0], tabs[1], tabs[2], tabs[3], mobileMore];

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
