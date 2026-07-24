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
} as const;

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

/**
 * Pick the earliest seeded group session that sits on a genuinely recurring slot
 * (same class + weekday + wall-clock time, with `minOccurrences` future
 * occurrences). This deliberately skips ad-hoc one-off sessions other tests may
 * have inserted, so series tests get a real weekly slot to enrol into.
 */
export async function pickRecurringGroupSession(
  minOccurrences = 3
): Promise<{ sessionId: string; classId: string; occurrences: number }> {
  const db = admin();
  const { data, error } = await db
    .from("class_sessions")
    .select("id, class_id, starts_at, classes!inner(class_type, timezone)")
    .eq("status", "scheduled")
    .eq("classes.class_type", "group")
    .gt("starts_at", hoursFromNow(2).toISOString())
    .order("starts_at");
  if (error) throw new Error(`pickRecurringGroupSession: ${error.message}`);

  const groups = new Map<string, { id: string; class_id: string }[]>();
  for (const row of (data ?? []) as any[]) {
    const tz = row.classes?.timezone || "Asia/Kolkata";
    const slot = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(row.starts_at));
    const key = `${row.class_id}|${slot}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ id: row.id, class_id: row.class_id });
  }
  for (const rows of groups.values()) {
    if (rows.length >= minOccurrences) {
      return { sessionId: rows[0].id, classId: rows[0].class_id, occurrences: rows.length };
    }
  }
  throw new Error(`no seeded recurring slot with ≥${minOccurrences} future occurrences`);
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
