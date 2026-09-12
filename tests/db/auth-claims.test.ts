import { describe, it, expect } from "vitest";
import { asUser } from "../../e2e/lib/supabase";

/**
 * Pins the fast path behind `getCurrentUser` / the proxy (see lib/auth.ts).
 *
 * `getClaims()` verifies the access token locally against the public JWKS, so a
 * signed-in navigation costs no round trip to the auth server. But it falls
 * back to a full `getUser()` network call *silently* when the token is signed
 * with HS*, carries no `kid`, or WebCrypto is missing — you would get the old
 * latency back with no error anywhere. These tests fail loudly instead.
 */
describe("getClaims verifies locally", () => {
  it("returns the user id without calling the auth server", async () => {
    const coach = await asUser("samir@sharwin.example");

    // Watch for a request to the auth server's /user endpoint — that is what
    // getUser() hits, and what the fallback would trigger.
    const realFetch = globalThis.fetch;
    const authUserCalls: string[] = [];
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (/\/auth\/v1\/user(\?|$)/.test(url)) authUserCalls.push(url);
      return realFetch(input, init);
    }) as typeof fetch;

    try {
      const { data, error } = await coach.auth.getClaims();
      expect(error).toBeNull();
      expect(data?.claims?.sub).toBeTruthy();
      expect(data?.claims?.email).toBe("samir@sharwin.example");
      expect(authUserCalls, "getClaims fell back to a getUser() network call").toEqual([]);

      // Prove the detector above isn't vacuous: getUser() is the call being
      // avoided, so it must trip the very interceptor that just stayed silent.
      await coach.auth.getUser();
      expect(authUserCalls.length, "interceptor never sees any auth call").toBe(1);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("signs tokens with an asymmetric alg carrying a kid", async () => {
    const coach = await asUser("samir@sharwin.example");
    const { data } = await coach.auth.getSession();
    const token = data.session?.access_token;
    expect(token).toBeTruthy();

    const header = JSON.parse(
      Buffer.from(token!.split(".")[0], "base64url").toString("utf8")
    );
    // HS* or a missing kid would silently route getClaims back to the network.
    expect(header.alg).toMatch(/^(ES|RS)/);
    expect(header.kid).toBeTruthy();
  });
});
