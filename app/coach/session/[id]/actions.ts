"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type Result = { ok: boolean; error?: string };

async function requireCoachSession(sessionId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, session: null };
  const { data: session } = await supabase
    .from("class_sessions")
    .select("id,coach_id,starts_at,ends_at")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session || session.coach_id !== user.id) {
    return { supabase, user, session: null };
  }
  return { supabase, user, session };
}

export async function setAttendance(
  bookingId: string,
  status: "attended" | "no_show" | "confirmed"
): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const { data: booking } = await supabase
    .from("bookings")
    .select("id,session_id,class_sessions!inner(coach_id,starts_at)")
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking) return { ok: false, error: "Booking not found." };

  const session = booking.class_sessions;
  if (session.coach_id !== user.id) return { ok: false, error: "Not your session." };

  // Server-side window: 15 min before start → 48h after.
  const start = new Date(session.starts_at).getTime();
  if (Date.now() < start - 15 * 60000 || Date.now() > start + 48 * 3600000) {
    return { ok: false, error: "Attendance can only be set around the session." };
  }

  const { error } = await supabase
    .from("bookings")
    .update({ status })
    .eq("id", bookingId);
  if (error) return { ok: false, error: "Couldn't save." };
  revalidatePath(`/coach/session/${booking.session_id}`);
  return { ok: true };
}

/**
 * Add a walk-in player to a school class. Only the coach at the session knows
 * who turned up, so they register the pupil (name + school grade) here. The
 * add_school_player RPC (SECURITY DEFINER) creates the account-less player,
 * enrols them in the weekly series and books them onto this + future sessions.
 */
export async function addSchoolPlayer(
  sessionId: string,
  fullName: string,
  grade: number | null
): Promise<Result & { bookingId?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };
  if (fullName.trim() === "") return { ok: false, error: "Enter the player's name." };

  const { data: playerId, error } = await supabase.rpc("add_school_player", {
    p_session: sessionId,
    p_full_name: fullName.trim(),
    // p_grade is a smallint with no DEFAULT, so the generated Args type marks it
    // required and non-null — it can't express "required, but NULL is valid".
    // Giving the SQL argument a DEFAULT NULL would drop this cast.
    p_grade: grade as number,
  });
  if (error) return { ok: false, error: "Couldn't add the player. Try again." };

  // The booking just created for this session — so the coach can mark
  // attendance for the new pupil straight away.
  const { data: booking } = await supabase
    .from("bookings")
    .select("id")
    .eq("session_id", sessionId)
    .eq("player_id", playerId as string)
    .maybeSingle();

  revalidatePath(`/coach/session/${sessionId}`);
  return { ok: true, bookingId: booking?.id };
}

export async function saveSessionNotes(sessionId: string, notes: string): Promise<Result> {
  const { supabase, session } = await requireCoachSession(sessionId);
  if (!session) return { ok: false, error: "Not your session." };
  const { error } = await supabase
    .from("class_sessions")
    .update({ coach_notes: notes })
    .eq("id", sessionId);
  return error ? { ok: false, error: "Couldn't save notes." } : { ok: true };
}

export async function confirmComing(sessionId: string): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const { error } = await supabase.rpc("coach_confirm_session", {
    p_session: sessionId,
  });
  if (error) return { ok: false, error: "Couldn't confirm. Try again." };
  revalidatePath(`/coach/session/${sessionId}`);
  return { ok: true };
}

export async function markArrived(
  sessionId: string,
  opts?: { source?: "auto" | "tap"; distanceM?: number | null }
): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const { error } = await supabase.rpc("coach_mark_arrival", {
    p_session: sessionId,
    p_late: false,
    p_source: opts?.source ?? "tap",
    // Omitted rather than passed as null — the SQL argument defaults to NULL.
    p_distance_m: opts?.distanceM ?? undefined,
  });
  if (error) return { ok: false, error: "Couldn't send. Try again." };
  revalidatePath(`/coach/session/${sessionId}`);
  return { ok: true };
}

export async function undoArrival(sessionId: string): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const { error } = await supabase.rpc("coach_undo_arrival", { p_session: sessionId });
  if (error) {
    if (error.message.includes("undo_window_passed")) {
      return { ok: false, error: "Too late to undo — that's been sent." };
    }
    return { ok: false, error: "Couldn't undo. Try again." };
  }
  revalidatePath(`/coach/session/${sessionId}`);
  return { ok: true };
}

export async function markRunningLate(sessionId: string): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const { error } = await supabase.rpc("coach_mark_arrival", {
    p_session: sessionId,
    p_late: true,
    p_source: "tap",
  });
  if (error) return { ok: false, error: "Couldn't send. Try again." };
  // Reporting lateness now stamps coach_late_at and coach_confirmed_at
  // (migration 0071), so this screen has something to re-render — it didn't
  // before, which is why it was the one arrival action that never revalidated.
  revalidatePath(`/coach/session/${sessionId}`);
  return { ok: true };
}

export async function reportProblem(sessionId: string): Promise<Result> {
  const { supabase, user, session } = await requireCoachSession(sessionId);
  if (!session || !user) return { ok: false, error: "Not your session." };

  const { data: founders } = await supabase
    .from("profiles")
    .select("id")
    .eq("role", "founder");
  if (founders && founders.length > 0) {
    await supabase.from("notifications").insert(
      founders.map((f) => ({
        user_id: f.id,
        type: "session_issue",
        title: "Coach reported a problem",
        body: "Open the session to follow up.",
        data: { session_id: sessionId, url: "/admin/schedule" },
      }))
    );
  }
  return { ok: true };
}

export async function cantMakeIt(sessionId: string): Promise<Result> {
  const { supabase, user, session } = await requireCoachSession(sessionId);
  if (!session || !user) return { ok: false, error: "Not your session." };

  const { error } = await supabase.rpc("handle_coach_dropout", {
    p_coach: user.id,
    p_from: session.starts_at,
    p_to: session.ends_at,
  });

  if (error) {
    // Never silently null the coach without the engine's cover search — that
    // leaves the session unassigned with no replacement lined up.
    return { ok: false, error: "Couldn't arrange cover — tell the founder directly." };
  }
  revalidatePath("/coach");
  return { ok: true };
}
