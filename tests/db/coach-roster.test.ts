// Guards the public coaching roster. `/coaches` and the private-booking coach
// picker both need each coach's name, which lives in `profiles` — a table RLS
// keeps owner-only. Reading it through a join silently yielded zero rows, so
// the public page rendered its "being updated" empty state. `public_coach_roster()`
// is the definer-rights projection that fixes it without widening profiles RLS.

import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { admin, asUser } from "../../e2e/lib/supabase";
import { SUPABASE_URL, ANON_KEY } from "../../e2e/lib/env";

/** A signed-out visitor — exactly what the public /coaches page uses. */
function anon() {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

describe("public coach roster", () => {
  it("returns every active coach, with a name, to a signed-out visitor", async () => {
    const { count: activeCoaches } = await admin()
      .from("coaches")
      .select("*", { count: "exact", head: true })
      .eq("active", true);

    const { data, error } = await anon().rpc("public_coach_roster");
    expect(error).toBeNull();
    expect(data?.length).toBe(activeCoaches);
    expect(data?.length).toBeGreaterThan(0);
    for (const coach of data ?? []) {
      expect(coach.full_name, `coach ${coach.id} name`).toBeTruthy();
    }
  });

  it("still hides the rest of the profile — no contact details leak", async () => {
    const { data } = await anon().rpc("public_coach_roster");
    const columns = Object.keys(data?.[0] ?? {});
    expect(columns).not.toContain("email");
    expect(columns).not.toContain("phone");

    // profiles itself stays locked down; the function is the only way through.
    const { data: profiles } = await anon().from("profiles").select("id");
    expect(profiles ?? []).toHaveLength(0);
  });

  it("is reachable by a signed-in client, whose profiles join returns nothing", async () => {
    const client = await asUser("client-a@sharwin.example");

    // The regression: joining profiles drops every row for a non-founder.
    const { data: joined } = await client
      .from("coaches")
      .select("id,profiles!inner(full_name)")
      .eq("active", true);
    expect(joined ?? []).toHaveLength(0);

    const { data: roster, error } = await client.rpc("public_coach_roster");
    expect(error).toBeNull();
    expect(roster?.length).toBeGreaterThan(0);
  });
});
