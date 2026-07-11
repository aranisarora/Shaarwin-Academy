"use server";

import { revalidatePath } from "next/cache";
import { requireFounder } from "@/lib/founder";
import {
  createOneOffSessionCore,
  createPrivateSessionCore,
  deleteGroupClassCore,
  materializeInviteCore,
  endGroupClassCore,
  moveSessionCore,
  reassignSessionCore,
  setSessionCapacityCore,
  topUpSessionsCore,
  updateGroupClassCore,
  type ClassUpdate,
  type PrivateSessionInput,
} from "@/lib/admin-ops";

type Result = { ok: boolean; error?: string; code?: string };

function refresh() {
  revalidatePath("/admin/calendar");
  revalidatePath("/admin");
}

// ── One session ("just this session") ────────────────────────────────────────

export async function reassignSession(
  sessionId: string,
  coachId: string,
  lock: boolean,
  force = false
): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await reassignSessionCore(supabase, founder.id, sessionId, coachId, lock, force);
  if (!result.ok) return result;
  refresh();
  return { ok: true };
}

export async function moveSession(
  sessionId: string,
  date: string,
  time: string
): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await moveSessionCore(supabase, founder.id, sessionId, date, time);
  if (!result.ok) return result;
  refresh();
  return { ok: true };
}

export async function setSessionCapacity(
  sessionId: string,
  capacity: number | null
): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await setSessionCapacityCore(supabase, founder.id, sessionId, capacity);
  if (!result.ok) return result;
  refresh();
  return { ok: true };
}

// ── The whole class ("every week") ───────────────────────────────────────────

export async function updateGroupClass(input: ClassUpdate): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await updateGroupClassCore(supabase, founder.id, input);
  if (!result.ok) return result;
  refresh();
  return { ok: true };
}

export async function endGroupClass(classId: string): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await endGroupClassCore(supabase, founder.id, classId);
  if (!result.ok) return result;
  refresh();
  return { ok: true };
}

export async function deleteGroupClass(classId: string): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await deleteGroupClassCore(supabase, founder.id, classId);
  if (!result.ok) return result;
  refresh();
  return { ok: true };
}

export async function topUpSessions(): Promise<Result & { created?: number }> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await topUpSessionsCore(supabase, founder.id);
  if (!result.ok) return result;
  refresh();
  return { ok: true, created: result.created };
}

// ── Adding to the calendar ───────────────────────────────────────────────────

export async function createOneOffSession(
  classId: string,
  date: string,
  time: string,
  coachId: string
): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await createOneOffSessionCore(supabase, founder.id, classId, date, time, coachId);
  if (!result.ok) return result;
  refresh();
  return { ok: true };
}

export async function createPrivateSession(input: PrivateSessionInput): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await createPrivateSessionCore(supabase, founder.id, input);
  if (!result.ok) return result;
  refresh();
  return { ok: true };
}

/**
 * Book a private session for a pre-registered client (a phone invite with no
 * account yet). The invite is turned into a real client account first, then
 * the session is booked exactly like createPrivateSession.
 */
export async function createPrivateSessionForInvite(
  inviteId: string,
  input: Omit<PrivateSessionInput, "clientId" | "playerId">
): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const materialized = await materializeInviteCore(supabase, founder.id, inviteId);
  if (!materialized.ok || !materialized.clientId)
    return { ok: false, error: materialized.error ?? "Couldn't create the account." };
  const result = await createPrivateSessionCore(supabase, founder.id, {
    ...input,
    clientId: materialized.clientId,
  });
  if (!result.ok) return result;
  refresh();
  revalidatePath("/admin/clients");
  return { ok: true };
}
