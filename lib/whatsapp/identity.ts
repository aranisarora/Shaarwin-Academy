// WhatsApp identity layer — who is this phone number, and how does the bot
// act as them?
//
// Security model:
//  - A phone number gets account access ONLY after redeeming a short-lived,
//    single-use code generated inside the logged-in webapp (or by signing up
//    fresh in chat, which creates a brand-new client account).
//  - For every conversation turn the bot mints a REAL Supabase session for the
//    linked user (admin generateLink → verifyOtp), so all reads/writes run as
//    that user and Postgres RLS is the enforcement layer — not the LLM.

import {
  createClient as createSupabaseClient,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { randomBytes } from "crypto";
import type { Profile } from "@/lib/auth";

const LINK_CODE_TTL_MINUTES = 15;

export function adminClient(): SupabaseClient {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

/** Phone (E.164, no whatsapp: prefix) → linked profile, or null. */
export async function resolveLinkedProfile(
  admin: SupabaseClient,
  phone: string
): Promise<Profile | null> {
  const { data: link } = await admin
    .from("wa_links")
    .select("user_id")
    .eq("phone", phone)
    .maybeSingle();
  if (!link) return null;

  const { data: profile } = await admin
    .from("profiles")
    .select("*")
    .eq("id", link.user_id)
    .maybeSingle();
  return (profile as Profile) ?? null;
}

/**
 * Mint a user-scoped Supabase client for the linked account. Uses the admin
 * API to generate a magic-link token and immediately verifies it server-side;
 * the resulting access token makes auth.uid() = user inside Postgres, so every
 * RPC and RLS policy behaves exactly as it does in the webapp.
 */
export async function userClientFor(
  email: string
): Promise<SupabaseClient | null> {
  const admin = adminClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) {
    console.error("wa: generateLink failed", error?.message);
    return null;
  }

  const anon = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const { data: verified, error: verifyError } = await anon.auth.verifyOtp({
    token_hash: tokenHash,
    type: "magiclink",
  });
  if (verifyError || !verified.session) {
    console.error("wa: verifyOtp failed", verifyError?.message);
    return null;
  }

  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        headers: { Authorization: `Bearer ${verified.session.access_token}` },
      },
    }
  );
}

/** Webapp side: issue a fresh single-use link code for the signed-in user. */
export async function createLinkCode(userId: string): Promise<string> {
  const admin = adminClient();
  // Retire any previous unused codes for this user.
  await admin
    .from("wa_link_codes")
    .delete()
    .eq("user_id", userId)
    .is("used_at", null);

  const code = `TT-${randomBytes(4).toString("hex").toUpperCase().slice(0, 6)}`;
  await admin.from("wa_link_codes").insert({
    code,
    user_id: userId,
    expires_at: new Date(Date.now() + LINK_CODE_TTL_MINUTES * 60000).toISOString(),
  });
  return code;
}

/**
 * Bot side: redeem a code sent over WhatsApp. Marks it used and links the
 * phone (replacing any previous link for either the phone or the account).
 */
export async function consumeLinkCode(
  admin: SupabaseClient,
  rawCode: string,
  phone: string
): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const code = rawCode.trim().toUpperCase();
  const { data: row } = await admin
    .from("wa_link_codes")
    .select("code,user_id,expires_at,used_at")
    .eq("code", code)
    .maybeSingle();

  if (!row) return { ok: false, error: "code_not_found" };
  if (row.used_at) return { ok: false, error: "code_already_used" };
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, error: "code_expired" };
  }

  await admin
    .from("wa_link_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("code", code);

  // One phone ↔ one account: clear both directions before inserting.
  await admin.from("wa_links").delete().eq("phone", phone);
  await admin.from("wa_links").delete().eq("user_id", row.user_id);
  await admin.from("wa_links").insert({ phone, user_id: row.user_id });
  await admin.from("profiles").update({ phone }).eq("id", row.user_id);

  return { ok: true, userId: row.user_id };
}

/** Bot side: brand-new client signs up entirely in chat. */
export async function signUpNewClient(
  admin: SupabaseClient,
  phone: string,
  fullName: string,
  email: string
): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const cleanEmail = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return { ok: false, error: "invalid_email" };
  }

  const { data: created, error } = await admin.auth.admin.createUser({
    email: cleanEmail,
    email_confirm: true,
    user_metadata: { full_name: fullName.trim() },
  });
  if (error || !created.user) {
    const msg = error?.message ?? "";
    return {
      ok: false,
      error: msg.includes("already") ? "email_taken" : "signup_failed",
    };
  }

  // The handle_new_user trigger provisions profiles + players; belt & braces
  // in case it hasn't run yet (mirrors requireUser()).
  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .eq("id", created.user.id)
    .maybeSingle();
  if (!profile) {
    await admin.from("profiles").insert({
      id: created.user.id,
      role: "client",
      full_name: fullName.trim(),
      email: cleanEmail,
    });
    await admin
      .from("players")
      .insert({ client_id: created.user.id, full_name: fullName.trim() });
  }

  await admin.from("wa_links").delete().eq("phone", phone);
  await admin.from("wa_links").insert({ phone, user_id: created.user.id });
  await admin.from("profiles").update({ phone }).eq("id", created.user.id);

  return { ok: true, userId: created.user.id };
}
