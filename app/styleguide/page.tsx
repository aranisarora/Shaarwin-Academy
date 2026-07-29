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
  ["--err", "#D64545"],
] as const;

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
