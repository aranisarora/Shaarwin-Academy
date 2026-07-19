"use server";

import { revalidatePath } from "next/cache";
import { requireFounder } from "@/lib/founder";
import {
  adjustCreditsCore,
  cancelSessionCore,
  createGroupClassCore,
  grantCompCore,
  saveVenueCore,
  setClassActiveCore,
  setVenueActiveCore,
  deleteVenueCore,
  type VenueInput,
} from "@/lib/admin-ops";
import type { NewClass } from "@/lib/admin-ops";

type Result = { ok: boolean; error?: string };

// ── Classes ──────────────────────────────────────────────────────────────────

export async function createGroupClass(input: NewClass): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };

  const result = await createGroupClassCore(supabase, founder.id, input);
  if (!result.ok) return result;

  revalidatePath("/admin/schedule");
  return { ok: true };
}

export async function setClassActive(classId: string, active: boolean): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await setClassActiveCore(supabase, founder.id, classId, active);
  if (!result.ok) return result;
  revalidatePath("/admin/schedule");
  return { ok: true };
}

/** Cancel one session with credits + notifications (C8 single-session case). */
export async function cancelSession(sessionId: string, reason: string): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };

  const result = await cancelSessionCore(supabase, founder.id, sessionId, reason);
  if (!result.ok) return result;

  revalidatePath("/admin/schedule");
  return { ok: true };
}

// ── Venues ───────────────────────────────────────────────────────────────────

export async function saveVenue(input: VenueInput): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await saveVenueCore(supabase, founder.id, input);
  if (!result.ok) return result;
  revalidatePath("/admin/venues");
  return { ok: true };
}

export async function setVenueActive(venueId: string, active: boolean): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await setVenueActiveCore(supabase, founder.id, venueId, active);
  if (!result.ok) return result;
  revalidatePath("/admin/venues");
  return { ok: true };
}

export async function deleteVenue(venueId: string): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await deleteVenueCore(supabase, founder.id, venueId);
  if (!result.ok) return result;
  revalidatePath("/admin/venues");
  return { ok: true };
}

// ── Clients ──────────────────────────────────────────────────────────────────

export async function grantCompSubscription(clientId: string, planId: string): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await grantCompCore(supabase, founder.id, clientId, planId);
  if (!result.ok) return result;
  revalidatePath("/admin/players");
  return { ok: true };
}

export async function adjustCredits(
  clientId: string,
  deltaMinutes: number,
  note: string
): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await adjustCreditsCore(supabase, founder.id, clientId, deltaMinutes, note);
  if (!result.ok) return result;
  revalidatePath("/admin/players");
  return { ok: true };
}

// ── Calendar: ranked alternatives ────────────────────────────────────────────

export async function getRankedCoaches(
  sessionId: string
): Promise<{ coachId: string; name: string; score: number }[]> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return [];
  const { data } = await supabase.rpc("rank_coaches", { p_session: sessionId });
  const rows = (data as { coach_id: string; score: number }[]) ?? [];
  if (rows.length === 0) return [];
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id,full_name")
    .in("id", rows.map((r) => r.coach_id));
  const names = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
  return rows.map((r) => ({
    coachId: r.coach_id,
    name: names.get(r.coach_id) ?? "Coach",
    score: Number(r.score),
  }));
}
