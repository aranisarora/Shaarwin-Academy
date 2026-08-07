// Session/calendar cores — reassign, move, capacity override, one-off session.
// Shared by admin actions and the WhatsApp bot; RLS enforces on the caller's
// client.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { academyWallToUtc, formatSessionDate } from "@/lib/academy-time";
import type { OpResult } from "@/lib/admin-ops-types";

const whenIST = formatSessionDate;

export async function reassignSessionCore(
  supabase: SupabaseClient<Database>,
  founderId: string,
  sessionId: string,
  coachId: string,
  lock: boolean,
  force = false
): Promise<OpResult> {
  const { error } = await supabase.rpc("founder_reassign", {
    p_session: sessionId,
    p_coach: coachId,
    p_lock: lock,
    p_force: force,
  });

  if (error && (error.code === "PGRST202" || error.code === "42883")) {
    // Engine RPC not applied yet — apply the assignment directly.
    const { error: e2 } = await supabase
      .from("class_sessions")
      .update({ coach_id: coachId })
      .eq("id", sessionId);
    if (e2) {
      return {
        ok: false,
        error: e2.message.includes("coach_no_overlap")
          ? "That coach already has an overlapping session."
          : "Reassign failed.",
      };
    }
    await supabase
      .from("coach_assignments")
      .update({ status: "superseded" })
      .eq("session_id", sessionId)
      .eq("status", "active");
    await supabase.from("coach_assignments").insert({
      session_id: sessionId,
      coach_id: coachId,
      assigned_by: founderId,
      locked: lock,
    });
  } else if (error) {
    if (error.message.includes("filter_failed")) {
      const reason = error.message.split("filter_failed_")[1] ?? "hard filter";
      const friendly: Record<string, string> = {
        inactive: "they're paused",
        time_off: "they're on approved time off",
        unavailable: "the slot is outside their availability hours",
        overlap: "they'd clash with another session (incl. travel buffer)",
        level_too_high: "the class level is above what they teach",
        dbs_required: "a junior is booked and they have no DBS check",
      };
      return {
        ok: false,
        code: "filter_failed",
        error: `That coach doesn't fit: ${friendly[reason] ?? reason}.`,
      };
    }
    if (error.message.includes("coach_no_overlap")) {
      return { ok: false, error: "That coach already has an overlapping session." };
    }
    return { ok: false, error: "Reassign failed." };
  }
  return { ok: true };
}

