import { StudioShell } from "@/components/shells/StudioShell";
import type { TabItem } from "@/components/ui/BottomTabBar";
import {
  BellIcon,
  CalendarIcon,
  CoachIcon,
  DotsIcon,
  GearIcon,
  MapPinIcon,
  PeopleIcon,
  ReceiptIcon,
  StarIcon,
} from "@/components/ui/icons";

// Desktop rail groups the sections by frequency of use (daily loop → people →
// setup) so it reads like the founder's mental model, not a flat list of tables.
// The mobile bottom bar holds four: Schedule · Players · Alerts · More.
//
// It used to hold five, three of which were one screen each for the same thing.
// Today led with a list of today's classes that was, to the row, the Schedule's
// first day — the same data through the same card — and Weekly was the
// repeating classes behind that same schedule. Today is gone (its one unique
// asset, the needs-you list, moved to Alerts) and Weekly is now a view inside
// Schedule.
//
// Four, not five. The freed slots went back into whitespace rather than being
// spent because they were there — five 20%-wide targets is a crowded row on a
// 390px phone, and Coaches is a screen he opens when a coach asks him for
// something, not one he passes through. It reads better from More, where
// anything that actually needs him reaches him as an Alert anyway.
//
// Alerts is /admin/notifications: the only surface that renders eleven of the
// thirteen ops_* feed types, and now also the queue of things waiting on him.
// A push banner keeps no history — dismiss one and the row behind it used to be
// reachable only through a link buried in the settings screen.
const tabs = [
  { href: "/admin/schedule", label: "Schedule", icon: <CalendarIcon /> },
  { href: "/admin/notifications", label: "Alerts", icon: <BellIcon /> },
  { href: "/admin/players", label: "Players", icon: <PeopleIcon />, group: "People" },
  { href: "/admin/coaches", label: "Coaches", icon: <CoachIcon />, group: "People" },
  { href: "/admin/skills", label: "Skills", icon: <StarIcon />, group: "Setup" },
  { href: "/admin/venues", label: "Venues", icon: <MapPinIcon />, group: "Setup" },
  { href: "/admin/schools", label: "Schools", icon: <PeopleIcon />, group: "Setup" },
  { href: "/admin/billing", label: "Billing", icon: <ReceiptIcon />, group: "Setup" },
  { href: "/admin/settings", label: "Settings", icon: <GearIcon />, group: "Setup" },
];

// Schedule · Players · Alerts · More. Matched by href rather than by index: the
// bar used to read tabs[0..3], so adding a single entry to the rail above would
// otherwise have pushed Players silently out of it.
const inBar = ["/admin/schedule", "/admin/players", "/admin/notifications"];
// More owns every tab that isn't in the bar, so those screens light it instead
// of leaving the whole row grey. Derived from `tabs` rather than listed again,
// so promoting a section into the bar takes it out of More by construction.
const mobileMore = {
  href: "/admin/more",
  label: "More",
  icon: <DotsIcon />,
  match: tabs.filter((t) => !inBar.includes(t.href)).map((t) => t.href),
};
// Every bar label now holds one line at 11px on any phone, so nothing needs
// shortening for the bar the way "Weekly classes" → "Weekly" once did. The
// order follows the day: what's on, who it's for, who's teaching it, what needs
// you, everything else.
const mobileTabs: TabItem[] = [
  ...inBar.map((href) => tabs.find((t) => t.href === href)!),
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
