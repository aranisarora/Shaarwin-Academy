"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireFounder } from "@/lib/founder";
import {
  decideTimeOffCore,
  promoteToCoachCore,
  saveCoachCore,
  setCoachActiveCore,
  type CoachInput,
} from "@/lib/admin-ops";

type Result = { ok: boolean; error?: string };

export async function promoteToCoach(profileId: string): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await promoteToCoachCore(supabase, founder.id, profileId);
  if (!result.ok) return result;
  revalidatePath("/admin/coaches");
  return { ok: true };
}

export async function saveCoach(input: CoachInput): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await saveCoachCore(supabase, founder.id, input);
  if (!result.ok) return result;
  revalidatePath("/admin/coaches");
  return { ok: true };
}

export async function setCoachActive(coachId: string, active: boolean): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await setCoachActiveCore(supabase, founder.id, coachId, active);
  if (!result.ok) return result;
  revalidatePath("/admin/coaches");
  revalidatePath("/admin/calendar");
  return { ok: true };
}

export async function decideTimeOff(
  timeOffId: string,
  approve: boolean
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (me?.role !== "founder") return { ok: false, error: "Founder only." };

  const result = await decideTimeOffCore(supabase, user.id, timeOffId, approve);
  if (!result.ok) return result;

  revalidatePath("/admin/coaches");
  revalidatePath("/admin");
  return { ok: true };
}
