import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type MasteryLabel = "Beginner" | "Intermediate" | "Advanced" | "Elite";

export function masteryLabel(mastery: number): MasteryLabel {
  if (mastery >= 75) return "Elite";
  if (mastery >= 50) return "Advanced";
  if (mastery >= 25) return "Intermediate";
  return "Beginner";
}

/**
 * Mastery 0-100 per player id via the get_players_mastery RPC. The RPC filters
 * server-side to players the caller may see; any requested id missing from the
 * result (unauthorised or unrated) maps to 0.
 */
export async function getMasteryMap(
  supabase: Supabase,
  playerIds: string[]
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (playerIds.length === 0) return map;
  const { data } = await supabase.rpc("get_players_mastery", {
    p_players: playerIds,
  });
  for (const row of data ?? []) {
    map.set(row.player_id as string, (row.mastery as number) ?? 0);
  }
  for (const id of playerIds) {
    if (!map.has(id)) map.set(id, 0);
  }
  return map;
}
