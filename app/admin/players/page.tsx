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

  // Round 1 — everything that needs nothing but the request. The invites, plans
  // and school-player queries used to sit behind the client list (invites on its
  // own await, the other two inside the id-keyed batch below) even though none
  // of them reads a client id. That cost a whole serial round trip to Tokyo.
  const [{ data: clients }, { data: invites }, { data: plans }, { data: schoolPlayers }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("id,full_name,email,phone,disputed,deleted_at,created_at,approval_status")
        .eq("role", "client")
        .order("created_at", { ascending: false })
        .limit(200),
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

  // Round 2 — the per-client roll-ups, which genuinely need the ids above.
  const ids = (clients ?? []).map((c) => c.id);
  const [{ data: subs }, { data: invoices }, { data: bookings }, { data: players }] =
    await Promise.all([
      ids.length
        ? supabase
            .from("subscriptions")
            .select("client_id,status,plans(name)")
            .in("client_id", ids)
            .in("status", ["active", "trialing", "past_due"])
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [] }),
      ids.length
        ? supabase
            .from("invoices")
            .select("client_id,amount_pence")
            .eq("status", "paid")
            .in("client_id", ids)
        : Promise.resolve({ data: [] }),
      ids.length
        ? supabase
            .from("bookings")
            .select("client_id,status")
            .in("status", ["attended", "no_show"])
            .in("client_id", ids)
        : Promise.resolve({ data: [] }),
      ids.length
        ? supabase
            .from("players")
            .select("id,client_id,full_name,skill_level,date_of_birth,notes,created_at")
            .in("client_id", ids)
            .order("created_at")
        : Promise.resolve({ data: [] }),
    ]);

  // A household can be on more than one live plan at a time — an old one
  // winding down beside the new one, a handful of them on the books right now.
  // The query comes back newest first, so the single plan we *show* is the one
  // they most recently signed up for and it stays the same on every load.
  // `plansByClient` keeps every plan they hold, because a filter that says
  // "everyone on this plan" has to mean everyone, not whichever row landed last.
  const subByClient = new Map<string, { status: string; plan: string | undefined }>();
  const plansByClient = new Map<string, Set<string>>();
  for (const s of subs ?? []) {
    const plan = s.plans?.name;
    if (!subByClient.has(s.client_id)) {
      subByClient.set(s.client_id, { status: s.status, plan });
    }
    if (plan) {
      const held = plansByClient.get(s.client_id);
      if (held) held.add(plan);
      else plansByClient.set(s.client_id, new Set([plan]));
    }
  }
  const ltv = new Map<string, number>();
  for (const inv of invoices ?? []) {
    ltv.set(inv.client_id, (ltv.get(inv.client_id) ?? 0) + inv.amount_pence);
  }
  // `bookings.client_id` and `players.client_id` are nullable — an account-less
  // school player owns neither. Both queries above filter `.in("client_id", ids)`,
  // so these rows always have an owner; the guards narrow the column and keep a
  // stray null out of the per-client tallies rather than bucketing it under one
  // shared `null` key.
  const noShows = new Map<string, number>();
  const attended = new Map<string, number>();
  for (const b of bookings ?? []) {
    if (b.client_id === null) continue;
    const bucket = b.status === "no_show" ? noShows : attended;
    bucket.set(b.client_id, (bucket.get(b.client_id) ?? 0) + 1);
  }
  const householdPlayers = (players ?? []).filter(
    (p): p is typeof p & { client_id: string } => p.client_id !== null
  );
  const studentsByClient = new Map<
    string,
    { id: string; name: string; level: string }[]
  >();
  for (const p of householdPlayers) {
    const list = studentsByClient.get(p.client_id) ?? [];
    list.push({ id: p.id, name: p.full_name, level: p.skill_level });
    studentsByClient.set(p.client_id, list);
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
    ltvPence: ltv.get(c.id) ?? 0,
    noShowCount: noShows.get(c.id) ?? 0,
    attendedCount: attended.get(c.id) ?? 0,
    students: studentsByClient.get(c.id) ?? [],
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
  // This one really is a third trip: it needs the player ids round 2 returns.
  const masteryMap = await getMasteryMap(supabase, [
    ...(players ?? []).map((p) => p.id),
    ...(schoolPlayers ?? []).map((p) => p.id),
  ]);

  const clientById = new Map((clients ?? []).map((c) => [c.id, c]));
  const householdRows = householdPlayers
    .filter((p) => {
      const c = clientById.get(p.client_id);
      return c && c.deleted_at === null;
    })
    .map((p) => {
      const c = clientById.get(p.client_id)!;
      // The household's plans were already rolled up for the Account holders
      // view; carrying them onto the player row costs nothing and lets the tab
      // filter players by what their household pays for. The filter matches on
      // the full list — a household on two plans belongs under both — while the
      // single `planName` is only ever the line the sheet prints.
      const sub = subByClient.get(p.client_id);
      return {
        id: p.id,
        name: p.full_name,
        skillLevel: p.skill_level,
        mastery: masteryMap.get(p.id) ?? 0,
        dateOfBirth: (p.date_of_birth as string | null) ?? null,
        notes: (p.notes as string | null) ?? null,
        createdAt: p.created_at as string,
        clientId: p.client_id as string | null,
        clientName: c.full_name ?? "",
        clientEmail: c.email ?? "",
        clientPhone: c.phone ?? null,
        school: null as string | null,
        schoolVenueId: null as string | null,
        grade: null as number | null,
        planName: sub?.plan ?? null,
        subStatus: sub?.status ?? null,
        planNames: [...(plansByClient.get(p.client_id) ?? [])],
      };
    });

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
