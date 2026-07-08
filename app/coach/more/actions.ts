"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type Result = { ok: boolean; error?: string; overlaps?: number };

async function coachId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, id: user?.id ?? null };
}

export async function addWindow(
  weekday: number,
  start: string,
  end: string
): Promise<Result> {
  const { supabase, id } = await coachId();
  if (!id) return { ok: false, error: "Sign in first." };
  if (start >= end) return { ok: false, error: "Window must start before it ends." };
  const { error } = await supabase.from("coach_availability").insert({
    coach_id: id,
    weekday,
    start_time: start,
    end_time: end,
  });
  revalidatePath("/coach/more");
  return error ? { ok: false, error: "Couldn't add window." } : { ok: true };
}

export async function removeWindow(windowId: string): Promise<Result> {
  const { supabase, id } = await coachId();
  if (!id) return { ok: false, error: "Sign in first." };
  await supabase
    .from("coach_availability")
    .delete()
    .eq("id", windowId)
    .eq("coach_id", id);
  revalidatePath("/coach/more");
  return { ok: true };
}

/**
 * First call returns overlap count (C2 — show before submit); calling again
 * with the same range submits the request.
 */
export async function requestTimeOff(
  startLocal: string,
  endLocal: string,
  reason: string
): Promise<Result> {
  const { supabase, id } = await coachId();
  if (!id) return { ok: false, error: "Sign in first." };

  const startsAt = new Date(startLocal).toISOString();
  const endsAt = new Date(endLocal).toISOString();
  if (startsAt >= endsAt) return { ok: false, error: "Range must start before it ends." };

  // Overlapping booked sessions — surfaced before submitting (C2).
  const { data: overlapping } = await supabase
    .from("class_sessions")
    .select("id")
    .eq("coach_id", id)
    .eq("status", "scheduled")
    .gte("starts_at", startsAt)
    .lt("starts_at", endsAt);

  // A pending identical request means this is the confirm pass.
  const { data: existing } = await supabase
    .from("coach_time_off")
    .select("id")
    .eq("coach_id", id)
    .eq("starts_at", startsAt)
    .eq("ends_at", endsAt)
    .maybeSingle();

  if ((overlapping?.length ?? 0) > 0 && !existing) {
    // Insert now so the confirm pass finds it; status stays pending either way.
    const { error } = await supabase.from("coach_time_off").insert({
      coach_id: id,
      starts_at: startsAt,
      ends_at: endsAt,
      reason: reason || null,
    });
    if (error) return { ok: false, error: "Couldn't request time off." };
    await notifyFounder(supabase, id, startsAt, endsAt);
    revalidatePath("/coach/more");
    return { ok: true, overlaps: overlapping!.length };
  }

  if (!existing) {
    const { error } = await supabase.from("coach_time_off").insert({
      coach_id: id,
      starts_at: startsAt,
      ends_at: endsAt,
      reason: reason || null,
    });
    if (error) return { ok: false, error: "Couldn't request time off." };
    await notifyFounder(supabase, id, startsAt, endsAt);
  }

  revalidatePath("/coach/more");
  return { ok: true, overlaps: 0 };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function notifyFounder(supabase: any, coach: string, startsAt: string, endsAt: string) {
  const { data: founders } = await supabase
    .from("profiles")
    .select("id")
    .eq("role", "founder");
  if (!founders) return;
  await supabase.from("notifications").insert(
    founders.map((f: { id: string }) => ({
      user_id: f.id,
      type: "time_off_requested",
      title: "Time-off request",
      body: "A coach requested time off — review it.",
      data: { coach_id: coach, starts_at: startsAt, ends_at: endsAt, url: "/admin/coaches" },
    }))
  );
}

export async function saveCoachProfile(input: {
  bio: string;
  baseLat: number;
  baseLng: number;
  radiusKm: number;
}): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };
  if (!Number.isFinite(input.radiusKm) || input.radiusKm < 1 || input.radiusKm > 50) {
    return { ok: false, error: "Radius must be between 1 and 50 km." };
  }

  const { error } = await supabase
    .from("coaches")
    .update({
      bio: input.bio.trim() || null,
      base_lat: input.baseLat,
      base_lng: input.baseLng,
      travel_radius_km: input.radiusKm,
    })
    .eq("id", user.id);
  if (error) return { ok: false, error: "Couldn't save." };
  revalidatePath("/coach/more");
  return { ok: true };
}
