"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSubscriptionSummary } from "@/lib/billing";

function isFunctionMissing(code: string | undefined): boolean {
  return code === "PGRST202" || code === "42883";
}

const KM = 111.32; // deg → km approximation for coverage checks

type CoachLite = {
  id: string;
  base_lat: number;
  base_lng: number;
  travel_radius_km: number;
};

async function coachesCovering(lat: number, lng: number): Promise<CoachLite[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("coaches")
    .select("id,base_lat,base_lng,travel_radius_km")
    .eq("active", true);
  return (data ?? []).filter((c) => {
    const dLat = (c.base_lat - lat) * KM;
    const dLng = (c.base_lng - lng) * KM * Math.cos((lat * Math.PI) / 180);
    return Math.sqrt(dLat * dLat + dLng * dLng) <= Number(c.travel_radius_km);
  });
}

export async function checkCoverage(lat: number, lng: number) {
  const covering = await coachesCovering(lat, lng);
  return { covered: covering.length > 0 };
}

export async function recordAreaInterest(email: string, postcode: string, lat: number, lng: number) {
  const supabase = await createClient();
  await supabase.from("area_interest").insert({ email, postcode, lat, lng });
  return { ok: true };
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
  if (error && !isFunctionMissing(error.code)) return [];

  // Fallback without the engine RPC: coach availability windows within radius.
  const covering = await coachesCovering(lat, lng);
  if (covering.length === 0) return [];
  const { data: availability } = await supabase
    .from("coach_availability")
    .select("coach_id,weekday,start_time,end_time")
    .in("coach_id", covering.map((c) => c.id));
  if (!availability || availability.length === 0) return [];

  const slots: Slot[] = [];
  const now = Date.now();
  for (let d = 1; d <= 14; d++) {
    const day = new Date(now + d * 86400000);
    const isoDow = ((day.getDay() + 6) % 7); // 0=Mon
    for (let h = 9; h <= 20; h++) {
      for (const m of [0, 30]) {
        const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
        if (start.getTime() < now + 24 * 3600000) continue;
        const startMinutes = h * 60 + m;
        const endMinutes = startMinutes + duration;
        const count = availability.filter((a) => {
          if (a.weekday !== isoDow) return false;
          const [sh, sm] = a.start_time.split(":").map(Number);
          const [eh, em] = a.end_time.split(":").map(Number);
          return sh * 60 + sm <= startMinutes && eh * 60 + em >= endMinutes;
        }).length;
        if (count > 0) slots.push({ starts_at: start.toISOString(), coach_count: count });
      }
    }
  }
  return slots;
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
};

export type PrivateResult =
  | { ok: true; sessionId: string; parked: boolean }
  | { ok: false; error: string };

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
  };

  const { data, error } = await supabase.rpc("request_private_class", { payload });
  if (!error && data) {
    revalidatePath("/app");
    revalidatePath("/app/schedule");
    return { ok: true, sessionId: data as string, parked: false };
  }
  if (error && !isFunctionMissing(error.code)) {
    if (error.message.includes("insufficient_minutes"))
      return { ok: false, error: "Not enough private minutes left this quarter." };
    if (error.message.includes("no_active_subscription"))
      return { ok: false, error: "You need the Private plan to book home sessions." };
    return { ok: false, error: "Request didn't go through. Try again." };
  }

  // Fallback without the RPC — same steps in JS.
  const summary = await getSubscriptionSummary(supabase, user.id);
  if (!summary.active)
    return { ok: false, error: "You need the Private plan to book home sessions." };
  if (summary.minutesBalance < req.duration)
    return { ok: false, error: "Not enough private minutes left this quarter." };

  const { data: cls, error: clsError } = await supabase
    .from("classes")
    .insert({
      class_type: "private",
      title: "Private session",
      capacity: 1,
      duration_minutes: req.duration,
      starts_on: req.startsAt.slice(0, 10),
      created_by: user.id,
    })
    .select("id")
    .single();
  if (clsError || !cls) return { ok: false, error: "Request didn't go through. Try again." };

  await supabase.from("private_class_details").insert({
    class_id: cls.id,
    client_id: user.id,
    player_id: req.playerId,
    address: req.address,
    postcode: req.postcode,
    lat: req.lat,
    lng: req.lng,
    has_table: req.hasTable,
    access_notes: req.accessNotes,
  });

  const ends = new Date(new Date(req.startsAt).getTime() + req.duration * 60000).toISOString();
  const covering = await coachesCovering(req.lat, req.lng);
  const coachId = req.preferredCoach && covering.some((c) => c.id === req.preferredCoach)
    ? req.preferredCoach
    : covering[0]?.id ?? null;

  const { data: session } = await supabase
    .from("class_sessions")
    .insert({ class_id: cls.id, coach_id: coachId, starts_at: req.startsAt, ends_at: ends })
    .select("id")
    .single();
  if (!session) return { ok: false, error: "Request didn't go through. Try again." };

  await supabase.from("private_credit_ledger").insert({
    client_id: user.id,
    delta_minutes: -req.duration,
    reason: "booking",
  });
  await supabase.from("bookings").insert({
    session_id: session.id,
    client_id: user.id,
    player_id: req.playerId,
    status: "confirmed",
  });
  await supabase.from("notifications").insert({
    user_id: user.id,
    type: "coach_assigned",
    title: coachId ? "You're on." : "We're confirming your coach",
    body: coachId
      ? "Coach confirmed — details in your schedule."
      : "You'll hear from us within 24 hours.",
    data: { session_id: session.id, url: "/app/schedule" },
  });

  revalidatePath("/app");
  revalidatePath("/app/schedule");
  return { ok: true, sessionId: session.id, parked: !coachId };
}
