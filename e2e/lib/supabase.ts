// supabase-js clients for the harness, all pointed at LOCAL Supabase.
//
//  - admin(): service-role client. Bypasses RLS. Use for seeding scenarios and
//    asserting rows (notifications, bookings, …).
//  - asUser(): a client signed in as a seeded/real user. Goes through PostgREST
//    as the `authenticated` role, so RLS and auth.uid() behave as in production
//    — this is how tests should call RPCs whose logic depends on the caller.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY, assertLocalSupabase } from "./env";
import { SEED_PASSWORD } from "./auth";

assertLocalSupabase();

/** Service-role client — full access, RLS bypassed. Seeding + assertions. */
export function admin(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * A client authenticated as `email`. RLS + auth.uid() apply, so use this to
 * call RPCs the way the real user would (booking, cancelling, marking arrival…).
 */
export async function asUser(
  email: string,
  password: string = SEED_PASSWORD
): Promise<SupabaseClient> {
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`asUser(${email}) sign-in failed: ${error.message}`);
  return client;
}
