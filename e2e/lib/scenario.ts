// Scenario factories — build a realistic world fast, using the service-role
// client for seeding and the REAL RPCs for actions (so tests exercise the same
// logic the app runs). Every factory takes overrides and returns created ids;
// generated users get a unique email per run so tests never collide.
//
// Cleanup is reset-per-suite (see the global setups), never per-test — factories
// lean on unique ids for order-independence, which is what keeps the harness
// from getting flaky.

import { admin, asUser } from "./supabase";
import { SEED_PASSWORD } from "./auth";

// ── Seeded ids worth reusing (from seed.sql / migration 0009) ────────────────
export const SEED = {
  founder: "00000000-0000-4000-8000-000000000001",
  coachSamir: "00000000-0000-4000-8000-000000000011",
  clientA: "00000000-0000-4000-8000-000000000021",
  // group plans (group_sessions_per_week = 1 / 2 / 3)
  groupPlan1x: "00000000-0000-4000-8000-0000000000d4",
  groupPlan2x: "00000000-0000-4000-8000-0000000000d5",
  groupPlan3x: "00000000-0000-4000-8000-0000000000d6",
  // a seeded group batch (Juniors — Lakefront, 0009) to hang ad-hoc sessions on
  groupClass: "00000000-0000-4000-8000-0000000001f1",
} as const;

const IST_OFFSET_MIN = 330; // Asia/Kolkata is a fixed UTC+5:30 (no DST)

/**
 * Build `weeks` weekly group sessions on one class at a fixed IST wall-clock
 * time and weekday — a self-contained recurring slot for series tests, so they
 * don't depend on (or collide with) the seeded schedule. Returns the sessions
 * earliest-first. Default 15:00 IST is a time no seeded batch uses.
 */
export async function createWeeklySlot(opts: {
  weeks?: number;
  classId?: string;
  coachId?: string;
  istHour?: number;
  firstInDays?: number;
} = {}): Promise<CreatedSession[]> {
  const weeks = opts.weeks ?? 4;
  const classId = opts.classId ?? SEED.groupClass;
  // First occurrence `firstInDays` out, at istHour:00 IST == (istHour*60 - 330)
  // minutes UTC (Kolkata is a fixed UTC+5:30).
  const first = new Date();
  first.setUTCDate(first.getUTCDate() + (opts.firstInDays ?? 3));
  const utcMinutes = (opts.istHour ?? 15) * 60 - IST_OFFSET_MIN;
  first.setUTCHours(Math.floor(utcMinutes / 60), utcMinutes % 60, 0, 0);

  const sessions: CreatedSession[] = [];
  for (let i = 0; i < weeks; i++) {
    const startsAt = new Date(first.getTime() + i * 7 * 86_400_000);
    sessions.push(await createGroupSession({ startsAt, classId, coachId: opts.coachId }));
  }
  return sessions;
}

// ── Time-travel helpers — assert scheduled_for by value, never by waiting ────
export const minutesFromNow = (m: number) => new Date(Date.now() + m * 60_000);
export const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000);
export const daysFromNow = (d: number) => new Date(Date.now() + d * 86_400_000);

const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
let seq = 0;
const uniqueEmail = (kind: string) => `test+${kind}-${RUN_ID}-${++seq}@sharwin.example`;

export type CreatedClient = {
  id: string;
  email: string;
  password: string;
  playerIds: string[];
};

/**
 * A client account: auth user (+password), an approved client profile (which
 * auto-grants one group trial credit via the profiles_grant_trial trigger),
 * `children` player rows, and — if a group plan id is given — a comp group
 * subscription so the client can book beyond the single trial.
 */
export async function createClient(opts: {
  children?: number;
  approved?: boolean;
  groupPlanId?: string;
  fullName?: string;
} = {}): Promise<CreatedClient> {
  const db = admin();
  const email = uniqueEmail("client");
  const fullName = opts.fullName ?? "Test Parent";
  const password = SEED_PASSWORD;

  const { data: created, error: authErr } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (authErr) throw new Error(`createClient auth: ${authErr.message}`);
  const id = created.user!.id;

  const { error: profErr } = await db.from("profiles").insert({
    id,
    role: "client",
    full_name: fullName,
    email,
    approval_status: opts.approved === false ? "pending" : "approved",
    onboarding_step: 2,
    onboarded_at: new Date().toISOString(),
  });
  if (profErr) throw new Error(`createClient profile: ${profErr.message}`);

  const playerIds: string[] = [];
  const n = opts.children ?? 1;
  for (let i = 0; i < n; i++) {
    const { data: player, error } = await db
      .from("players")
      .insert({
        client_id: id,
        full_name: `${fullName} Jr ${i + 1}`,
        date_of_birth: "2015-01-01",
        skill_level: "beginner",
      })
      .select("id")
      .single();
    if (error) throw new Error(`createClient player: ${error.message}`);
    playerIds.push(player!.id);
  }

  if (opts.groupPlanId) {
    const { error } = await db.from("subscriptions").insert({
      client_id: id,
      plan_id: opts.groupPlanId,
      source: "comp",
      status: "active",
      current_period_start: new Date().toISOString(),
      current_period_end: daysFromNow(30).toISOString(),
    });
    if (error) throw new Error(`createClient subscription: ${error.message}`);
  }

  return { id, email, password, playerIds };
}

