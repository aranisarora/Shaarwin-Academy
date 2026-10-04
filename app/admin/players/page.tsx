import { venueDisplayName } from "@/lib/venue-display";
import type { Metadata } from "next";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { AdminShell } from "@/components/app/AdminShell";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { type PendingClientRow } from "@/components/app/ClientManager";
import { PeopleTabs } from "@/components/app/PeopleTabs";
import { getMasteryMap } from "@/lib/mastery";

export const metadata: Metadata = { title: "Players" };

type SearchParams = Promise<{ view?: string; client?: string }>;

async function People({ searchParams }: { searchParams: SearchParams }) {
  const [{ supabase }, { view, client: focusClient }] = await Promise.all([
    requireUser("/admin/players"),
    searchParams,
  ]);

  // Round 1 — everything that needs nothing but the request. Each client's
  // plans, paid invoices, marked bookings and players ride embedded under the
  // client row: max_rows caps only the top level, so no roll-up can be cut
  // short, and no id list has to wait on a first round trip.
  const [{ data: clients }, { data: invites }, { data: plans }, { data: schoolPlayers }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select(
          "id,full_name,email,phone,disputed,deleted_at,created_at,approval_status,subscriptions(status,plans(name)),invoices(amount_pence),bookings(status),players(id,full_name,skill_level,date_of_birth,notes,created_at)"
        )
        .eq("role", "client")
        .in("subscriptions.status", ["active", "trialing", "past_due"])
        .eq("invoices.status", "paid")
        .in("bookings.status", ["attended", "no_show"])
        .order("created_at", { referencedTable: "subscriptions", ascending: false })
        .order("created_at", { referencedTable: "players" })
        .order("created_at", { ascending: false }),
      supabase
        .from("client_invites")
        .select("id,phone,full_name,notes,plan_id")
        .is("claimed_at", null)
        .order("created_at", { ascending: false }),
      supabase.from("plans").select("id,name").eq("active", true).order("price_pence"),
      // School players have no account holder — fetched on their own and joined
      // to the school (venue) they attend. The raw `school_venue_id` rides along
      // beside the joined name because the Players tab filters on the id: the
      // display name is only ever a label, and a pupil whose venue row went
      // missing must not land in the same bucket as everyone else's fallback.
      supabase
        .from("players")
        .select(
          "id,full_name,skill_level,date_of_birth,notes,created_at,grade,school_venue_id,venues(name,unit)"
        )
        .is("client_id", null)
        .order("created_at"),
    ]);

  // A household can be on more than one live plan at a time — an old one
  // winding down beside the new one, a handful of them on the books right now.
  // The embed comes back newest first, so the single plan we *show* is the one
  // they most recently signed up for and it stays the same on every load.
  // `plansByClient` keeps every plan they hold, because a filter that says
  // "everyone on this plan" has to mean everyone, not whichever row landed last.
  const subByClient = new Map<string, { status: string; plan: string | undefined }>();
  const plansByClient = new Map<string, Set<string>>();
  for (const c of clients ?? []) {
    const [latest] = c.subscriptions;
    if (latest) subByClient.set(c.id, { status: latest.status, plan: latest.plans?.name });
    const held = new Set(
      c.subscriptions.map((s) => s.plans?.name).filter((n): n is string => !!n)
    );
    if (held.size > 0) plansByClient.set(c.id, held);
  }

  const rows = (clients ?? []).map((c) => ({
    id: c.id,
    name: c.full_name,
    email: c.email,
    phone: c.phone,
    disputed: c.disputed,
    archived: c.deleted_at !== null,
    approvalStatus: (c.approval_status ?? "approved") as "pending" | "approved" | "denied",
    createdAt: c.created_at,
    subStatus: subByClient.get(c.id)?.status ?? null,
    planName: subByClient.get(c.id)?.plan ?? null,
    ltvPence: c.invoices.reduce((sum, inv) => sum + inv.amount_pence, 0),
    noShowCount: c.bookings.filter((b) => b.status === "no_show").length,
    attendedCount: c.bookings.filter((b) => b.status === "attended").length,
    students: c.players.map((p) => ({ id: p.id, name: p.full_name, level: p.skill_level })),
  }));

  const pendingRows: PendingClientRow[] = (invites ?? []).map((i) => ({
    id: i.id,
    phone: i.phone,
    name: i.full_name ?? "",
    notes: i.notes ?? "",
    planId: i.plan_id ?? "",
  }));

  // The Players view — every player we coach: household players joined with
  // their account holder's contact details, and the school pupils below them.
  // Archived clients' players stay hidden, matching the default client list.
  // This one really is a second trip: it needs the player ids round 1 returns.
  const liveClients = (clients ?? []).filter((c) => c.deleted_at === null);
  const masteryMap = await getMasteryMap(supabase, [
    ...liveClients.flatMap((c) => c.players.map((p) => p.id)),
    ...(schoolPlayers ?? []).map((p) => p.id),
  ]);

  const householdRows = liveClients.flatMap((c) =>
    c.players.map((p) => {
      // The household's plans were already rolled up for the Account holders
      // view; carrying them onto the player row costs nothing and lets the tab
      // filter players by what their household pays for. The filter matches on
      // the full list — a household on two plans belongs under both — while the
      // single `planName` is only ever the line the sheet prints.
      const sub = subByClient.get(c.id);
      return {
        id: p.id,
        name: p.full_name,
        skillLevel: p.skill_level,
        mastery: masteryMap.get(p.id) ?? 0,
        dateOfBirth: p.date_of_birth,
        notes: p.notes,
        createdAt: p.created_at,
        clientId: c.id as string | null,
        clientName: c.full_name ?? "",
        clientEmail: c.email ?? "",
        clientPhone: c.phone ?? null,
        school: null as string | null,
        schoolVenueId: null as string | null,
        grade: null as number | null,
        planName: sub?.plan ?? null,
        subStatus: sub?.status ?? null,
        planNames: [...(plansByClient.get(c.id) ?? [])],
      };
    })
  );

  // Account-less school players, tagged with the school they attend.
  const schoolRows = (schoolPlayers ?? []).map((p) => ({
    id: p.id,
    name: p.full_name,
    skillLevel: p.skill_level,
    mastery: masteryMap.get(p.id) ?? 0,
    dateOfBirth: (p.date_of_birth as string | null) ?? null,
    notes: (p.notes as string | null) ?? null,
    createdAt: p.created_at as string,
    clientId: null as string | null,
    clientName: "",
    clientEmail: "",
    clientPhone: null,
    school: p.venues ? venueDisplayName(p.venues) : "School",
    schoolVenueId: (p.school_venue_id as string | null) ?? null,
    grade: (p.grade as number | null) ?? null,
    // A school pupil sits outside billing entirely — the school pays, not a
    // household — so there is no plan to show and none to filter on.
    planName: null as string | null,
    subStatus: null as string | null,
    planNames: [] as string[],
  }));

  const playerRows = [...householdRows, ...schoolRows].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );

  return (
    <PeopleTabs
      initialView={view === "clients" || focusClient ? "clients" : "players"}
      clients={rows}
      plans={plans ?? []}
      pending={pendingRows}
      players={playerRows}
      focusClientId={focusClient ?? null}
    />
  );
}

export default function AdminPlayersPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  return (
    <AdminShell title="Players">
      <div className="mx-auto max-w-3xl">
        <Suspense fallback={<PageSkeleton />}>
          <People searchParams={searchParams} />
        </Suspense>
      </div>
    </AdminShell>
  );
}
