"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSubscriptionSummary } from "@/lib/billing";

export type BookResult =
  | { ok: true; status: "confirmed" | "waitlisted"; bookingId: string }
  | { ok: false; error: string };

/** Result of booking a slot that may span many future weeks. */
export type BookSlotResult =
  | {
      ok: true;
      recurring: boolean;
      firstStatus: "confirmed" | "waitlisted" | "skipped";
      confirmed: number;
      waitlisted: number;
      skipped: number;
    }
  | { ok: false; error: string };

const errorCopy: Record<string, string> = {
  no_active_subscription: "You need an active membership to book.",
  weekly_cap_reached: "You've used your group sessions for this week.",
  session_not_bookable: "This session can't be booked any more.",
  player_double_booked: "That player already has a session at this time.",
  player_not_in_household: "That player isn't on your account.",
  already_booked: "Already booked — you're in.",
  booking_failed: "Booking didn't go through. Try again.",
};

/**
 * Book a slot. When `recurring` is true the RPC enrols every future occurrence
 * of the slot (same weekday + time) and keeps a standing series so newly
 * generated weeks are booked automatically. `recurring` false books just the
 * one session.
 */
export async function bookSlot(
  sessionId: string,
  playerId: string,
  recurring: boolean
): Promise<BookSlotResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in to book." };

  const { data, error } = await supabase.rpc("book_series", {
    p_session: sessionId,
    p_player: playerId,
    p_recurring: recurring,
  });

  if (!error && data) {
    revalidatePath("/app");
    revalidatePath("/app/schedule");
    const d = data as {
      confirmed: number;
      waitlisted: number;
      skipped: number;
      first_status: string;
    };
    const first =
      d.first_status === "confirmed"
        ? "confirmed"
        : d.first_status === "waitlisted"
          ? "waitlisted"
          : "skipped";
    return {
      ok: true,
      recurring,
      firstStatus: first,
      confirmed: d.confirmed ?? 0,
      waitlisted: d.waitlisted ?? 0,
      skipped: d.skipped ?? 0,
    };
  }

  if (error && !isFunctionMissing(error.code)) {
    const key = Object.keys(errorCopy).find((k) => error.message.includes(k));
    return { ok: false, error: key ? errorCopy[key] : errorCopy.booking_failed };
  }

  // Fallback (RPC not applied yet): book just the immediate session in JS.
  const single = await bookSession(sessionId, playerId);
  if (!single.ok) return { ok: false, error: single.error };
  return {
    ok: true,
    recurring: false,
    firstStatus: single.status,
    confirmed: single.status === "confirmed" ? 1 : 0,
    waitlisted: single.status === "waitlisted" ? 1 : 0,
    skipped: 0,
  };
}

