// What actually happened to a message.
//
// The assistant's honesty rules exist because it could never tell: a message is
// handed to a worker, the worker hands it to a carrier, and everything after
// that was invisible. "Queued" was the last true thing anyone could say, so the
// lint layer had to police every phrasing that upgraded it.
//
// Meta's Cloud API reports each transition — sent, delivered, read, failed with
// a reason — on the same webhook as inbound messages. This module records them.
// The rules stay exactly as strict; what changes is that "delivered" becomes a
// thing the system can actually KNOW, and therefore say.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { CloudStatus } from "./cloud-api";

export type DeliveryStatus = "queued" | "sent" | "delivered" | "read" | "failed";

/**
 * How far along a status is.
 *
 * Receipts arrive out of order in practice — a `delivered` can land after the
 * `read` that followed it — so a later webhook must never be able to walk a
 * message BACKWARDS and turn a message somebody has visibly read into one that
 * was merely sent.
 *
 * `failed` outranks everything because it is terminal and it is the one status
 * anybody needs to act on. A stray late `sent` must not bury it.
 */
const RANK: Record<DeliveryStatus, number> = {
  queued: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 4,
};

export function isDeliveryStatus(value: string): value is DeliveryStatus {
  return Object.hasOwn(RANK, value);
}

/** Does `next` represent progress over `current`? */
export function advances(current: string | null | undefined, next: DeliveryStatus): boolean {
  if (!current || !isDeliveryStatus(current)) return true;
  return RANK[next] > RANK[current];
}

/** The column that timestamps each status. */
const STAMP: Record<DeliveryStatus, "sent_at" | "delivered_at" | "read_at" | "failed_at" | null> = {
  queued: null,
  sent: "sent_at",
  delivered: "delivered_at",
  read: "read_at",
  failed: "failed_at",
};

/**
 * Note that a message has been handed to the carrier, so a later receipt has a
 * row to land on and a phone number to be attributed to. Best-effort: failing
 * to record an outgoing message must never stop it being sent.
 */
export async function recordSend(
  admin: SupabaseClient<Database>,
  opts: { messageId: string; phone: string; notificationId?: string | null }
): Promise<void> {
  if (!opts.messageId) return;
  const { error } = await admin.from("wa_delivery").upsert(
    {
      message_id: opts.messageId,
      phone: opts.phone,
      status: "sent",
      sent_at: new Date().toISOString(),
      notification_id: opts.notificationId ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "message_id" }
  );
  if (error) console.warn("wa: recording send failed", error.message);
}

/**
 * Apply a batch of carrier receipts.
 *
 * Read-then-write rather than a blind upsert, because the monotonic rule needs
 * to see the current value. The batch is small (one webhook's worth) and this
 * runs in after(), so the extra round trip costs nobody anything.
 */
export async function recordStatuses(
  admin: SupabaseClient<Database>,
  statuses: readonly CloudStatus[]
): Promise<void> {
  if (statuses.length === 0) return;

  // Collapse duplicates inside the batch first, keeping the furthest-along one
  // per message — Meta can report sent and delivered in a single payload.
  const latest = new Map<string, CloudStatus>();
  for (const status of statuses) {
    if (!status.messageId || !isDeliveryStatus(status.status)) continue;
    const held = latest.get(status.messageId);
    if (!held || advances(held.status, status.status)) latest.set(status.messageId, status);
  }
  if (latest.size === 0) return;

  const ids = [...latest.keys()];
  const { data: existing, error: readError } = await admin
    .from("wa_delivery")
    .select("message_id,status")
    .in("message_id", ids);
  if (readError) console.warn("wa: delivery read failed", readError.message);
  const current = new Map((existing ?? []).map((r) => [r.message_id, r.status]));

  for (const [messageId, status] of latest) {
    const next = status.status as DeliveryStatus;
    if (!advances(current.get(messageId), next)) continue;

    const stamp = STAMP[next];
    const at = status.at ?? new Date().toISOString();
    const { error } = await admin.from("wa_delivery").upsert(
      {
        message_id: messageId,
        phone: status.recipient,
        status: next,
        ...(stamp ? { [stamp]: at } : {}),
        // Only ever set on the way to failed — a later success would otherwise
        // leave a stale reason attached to a message that arrived fine.
        ...(next === "failed" ? { error: status.error ?? "unknown" } : {}),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "message_id" }
    );
    if (error) console.warn("wa: delivery write failed", messageId, error.message);
  }
}

export type DeliveryRollup = {
  total: number;
  delivered: number;
  read: number;
  failed: number;
  pending: number;
};

/**
 * The digest line: "41 reminders, 40 delivered, 1 failed".
 *
 * `delivered` counts everything that reached the handset, which includes the
 * ones that were then read — a founder reading "40 delivered, 12 read" should
 * not have to add them together to find out how many arrived.
 */
export function rollup(rows: readonly { status: string }[]): DeliveryRollup {
  const out: DeliveryRollup = { total: rows.length, delivered: 0, read: 0, failed: 0, pending: 0 };
  for (const row of rows) {
    switch (row.status) {
      case "read":
        out.read++;
        out.delivered++;
        break;
      case "delivered":
        out.delivered++;
        break;
      case "failed":
        out.failed++;
        break;
      default:
        out.pending++;
    }
  }
  return out;
}

/** One line for the 21:00 founder digest. */
export function deliveryLine(counts: DeliveryRollup): string {
  if (counts.total === 0) return "No messages went out today.";
  const bits = [`${counts.total} sent`, `${counts.delivered} delivered`];
  if (counts.read) bits.push(`${counts.read} read`);
  if (counts.failed) bits.push(`${counts.failed} failed`);
  if (counts.pending) bits.push(`${counts.pending} still in flight`);
  return bits.join(", ");
}
