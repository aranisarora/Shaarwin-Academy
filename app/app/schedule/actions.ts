"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type RescheduleTarget = {
  sessionId: string;
  starts_at: string;
  classTitle: string;
  venueName: string | null;
  seatsLeft: number;
  sameClass: boolean;
};

/** Equivalent sessions: same class first, then same-level nearby; 14 days; seats free. */
export async function getRescheduleTargets(
  bookingId: string
): Promise<{ targets: RescheduleTarget[]; isPrivate: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { targets: [], isPrivate: false, error: "Sign in first." };

  const { data: booking } = await supabase
    .from("bookings")
    .select(
      "id,session_id,class_sessions!inner(class_id,starts_at,classes!inner(id,skill_level,class_type,capacity))"
    )
    .eq("id", bookingId)
    .eq("client_id", user.id)
    .maybeSingle();
  if (!booking) return { targets: [], isPrivate: false, error: "Booking not found." };

  const current = booking.class_sessions as unknown as {
    class_id: string;
    starts_at: string;
    classes: { id: string; skill_level: string; class_type: string; capacity: number };
  };
  if (current.classes.class_type === "private") {
    return { targets: [], isPrivate: true };
  }

  // Period-end fence (A4/A12): hide slots beyond current_period_end when cancelling.
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("current_period_end,cancel_at_period_end")
    .eq("client_id", user.id)
    .in("status", ["active", "trialing", "past_due"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const fence =
    sub?.cancel_at_period_end && sub.current_period_end
      ? new Date(sub.current_period_end)
      : null;

  const until = new Date(Date.now() + 14 * 86400000);
  const { data: sessions } = await supabase
    .from("class_sessions")
    .select(
      "id,class_id,starts_at,capacity_override,classes!inner(id,title,skill_level,class_type,capacity,location_label,venues(name))"
    )
    .eq("status", "scheduled")
    .eq("classes.class_type", "group")
    .gt("starts_at", new Date(Date.now() + 3600000).toISOString())
    .lt("starts_at", until.toISOString())
    .neq("id", booking.session_id)
    .order("starts_at");

  const candidates = (sessions ?? []).filter((s) => {
    const cls = s.classes as unknown as { id: string; skill_level: string };
    if (fence && new Date(s.starts_at) > fence) return false;
    return cls.id === current.class_id || cls.skill_level === current.classes.skill_level;
  });

  const ids = candidates.map((s) => s.id);
  const { data: bookingRows } = ids.length
    ? await supabase
        .from("bookings")
        .select("session_id")
        .in("session_id", ids)
        .eq("status", "confirmed")
    : { data: [] };
  const counts = new Map<string, number>();
  for (const row of bookingRows ?? []) {
    counts.set(row.session_id, (counts.get(row.session_id) ?? 0) + 1);
  }

  const targets = candidates
    .map((s) => {
      const cls = s.classes as unknown as {
        id: string;
        title: string;
        capacity: number;
        location_label: string | null;
        venues: { name: string } | null;
      };
      const capacity = s.capacity_override ?? cls.capacity;
      return {
        sessionId: s.id,
        starts_at: s.starts_at,
        classTitle: cls.title,
        venueName: cls.location_label ?? null,
        seatsLeft: capacity - (counts.get(s.id) ?? 0),
        sameClass: (s.classes as unknown as { id: string }).id === current.class_id,
      };
    })
    .filter((t) => t.seatsLeft > 0)
    .sort((a, b) =>
      a.sameClass === b.sameClass
        ? a.starts_at.localeCompare(b.starts_at)
        : a.sameClass
          ? -1
          : 1
    );

  return { targets, isPrivate: false };
}

/** Slot grid for the private reschedule path (same address + duration, P07 grid). */
export async function getPrivateRescheduleSlots(
  sessionId: string
): Promise<{ starts_at: string; coach_count: number }[]> {
  const supabase = await createClient();
  const { data: session } = await supabase
    .from("class_sessions")
    .select("class_id,classes!inner(duration_minutes,private_class_details(lat,lng,player_id))")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) return [];
  const cls = session.classes as unknown as {
    duration_minutes: number;
    private_class_details: { lat: number; lng: number; player_id: string }[] | null;
  };
  const detail = cls.private_class_details?.[0];
  if (!detail) return [];
  const { data } = await supabase.rpc("get_bookable_slots", {
    p_lat: detail.lat,
    p_lng: detail.lng,
    p_duration: cls.duration_minutes,
    p_player: detail.player_id,
  });
  return (data as { starts_at: string; coach_count: number }[]) ?? [];
}

const rescheduleErrors: Record<string, string> = {
  reschedule_limit_reached: "This booking has been moved twice already — that's the limit.",
  target_full: "Just filled — pick another time.",
  player_double_booked: "That player already has a session at this time.",
  target_not_bookable: "That session can't be booked any more.",
  session_started: "The original session has already started.",
};

export async function rescheduleGroupBooking(
  bookingId: string,
  targetSessionId: string
): Promise<{ ok: boolean; newBookingId?: string; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reschedule_booking", {
    p_booking: bookingId,
    p_target_session: targetSessionId,
  });
  if (error) {
    const key = Object.keys(rescheduleErrors).find((k) => error.message.includes(k));
    return { ok: false, error: key ? rescheduleErrors[key] : "Reschedule failed — your original booking is untouched." };
  }
  revalidatePath("/app/schedule");
  revalidatePath("/app");
  return { ok: true, newBookingId: (data as { id: string })?.id };
}

