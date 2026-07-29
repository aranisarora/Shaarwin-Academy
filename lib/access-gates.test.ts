import { describe, it, expect } from "vitest";
import { gateRedirect, type GateProfile } from "./access-gates";

/**
 * These assertions are the contract that moved out of `requireUser` when the
 * gates went into the proxy (see lib/access-gates.ts). The risk of that move is
 * silent over-reach — gating a coach, or gating the very screen a client is
 * being sent to, would lock someone in a redirect loop with no error anywhere.
 */

const client = (over: Partial<GateProfile> = {}): GateProfile => ({
  role: "client",
  approval_status: "approved",
  onboarded_at: "2026-01-01T00:00:00Z",
  ...over,
});

describe("gateRedirect", () => {
  it("lets an approved, onboarded client through", () => {
    expect(gateRedirect("/app", client())).toBeNull();
    expect(gateRedirect("/app/schedule", client())).toBeNull();
  });

  describe("approval gate", () => {
    it("holds a pending client at /app/pending", () => {
      const p = client({ approval_status: "pending" });
      expect(gateRedirect("/app", p)).toBe("/app/pending");
      expect(gateRedirect("/app/book", p)).toBe("/app/pending");
    });

    it("holds a denied client too", () => {
      expect(
        gateRedirect("/app/schedule", client({ approval_status: "denied" }))
      ).toBe("/app/pending");
    });

    it("does not redirect the pending screen to itself", () => {
      expect(
        gateRedirect("/app/pending", client({ approval_status: "pending" }))
      ).toBeNull();
    });

    it("takes precedence over onboarding", () => {
      const p = client({ approval_status: "pending", onboarded_at: null });
      expect(gateRedirect("/app/onboarding", p)).toBe("/app/pending");
    });
  });

  describe("onboarding gate", () => {
    it("routes an approved but un-onboarded client to /app/onboarding", () => {
      const p = client({ onboarded_at: null });
      expect(gateRedirect("/app", p)).toBe("/app/onboarding");
      expect(gateRedirect("/app/players", p)).toBe("/app/onboarding");
    });

    it("does not redirect the onboarding screen to itself", () => {
      expect(
        gateRedirect("/app/onboarding", client({ onboarded_at: null }))
      ).toBeNull();
    });

    it("still gates /app/onboarding/done, which is only reached once stamped", () => {
      // finishOnboardingSetup stamps onboarded_at before this screen renders,
      // so in practice the gate is already open — matching the old requireUser
      // behaviour, where nextPath !== "/app/onboarding" sent it back.
      expect(
        gateRedirect("/app/onboarding/done", client({ onboarded_at: null }))
      ).toBe("/app/onboarding");
      expect(gateRedirect("/app/onboarding/done", client())).toBeNull();
    });
  });

  describe("exemptions", () => {
    it("never gates a coach or a founder", () => {
      const unapproved = { approval_status: "pending", onboarded_at: null };
      expect(gateRedirect("/app", { role: "coach", ...unapproved })).toBeNull();
      expect(gateRedirect("/app", { role: "founder", ...unapproved })).toBeNull();
    });

    it("never gates anything outside /app", () => {
      const p = client({ approval_status: "pending", onboarded_at: null });
      expect(gateRedirect("/coach", p)).toBeNull();
      expect(gateRedirect("/admin/players", p)).toBeNull();
      expect(gateRedirect("/", p)).toBeNull();
    });

    it("does not treat a path merely prefixed with /app as inside the app", () => {
      const p = client({ approval_status: "pending" });
      expect(gateRedirect("/apply", p)).toBeNull();
    });
  });
});
