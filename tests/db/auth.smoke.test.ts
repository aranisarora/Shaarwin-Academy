import { describe, it, expect } from "vitest";
import { admin, asUser } from "../../e2e/lib/supabase";
import { getStorageState } from "../../e2e/lib/auth";

describe("harness auth", () => {
  it("service-role admin sees the 6 seeded profiles", async () => {
    const { count, error } = await admin()
      .from("profiles")
      .select("*", { count: "exact", head: true });
    expect(error).toBeNull();
    expect(count).toBeGreaterThanOrEqual(6);
  });

  it("mints a storage state with @supabase/ssr auth cookies for each role", async () => {
    for (const role of ["client", "coach", "founder"]) {
      const state = await getStorageState(role);
      const authCookies = state.cookies.filter((c) => /-auth-token(\.\d+)?$/.test(c.name));
      expect(authCookies.length, `${role} auth cookies`).toBeGreaterThan(0);
      // ssr encodes the session as a base64- prefixed value
      expect(authCookies[0].value.startsWith("base64-")).toBe(true);
    }
  });

  it("asUser() resolves auth.uid() to the signed-in user (RLS path)", async () => {
    const coach = await asUser("samir@sharwin.example");
    const { data, error } = await coach.auth.getUser();
    expect(error).toBeNull();
    expect(data.user?.email).toBe("samir@sharwin.example");
  });
});