/** Move one session to a new day/time; everyone booked (and the coach) is told. */
export async function moveSessionCore(
  supabase: SupabaseClient<Database>,
  founderId: string,
  sessionId: string,
  date: string, // YYYY-MM-DD academy wall clock
  time: string // HH:MM
): Promise<OpResult> {
  const { data: session } = await supabase
    .from("class_sessions")
    .select("id,coach_id,starts_at,classes!inner(title,duration_minutes)")
    .eq("id", sessionId)
    .eq("status", "scheduled")
    .maybeSingle();
  if (!session) return { ok: false, error: "Session not found." };
  const cls = session.classes;

  const newStart = academyWallToUtc(date, time);
  if (!(newStart > new Date())) return { ok: false, error: "Pick a time in the future." };
  const newEnd = new Date(newStart.getTime() + cls.duration_minutes * 60000);

  let coachCleared = false;
  const { error } = await supabase
    .from("class_sessions")
    .update({ starts_at: newStart.toISOString(), ends_at: newEnd.toISOString() })
    .eq("id", sessionId);
  if (error) {
    const { error: retryErr } = await supabase
      .from("class_sessions")
      .update({
        starts_at: newStart.toISOString(),
        ends_at: newEnd.toISOString(),
        coach_id: null,
      })
      .eq("id", sessionId);
    if (retryErr) return { ok: false, error: "Couldn't move the session." };
    coachCleared = true;
    await supabase.rpc("assign_unassigned_sessions");
  }

  const { data: bookings } = await supabase
    .from("bookings")
    .select("client_id")
    .eq("session_id", sessionId)
    .in("status", ["confirmed", "waitlisted"]);
  const when = whenIST(newStart);
  // old → new, so the message can say what it changed FROM. Without this the
  // member is told a session "is now Thursday 6:30pm" with no way to know which
  // of their sessions moved. (notification-fix-plan 2.5.)
  const wasWhen = whenIST(new Date(session.starts_at));
  const changed = {
    old_time_str: wasWhen,
    new_time_str: when,
    old_starts_at: session.starts_at,
    new_starts_at: newStart.toISOString(),
  };
  const notified = new Set<string>();
  for (const b of bookings ?? []) {
    // A school player's booking has no account behind it — nobody to notify.
    if (b.client_id === null) continue;
    if (notified.has(b.client_id)) continue;
    notified.add(b.client_id);
    await supabase.from("notifications").insert({
      user_id: b.client_id,
      type: "session_moved",
      title: "Session moved",
      body: `${cls.title} has moved from ${wasWhen} to ${when}.`,
      data: { session_id: sessionId, class_title: cls.title, ...changed, url: "/app/schedule" },
    });
  }
  if (session.coach_id) {
    await supabase.from("notifications").insert({
      user_id: session.coach_id,
      type: "session_moved",
      title: coachCleared ? "Session moved off your calendar" : "Session moved",
      body: `${cls.title} — ${
        coachCleared
          ? `the new time (${when}) clashed for you, so it's off your calendar`
          : `moved from ${wasWhen} to ${when}`
      }.`,
      data: { session_id: sessionId, class_title: cls.title, ...changed, url: "/coach" },
    });
  }

  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "session.move",
    entity: "class_sessions",
    entity_id: sessionId,
    meta: { new_start: newStart.toISOString(), coach_cleared: coachCleared },
  });
  return { ok: true };
}

/** One-off capacity change for a single session (null = back to class default). */
export async function setSessionCapacityCore(
  supabase: SupabaseClient<Database>,
  founderId: string,
  sessionId: string,
  capacity: number | null
): Promise<OpResult> {
  if (capacity !== null && (!Number.isFinite(capacity) || capacity < 1)) {
    return { ok: false, error: "Spots must be at least 1." };
  }
  const { error } = await supabase
    .from("class_sessions")
    .update({ capacity_override: capacity })
    .eq("id", sessionId);
  if (error) return { ok: false, error: "Couldn't update the spots." };
  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "session.capacity",
    entity: "class_sessions",
    entity_id: sessionId,
    meta: { capacity },
  });
  return { ok: true };
}

export type PrivateSessionInput = {
  /**
   * The client this session is booked for. Omit to hold an "open" private slot
   * (coach + venue + time, no client) — no booking or minutes debit until a
   * client is assigned later via assignPrivateSessionClientCore.
   */
  clientId?: string;
  playerId?: string; // defaults to the client's first player
  date: string; // YYYY-MM-DD academy wall clock
  time: string; // HH:MM
  durationMinutes: number; // 60 | 90
  address: string;
  postcode?: string;
  lat: number;
  lng: number;
  hasTable?: boolean;
  accessNotes?: string;
  /** Structured address, written straight to the `address_details` jsonb column. */
  addressDetails?: Json | null;
  /**
   * The venue this private sits at, when it's one we hold. Preferred over
   * `venueLabel`: renaming the venue then corrects every message it has ever
   * appeared in, rather than leaving frozen copies behind.
   */
  venueId?: string | null;
  /** Only for somewhere with no venue row. Ignored when `venueId` is set. */
  venueLabel?: string | null;
  /** Where inside the venue — "Clubhouse", "Villa 659", "Tower 1, flat 171". */
  unitLabel?: string | null;
  coachId?: string;
  /**
   * Repeat the session weekly. 1 (or unset) books a single one-off session; N
   * stands up a recurring weekly slot — a private_booking_series booked N weeks
   * ahead, which the nightly generator then keeps rolling. All-or-nothing.
   */
  recurWeeks?: number;
};

/** A wall-clock date (YYYY-MM-DD) shifted forward by whole weeks. */
function addWeeksToWallDate(date: string, weeks: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}

/**
 * Founder books a private session on a client's behalf — same shape the
 * client-side request_private_class RPC produces (private class + details +
 * session + confirmed booking + minutes debit), but founder-initiated so the
 * 24h lead time, balance check and the client's plan limits (session length,
 * sessions per week) don't apply. An admin booking is the decision, not a
 * request to be vetted — the plan only ever gates what clients book themselves.
 * The debit keeps the ledger symmetric with the cancel-refund path; the balance
 * may go negative and the founder can top it up via adjustCreditsCore.
 *
 * With `recurWeeks > 1` this creates a real private_booking_series (the same
 * model as the client-side create_private_series): the slot shows as "Weekly",
 * the client can cancel all future weeks from their schedule, and the nightly
 * generate_private_sessions keeps rolling the horizon while their plan is live.
 * The initial `recurWeeks` weeks are booked here; the whole run rolls back if
 * any week fails. With no client (an open slot) the same `recurWeeks` holds
 * that many weeks of empty sessions — no series, since one needs a client.
 */
export async function createPrivateSessionCore(
  supabase: SupabaseClient<Database>,
  founderId: string,
  input: PrivateSessionInput
): Promise<OpResult> {
  // No client → an open slot: no player, no booking, no minutes debit.
  const isOpen = !input.clientId;
  const clientId = input.clientId;

  let playerId = input.playerId;
  if (!isOpen && clientId) {
    if (playerId) {
      const { data: p } = await supabase
        .from("players")
        .select("id")
        .eq("id", playerId)
        .eq("client_id", clientId)
        .maybeSingle();
      if (!p) return { ok: false, error: "That player doesn't belong to this client." };
    } else {
      const { data: p } = await supabase
        .from("players")
        .select("id")
        .eq("client_id", clientId)
        .order("created_at")
        .limit(1)
        .maybeSingle();
      if (!p) {
        // Founder-initiated booking for an account that never added a player —
        // create one from the client's name so the session has someone on it.
        const { data: prof } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("id", clientId)
          .maybeSingle();
        const { data: fresh, error: freshErr } = await supabase
          .from("players")
          .insert({
            client_id: clientId,
            full_name: prof?.full_name?.trim() || "Player",
          })
          .select("id")
          .single();
        if (freshErr || !fresh)
          return { ok: false, error: "That client has no player profile yet." };
        playerId = fresh.id;
      } else {
        playerId = p.id;
      }
    }
  }

  const duration = input.durationMinutes === 90 ? 90 : 60;
  const weeks = Math.min(Math.max(Math.trunc(input.recurWeeks ?? 1), 1), 12);
  // >1 week means a standing weekly slot, not a fixed block: we create a real
  // private_booking_series (same model as the client-side create_private_series)
  // so it shows as "Weekly", the client can cancel all future weeks, and the
  // nightly generate_private_sessions keeps rolling the horizon. An open slot
  // still books its N weeks — private_booking_series is keyed to a client and a
  // player, so what it can't have is the rolling template, not the occurrences.
  const recurring = weeks > 1 && !isOpen;
  // ISO weekday (Mon=1..Sun=7) of the first occurrence, in the IST wall date.
  const isoWeekday = (((new Date(`${input.date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1);

  // One occurrence per week from the chosen start date, same weekday/time.
  const occurrences = Array.from({ length: weeks }, (_, i) => {
    const date = addWeeksToWallDate(input.date, i);
    const start = academyWallToUtc(date, input.time);
    return { date, start, end: new Date(start.getTime() + duration * 60000) };
  });
  if (!(occurrences[0].start > new Date()))
    return { ok: false, error: "Pick a time in the future." };

  // Create each occurrence. Track what we made so a mid-run failure can undo
  // the whole series — a half-booked recurring run shouldn't linger.
  const createdClassIds: string[] = [];
  const createdLedgerIds: string[] = [];
  const createdSessions: { id: string; start: Date }[] = [];
  let seriesId: string | null = null;

  async function rollback() {
    if (createdLedgerIds.length)
      await supabase.from("private_credit_ledger").delete().in("id", createdLedgerIds);
    // Deleting the class cascades to its details, session and booking.
    if (createdClassIds.length)
      await supabase.from("classes").delete().in("id", createdClassIds);
    if (seriesId)
      await supabase.from("private_booking_series").delete().eq("id", seriesId);
  }

  // Stand up the standing series first, so every occurrence below links to it.
  // `recurring` already implies a client (it's `!isOpen`), and a client always
  // resolved a player above — the ids are restated here so the non-null columns
  // below are guaranteed by the type system rather than by that reasoning.
  if (recurring && clientId && playerId) {
    const { data: series, error: seriesErr } = await supabase
      .from("private_booking_series")
      .insert({
        client_id: clientId,
        player_id: playerId,
        preferred_coach: input.coachId || null,
        weekday: isoWeekday,
        start_time: input.time,
        duration_minutes: duration,
        address: input.address,
        postcode: input.postcode ?? "",
        lat: input.lat,
        lng: input.lng,
        has_table: input.hasTable ?? true,
        access_notes: input.accessNotes || null,
        address_details: input.addressDetails ?? null,
        // The location lives on the series too, not just its occurrences —
        // generate_private_sessions rolls the horizon from these columns, so a
        // series missing them would re-derive a label every week.
        venue_id: input.venueId || null,
        venue_label: input.venueId ? null : input.venueLabel?.trim() || null,
        unit_label: input.unitLabel?.trim() || null,
      })
      .select("id")
      .single();
    if (seriesErr || !series) {
      return {
        ok: false,
        error:
          seriesErr?.code === "23505"
            ? "This client already has a weekly slot at that day and time."
            : "Couldn't set up the weekly series.",
      };
    }
    seriesId = series.id;
  }

  for (const occ of occurrences) {
    const { data: cls, error: clsErr } = await supabase
      .from("classes")
      .insert({
        class_type: "private",
        title: isOpen ? "Private — unassigned" : "Private session",
        skill_level: "beginner",
        capacity: 1,
        duration_minutes: duration,
        starts_on: occ.date,
        created_by: founderId,
        venue_id: input.venueId || null,
      })
      .select("id")
      .single();
    if (clsErr || !cls) {
      await rollback();
      return { ok: false, error: "Couldn't create the session." };
    }
    createdClassIds.push(cls.id);

    const { error: detErr } = await supabase.from("private_class_details").insert({
      class_id: cls.id,
      client_id: clientId ?? null,
      player_id: playerId ?? null,
      address: input.address,
      postcode: input.postcode ?? "",
      lat: input.lat,
      lng: input.lng,
      has_table: input.hasTable ?? true,
      access_notes: input.accessNotes || null,
      address_details: input.addressDetails ?? null,
      venue_label: input.venueId ? null : input.venueLabel?.trim() || null,
      unit_label: input.unitLabel?.trim() || null,
    });
    if (detErr) {
      await rollback();
      return { ok: false, error: "Couldn't save the address." };
    }

    const { data: session, error: sessErr } = await supabase
      .from("class_sessions")
      .insert({
        class_id: cls.id,
        coach_id: input.coachId || null,
        starts_at: occ.start.toISOString(),
        ends_at: occ.end.toISOString(),
      })
      .select("id")
      .single();
    if (sessErr || !session) {
      await rollback();
      return {
        ok: false,
        error: sessErr?.message.includes("coach_no_overlap")
          ? "That coach is already busy then — pick another coach or leave it on automatic."
          : "Couldn't create the session.",
      };
    }
    createdSessions.push({ id: session.id, start: occ.start });

    // Open slot: no client yet, so no booking and no minutes debit. The empty
    // held session is filled later via assignPrivateSessionClientCore.
    if (clientId && playerId) {
      const { data: booking, error: bookErr } = await supabase
        .from("bookings")
        .insert({
          session_id: session.id,
          client_id: clientId,
          player_id: playerId,
          status: "confirmed",
          private_series_id: seriesId,
        })
        .select("id")
        .single();
      if (bookErr || !booking) {
        await rollback();
        return { ok: false, error: "Couldn't book the client in." };
      }

      // The 3-hour reminder. request_private_class queues this unconditionally
      // for client-initiated privates, but this admin path never did — and
      // production books ~96% of its sessions from here, so most families were
      // getting no reminder at all. Payload matches the reminder template's
      // variables (class_title, time_str). (notification-fix-plan Phase 3 / C4.)
      await supabase.from("notifications").insert({
        user_id: clientId,
        type: "reminder_upcoming",
        title: "Later today",
        body: "Private session",
        data: {
          booking_id: booking.id,
          session_id: session.id,
          class_title: "Private session",
          time_str: whenIST(occ.start),
          url: "/app/schedule",
        },
        scheduled_for: new Date(occ.start.getTime() - 3 * 3600_000).toISOString(),
      });

      const { data: ledger } = await supabase
        .from("private_credit_ledger")
        .insert({
          client_id: clientId,
          booking_id: booking.id,
          delta_minutes: -duration,
          reason: "booking",
          note: "booked by academy",
        })
        .select("id")
        .single();
      if (ledger) createdLedgerIds.push(ledger.id);
    }
  }

  if (!input.coachId) await supabase.rpc("assign_unassigned_sessions");

  const firstWhen = whenIST(occurrences[0].start);
  if (clientId) {
    // The CLIENT copy is its own type (G1). It used to share
    // `new_private_session` with the coach, and interactiveContentFor() maps
    // that type to the coach template — so a parent got coach-worded copy with
    // a /coach/session/<id> CTA they can't open.
    await supabase.from("notifications").insert({
      user_id: clientId,
      type: "private_session_booked",
      title: recurring ? "Weekly private sessions booked" : "Private session booked",
      body:
        recurring
          ? `We've set up a weekly private slot starting ${firstWhen} — it's on your schedule, and you can manage it there.`
          : `We've set up a private session for ${firstWhen} — it's on your schedule.`,
      data: { session_id: createdSessions[0].id, url: "/app/schedule" },
    });
  }
  if (input.coachId) {
    // One message for the whole booking, not one per occurrence — a recurring
    // private over N weeks used to queue N messages to the same coach. Count
    // sessions rather than reading `recurring`: an open slot booked over N
    // weeks is N sessions without being a series, and the coach still has to
    // turn up to all of them.
    const first = createdSessions[0];
    const many = createdSessions.length > 1;
    // A notification body is frozen at INSERT, so this has to resolve here
    // rather than lean on a read-time fix. Read through the database — not a
    // TypeScript twin — so it is byte-identical to what the notify worker and
    // the SQL triggers produce for the same session. Falls back to the raw
    // address, since a wordy address beats no address.
    const [{ data: label }, { data: mapsUrl }] = await Promise.all([
      supabase.rpc("class_location_label", { p_class: createdClassIds[0] }),
      supabase.rpc("class_location_maps_url", { p_class: createdClassIds[0] }),
    ]);
    const where = (label as string | null)?.trim() || input.address;
    await supabase.from("notifications").insert({
      user_id: input.coachId,
      type: "new_private_session",
      title: many ? "New weekly private session" : "New private session",
      body: many
        ? `${createdSessions.length} sessions from ${whenIST(first.start)} — ${where}`
        : `${whenIST(first.start)} — ${where}`,
      data: {
        session_id: first.id,
        session_count: createdSessions.length,
        location_str: where,
        maps_url: (mapsUrl as string | null) ?? null,
        time_str: whenIST(first.start),
        url: `/coach/session/${first.id}`,
      },
    });
  }

  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "session.create_private",
    entity: "class_sessions",
    entity_id: createdSessions[0].id,
    meta: {
      client_id: clientId ?? null,
      minutes: duration,
      // The span booked, series or not — an open slot held over N weeks is
      // still N weeks, and logging 1 there hid whole runs from the audit trail.
      weeks,
      sessions: createdSessions.length,
      private_series_id: seriesId,
    },
  });
  return { ok: true };
}

