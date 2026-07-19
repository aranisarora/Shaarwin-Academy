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

  const session = booking.class_sessions as unknown as {
    coach_id: string;
    starts_at: string;
  };
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

export async function markArrived(sessionId: string): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const { error } = await supabase.rpc("coach_mark_arrival", {
    p_session: sessionId,
    p_late: false,
  });
  if (error) return { ok: false, error: "Couldn't send. Try again." };
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
  });
  if (error) return { ok: false, error: "Couldn't send. Try again." };
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
    // Engine not applied yet: unassign + alert the founder directly.
    await supabase
      .from("class_sessions")
      .update({ coach_id: null })
      .eq("id", sessionId);
    const { data: founders } = await supabase
      .from("profiles")
      .select("id")
      .eq("role", "founder");
    if (founders) {
      await supabase.from("notifications").insert(
        founders.map((f) => ({
          user_id: f.id,
          type: "session_unassigned",
          title: "Cover needed",
          body: "A coach dropped a session.",
          data: { session_id: sessionId, url: "/admin/schedule" },
        }))
      );
    }
  }
  revalidatePath("/coach");
  return { ok: true };
}
