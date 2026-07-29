// Founder operations shared by the admin server actions and the WhatsApp bot.
// Every function runs on a caller-supplied user-scoped client, so Postgres RLS
// (founder policies) is the enforcement layer regardless of entry point.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { academyOffsetMinutes, academyWallToUtc } from "@/lib/academy-time";
import { toSkillLevel, type OpResult } from "@/lib/admin-ops-types";

// OpResult lives in a leaf module (admin-ops-types) so the domain cores can
// import it without pointing back at this barrel — see admin-ops-types.ts.
export type { OpResult } from "@/lib/admin-ops-types";

// Domain cores split out to keep files small — re-exported so `@/lib/admin-ops`
// stays the single import surface for both the admin actions and the bot.
export * from "@/lib/admin-ops-classes";
export * from "@/lib/admin-ops-calendar";
export * from "@/lib/admin-ops-coaches";
export * from "@/lib/admin-ops-clients";
export * from "@/lib/admin-ops-venues";
export * from "@/lib/admin-ops-settings";

export type NewClass = {
  title: string;
  description: string;
  skillLevel: string;
  capacity: number;
  durationMinutes: number;
  venueId: string;
  weekday: string; // MO..SU
  time: string; // HH:MM
  coachId?: string;
  isSchool?: boolean;
};

export async function createGroupClassCore(
  supabase: SupabaseClient<Database>,
  founderId: string,
  input: NewClass
): Promise<OpResult> {
  const { data: cls, error } = await supabase
    .from("classes")
    .insert({
      class_type: "group",
      is_school: input.isSchool ?? false,
      title: input.title,
      description: input.description || null,
      skill_level: toSkillLevel(input.skillLevel),
      capacity: input.capacity,
      duration_minutes: input.durationMinutes,
      venue_id: input.venueId,
      recurrence_rule: `FREQ=WEEKLY;BYDAY=${input.weekday}`,
      starts_on: new Date().toISOString().slice(0, 10),
      created_by: founderId,
    })
    .select("id")
    .single();
  if (error || !cls) return { ok: false, error: "Couldn't create the class." };

  // Publish → sessions 8 weeks ahead, wall-clock Asia/Kolkata.
  const weekdayNum = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 }[input.weekday] ?? 1;
  const [hh, mm] = input.time.split(":").map(Number);
  const sessions: { class_id: string; coach_id: string | null; starts_at: string; ends_at: string }[] = [];
  const today = new Date();
  for (let d = 0; d <= 56; d++) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + d);
    const isoDow = ((day.getDay() + 6) % 7) + 1;
    if (isoDow !== weekdayNum) continue;
    const naive = new Date(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), hh, mm));
    const offset = academyOffsetMinutes(naive);
    const start = new Date(naive.getTime() - offset * 60000);
    if (start <= new Date()) continue;
    sessions.push({
      class_id: cls.id,
      coach_id: input.coachId || null,
      starts_at: start.toISOString(),
      ends_at: new Date(start.getTime() + input.durationMinutes * 60000).toISOString(),
    });
  }
  if (sessions.length) {
    const { error: sessErr } = await supabase.from("class_sessions").insert(sessions);
    if (sessErr) {
      return {
        ok: false,
        error: sessErr.message.includes("coach_no_overlap")
          ? "That coach already has overlapping sessions at this time — class created, pick a different coach in the calendar."
          : "Class created but sessions failed to generate.",
      };
    }
  }
  if (!input.coachId) {
    await supabase.rpc("assign_unassigned_sessions");
  }

  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "class.create",
    entity: "classes",
    entity_id: cls.id,
    meta: { sessions: sessions.length },
  });

  return { ok: true };
}

export type NewOneOffClass = {
  title: string;
  description: string;
  skillLevel: string;
  capacity: number;
  durationMinutes: number;
  venueId: string;
  /** Each occurrence becomes one session — academy wall-clock date + time. */
  occurrences: { date: string; time: string }[];
  coachId?: string;
  isSchool?: boolean;
};

/**
 * A one-off class: same shape as a weekly group class but with no recurrence
 * rule, so the session top-up generator never extends it and it stays off the
 * Weekly classes tab. One session is created per occurrence, each at its own
 * date and time.
 */
export async function createOneOffClassCore(
  supabase: SupabaseClient<Database>,
  founderId: string,
  input: NewOneOffClass
): Promise<OpResult> {
  if (input.occurrences.length === 0) return { ok: false, error: "Pick at least one date." };
  const starts = input.occurrences.map((o) => academyWallToUtc(o.date, o.time));
  if (starts.some((s) => !(s > new Date())))
    return { ok: false, error: "Pick times in the future." };

  const startsOn = input.occurrences.map((o) => o.date).sort()[0];
  const { data: cls, error } = await supabase
    .from("classes")
    .insert({
      class_type: "group",
      is_school: input.isSchool ?? false,
      title: input.title,
      description: input.description || null,
      skill_level: toSkillLevel(input.skillLevel),
      capacity: input.capacity,
      duration_minutes: input.durationMinutes,
      venue_id: input.venueId,
      recurrence_rule: null,
      starts_on: startsOn,
      created_by: founderId,
    })
    .select("id")
    .single();
  if (error || !cls) return { ok: false, error: "Couldn't create the class." };

  const { error: sessErr } = await supabase.from("class_sessions").insert(
    starts.map((start) => ({
      class_id: cls.id,
      coach_id: input.coachId || null,
      starts_at: start.toISOString(),
      ends_at: new Date(start.getTime() + input.durationMinutes * 60000).toISOString(),
    }))
  );
  if (sessErr) {
    // No sessions means nothing on the calendar — remove the empty class shell.
    await supabase.from("classes").delete().eq("id", cls.id);
    return {
      ok: false,
      error: sessErr.message.includes("coach_no_overlap")
        ? "That coach is already busy then — pick another coach or leave it on automatic."
        : "Couldn't add the sessions.",
    };
  }
  if (!input.coachId) await supabase.rpc("assign_unassigned_sessions");

  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "class.create",
    entity: "classes",
    entity_id: cls.id,
    meta: { one_off: true, sessions: starts.length },
  });

  return { ok: true };
}