/**
 * Assign a client to an "open" private slot created without one. Fills the held
 * session in place: sets the client/player on the details, books them in, debits
 * their minutes and notifies them — the mirror of the booking half of
 * createPrivateSessionCore. Only touches this one session (open slots are single
 * held sessions, never a standing series). Like that path, the client's plan
 * limits don't gate an admin assignment.
 */
export async function assignPrivateSessionClientCore(
  supabase: SupabaseClient<Database>,
  founderId: string,
  sessionId: string,
  clientId: string,
  playerId?: string
): Promise<OpResult> {
  const { data: session } = await supabase
    .from("class_sessions")
    .select(
      "id,starts_at,coach_id,status,classes!inner(id,class_type,duration_minutes,private_class_details(client_id))"
    )
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) return { ok: false, error: "Session not found." };
  if (session.status !== "scheduled")
    return { ok: false, error: "That session isn't open for booking." };

  const cls = session.classes;
  if (cls.class_type !== "private") return { ok: false, error: "Not a private session." };
  const det = cls.private_class_details;
  const existing = Array.isArray(det) ? det[0]?.client_id : det?.client_id;
  if (existing) return { ok: false, error: "This session already has a client." };

  const duration = cls.duration_minutes;
  const start = new Date(session.starts_at);
  if (!(start > new Date())) return { ok: false, error: "That session is in the past." };

  // Resolve the player: given one (must belong to the client), the client's
  // first, or a fresh one made from their name.
  let resolvedPlayer = playerId;
  if (resolvedPlayer) {
    const { data: p } = await supabase
      .from("players")
      .select("id")
      .eq("id", resolvedPlayer)
      .eq("client_id", clientId)
      .maybeSingle();
    if (!p) return { ok: false, error: "That player doesn't belong to this client." };
  } else {
    const { data: p } = await supabase
      .from("players")
      .select("id")
      .eq("client_id", clientId)
      .order("created_at")
      .limit(1)
      .maybeSingle();
    if (p) {
      resolvedPlayer = p.id;
    } else {
      const { data: prof } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", clientId)
        .maybeSingle();
      const { data: fresh, error: freshErr } = await supabase
        .from("players")
        .insert({ client_id: clientId, full_name: prof?.full_name?.trim() || "Player" })
        .select("id")
        .single();
      if (freshErr || !fresh)
        return { ok: false, error: "That client has no player profile yet." };
      resolvedPlayer = fresh.id;
    }
  }

  // Attach the client to the slot, then book them in. If the booking fails,
  // roll the details back to unassigned so the slot stays clean.
  const { error: detErr } = await supabase
    .from("private_class_details")
    .update({ client_id: clientId, player_id: resolvedPlayer })
    .eq("class_id", cls.id);
  if (detErr) return { ok: false, error: "Couldn't assign the client." };

  const { data: booking, error: bookErr } = await supabase
    .from("bookings")
    .insert({
      session_id: sessionId,
      client_id: clientId,
      player_id: resolvedPlayer,
      status: "confirmed",
    })
    .select("id")
    .single();
  if (bookErr || !booking) {
    await supabase
      .from("private_class_details")
      .update({ client_id: null, player_id: null })
      .eq("class_id", cls.id);
    return { ok: false, error: "Couldn't book the client in." };
  }

  await supabase
    .from("classes")
    .update({ title: "Private session" })
    .eq("id", cls.id);

  await supabase.from("private_credit_ledger").insert({
    client_id: clientId,
    booking_id: booking.id,
    delta_minutes: -duration,
    reason: "booking",
    note: "booked by academy",
  });

  // Same gap as createPrivateSessionCore: filling a held slot booked the client
  // in but never queued their 3-hour reminder. (notification-fix-plan Phase 3 / C4.)
  await supabase.from("notifications").insert({
    user_id: clientId,
    type: "reminder_upcoming",
    title: "Later today",
    body: "Private session",
    data: {
      booking_id: booking.id,
      session_id: sessionId,
      class_title: "Private session",
      time_str: whenIST(start),
      url: "/app/schedule",
    },
    scheduled_for: new Date(start.getTime() - 3 * 3600_000).toISOString(),
  });

  await supabase.from("notifications").insert({
    user_id: clientId,
    // Client-worded type, not the coach's `new_private_session` (G1).
    type: "private_session_booked",
    title: "Private session booked",
    body: `We've set up a private session for ${whenIST(start)} — it's on your schedule.`,
    data: { session_id: sessionId, url: "/app/schedule" },
  });

  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "session.assign_private",
    entity: "class_sessions",
    entity_id: sessionId,
    meta: { client_id: clientId, minutes: duration },
  });
  return { ok: true };
}

