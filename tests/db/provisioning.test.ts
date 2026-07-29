import { describe, it, expect, afterAll } from "vitest";
import { admin } from "../../e2e/lib/supabase";

// `requireUser` (lib/auth.ts) reads the profiles row and never creates one: the
// on_auth_user_created trigger on auth.users provisions it inside the signup
// transaction. It used to carry a belt-and-braces fallback that inserted the
// rows itself, which had already drifted from the trigger (it omitted
// approval_status). These specs pin the behaviour the fallback used to cover,
// so its removal stays safe.

const created: string[] = [];

async function signUpFresh(): Promise<{ id: string; email: string }> {
  const email = `provisioning+${Date.now()}${Math.random().toString(36).slice(2, 8)}@sharwin.example`;
  const { data, error } = await admin().auth.admin.createUser({
    email,
    password: "harness-provisioning-pw",
    email_confirm: true,
    user_metadata: { full_name: "Provisioning Probe" },
  });
  if (error) throw new Error(`createUser failed: ${error.message}`);
  created.push(data.user.id);
  return { id: data.user.id, email };
}

afterAll(async () => {
  for (const id of created) await admin().auth.admin.deleteUser(id);
});

describe("handle_new_user provisioning trigger", () => {
  it("inserts the profiles row for a brand-new auth user", async () => {
    const user = await signUpFresh();

    const { data: profile, error } = await admin()
      .from("profiles")
      .select("id,role,full_name,email,approval_status")
      .eq("id", user.id)
      .maybeSingle();

    expect(error).toBeNull();
    // The whole point: requireUser can now assume this row exists.
    expect(profile, "no profiles row — requireUser would throw").not.toBeNull();
    expect(profile!.role).toBe("client");
    expect(profile!.email).toBe(user.email);
    // The old app-layer fallback never set this, relying on the column default;
    // assert the trigger produces a usable value so the two can't disagree.
    expect(profile!.approval_status).toBeTruthy();
  });

  it("inserts the client's first player row too", async () => {
    const user = await signUpFresh();

    const { data: players, error } = await admin()
      .from("players")
      .select("id,full_name")
      .eq("client_id", user.id);

    expect(error).toBeNull();
    expect(players ?? []).toHaveLength(1);
    expect(players![0].full_name).toBe("Provisioning Probe");
  });
});
