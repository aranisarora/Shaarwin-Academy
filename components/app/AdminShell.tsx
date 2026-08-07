import { StudioShell } from "@/components/shells/StudioShell";
import type { TabItem } from "@/components/ui/BottomTabBar";
import {
  BellIcon,
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
//
// Notifications sits in the daily loop, not under Setup: /admin/notifications is
// the only surface that renders eleven of the thirteen ops_* feed types, and a
// push banner keeps no history — dismiss one and the row behind it was, until
// now, reachable only through a link buried in the settings screen.
const tabs = [
  { href: "/admin", label: "Today", icon: <HomeIcon /> },
  { href: "/admin/schedule", label: "Schedule", icon: <CalendarIcon /> },
  { href: "/admin/weekly", label: "Weekly classes", icon: <RepeatIcon /> },
  { href: "/admin/notifications", label: "Notifications", icon: <BellIcon /> },
  { href: "/admin/players", label: "Players", icon: <PeopleIcon />, group: "People" },
  { href: "/admin/coaches", label: "Coaches", icon: <CoachIcon />, group: "People" },
  { href: "/admin/skills", label: "Skills", icon: <StarIcon />, group: "Setup" },
  { href: "/admin/venues", label: "Venues", icon: <MapPinIcon />, group: "Setup" },
  { href: "/admin/schools", label: "Schools", icon: <PeopleIcon />, group: "Setup" },
  { href: "/admin/billing", label: "Billing", icon: <ReceiptIcon />, group: "Setup" },
  { href: "/admin/settings", label: "Settings", icon: <GearIcon />, group: "Setup" },
];

// Today · Schedule · Weekly · Players · More. Matched by href rather than by
// index: the bar used to read tabs[0..3], so adding a single entry to the rail
// above would otherwise have pushed Players silently out of it.
const inBar = ["/admin", "/admin/schedule", "/admin/weekly", "/admin/players"];
// More owns every tab that isn't in the bar, so those screens light it instead
// of leaving the whole row grey. Derived from `tabs` rather than listed again,
// so promoting a section into the bar takes it out of More by construction.
const mobileMore = {
  href: "/admin/more",
  label: "More",
  icon: <DotsIcon />,
  match: tabs.filter((t) => !inBar.includes(t.href)).map((t) => t.href),
};
// "Weekly classes" wraps to two lines at 11px on every phone width. Nothing is
// cut off — but two lines grow the bar past its 56px floor, and because each
// tab centres itself in the stretched row, Weekly's icon ends up sitting eight
// pixels above the other four. That crooked row is what reads as overflow.
// "Weekly" holds one line down to a 253px viewport, so it is safe anywhere.
// Third time we've made this trade — Notifications → Alerts on the coach bar,
// "Book group class" → Book on the client one: the rail has room for the full
// name, the bar does not, and the page heading and tab title still say "Weekly
// classes" so the whole name introduces itself on arrival.
//
// The copy is the load-bearing part: filter() hands back the very same objects
// as `tabs`, so renaming one in place would rename the desktop rail with it.
const mobileTabs: TabItem[] = [
  ...tabs
    .filter((t) => inBar.includes(t.href))
    .map((t) => (t.href === "/admin/weekly" ? { ...t, label: "Weekly" } : t)),
  mobileMore,
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
    <StudioShell title={title} tabs={tabs} mobileTabs={mobileTabs} actions={actions}>
      {children}
    </StudioShell>
  );
}
