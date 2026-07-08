"use server";

import { revalidatePath } from "next/cache";
import { requireFounder } from "@/lib/founder";
import {
  createOneOffSessionCore,
  moveSessionCore,
  reassignSessionCore,
  setSessionCapacityCore,
} from "@/lib/admin-ops";

type Result = { ok: boolean; error?: string };

export async function reassignSession(
  sessionId: string,
  coachId: string,
  lock: boolean
): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await reassignSessionCore(supabase, founder.id, sessionId, coachId, lock);
  if (!result.ok) return result;
  revalidatePath("/admin/calendar");
  revalidatePath("/admin");
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
  revalidatePath("/admin/calendar");
  revalidatePath("/admin");
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
  revalidatePath("/admin/calendar");
  return { ok: true };
}

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
  revalidatePath("/admin/calendar");
  revalidatePath("/admin");
  return { ok: true };
}