/**
 * Cancel all future scheduled private sessions for the same client as the
 * given session. Refunds minutes and notifies the client + affected coaches.
 * Used by the admin "Cancel all upcoming sessions" action on the session sheet.
 *
 * It also RETIRES that client's live weekly slots, and that is not a detail.
 * Cancelling the sessions alone leaves `private_booking_series.active` true, and
 * `generate_private_sessions` loops over exactly that flag under a nightly cron
 * — so the founder cancelled the weeks, and the generator put them back the
 * following night, every night. Worse, the refund this function issues restores
 * the balance, so the minutes check passes and the family is debited again. The
 * slot was, in practice, uncancellable from the admin.
 */
export async function cancelFuturePrivateSessionsCore(
  supabase: SupabaseClient<Database>,
  founderId: string,
  sessionId: string
): Promise<OpResult & { cancelled?: number; seriesRetired?: number }> {
  // Resolve the client from this session's class.
  const { data: anchor } = await supabase
    .from("class_sessions")
    .select("id,classes!inner(class_type,private_class_details(client_id))")
    .eq("id", sessionId)
    .maybeSingle();
  if (!anchor) return { ok: false, error: "Session not found." };

  const cls = anchor.classes;
  if (cls.class_type !== "private") return { ok: false, error: "Not a private session." };
  const det = cls.private_class_details;
  const clientId = Array.isArray(det) ? det[0]?.client_id : det?.client_id;
  if (!clientId) return { ok: false, error: "Client not found." };

  // Retire the templates FIRST, for the reason in the doc comment. This also
  // does the honest half of the cancellation for any week the series generated:
  // full refund, 'cancelled_by_academy', reminders dropped. Whatever is left
  // afterwards is a one-off private with no series behind it, and the sweep
  // below still catches it.
  const { data: liveSeries } = await supabase
    .from("private_booking_series")
    .select("id")
    .eq("client_id", clientId)
    .eq("active", true);
  let seriesRetired = 0;
  for (const s of liveSeries ?? []) {
    const { error } = await supabase.rpc("end_private_series_as_academy", { p_series: s.id });
    if (!error) seriesRetired += 1;
  }

  // All future class IDs for this client's private sessions.
  const { data: clientClasses } = await supabase
    .from("private_class_details")
    .select("class_id")
    .eq("client_id", clientId);
  const classIds = (clientClasses ?? []).map((c) => c.class_id);
  if (!classIds.length) return { ok: true, cancelled: 0, seriesRetired };

  // Future scheduled sessions across those classes.
  const { data: futureSessions } = await supabase
    .from("class_sessions")
    .select("id,coach_id,classes!inner(title,duration_minutes)")
    .in("class_id", classIds)
    .eq("status", "scheduled")
    .gt("starts_at", new Date().toISOString());

  const sessions = futureSessions ?? [];
  if (!sessions.length) return { ok: true, cancelled: 0, seriesRetired };

  const sessionIds = sessions.map((s) => s.id);

  // Cancel all the sessions.
  await supabase
    .from("class_sessions")
    .update({ status: "cancelled", cancel_reason: "cancelled by academy" })
    .in("id", sessionIds);

  // Find bookings, cancel them, and refund minutes.
  const { data: bookings } = await supabase
    .from("bookings")
    .select("id,client_id,session_id")
    .in("session_id", sessionIds)
    .in("status", ["confirmed", "waitlisted"]);

  const durationBySession = new Map<string, number>(
    sessions.map((s) => [
      s.id,
      (s.classes).duration_minutes,
    ])
  );

  for (const b of bookings ?? []) {
    await supabase
      .from("bookings")
      .update({
        status: "cancelled_by_academy",
        cancelled_at: new Date().toISOString(),
        cancel_reason: "cancelled by academy",
      })
      .eq("id", b.id);

    // No account holder (school player) means no minutes ledger to refund into.
    if (b.client_id === null) continue;
    const mins = durationBySession.get(b.session_id) ?? 60;
    await supabase.from("private_credit_ledger").insert({
      client_id: b.client_id,
      booking_id: b.id,
      delta_minutes: mins,
      reason: "cancellation_refund",
      note: "academy cancelled all upcoming sessions",
    });
  }

  // One notification to the client.
  await supabase.from("notifications").insert({
    user_id: clientId,
    type: "session_cancelled",
    title: "Upcoming sessions cancelled",
    body: `Your upcoming private sessions have been cancelled — your minutes have been returned.`,
    data: { url: "/app/schedule" },
  });

  // Notify affected coaches (de-duped).
  const coachIds = new Set(
    sessions.map((s) => s.coach_id).filter((c): c is string => !!c)
  );
  for (const coachId of coachIds) {
    await supabase.from("notifications").insert({
      user_id: coachId,
      type: "session_cancelled",
      title: "Private sessions cancelled",
      body: `All upcoming private sessions for this client have been cancelled.`,
      data: { url: "/coach" },
    });
  }

  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "session.cancel_private_series",
    entity: "class_sessions",
    entity_id: sessionId,
    meta: { client_id: clientId, cancelled: sessions.length },
  });

  return { ok: true, cancelled: sessions.length, seriesRetired };
}

