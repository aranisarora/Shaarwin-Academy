"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSubscriptionSummary } from "@/lib/billing";
import { isWithinBengaluru } from "@/lib/coverage";
import type { StructuredAddress } from "@/lib/address";

export async function checkCoverage(lat: number, lng: number) {
  return { covered: isWithinBengaluru(lat, lng) };
}

export async function recordAreaInterest(email: string, postcode: string, lat: number, lng: number) {
  const supabase = await createClient();
  await supabase.from("area_interest").insert({ email, postcode, lat, lng });
  return { ok: true };
}

/**
 * Persist the client's structured address as their default so the next private
 * booking lands on step 1 already solved (pin + coverage green). Fire-and-forget
 * after a successful booking — a failure here must never surface to the user,
 * their session is already booked. Writes the same columns as the profile edit
 * page (`default_address` + `address_details` + the lat/lng mirror).
 */
export async function saveDefaultAddress(details: StructuredAddress): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from("profiles")
    .update({
      default_address: details.formatted.trim() || null,
      address_details: details,
      default_lat: details.lat,
      default_lng: details.lng,
    })
    .eq("id", user.id);
}

export type Slot = { starts_at: string; coach_count: number };

export async function getSlots(
  lat: number,
  lng: number,
  duration: number,
  playerId: string
): Promise<Slot[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_bookable_slots", {
    p_lat: lat,
    p_lng: lng,
    p_duration: duration,
    p_player: playerId,
  });
  if (!error && data) return data as Slot[];
  // Any RPC error → no slots. Never fall back to a permissive JS list that
  // skips the engine's coverage, minutes and lead-time checks.
  return [];
}

export type PrivateRequest = {
  playerId: string;
  duration: number;
  startsAt: string;
  address: string;
  postcode: string;
  lat: number;
  lng: number;
  hasTable: boolean;
  accessNotes: string;
  preferredCoach?: string;
  details?: StructuredAddress | null;
};

export type PrivateResult =
  | { ok: true; sessionId: string; parked: boolean }
  | { ok: false; error: string };

export type PrivateSessionsResult =
  | { ok: true; booked: number; parked: number; ranOut: boolean }
  | { ok: false; error: string };

const MAX_PRIVATE_SLOTS = 12; // cap a single multi-select booking run

/**
 * Book a set of explicitly chosen private slots in one go. Each session debits
 * the finite minutes balance, so slots are booked in chronological order and
 * the run stops once the balance can't cover the next one — then reports how
 * far it got so the UI can tell the user which slots landed.
 */
export async function requestPrivateSessions(
  req: Omit<PrivateRequest, "startsAt">,
  startsAtList: string[]
): Promise<PrivateSessionsResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  // De-dupe and book earliest-first so a partial run keeps the soonest slots.
  const slots = [...new Set(startsAtList)].sort().slice(0, MAX_PRIVATE_SLOTS);
  if (slots.length === 0) return { ok: false, error: "Pick at least one time." };

  const summary = await getSubscriptionSummary(supabase, user.id);
  let remaining = summary.minutesBalance;
  if (remaining < req.duration) {
    return { ok: false, error: "Not enough private minutes — top up from the membership page." };
  }

  let booked = 0;
  let parked = 0;
  let ranOut = false;

  for (const startsAt of slots) {
    if (remaining < req.duration) {
      ranOut = true;
      break;
    }
    const r = await requestPrivateClass({ ...req, startsAt });
    if (r.ok) {
      booked += 1;
      if (r.parked) parked += 1;
      remaining -= req.duration;
    } else {
      // Out of minutes mid-run: keep what booked, stop cleanly.
      if (r.error.includes("minutes")) ranOut = true;
      // First slot failing for another reason is a hard error.
      else if (booked === 0) return { ok: false, error: r.error };
      break;
    }
  }

  if (booked < slots.length) ranOut = true;
  return { ok: true, booked, parked, ranOut };
}

export async function requestPrivateClass(req: PrivateRequest): Promise<PrivateResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const payload = {
    player_id: req.playerId,
    duration_minutes: req.duration,
    starts_at: req.startsAt,
    address: req.address,
    postcode: req.postcode,
    lat: req.lat,
    lng: req.lng,
    has_table: req.hasTable,
    access_notes: req.accessNotes,
    preferred_coach: req.preferredCoach ?? "",
    address_details: req.details ?? null,
  };

  const { data, error } = await supabase.rpc("request_private_class", { payload });
  if (error) {
    return { ok: false, error: mapPrivateBookingError(error.message) };
  }
  revalidatePath("/app");
  revalidatePath("/app/schedule");
  return { ok: true, sessionId: data as string, parked: false };
}

function mapPrivateBookingError(message: string): string {
  if (message.includes("insufficient_minutes"))
    return "Not enough private minutes — top up from the membership page.";
  if (message.includes("plan_duration_mismatch"))
    return "Your plan covers a different session length — pick the duration included in your plan.";
  if (message.includes("private_weekly_cap"))
    return "You've reached your plan's weekly private sessions — pick a slot in another week.";
  if (message.includes("recurring_needs_private_plan"))
    return "Weekly slots need a private coaching plan — you can still book one-time sessions.";
  if (message.includes("lead_time_24h"))
    return "Private sessions need at least 24 hours' notice.";
  return "Request didn't go through. Try again.";
}

export type PrivateSeriesResult =
  | { ok: true; booked: number; skipped: number }
  | { ok: false; error: string };

/**
 * Stand up weekly private slot(s): each entry in weeklySlots is the FIRST
 * occurrence of that slot; the RPC books ~4 weeks ahead and the nightly
 * generator keeps rolling the horizon while the plan stays active.
 */
export async function requestPrivateSeries(
  req: Omit<PrivateRequest, "startsAt">,
  weeklySlots: string[]
): Promise<PrivateSeriesResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const slots = [...new Set(weeklySlots)].sort();
  if (slots.length === 0) return { ok: false, error: "Pick at least one weekly slot." };

  const payload = {
    player_id: req.playerId,
    duration_minutes: req.duration,
    address: req.address,
    postcode: req.postcode,
    lat: req.lat,
    lng: req.lng,
    has_table: req.hasTable,
    access_notes: req.accessNotes,
    preferred_coach: req.preferredCoach ?? "",
    address_details: req.details ?? null,
    starts_at_list: slots,
  };

  const { data, error } = await supabase.rpc("create_private_series", { payload });
  if (error) {
    return { ok: false, error: mapPrivateBookingError(error.message) };
  }
  revalidatePath("/app");
  revalidatePath("/app/schedule");
  const result = data as { booked: number; skipped: number };
  return { ok: true, booked: result.booked ?? 0, skipped: result.skipped ?? 0 };
}
