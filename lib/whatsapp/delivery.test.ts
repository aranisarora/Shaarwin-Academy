import { describe, expect, it } from "vitest";
import { advances, deliveryLine, isDeliveryStatus, recordStatuses, rollup } from "./delivery";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { CloudStatus } from "./cloud-api";

describe("advances — receipts arrive out of order", () => {
  it("moves a message forward", () => {
    expect(advances("sent", "delivered")).toBe(true);
    expect(advances("delivered", "read")).toBe(true);
    expect(advances(null, "sent")).toBe(true);
  });

  /**
   * The one that matters. A `delivered` receipt can land AFTER the `read` that
   * followed it, and letting it apply would turn a message somebody visibly
   * read into one that was merely delivered.
   */
  it("never walks a message backwards", () => {
    expect(advances("read", "delivered")).toBe(false);
    expect(advances("delivered", "sent")).toBe(false);
    expect(advances("read", "read")).toBe(false);
  });

  /**
   * failed is terminal and the only status anyone has to act on. A stray late
   * `sent` must not bury it.
   */
  it("lets failure win, and keeps it", () => {
    expect(advances("read", "failed")).toBe(true);
    expect(advances("failed", "read")).toBe(false);
    expect(advances("failed", "sent")).toBe(false);
  });

  it("treats an unrecognised stored value as no information", () => {
    expect(advances("banana", "sent")).toBe(true);
    expect(isDeliveryStatus("banana")).toBe(false);
  });
});

/** Records upserts so the monotonic rule can be asserted against real calls. */
function stubDelivery(existing: { message_id: string; status: string }[] = []) {
  const upserts: Record<string, unknown>[] = [];
  const client = {
    from() {
      const builder: Record<string, unknown> = {
        select: () => builder,
        in: () => Promise.resolve({ data: existing, error: null }),
        upsert(row: Record<string, unknown>) {
          upserts.push(row);
          return Promise.resolve({ error: null });
        },
      };
      return builder;
    },
  };
  return { admin: client as unknown as SupabaseClient<Database>, upserts };
}

const status = (over: Partial<CloudStatus>): CloudStatus => ({
  messageId: "wamid.A",
  status: "delivered",
  recipient: "+919812345678",
  at: "2026-08-12T10:00:00.000Z",
  ...over,
});

describe("recordStatuses", () => {
  it("writes a receipt and stamps the matching column", async () => {
    const { admin, upserts } = stubDelivery();
    await recordStatuses(admin, [status({ status: "delivered" })]);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({
      message_id: "wamid.A",
      status: "delivered",
      delivered_at: "2026-08-12T10:00:00.000Z",
      phone: "+919812345678",
    });
  });

  it("does not apply a receipt that would move a message backwards", async () => {
    const { admin, upserts } = stubDelivery([{ message_id: "wamid.A", status: "read" }]);
    await recordStatuses(admin, [status({ status: "delivered" })]);
    expect(upserts).toHaveLength(0);
  });

  /** Meta can report sent and delivered for one message in a single payload. */
  it("keeps only the furthest-along status per message in one batch", async () => {
    const { admin, upserts } = stubDelivery();
    await recordStatuses(admin, [
      status({ status: "sent" }),
      status({ status: "delivered" }),
      status({ status: "read" }),
    ]);
    expect(upserts).toHaveLength(1);
    expect(upserts[0].status).toBe("read");
  });

  it("keeps the reason on a failure, and only on a failure", async () => {
    const { admin, upserts } = stubDelivery();
    await recordStatuses(admin, [
      status({ status: "failed", error: "outside the 24 hour window" }),
    ]);
    expect(upserts[0]).toMatchObject({ status: "failed", error: "outside the 24 hour window" });

    const clean = stubDelivery();
    await recordStatuses(clean.admin, [status({ status: "delivered" })]);
    expect(clean.upserts[0].error).toBeUndefined();
  });

  it("ignores a status it does not recognise rather than storing nonsense", async () => {
    const { admin, upserts } = stubDelivery();
    await recordStatuses(admin, [status({ status: "teleported" })]);
    expect(upserts).toHaveLength(0);
  });

  it("does nothing at all for an empty batch", async () => {
    const { admin, upserts } = stubDelivery();
    await recordStatuses(admin, []);
    expect(upserts).toHaveLength(0);
  });
});

describe("rollup and the digest line", () => {
  /**
   * A read message reached the handset, so it counts as delivered too — a
   * founder reading "40 delivered, 12 read" should not have to add them up to
   * find out how many arrived.
   */
  it("counts a read message as delivered as well", () => {
    const counts = rollup([{ status: "read" }, { status: "delivered" }]);
    expect(counts).toEqual({ total: 2, delivered: 2, read: 1, failed: 0, pending: 0 });
  });

  it("separates failures from messages still in flight", () => {
    const counts = rollup([{ status: "failed" }, { status: "sent" }, { status: "queued" }]);
    expect(counts).toMatchObject({ failed: 1, pending: 2, delivered: 0 });
  });

  it("writes the digest line the plan asks for", () => {
    expect(
      deliveryLine(rollup([...Array(40).fill({ status: "delivered" }), { status: "failed" }]))
    ).toBe("41 sent, 40 delivered, 1 failed");
  });

  it("says nothing went out rather than printing zeroes", () => {
    expect(deliveryLine(rollup([]))).toBe("No messages went out today.");
  });

  it("leaves out the parts with nothing to report", () => {
    expect(deliveryLine(rollup([{ status: "delivered" }]))).toBe("1 sent, 1 delivered");
  });
});
