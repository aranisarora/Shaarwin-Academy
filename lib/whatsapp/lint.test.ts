// Each case here is something the bot actually said to a real person, or
// something it must be free to keep saying. The linter earns its place only if
// it catches the first set without touching the second.

import { describe, it, expect } from "vitest";
import { lintReply, usedMessagingTool } from "./lint";

describe("lintReply — uuids", () => {
  it("redacts the player ids the bot showed the founder", () => {
    // Verbatim from production, 2026-08-09 10:05 IST.
    const said =
      "I found two players named Riaan:\n\n1. Riaan (Player ID: ed159aa7-250f-47c7-9f49-4b757cc934d7)\n2. Riaan (Player ID: 8a00732e-9bb9-4e9d-b8c0-2fbe4b2f4426)";
    const { text, findings } = lintReply(said);
    expect(text).not.toContain("ed159aa7");
    expect(text).not.toContain("8a00732e");
    expect(findings.filter((f) => f.rule === "uuid")).toHaveLength(2);
  });

  it("leaves things that merely look hex-ish alone", () => {
    // Mangling a real order number would be a worse bug than the one fixed.
    const safe =
      "Order 5e0fe3d2 is paid, invoice INV-2026-0042, ref pay_Qk3xR9mNbVcXyZ, postcode 560103.";
    const { text, findings } = lintReply(safe);
    expect(text).toBe(safe);
    expect(findings).toHaveLength(0);
  });
});

describe("lintReply — links", () => {
  it("rewrites a localhost link a stranger could never open", () => {
    const { text, findings } = lintReply("Book here: http://localhost:3000/app/schedule");
    expect(text).not.toContain("localhost");
    expect(text).toContain("/app/schedule");
    expect(findings.map((f) => f.rule)).toContain("localhost");
  });
});

describe("lintReply — raw timestamps", () => {
  it("renders an ISO timestamp the way a person reads time", () => {
    const { text, findings } = lintReply("Your session is at 2026-08-09T18:30:00+05:30.");
    expect(text).not.toContain("2026-08-09T18:30");
    expect(findings.map((f) => f.rule)).toContain("raw_iso");
  });

  it("does not touch a plain date", () => {
    const said = "Your session is on 2026-08-09.";
    expect(lintReply(said).text).toBe(said);
  });
});

describe("lintReply — sending is not receiving", () => {
  const opts = { usedMessaging: true };

  it("downgrades the claim the bot made about Sunil", () => {
    // Production, 2026-08-08 11:54 IST. notify had returned `queued`, and the
    // row went out by EMAIL — Sunil had no WhatsApp binding at all.
    const said = "I've sent the message to Sunil Hatti. He has been asked to press the button.";
    const { text, findings } = lintReply(said, opts);
    expect(findings.some((f) => f.rule === "sent_claim")).toBe(false);
    // "sent the message" is narration of the tool call, which is fine; the
    // banned move is asserting arrival. Keep this case honest about scope.
    expect(text).toContain("Sunil Hatti");
  });

  it("rewrites an assertion that people received something", () => {
    const { text, findings } = lintReply("All 8 coaches have been notified.", opts);
    expect(text).toBe("All 8 coaches have been messaged.");
    expect(findings.map((f) => f.rule)).toContain("sent_claim");
  });

  it("catches the other phrasings of the same promise", () => {
    for (const said of [
      "He has been told.",
      "They have been informed.",
      "They've received it.",
      "Everyone has been told.",
    ]) {
      const { findings } = lintReply(said, opts);
      expect(findings.some((f) => f.rule === "sent_claim")).toBe(true);
    }
  });

  it("stays silent when no messaging tool ran this turn", () => {
    // Otherwise ordinary conversation gets mangled: a parent asking to be
    // notified is not the bot claiming delivery.
    const said = "You have been notified of every change so far.";
    const { text, findings } = lintReply(said, { usedMessaging: false });
    expect(text).toBe(said);
    expect(findings).toHaveLength(0);
  });

  it("passes the rewritten interactive.ts strings clean", () => {
    // These four bypass the LLM entirely. If someone reverts them to
    // "notified", this test fails rather than the regression reaching a coach.
    for (const said of [
      "📍 Marked you as arrived — the parents have been messaged. Have a great session!",
      "✅ It's yours — thanks for covering! You're marked as confirmed, and the families have been messaged.",
    ]) {
      expect(lintReply(said, opts).findings).toHaveLength(0);
    }
  });
});

describe("lintReply — safety properties", () => {
  it("is idempotent, so linting on both persist and send is safe", () => {
    const said =
      "Player ed159aa7-250f-47c7-9f49-4b757cc934d7 at http://localhost:3000/app — all 8 have been notified.";
    const once = lintReply(said, { usedMessaging: true });
    const twice = lintReply(once.text, { usedMessaging: true });
    expect(twice.text).toBe(once.text);
    expect(twice.findings).toHaveLength(0);
  });

  it("leaves an ordinary reply completely untouched", () => {
    const said =
      "Here's tomorrow's schedule (Sun 9 Aug):\n\n*Samir*\n  7:30 am: Private session\n\nAnything else?";
    const { text, findings } = lintReply(said, { usedMessaging: true });
    expect(text).toBe(said);
    expect(findings).toHaveLength(0);
  });
});

describe("usedMessagingTool", () => {
  it("recognises the tools that queue a message", () => {
    expect(usedMessagingTool(["notify"])).toBe(true);
    expect(usedMessagingTool(["broadcast_message"])).toBe(true);
    expect(usedMessagingTool(["find", "notify"])).toBe(true);
  });

  it("does not fire on ordinary lookups", () => {
    expect(usedMessagingTool(["find", "list_clients", "academy_overview"])).toBe(false);
    expect(usedMessagingTool([])).toBe(false);
  });
});
