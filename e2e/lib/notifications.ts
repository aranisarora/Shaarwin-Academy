// Notification queue assertions — the point of the whole harness. We prove the
// right person was queued the right message at the right time by reading the
// `notifications` table, not by receiving WhatsApp on a phone. The notify worker
// + Twilio are trusted as a pipe (queue-level verification, per the plan).
//
// Timezone care: the product runs Asia/Kolkata, but scheduled_for is a
// timestamptz — always compared as an absolute instant with a tolerance, never
// via local-time string formatting.

import type { SupabaseClient } from "@supabase/supabase-js";

export type NotificationRow = {
  id: string;
  user_id: string;
  channel: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  scheduled_for: string;
  status: "pending" | "sent" | "failed";
  created_at: string;
};

export type NotificationMatch = {
  /** Recipient — the right person. */
  userId?: string;
  /** Exact type string (read from schema.sql functions, e.g. "booking_confirmed"). */
  type?: string;
  status?: "pending" | "sent" | "failed";
  /** jsonb @> — the row's data must contain these keys/values. */
  dataContains?: Record<string, unknown>;
  /** The right time — absolute instant ± tolerance (default 5 min). */
  scheduledFor?: { near: Date; toleranceMinutes?: number };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function describe(m: NotificationMatch): string {
  const parts: string[] = [];
  if (m.type) parts.push(`type=${m.type}`);
  if (m.userId) parts.push(`user=${m.userId}`);
  if (m.status) parts.push(`status=${m.status}`);
  if (m.dataContains) parts.push(`data⊇${JSON.stringify(m.dataContains)}`);
  if (m.scheduledFor)
    parts.push(
      `scheduled≈${m.scheduledFor.near.toISOString()}±${m.scheduledFor.toleranceMinutes ?? 5}m`
    );
  return parts.join(", ") || "(any)";
}

async function query(db: SupabaseClient, m: NotificationMatch): Promise<NotificationRow[]> {
  let q = db.from("notifications").select("*");
  if (m.userId) q = q.eq("user_id", m.userId);
  if (m.type) q = q.eq("type", m.type);
  if (m.status) q = q.eq("status", m.status);
  if (m.dataContains) q = q.contains("data", m.dataContains);
  const { data, error } = await q;
  if (error) throw new Error(`notifications query failed: ${error.message}`);

  let rows = (data ?? []) as NotificationRow[];
  if (m.scheduledFor) {
    const tolMs = (m.scheduledFor.toleranceMinutes ?? 5) * 60_000;
    const target = m.scheduledFor.near.getTime();
    rows = rows.filter(
      (r) => Math.abs(new Date(r.scheduled_for).getTime() - target) <= tolMs
    );
  }
  return rows;
}

/** Dump what DID exist for a user, to make failures diagnosable. */
async function context(db: SupabaseClient, m: NotificationMatch): Promise<string> {
  const { data } = await db
    .from("notifications")
    .select("type,user_id,scheduled_for,status,data")
    .eq(m.userId ? "user_id" : "type", m.userId ?? m.type ?? "")
    .limit(20);
  return JSON.stringify(data ?? [], null, 2);
}

/**
 * Assert (polling briefly) that at least one notification matches. Returns the
 * first match. Rows written by triggers/RPCs are present synchronously; the
 * short poll only guards against incidental async.
 */
export async function expectNotification(
  db: SupabaseClient,
  match: NotificationMatch,
  opts: { timeoutMs?: number } = {}
): Promise<NotificationRow> {
  const timeoutMs = opts.timeoutMs ?? 5_000;
  const deadline = Date.now() + timeoutMs;
  let rows: NotificationRow[] = [];
  do {
    rows = await query(db, match);
    if (rows.length > 0) return rows[0];
    await sleep(150);
  } while (Date.now() < deadline);

  throw new Error(
    `Expected a notification [${describe(match)}] but found none.\n` +
      `Rows for that ${match.userId ? "user" : "type"}:\n${await context(db, match)}`
  );
}

/**
 * Assert NO notification matches. Negative assertions matter as much as positive
 * ones (a cancelled reminder must actually be gone). Waits a short grace first
 * so a synchronously-written row would already be visible.
 */
export async function expectNoNotification(
  db: SupabaseClient,
  match: NotificationMatch,
  opts: { graceMs?: number } = {}
): Promise<void> {
  await sleep(opts.graceMs ?? 250);
  const rows = await query(db, match);
  if (rows.length > 0) {
    throw new Error(
      `Expected NO notification [${describe(match)}] but found ${rows.length}:\n` +
        JSON.stringify(rows, null, 2)
    );
  }
}

/**
 * Assert an EXACT count of matching notifications. This is the guard against the
 * spam-regression class (migration 0028: a series booking must queue one
 * notification, not one per occurrence).
 */
export async function expectNotificationCount(
  db: SupabaseClient,
  match: NotificationMatch,
  expected: number,
  opts: { graceMs?: number } = {}
): Promise<NotificationRow[]> {
  await sleep(opts.graceMs ?? 250);
  const rows = await query(db, match);
  if (rows.length !== expected) {
    throw new Error(
      `Expected exactly ${expected} notification(s) [${describe(match)}], found ${rows.length}:\n` +
        JSON.stringify(rows, null, 2)
    );
  }
  return rows;
}