/**
 * Reschedule "this + following": move the picked week to the target and
 * re-point the whole standing series onto the target's slot.
 */
export async function rescheduleSeries(
  bookingId: string,
  targetSessionId: string
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("reschedule_series", {
    p_booking: bookingId,
    p_target_session: targetSessionId,
  });
  if (error) {
    const key = Object.keys(rescheduleErrors).find((k) => error.message.includes(k));
    return {
      ok: false,
      error: key ? rescheduleErrors[key] : "Reschedule failed — your original booking is untouched.",
    };
  }
  revalidatePath("/app/schedule");
  revalidatePath("/app");
  return { ok: true };
}

/** Cancel a standing series: stops it and frees all future weeks. */
export async function cancelSeries(
  seriesId: string
): Promise<{ ok: boolean; cancelled?: number; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cancel_series", { p_series: seriesId });
  if (error) return { ok: false, error: "Couldn't stop the recurring booking. Try again." };
  revalidatePath("/app/schedule");
  revalidatePath("/app");
  return { ok: true, cancelled: (data as number) ?? 0 };
}

/** End a standing weekly private slot: cancels all future weeks (with refunds). */
export async function cancelPrivateSeries(
  seriesId: string
): Promise<{ ok: boolean; cancelled?: number; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cancel_private_series", {
    p_series: seriesId,
  });
  if (error) return { ok: false, error: "Couldn't end the weekly sessions. Try again." };
  revalidatePath("/app/schedule");
  revalidatePath("/app");
  return { ok: true, cancelled: (data as number) ?? 0 };
}

export type PrivatePreview = {
  ok: boolean;
  proposedCoach?: string | null;
  coachChanged?: boolean;
  coachName?: string | null;
  error?: string;
};

export async function previewPrivateReschedule(
  sessionId: string,
  newStart: string
): Promise<PrivatePreview> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reschedule_private_session", {
    p_session: sessionId,
    p_new_start: newStart,
    p_confirm: false,
  });
  if (error) {
    if (error.message.includes("no_coach_available"))
      return { ok: false, error: "No coach is free then — pick another time." };
    if (error.message.includes("lead_time_24h"))
      return { ok: false, error: "Private sessions need 24 hours' notice." };
    return { ok: false, error: "Couldn't check that time. Try another." };
  }
  const row = (data as { proposed_coach: string | null; coach_changed: boolean }[])?.[0];
  let coachName: string | null = null;
  if (row?.proposed_coach) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", row.proposed_coach)
      .maybeSingle();
    coachName = profile?.full_name ?? null;
  }
  return {
    ok: true,
    proposedCoach: row?.proposed_coach ?? null,
    coachChanged: row?.coach_changed ?? false,
    coachName,
  };
}

export async function confirmPrivateReschedule(
  sessionId: string,
  newStart: string
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("reschedule_private_session", {
    p_session: sessionId,
    p_new_start: newStart,
    p_confirm: true,
  });
  if (error) return { ok: false, error: "Reschedule failed — your session is unchanged." };
  revalidatePath("/app/schedule");
  revalidatePath("/app");
  return { ok: true };
}
