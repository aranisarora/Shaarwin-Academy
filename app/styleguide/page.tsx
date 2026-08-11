import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { Spinner } from "@/components/ui/Spinner";
import { SectionDivider } from "@/components/ui/SectionDivider";
import { EmptyState } from "@/components/ui/EmptyState";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/Tabs";
import { SessionCard } from "@/components/app/ClassCard";
import type { SessionRow } from "@/components/app/admin-calendar-types";

export const metadata: Metadata = {
  title: "Styleguide",
  robots: { index: false },
};

const tokens = [
  ["--ink", "#0B0C0F"],
  ["--ink-2", "#14161B"],
  ["--ivory", "#F4F1EA"],
  ["--paper", "#FBF9F4"],
  ["--ember", "#E8590C"],
  ["--ember-2", "#C2410C"],
  ["--smoke", "#A3A7B0"],
  ["--slate", "#5A5C63"],
  ["--line-d", "#26282E"],
  ["--line-l", "#E2DDD1"],
  ["--ok", "#3F9B63"],
  ["--ok-ink", "#226B42"],
  ["--err", "#D64545"],
] as const;

/** A session card specimen. Only a handful of these fields reach the card; the
 *  rest are filled so the row is a real SessionRow and the specimens below are
 *  the actual component rather than a drawing of it. */
function specimen(over: Partial<SessionRow>): SessionRow {
  return {
    id: "spec",
    starts_at: "",
    ends_at: "",
    status: "scheduled",
    cancelReason: null,
    coachId: "coach",
    coachArrivedAt: null,
    coachArrivalSource: null,
    coachArrivalDistanceM: null,
    title: "Session",
    capacity: 8,
    isPrivate: false,
    isSchool: false,
    venueName: "Venue",
    playerName: null,
    privatePlayerName: null,
    privateClientId: null,
    address: null,
    classId: "class",
    classActive: true,
    classDescription: "",
    classLevel: "beginner",
    classCapacity: 8,
    classDuration: 60,
    classVenueId: null,
    classWeekday: "TU",
    classTime: "09:00",
    // Null on purpose: a specimen has no standing slot, so no card grows a
    // "Moved from …" line that the state being shown has nothing to do with.
    classSlotTime: null,
    classRecurring: false,
    ...over,
  };
}

/** Specimen clock. Module scope rather than the component body, because reading
 *  the wall clock while rendering is impure and the lint rule that says so is
 *  right — this page is design-time only and 404s outside dev, so a base fixed
 *  at server start is exactly as fresh as it needs to be. */
const SPEC_NOW = Date.now();
const at = (mins: number) => new Date(SPEC_NOW + mins * 60_000).toISOString();

/**
 * Every state a session card can be in, side by side and in both moods.
 *
 * These exist because the states are otherwise unreviewable: half of them need
 * a specific wall-clock moment and a specific row in production to appear at
 * all, so "does a live class with no coach still read as urgent" could only be
 * answered by waiting for one to happen. Times are relative to render, so the
 * live cards are genuinely live.
 */
function CardSpecimens() {
  const rows: { caption: string; session: SessionRow }[] = [
    {
      caption: "Live · arrived",
      session: specimen({
        starts_at: at(-20),
        ends_at: at(40),
        isSchool: true,
        venueName: "TCIS Sarjapura",
        coachArrivedAt: at(-24),
      }),
    },
    {
      caption: "Live · not marked",
      session: specimen({ starts_at: at(-35), ends_at: at(25), venueName: "La Palazzo" }),
    },
    {
      caption: "Live · no coach — warm and red at once",
      session: specimen({
        starts_at: at(-10),
        ends_at: at(50),
        isPrivate: true,
        venueName: "Purva Seasons",
        coachId: null,
      }),
    },
    {
      caption: "Finished · arrived (the geofence one)",
      session: specimen({
        starts_at: at(-180),
        ends_at: at(-120),
        status: "completed",
        venueName: "La Palazzo",
        coachArrivedAt: at(-198),
      }),
    },
    {
      caption: "Finished · nobody marked anything",
      session: specimen({
        starts_at: at(-240),
        ends_at: at(-180),
        status: "completed",
        isSchool: true,
        venueName: "Neev Academy",
      }),
    },
    {
      caption: "Finished · private, arrived",
      session: specimen({
        starts_at: at(-300),
        ends_at: at(-240),
        status: "completed",
        isPrivate: true,
        venueName: "Divyasree",
        privatePlayerName: "Aarav",
        coachArrivedAt: at(-312),
      }),
    },
    {
      caption: "Upcoming · nothing to report",
      session: specimen({ starts_at: at(180), ends_at: at(240), isSchool: true, venueName: "Christ University" }),
    },
    {
      caption: "Upcoming · coach already there",
      session: specimen({
        starts_at: at(90),
        ends_at: at(150),
        venueName: "Prestige Mayberry",
        coachArrivedAt: at(-5),
      }),
    },
    {
      caption: "Upcoming · no coach",
      session: specimen({ starts_at: at(300), ends_at: at(360), venueName: "Meridian Park", coachId: null }),
    },
    {
      caption: "Cancelled",
      session: specimen({
        starts_at: at(-60),
        ends_at: at(0),
        status: "cancelled",
        isPrivate: true,
        venueName: "Adarsh Palm Retreat",
        cancelReason: "Family away",
      }),
    },
  ];
  return (
    <div className="mb-8" data-spec="session-cards">
      <p className="label mb-3">Session cards — every state</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {rows.map(({ caption, session }, i) => (
          <div key={i}>
            <p className="mb-1 text-xs text-fg-2">{caption}</p>
            <SessionCard session={session} coachName="Sunil Hatti" />
          </div>
        ))}
      </div>
    </div>
  );
}