/** Cancel one session with credits + notifications (C8 single-session case). */
export async function cancelSessionCore(
  supabase: SupabaseClient<Database>,
  founderId: string,
  sessionId: string,
  reason: string
): Promise<OpResult> {
  const { data: session } = await supabase
    .from("class_sessions")
    .select("id,starts_at,coach_id,classes!inner(title,class_type,duration_minutes)")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) return { ok: false, error: "Session not found." };
  const cls = session.classes;

  const { data: bookings } = await supabase
    .from("bookings")
    .select("id,client_id")
    .eq("session_id", sessionId)
    .in("status", ["confirmed", "waitlisted"]);

  await supabase
    .from("class_sessions")
    .update({ status: "cancelled", cancel_reason: reason })
    .eq("id", sessionId);

  for (const b of bookings ?? []) {
    await supabase
      .from("bookings")
      .update({
        status: "cancelled_by_academy",
        cancelled_at: new Date().toISOString(),
        cancel_reason: reason,
      })
      .eq("id", b.id);
    // The booking is cancelled either way; the refund and the notification both
    // need an account holder, which a school player's booking doesn't have.
    if (b.client_id === null) continue;
    if (cls.class_type === "private") {
      await supabase.from("private_credit_ledger").insert({
        client_id: b.client_id,
        booking_id: b.id,
        delta_minutes: cls.duration_minutes,
        reason: "cancellation_refund",
        note: "academy cancelled",
      });
    }
    await supabase.from("notifications").insert({
      user_id: b.client_id,
      type: "session_cancelled",
      title: "Session cancelled",
      body: `${cls.title} — we're sorry. ${cls.class_type === "private" ? "Your minutes have been returned." : "Your session allowance is unaffected."}`,
      data: { session_id: sessionId, url: "/app/schedule" },
    });
  }
  if (session.coach_id) {
    await supabase.from("notifications").insert({
      user_id: session.coach_id,
      type: "session_cancelled",
      title: "Session cancelled",
      body: cls.title,
      data: { session_id: sessionId, url: "/coach" },
    });
  }

  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "session.cancel",
    entity: "class_sessions",
    entity_id: sessionId,
    meta: { reason, bookings: bookings?.length ?? 0 },
  });

  return { ok: true };
}

export async function grantCompCore(
  supabase: SupabaseClient<Database>,
  founderId: string,
  clientId: string,
  planId: string
): Promise<OpResult> {
  const { data: plan } = await supabase
    .from("plans")
    .select("private_minutes_per_cycle")
    .eq("id", planId)
    .maybeSingle();
  const { data: sub, error } = await supabase
    .from("subscriptions")
    .insert({
      client_id: clientId,
      plan_id: planId,
      source: "comp",
      status: "active",
      current_period_start: new Date().toISOString(),
      current_period_end: new Date(Date.now() + 30 * 86400000).toISOString(),
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: "Couldn't grant the subscription." };
  if (plan && plan.private_minutes_per_cycle > 0) {
    await supabase.from("private_credit_ledger").insert({
      client_id: clientId,
      subscription_id: sub.id,
      delta_minutes: plan.private_minutes_per_cycle,
      reason: "grant",
      note: "comp grant",
    });
  }
  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "subscription.comp_grant",
    entity: "subscriptions",
    entity_id: sub.id,
    meta: { client_id: clientId, plan_id: planId },
  });
  return { ok: true };
}

export async function adjustCreditsCore(
  supabase: SupabaseClient<Database>,
  founderId: string,
  clientId: string,
  deltaMinutes: number,
  note: string
): Promise<OpResult> {
  if (!Number.isFinite(deltaMinutes) || deltaMinutes === 0) {
    return { ok: false, error: "Enter a non-zero number of minutes." };
  }
  await supabase.from("private_credit_ledger").insert({
    client_id: clientId,
    delta_minutes: deltaMinutes,
    reason: "manual",
    note: note || "founder adjustment",
  });
  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "credits.adjust",
    entity: "private_credit_ledger",
    meta: { client_id: clientId, delta: deltaMinutes, note },
  });
  return { ok: true };
}

export async function decideTimeOffCore(
  supabase: SupabaseClient<Database>,
  founderId: string,
  timeOffId: string,
  approve: boolean
): Promise<OpResult> {
  const { data: request } = await supabase
    .from("coach_time_off")
    .select("id,coach_id,starts_at,ends_at")
    .eq("id", timeOffId)
    .maybeSingle();
  if (!request) return { ok: false, error: "Request not found." };

  await supabase
    .from("coach_time_off")
    .update({ status: approve ? "approved" : "rejected", decided_by: founderId })
    .eq("id", timeOffId);

  if (approve) {
    // Approval resolves overlapping sessions via the cascade (C2).
    await supabase.rpc("handle_coach_dropout", {
      p_coach: request.coach_id,
      p_from: request.starts_at,
      p_to: request.ends_at,
    });
  }

  await supabase.from("notifications").insert({
    user_id: request.coach_id,
    type: "time_off_decision",
    title: approve ? "Time off approved" : "Time off rejected",
    body: approve
      ? "Your sessions in the range are being covered."
      : "Talk to the founder if you need this changed.",
    data: { url: "/coach/more" },
  });

  return { ok: true };
}
