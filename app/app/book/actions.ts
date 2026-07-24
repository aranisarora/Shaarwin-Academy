"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

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
  no_entitlement:
    "No membership, free trial or drop-in class available — see the membership page.",
  recurring_needs_membership:
    "Weekly bookings need a membership — book a one-off, or pick a plan first.",
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

  if (error) {
    const key = Object.keys(errorCopy).find((k) => error.message.includes(k));
    return { ok: false, error: key ? errorCopy[key] : errorCopy.booking_failed };
  }

  return { ok: false, error: errorCopy.booking_failed };
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

  if (error) {
    const key = Object.keys(errorCopy).find((k) => error.message.includes(k));
    return { ok: false, error: key ? errorCopy[key] : errorCopy.booking_failed };
  }

  return { ok: false, error: errorCopy.booking_failed };
}

export type CancelResult = { ok: boolean; error?: string };

export async function cancelBooking(bookingId: string): Promise<CancelResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const { error } = await supabase.rpc("cancel_booking", { p_booking: bookingId });
  if (error) return { ok: false, error: "Cancel failed. Try again." };

  revalidatePath("/app");
  revalidatePath("/app/schedule");
  return { ok: true };
}
