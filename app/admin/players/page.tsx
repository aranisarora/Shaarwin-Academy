import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { AdminShell } from "@/components/app/AdminShell";
import { type PendingClientRow } from "@/components/app/ClientManager";
import { PeopleTabs } from "@/components/app/PeopleTabs";
import { getMasteryMap } from "@/lib/mastery";

export const metadata: Metadata = { title: "Players" };

export default async function AdminPlayersPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; client?: string }>;
}) {
  const { supabase } = await requireUser("/admin/players");
  const { view, client: focusClient } = await searchParams;
  const { data: clients } = await supabase
    .from("profiles")
    .select("id,full_name,email,phone,disputed,deleted_at,created_at,approval_status")
    .eq("role", "client")
    .order("created_at", { ascending: false })
    .limit(200);

  const { data: invites } = await supabase
    .from("client_invites")
    .select("id,phone,full_name,notes,plan_id")
    .is("claimed_at", null)
    .order("created_at", { ascending: false });

  const ids = (clients ?? []).map((c) => c.id);
  const [
    { data: subs },
    { data: invoices },
    { data: bookings },
    { data: plans },
    { data: players },
    { data: schoolPlayers },
  ] =
    await Promise.all([
      ids.length
        ? supabase
            .from("subscriptions")
            .select("client_id,status,plans(name)")
            .in("client_id", ids)
            .in("status", ["active", "trialing", "past_due"])
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
      supabase.from("plans").select("id,name").eq("active", true).order("price_pence"),
      ids.length
        ? supabase
            .from("players")
            .select("id,client_id,full_name,skill_level,date_of_birth,notes,created_at")
            .in("client_id", ids)
            .order("created_at")
        : Promise.resolve({ data: [] }),
      // School players have no account holder — fetched on their own and joined
      // to the school (venue) they attend.
      supabase
        .from("players")
        .select("id,full_name,skill_level,date_of_birth,notes,created_at,grade,venues(name)")
        .is("client_id", null)
        .order("created_at"),
    ]);

  const subByClient = new Map(
    (subs ?? []).map((s) => [
      s.client_id,
      { status: s.status, plan: (s.plans as unknown as { name: string } | null)?.name },
    ])
  );
  const ltv = new Map<string, number>();
  for (const inv of invoices ?? []) {
    ltv.set(inv.client_id, (ltv.get(inv.client_id) ?? 0) + inv.amount_pence);
  }
  const noShows = new Map<string, number>();
  const attended = new Map<string, number>();
  for (const b of bookings ?? []) {
    const bucket = b.status === "no_show" ? noShows : attended;
    bucket.set(b.client_id, (bucket.get(b.client_id) ?? 0) + 1);
  }
  const studentsByClient = new Map<
    string,
    { id: string; name: string; level: string }[]
  >();
  for (const p of players ?? []) {
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

  // The Players view — every household player, joined with their account
  // holder's contact details. Archived clients' players stay hidden, matching
  // the default client list.
  const masteryMap = await getMasteryMap(supabase, [
    ...(players ?? []).map((p) => p.id),
    ...(schoolPlayers ?? []).map((p) => p.id),
  ]);

  const clientById = new Map((clients ?? []).map((c) => [c.id, c]));
  const householdRows = (players ?? [])
    .filter((p) => {
      const c = clientById.get(p.client_id);
      return c && c.deleted_at === null;
    })
    .map((p) => {
      const c = clientById.get(p.client_id)!;
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
    school: (p.venues as unknown as { name: string } | null)?.name ?? "School",
  }));

  const playerRows = [...householdRows, ...schoolRows].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );

  return (
    <AdminShell title="Players">
      <div className="mx-auto max-w-3xl">
        <PeopleTabs
          initialView={view === "clients" || focusClient ? "clients" : "players"}
          clients={rows}
          plans={plans ?? []}
          pending={pendingRows}
          players={playerRows}
          focusClientId={focusClient ?? null}
        />
      </div>
    </AdminShell>
  );
}
