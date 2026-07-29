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
