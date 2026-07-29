import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client, for server-only paths with no user session
 * (Razorpay webhooks, checkout fulfilment bookkeeping).
 *
 * There is deliberately no anon-key fallback. Under the anon key every write
 * here is silently refused by RLS while the request still returns 200 — a
 * captured payment would never grant its credits and Razorpay would never
 * retry. Missing the key must fail loudly instead.
 */
export function hasServiceRoleKey(): boolean {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // Real keys are JWTs ("ey…") or the newer secret format; anything else is a
  // placeholder from .env.example.
  return Boolean(key && (key.startsWith("ey") || key.startsWith("sb_secret")));
}

export function createAdminClient() {
  if (!hasServiceRoleKey()) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is missing or a placeholder — service-role operations cannot run"
    );
  }
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}
