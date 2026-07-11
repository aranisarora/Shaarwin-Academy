import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { AdminShell } from "@/components/app/AdminShell";
import { PlayerManager } from "@/components/app/PlayerManager";

export const metadata: Metadata = { title: "Players" };

export default async function AdminPlayersPage() {
  const { supabase } = await requireUser("/admin/players");

  const { data: players } = await supabase
    .from("players")
    .select(
      "id,full_name,skill_level,date_of_birth,notes,created_at,client_id,profiles!players_client_id_fkey!inner(full_name,email,phone,role)"
    )
    .eq("profiles.role", "client")
    .order("created_at", { ascending: false })
    .limit(500);

  const rows = (players ?? []).map((p) => {
    const client = p.profiles as unknown as {
      full_name: string;
      email: string;
      phone: string | null;
    } | null;
    return {
      id: p.id,
      name: p.full_name,
      skillLevel: p.skill_level,
      dateOfBirth: p.date_of_birth as string | null,
      notes: p.notes as string | null,
      createdAt: p.created_at,
      clientId: p.client_id,
      clientName: client?.full_name ?? "",
      clientEmail: client?.email ?? "",
      clientPhone: client?.phone ?? null,
    };
  });

  return (
    <AdminShell title="Players">
      <div className="mx-auto max-w-3xl">
        <PlayerManager players={rows} />
      </div>
    </AdminShell>
  );
}