function MoodPanel({ mood }: { mood: "stage" | "studio" }) {
  return (
    <section
      data-mood={mood}
      className="rounded-[12px] border border-line bg-surface p-6 text-fg sm:p-8"
    >
      <p className="label mb-6">{mood} mood</p>

      <h2 className="display-xl mb-2">Aa 36</h2>
      <p className="mb-1 font-display text-2xl">Fraunces — headlines, prices, big numerals</p>
      <p className="mb-1 text-base">Inter — everything else. App body 16px.</p>
      <p className="label mb-8">Label — 11px uppercase 0.08em</p>

      <div className="mb-8 flex flex-wrap items-center gap-3">
        <Button>Book this session</Button>
        <Button variant="ghost">How it works</Button>
        <Button variant="destructive">Cancel booking</Button>
        <ButtonLink href="/styleguide" variant="ghost">
          Link button
        </ButtonLink>
        <Spinner />
      </div>

      <div className="mb-8 flex flex-wrap gap-2">
        <Badge>Beginner</Badge>
        <Badge tone="ember">Popular</Badge>
        <Badge tone="ok">Confirmed</Badge>
        <Badge tone="err">Full</Badge>
      </div>

      <div className="mb-8 grid gap-4 sm:grid-cols-2">
        <Input label="Email" placeholder="you@club.com" hint="We never share it." />
        <Select label="Level" defaultValue="beginner">
          <option value="beginner">Beginner</option>
          <option value="intermediate">Intermediate</option>
          <option value="advanced">Advanced</option>
        </Select>
      </div>

      <Card className="mb-8">
        <Card.Content>
          <p className="label mb-1">Next session</p>
          <p className="font-display text-3xl tnum">Tue 20:00</p>
          <p className="text-fg-2">Adarsh Palm Retreat — Intermediate</p>
        </Card.Content>
      </Card>

      <Tabs defaultValue="upcoming" className="mb-8">
        <TabsList>
          <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
          <TabsTrigger value="past">Past</TabsTrigger>
        </TabsList>
        <TabsContent value="upcoming" className="pt-3 text-sm text-fg-2">
          Two sessions booked this week.
        </TabsContent>
        <TabsContent value="past" className="pt-3 text-sm text-fg-2">
          Attended 12 · Missed 1
        </TabsContent>
      </Tabs>

      <CardSpecimens />

      <div className="mb-8 flex gap-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-24" />
      </div>

      <SectionDivider className="mb-8" />

      <EmptyState copy="Nothing booked. The table's free." />
    </section>
  );
}

export default function StyleguidePage() {
  // Design-time reference only — never routable in production.
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <div data-mood="studio" className="min-h-dvh bg-surface px-4 py-10 text-fg sm:px-8">
      <div className="mx-auto max-w-6xl">
        <h1 className="display-xl mb-2">Court Noir</h1>
        <p className="mb-10 text-fg-2">
          Sharwin TTA design system — every token and component, both moods.
        </p>

        <p className="label mb-4">Tokens</p>
        <div className="mb-12 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {tokens.map(([name, hex]) => (
            <div key={name} className="rounded-[8px] border border-line bg-surface-2 p-3">
              <div
                className="mb-2 h-10 rounded-[6px] border border-line"
                style={{ background: `var(${name})` }}
              />
              <p className="text-xs font-medium">{name}</p>
              <p className="text-xs text-fg-2">{hex}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <MoodPanel mood="stage" />
          <MoodPanel mood="studio" />
        </div>
      </div>
    </div>
  );
}