export async function bookSession(
  sessionId: string,
  playerId: string
): Promise<BookResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in to book." };

  // Preferred path: the race-proof SQL RPC (P05 contract).
  const { data, error } = await supabase.rpc("book_session", {
    p_session: sessionId,
    p_player: playerId,
  });

  if (!error && data) {
    revalidatePath("/app");
    revalidatePath("/app/schedule");
    return { ok: true, status: data.status, bookingId: data.id };
  }

  if (error && !isFunctionMissing(error.code)) {
    const key = Object.keys(errorCopy).find((k) => error.message.includes(k));
    return { ok: false, error: key ? errorCopy[key] : errorCopy.booking_failed };
  }

  // Fallback (RPCs not yet applied to the database): validate in JS.
  // The partial unique index on live bookings remains the double-book backstop.
  const summary = await getSubscriptionSummary(supabase, user.id);
  if (!summary.active) return { ok: false, error: errorCopy.no_active_subscription };

  const { data: session } = await supabase
    .from("class_sessions")
    .select("id,starts_at,ends_at,status,capacity_override,classes!inner(title,capacity)")
    .eq("id", sessionId)
    .single();
  if (!session || session.status !== "scheduled") {
    return { ok: false, error: errorCopy.session_not_bookable };
  }
  if (new Date(session.starts_at).getTime() < Date.now() + 60 * 60000) {
    return { ok: false, error: errorCopy.session_not_bookable };
  }

  const { data: player } = await supabase
    .from("players")
    .select("id")
    .eq("id", playerId)
    .eq("client_id", user.id)
    .maybeSingle();
  if (!player) return { ok: false, error: errorCopy.booking_failed };

  const cls = session.classes as unknown as { title: string; capacity: number };
  const capacity = session.capacity_override ?? cls.capacity;
  const { count: confirmed } = await supabase
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("session_id", sessionId)
    .eq("status", "confirmed");

  const status = (confirmed ?? 0) < capacity ? "confirmed" : "waitlisted";
  let waitlistPosition: number | null = null;
  if (status === "waitlisted") {
    const { count } = await supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("session_id", sessionId)
      .eq("status", "waitlisted");
    waitlistPosition = (count ?? 0) + 1;
  }

  const { data: booking, error: insertError } = await supabase
    .from("bookings")
    .insert({
      session_id: sessionId,
      client_id: user.id,
      player_id: playerId,
      status,
      waitlist_position: waitlistPosition,
    })
    .select("id,status")
    .single();

  if (insertError) {
    return {
      ok: false,
      error: insertError.code === "23505" ? errorCopy.already_booked : errorCopy.booking_failed,
    };
  }

  // Outbox rows — P11 delivers.
  await supabase.from("notifications").insert([
    {
      user_id: user.id,
      type: "booking_confirmed",
      title: status === "confirmed" ? "Booked." : "You're on the waitlist",
      body: cls.title,
      data: { booking_id: booking.id, session_id: sessionId, url: "/app/schedule" },
    },
    {
      user_id: user.id,
      type: "reminder_24h",
      title: "Tomorrow",
      body: cls.title,
      data: { booking_id: booking.id, url: "/app/schedule" },
      scheduled_for: new Date(new Date(session.starts_at).getTime() - 24 * 3600000).toISOString(),
    },
    {
      user_id: user.id,
      type: "reminder_2h",
      title: "Later today",
      body: cls.title,
      data: { booking_id: booking.id, url: "/app/schedule" },
      scheduled_for: new Date(new Date(session.starts_at).getTime() - 2 * 3600000).toISOString(),
    },
  ]);

  revalidatePath("/app");
  revalidatePath("/app/schedule");
  return { ok: true, status: booking.status, bookingId: booking.id };
}

export type CancelResult = { ok: boolean; error?: string };

export async function cancelBooking(bookingId: string): Promise<CancelResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const { error } = await supabase.rpc("cancel_booking", { p_booking: bookingId });

  if (error && isFunctionMissing(error.code)) {
    // Fallback path without the RPC.
    const { data: booking } = await supabase
      .from("bookings")
      .select("id,client_id,session_id,class_sessions!inner(starts_at)")
      .eq("id", bookingId)
      .maybeSingle();
    if (!booking || booking.client_id !== user.id) {
      return { ok: false, error: "Booking not found." };
    }
    const startsAt = (booking.class_sessions as unknown as { starts_at: string }).starts_at;
    const free = new Date(startsAt).getTime() - Date.now() >= 24 * 3600000;
    const { error: updateError } = await supabase
      .from("bookings")
      .update({
        status: "cancelled_by_client",
        cancelled_at: new Date().toISOString(),
        cancel_reason: free ? "in_window" : "late",
      })
      .eq("id", bookingId);
    if (updateError) return { ok: false, error: "Cancel failed. Try again." };
  } else if (error) {
    return { ok: false, error: "Cancel failed. Try again." };
  }

  revalidatePath("/app");
  revalidatePath("/app/schedule");
  return { ok: true };
}

function isFunctionMissing(code: string | undefined): boolean {
  return code === "PGRST202" || code === "42883";
}
