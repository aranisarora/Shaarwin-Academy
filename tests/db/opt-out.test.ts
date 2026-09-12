// notification-fix-plan 2.3 — STOP / START, the database half.
//
// The matcher is unit-tested in lib/whatsapp/optout.test.ts; this proves the
// effect it has on the row the worker reads. Both halves matter: Twilio's
// Advanced Opt-Out may stop delivery at their edge, but if our database doesn't
// know, every suppressed send still looks "sent" to us and we can't tell an
// opted-out member from a broken one.

import { describe, it, expect } from "vitest";
import { admin } from "../../e2e/lib/supabase";
import { createClient } from "../../e2e/lib/scenario";
import { applyOptOut } from "../../lib/whatsapp/optout";
import { ALL_PREF_KEYS } from "../../lib/notification-prefs";

describe("WhatsApp opt-out (migration 0044)", () => {
  it("STOP sets the hard channel gate and turns every mutable pref off", async () => {
    const db = admin();
    const parent = await createClient({ children: 0 });

    const reply = await applyOptOut(db, parent.id, "stop");
    expect(reply).toContain("unsubscribed");

    const { data } = await db
      .from("profiles")
      .select("wa_muted,notification_prefs")
      .eq("id", parent.id)
      .single();

    expect(data!.wa_muted).toBe(true);
    const prefs = data!.notification_prefs as Record<string, boolean>;
    for (const key of ALL_PREF_KEYS) expect(prefs[key]).toBe(false);
  });

  it("START reverses it completely", async () => {
    const db = admin();
    const parent = await createClient({ children: 0 });

    await applyOptOut(db, parent.id, "stop");
    const reply = await applyOptOut(db, parent.id, "start");
    expect(reply).toContain("resubscribed");

    const { data } = await db
      .from("profiles")
      .select("wa_muted,notification_prefs")
      .eq("id", parent.id)
      .single();

    expect(data!.wa_muted).toBe(false);
    const prefs = data!.notification_prefs as Record<string, boolean>;
    for (const key of ALL_PREF_KEYS) expect(prefs[key]).toBe(true);
  });

  it("defaults to not-muted, so existing members are unaffected", async () => {
    const db = admin();
    const parent = await createClient({ children: 0 });
    const { data } = await db
      .from("profiles")
      .select("wa_muted")
      .eq("id", parent.id)
      .single();
    expect(data!.wa_muted).toBe(false);
  });

  it("leaves unrelated preference keys alone", async () => {
    // The mute is a channel-level gate; it must not clobber settings that
    // aren't part of the messaging opt-out.
    const db = admin();
    const parent = await createClient({ children: 0 });
    await db
      .from("profiles")
      .update({ notification_prefs: { some_future_key: true } })
      .eq("id", parent.id);

    await applyOptOut(db, parent.id, "stop");

    const { data } = await db
      .from("profiles")
      .select("notification_prefs")
      .eq("id", parent.id)
      .single();
    const prefs = data!.notification_prefs as Record<string, boolean>;
    expect(prefs.some_future_key).toBe(true);
  });
});