export type CreatedCoach = { id: string; email: string };

/**
 * A coach account: auth user + coach profile + coaches row (the coaches insert
 * fires seed_default_coach_availability, so the coach is immediately
 * assignable). Defaults place them at the Bellandur hub near the seeded venues.
 */
export async function createCoach(opts: {
  baseLat?: number;
  baseLng?: number;
  maxLevel?: "beginner" | "intermediate" | "advanced" | "elite";
  fullName?: string;
} = {}): Promise<CreatedCoach> {
  const db = admin();
  const email = uniqueEmail("coach");
  const fullName = opts.fullName ?? "Test Coach";

  const { data: created, error: authErr } = await db.auth.admin.createUser({
    email,
    password: SEED_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (authErr) throw new Error(`createCoach auth: ${authErr.message}`);
  const id = created.user!.id;

  const { error: profErr } = await db.from("profiles").insert({
    id,
    role: "coach",
    full_name: fullName,
    email,
    approval_status: "approved",
  });
  if (profErr) throw new Error(`createCoach profile: ${profErr.message}`);

  const { error: coachErr } = await db.from("coaches").insert({
    id,
    base_lat: opts.baseLat ?? 12.931,
    base_lng: opts.baseLng ?? 77.683,
    max_teachable_level: opts.maxLevel ?? "elite",
    dbs_checked: true,
  });
  if (coachErr) throw new Error(`createCoach coaches: ${coachErr.message}`);

  return { id, email };
}

async function firstGroupClassId(): Promise<string> {
  const { data, error } = await admin()
    .from("classes")
    .select("id")
    .eq("class_type", "group")
    .eq("active", true)
    .order("created_at")
    .limit(1)
    .single();
  if (error || !data) throw new Error(`no seeded group class found: ${error?.message}`);
  return data.id;
}

export type CreatedSession = {
  sessionId: string;
  classId: string;
  coachId: string | null;
  startsAt: Date;
  endsAt: Date;
};

/**
 * A concrete group session on a seeded batch (reuses 0009 venues/classes rather
 * than inventing new ones). Give `startsAt` to pin reminder timing; give
 * `coachId` to assign a specific coach, else the assignment engine picks one.
 */
export async function createGroupSession(opts: {
  startsAt?: Date;
  classId?: string;
  coachId?: string;
  capacity?: number;
} = {}): Promise<CreatedSession> {
  const db = admin();
  const classId = opts.classId ?? (await firstGroupClassId());
  const { data: cls, error: clsErr } = await db
    .from("classes")
    .select("duration_minutes")
    .eq("id", classId)
    .single();
  if (clsErr || !cls) throw new Error(`class not found: ${clsErr?.message}`);

  const startsAt = opts.startsAt ?? hoursFromNow(4);
  const endsAt = new Date(startsAt.getTime() + cls.duration_minutes * 60_000);

  const { data: session, error } = await db
    .from("class_sessions")
    .insert({
      class_id: classId,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      capacity_override: opts.capacity ?? null,
      coach_id: opts.coachId ?? null,
    })
    .select("id")
    .single();
  if (error || !session) throw new Error(`createGroupSession: ${error?.message}`);

  let coachId = opts.coachId ?? null;
  if (!coachId) {
    const { data: assigned } = await db.rpc("assign_coach", { p_session: session.id });
    coachId = (assigned as string | null) ?? null;
  }

  return { sessionId: session.id, classId, coachId, startsAt, endsAt };
}

export type CreatedPrivateSession = CreatedSession & {
  clientId: string;
  playerId: string;
  playerName: string;
  locationName: string;
  address: string;
};

/**
 * A concrete PRIVATE session: a one-to-one class held at the client's own
 * address (no venue), the coach assigned, and the client's child booked in.
 * Seeded directly with the service role — like createGroupSession — so it
 * bypasses the private-plan minutes gate that `_create_private_occurrence`
 * enforces; this factory's job is to stand up a coach-facing private session,
 * not to exercise billing. Mirrors the exact row shape that RPC writes (private
 * `classes` row + `private_class_details` + a debit-less booking).
 */
export async function createPrivateSession(opts: {
  startsAt?: Date;
  coachId?: string;
  durationMinutes?: number;
  hasTable?: boolean;
  locationName?: string;
  fullName?: string;
} = {}): Promise<CreatedPrivateSession> {
  const db = admin();
  const duration = opts.durationMinutes ?? 60;
  const locationName = opts.locationName ?? "Whitefield Court";
  const fullName = opts.fullName ?? "Private Parent";

  // The private booking is the client's own child, so build the family first.
  const client = await createClient({ children: 1, fullName });
  const playerId = client.playerIds[0];
  const { data: pl } = await db
    .from("players")
    .select("full_name")
    .eq("id", playerId)
    .single();
  const playerName = (pl as { full_name: string }).full_name;

  const startsAt = opts.startsAt ?? hoursFromNow(4);
  const endsAt = new Date(startsAt.getTime() + duration * 60_000);
  const startsOn = startsAt.toISOString().slice(0, 10);
  const lat = 12.9698; // Whitefield, within the default coach's teachable range
  const lng = 77.75;
  const address = `12 ${locationName}, Whitefield`;

  const { data: cls, error: clsErr } = await db
    .from("classes")
    .insert({
      class_type: "private",
      title: "Private session",
      skill_level: "beginner",
      capacity: 1,
      duration_minutes: duration,
      starts_on: startsOn,
      created_by: client.id,
    })
    .select("id")
    .single();
  if (clsErr || !cls) throw new Error(`createPrivateSession class: ${clsErr?.message}`);

  const { error: pcdErr } = await db.from("private_class_details").insert({
    class_id: cls.id,
    client_id: client.id,
    player_id: playerId,
    address,
    postcode: "560066",
    lat,
    lng,
    has_table: opts.hasTable ?? true,
    access_notes: "Gate code 4321; park inside the compound.",
    address_details: {
      name: locationName,
      formatted: address,
      locality: "Whitefield",
      city: "Bengaluru",
      postcode: "560066",
      lat,
      lng,
    },
  });
  if (pcdErr) throw new Error(`createPrivateSession details: ${pcdErr.message}`);

  const { data: session, error: sErr } = await db
    .from("class_sessions")
    .insert({
      class_id: cls.id,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      coach_id: opts.coachId ?? null,
    })
    .select("id")
    .single();
  if (sErr || !session) throw new Error(`createPrivateSession session: ${sErr?.message}`);

  let coachId = opts.coachId ?? null;
  if (!coachId) {
    const { data: assigned } = await db.rpc("assign_coach", { p_session: session.id });
    coachId = (assigned as string | null) ?? null;
  }

  const { error: bErr } = await db.from("bookings").insert({
    session_id: session.id,
    client_id: client.id,
    player_id: playerId,
    status: "confirmed",
  });
  if (bErr) throw new Error(`createPrivateSession booking: ${bErr.message}`);

  return {
    sessionId: session.id,
    classId: cls.id,
    coachId,
    startsAt,
    endsAt,
    clientId: client.id,
    playerId,
    playerName,
    locationName,
    address,
  };
}

/** Book a single session as the given client (real book_session RPC). */
export async function bookSession(args: {
  email: string;
  password?: string;
  sessionId: string;
  playerId: string;
}) {
  const user = await asUser(args.email, args.password ?? SEED_PASSWORD);
  const { data, error } = await user.rpc("book_session", {
    p_session: args.sessionId,
    p_player: args.playerId,
  });
  if (error) throw new Error(`bookSession: ${error.message}`);
  return data as { id: string; status: string; session_id: string };
}

/** Book a recurring series as the given client (real book_series RPC). */
export async function bookSeries(args: {
  email: string;
  password?: string;
  sessionId: string;
  playerId: string;
  recurring?: boolean;
}) {
  const user = await asUser(args.email, args.password ?? SEED_PASSWORD);
  const { data, error } = await user.rpc("book_series", {
    p_session: args.sessionId,
    p_player: args.playerId,
    p_recurring: args.recurring ?? true,
  });
  if (error) throw new Error(`bookSeries: ${error.message}`);
  return data as {
    series_id: string | null;
    confirmed: number;
    waitlisted: number;
    skipped: number;
    first_status: string;
  };
}

/** Cancel a booking as the given client (real cancel_booking RPC). */
export async function cancelBooking(args: {
  email: string;
  password?: string;
  bookingId: string;
}) {
  const user = await asUser(args.email, args.password ?? SEED_PASSWORD);
  const { error } = await user.rpc("cancel_booking", { p_booking: args.bookingId });
  if (error) throw new Error(`cancelBooking: ${error.message}`);
}

/** Coach marks arrival on their session (real coach_mark_arrival RPC). */
export async function coachMarkArrival(args: {
  coachEmail: string;
  password?: string;
  sessionId: string;
  late?: boolean;
  source?: "tap" | "auto" | "wa";
  distanceM?: number;
}) {
  const coach = await asUser(args.coachEmail, args.password ?? SEED_PASSWORD);
  const { data, error } = await coach.rpc("coach_mark_arrival", {
    p_session: args.sessionId,
    p_late: args.late ?? false,
    p_source: args.source ?? "tap",
    p_distance_m: args.distanceM ?? null,
  });
  if (error) throw new Error(`coachMarkArrival: ${error.message}`);
  return data as string | null;
}

/** Coach undoes a just-marked arrival (real coach_undo_arrival RPC). */
export async function coachUndoArrival(args: {
  coachEmail: string;
  password?: string;
  sessionId: string;
}) {
  const coach = await asUser(args.coachEmail, args.password ?? SEED_PASSWORD);
  const { error } = await coach.rpc("coach_undo_arrival", { p_session: args.sessionId });
  if (error) throw new Error(`coachUndoArrival: ${error.message}`);
}
