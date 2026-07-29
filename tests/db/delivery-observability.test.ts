// notification-fix-plan 1.5 — delivery failure observability.
//
// The writer is the notify edge function, not a Postgres RPC, so what Layer 1
// can prove is the *contract* it depends on: the failure columns exist and
// accept what the worker writes. If this regresses the worker silently loses its
// diagnostics — which is exactly the state the Jul 2026 audit had to work around.

import { describe, it, expect } from "vitest";
import { admin } from "../../e2e/lib/supabase";
import { createClient } from "../../e2e/lib/scenario";

describe("delivery observability (migration 0041)", () => {
  it("records why a delivery failed, the way the worker writes it", async () => {
    const db = admin();
    const parent = await createClient({ children: 0 });

    const { data: row, error } = await db
      .from("notifications")
      .insert({
        user_id: parent.id,
        type: "booking_confirmed",
        title: "Test",
        body: "Test",
        data: {},
        status: "failed",
        channel_attempted: "whatsapp",
        error: "whatsapp: not_linked; email: no_channel",
      })
      .select("status,error,channel_attempted")
      .single();

    expect(error).toBeNull();
    expect(row!.channel_attempted).toBe("whatsapp");
    expect(row!.error).toContain("not_linked");
  });

  it("leaves error null on the happy path, so the failure query stays clean", async () => {
    const db = admin();
    const parent = await createClient({ children: 0 });

    const { data: row } = await db
      .from("notifications")
      .insert({
        user_id: parent.id,
        type: "booking_confirmed",
        title: "Test",
        body: "Test",
        data: {},
      })
      .select("status,error,channel_attempted")
      .single();

    expect(row!.status).toBe("pending");
    expect(row!.error).toBeNull();
    expect(row!.channel_attempted).toBeNull();
  });

  it("makes 'why did the last 3 days fail' answerable in one query", async () => {
    const db = admin();
    // The whole point of 1.5: this query shape must work. Before the migration
    // the only available answer was status='failed' with no reason.
    const { error } = await db
      .from("notifications")
      .select("type,error,channel_attempted")
      .eq("status", "failed")
      .not("error", "is", null)
      .limit(5);
    expect(error).toBeNull();
  });
});

describe("inbound webhook dedupe (migration 0042)", () => {
  it("lets the first claim through and rejects a Twilio retry of the same sid", async () => {
    const db = admin();
    const sid = `SM_test_${crypto.randomUUID()}`;

    const first = await db.from("wa_inbound_seen").insert({ message_sid: sid, phone: "+910000000000" });
    expect(first.error).toBeNull();

    // Twilio retrying the same inbound message — must lose the race.
    const retry = await db.from("wa_inbound_seen").insert({ message_sid: sid, phone: "+910000000000" });
    expect(retry.error).not.toBeNull();
    expect(retry.error!.code).toBe("23505"); // unique_violation — what route.ts keys off
  });

  it("treats distinct messages from the same phone independently", async () => {
    const db = admin();
    const phone = "+910000000001";
    const a = await db.from("wa_inbound_seen").insert({ message_sid: `SM_a_${crypto.randomUUID()}`, phone });
    const b = await db.from("wa_inbound_seen").insert({ message_sid: `SM_b_${crypto.randomUUID()}`, phone });
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
  });

  it("prunes rows older than the retry window", async () => {
    const db = admin();
    const stale = `SM_stale_${crypto.randomUUID()}`;
    await db.from("wa_inbound_seen").insert({
      message_sid: stale,
      phone: "+910000000002",
      created_at: new Date(Date.now() - 3 * 86400_000).toISOString(),
    });

    const { error } = await db.rpc("prune_wa_inbound_seen");
    expect(error).toBeNull();

    const { data } = await db.from("wa_inbound_seen").select("message_sid").eq("message_sid", stale);
    expect(data).toHaveLength(0);
  });
});
