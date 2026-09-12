// Founder operations shared by the admin server actions and the WhatsApp bot.
// Every function runs on a caller-supplied user-scoped client, so Postgres RLS
// (founder policies) is the enforcement layer regardless of entry point.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { academyToday, academyWallToUtc } from "@/lib/academy-time";
import { overlaps, weeklyOccurrences } from "@/lib/slot-clashes";
import { toSkillLevel, type OpResult } from "@/lib/admin-ops-types";

// OpResult lives in a leaf module (admin-ops-types) so the domain cores can
// import it without pointing back at this barrel — see admin-ops-types.ts.
export type { OpResult } from "@/lib/admin-ops-types";

// Domain cores split out to keep files small — re-exported so `@/lib/admin-ops`
// stays the single import surface for both the admin actions and the bot.
export * from "@/lib/admin-ops-classes";
export * from "@/lib/admin-ops-calendar";
export * from "@/lib/admin-ops-private-series";
export * from "@/lib/admin-ops-wipe";
export * from "@/lib/admin-ops-removal-notice";
export * from "@/lib/admin-ops-chunk";
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

export type CreateClassResult = OpResult & {
  /** Weeks actually put on the schedule. */
  weeks?: number;
  /** Of those, how many could NOT take the chosen coach and went out coachless
   * for the engine to fill. Zero when no coach was named. */
  coachless?: number;
};

/**
 * Publish a repeating group class, plus its next 8 weeks of sessions.
 *
 * A clashing week no longer takes the class down with it. It used to: every
 * occurrence went in as ONE array insert, and `coach_no_overlap` is a
 * non-deferrable EXCLUDE, so a single week where the chosen coach was already
 * booked aborted all nine rows. The `classes` row is written in a separate
 * PostgREST call — a separate transaction — so it had already been committed,
 * and nothing cleaned it up. The founder was left with a class holding zero
 * sessions, told to "pick a different coach in the calendar" when the calendar
 * had nothing of his to pick. The class then sat empty indefinitely, because
 * `generate_class_sessions` is on no cron job and only a manual top-up refills
 * it.
 *
 * The rule now: the SLOT is what the founder is creating, and one busy week is
 * a fact about a coach's diary, not a reason the Tuesday class cannot exist. So
 * we ask the coach's diary first, hand the weeks he can take to him and let the
 * rest go out coachless for the assignment engine — and say plainly which is
 * which, rather than reporting a clean success over weeks that quietly have
 * nobody on them.
 */
export async function createGroupClassCore(
  supabase: SupabaseClient<Database>,
  founderId: string,
  input: NewClass
): Promise<CreateClassResult> {
  // Occurrences are built on the ACADEMY wall clock, not the server's. This
  // used to walk `new Date()` in local time and stamp `starts_on` from a UTC
  // date string, so a deploy region west of IST could drop or add an occurrence
  // and record a start date a day out.
  const todayWall = academyToday();
  const durationMs = input.durationMinutes * 60000;

  // Shared with the Add sheet's clash preview (lib/slot-clashes.ts), so what
  // the founder was shown and what actually gets written are the same weeks.
  const slots = weeklyOccurrences(input.weekday, input.time, 8);

  // Which of those weeks the chosen coach genuinely cannot take. Asked BEFORE
  // anything is written, so the insert is shaped to succeed rather than being
  // fired hopefully at a constraint. Only `scheduled` sessions count — the
  // constraint ignores cancelled and completed ones, and so must we, or we'd
  // hand a week to nobody over a session that was called off weeks ago.
  const clashing = new Set<number>();
  if (input.coachId && slots.length) {
    const windowStart = slots[0];
    const windowEnd = new Date(slots[slots.length - 1].getTime() + durationMs);
    const { data: busy } = await supabase
      .from("class_sessions")
      .select("starts_at,ends_at")
      .eq("coach_id", input.coachId)
      .eq("status", "scheduled")
      .lt("starts_at", windowEnd.toISOString())
      .gt("ends_at", windowStart.toISOString());
    for (const [i, start] of slots.entries()) {
      const hit = (busy ?? []).some((b) =>
        overlaps(
          start.getTime(),
          start.getTime() + durationMs,
          new Date(b.starts_at).getTime(),
          new Date(b.ends_at).getTime()
        )
      );
      if (hit) clashing.add(i);
    }
  }

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
      starts_on: todayWall,
      created_by: founderId,
    })
    .select("id")
    .single();
  if (error || !cls) return { ok: false, error: "Couldn't create the class." };

  const rows = slots.map((start, i) => ({
    class_id: cls.id,
    coach_id: input.coachId && !clashing.has(i) ? input.coachId : null,
    starts_at: start.toISOString(),
    ends_at: new Date(start.getTime() + durationMs).toISOString(),
  }));

  let created = 0;
  let coachless = rows.filter((r) => input.coachId && r.coach_id === null).length;
  if (rows.length) {
    const { error: sessErr } = await supabase.from("class_sessions").insert(rows);
    if (!sessErr) created = rows.length;
    else {
      // The pre-check lost a race, or something else refused the batch. Go week
      // by week so one bad row costs one week rather than the whole term, and
      // retry a rejected coached week without the coach — the week matters more
      // than who is on it, and the engine gets a go at it below.
      for (const row of rows) {
        const { error: rowErr } = await supabase.from("class_sessions").insert(row);
        if (!rowErr) {
          created += 1;
          continue;
        }
        if (!row.coach_id) continue;
        const { error: bareErr } = await supabase
          .from("class_sessions")
          .insert({ ...row, coach_id: null });
        if (!bareErr) {
          created += 1;
          coachless += 1;
        }
      }
    }
  }

  // Nothing at all landed on the schedule, so there is no class — only a shell
  // that would show up on the weekly list with no slot of its own to read. Take
  // it back out, the way the one-off path always has.
  if (rows.length && created === 0) {
    await supabase.from("classes").delete().eq("id", cls.id);
    return {
      ok: false,
      error: "Couldn't put any weeks of this class on the schedule, so nothing was created. Try again, or pick a different time.",
    };
  }

  if (coachless > 0 || !input.coachId) {
    await supabase.rpc("assign_unassigned_sessions");
  }

  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "class.create",
    entity: "classes",
    entity_id: cls.id,
    meta: { sessions: created, coachless },
  });

  return { ok: true, weeks: created, coachless };
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