/** Add a single extra session to an existing class (e.g. a holiday special). */
export async function createOneOffSessionCore(
  supabase: SupabaseClient<Database>,
  founderId: string,
  classId: string,
  date: string,
  time: string,
  coachId: string
): Promise<OpResult> {
  const { data: cls } = await supabase
    .from("classes")
    .select("id,title,duration_minutes")
    .eq("id", classId)
    .maybeSingle();
  if (!cls) return { ok: false, error: "Class not found." };

  const start = academyWallToUtc(date, time);
  if (!(start > new Date())) return { ok: false, error: "Pick a time in the future." };
  const end = new Date(start.getTime() + cls.duration_minutes * 60000);

  const { data: created, error } = await supabase
    .from("class_sessions")
    .insert({
      class_id: classId,
      coach_id: coachId || null,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
    })
    .select("id")
    .single();
  if (error || !created) {
    return {
      ok: false,
      error: error?.message.includes("coach_no_overlap")
        ? "That coach is already busy then — pick another coach or leave it on automatic."
        : "Couldn't add the session.",
    };
  }
  if (!coachId) await supabase.rpc("assign_unassigned_sessions");

  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "session.create",
    entity: "class_sessions",
    entity_id: created.id,
    meta: { class_id: classId },
  });
  return { ok: true };
}
