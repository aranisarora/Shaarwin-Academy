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
import { normalizePhone } from "./phone";

const LINK_CODE_TTL_MINUTES = 15;

/** Supabase Auth needs an email; for phone-first users we mint a synthetic one
 *  that never receives mail. The phone (in wa_links + profiles.phone) is the
 *  real identity. */
export function syntheticEmailFor(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return `wa${digits}@sharwin.local`;
}

export function adminClient(): SupabaseClient {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

/** Why a message is being handled without a linked account — for logging. */
export type GuestReason = "not_linked" | "db_error";

export type IdentityResult =
  | { profile: Profile; reason: null }
  | { profile: null; reason: GuestReason };

/**
 * Resolve the account behind a phone number. Order:
 *   1. Explicit wa_links row (the canonical link).
 *   2. Fallback: a profile whose profiles.phone matches (e.g. a web-created
 *      account that never redeemed a code) — auto-link it so step 1 hits next
 *      time. This is what makes "sign up on the web, just message the bot" work.
 * Returns a typed reason when nothing matches so the caller can log/act.
 */
export async function resolveIdentity(
  admin: SupabaseClient,
  rawPhone: string
): Promise<IdentityResult> {
  const phone = normalizePhone(rawPhone);
  if (!phone) return { profile: null, reason: "not_linked" };

  try {
    const { data: link, error: linkErr } = await admin
      .from("wa_links")
      .select("user_id")
      .eq("phone", phone)
      .maybeSingle();
    if (linkErr) {
      console.error("wa: wa_links lookup failed", linkErr.message);
      return { profile: null, reason: "db_error" };
    }

    if (link) {
      const { data: profile } = await admin
        .from("profiles")
        .select("*")
        .eq("id", link.user_id)
        .maybeSingle();
      if (profile) return { profile: profile as Profile, reason: null };
    }

    // No link row — try matching an existing account by phone and auto-link it.
    const { data: byPhone } = await admin
      .from("profiles")
      .select("*")
      .eq("phone", phone)
      .maybeSingle();
    if (byPhone) {
      await admin
        .from("wa_links")
        .upsert({ phone, user_id: byPhone.id }, { onConflict: "phone" });
      return { profile: byPhone as Profile, reason: null };
    }

    return { profile: null, reason: "not_linked" };
  } catch (err) {
    console.error("wa: resolveIdentity crashed", err);
    return { profile: null, reason: "db_error" };
  }
}

/** @deprecated use resolveIdentity — kept for callers that only need the profile. */
export async function resolveLinkedProfile(
  admin: SupabaseClient,
  phone: string
): Promise<Profile | null> {
  return (await resolveIdentity(admin, phone)).profile;
}

/**
 * Phone-first onboarding: the number is already Twilio-verified, so create a
 * client account bound to it (synthetic email, no OTP, no code) and link it.
 * fullName is a placeholder until the bot collects the real one via
 * update_profile. Returns the fresh profile, or null on failure.
 */
export async function autoProvisionClient(
  admin: SupabaseClient,
  rawPhone: string
): Promise<Profile | null> {
  const phone = normalizePhone(rawPhone);
  if (!phone) return null;

  // Guard against races: if any account already owns this phone (via wa_links
  // or profiles.phone), return it instead of creating a duplicate.
  const existing = await resolveIdentity(admin, phone);
  if (existing.profile) return existing.profile;

  const email = syntheticEmailFor(phone);
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { full_name: "" },
  });
  if (error || !created.user) {
    console.error("wa: autoProvisionClient createUser failed", error?.message);
    return null;
  }

  const userId = created.user.id;
  // handle_new_user trigger usually provisions these; belt & braces.
  const { data: provisioned } = await admin
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (!provisioned) {
    await admin
      .from("profiles")
      .insert({ id: userId, role: "client", full_name: "", email });
    await admin.from("players").insert({ client_id: userId, full_name: "there" });
  }

  await admin.from("wa_links").delete().eq("phone", phone);
  await admin.from("wa_links").insert({ phone, user_id: userId });
  await admin.from("profiles").update({ phone }).eq("id", userId);

  // If an admin pre-registered this phone as a coach, upgrade the fresh account.
  await admin.rpc("claim_coach_invite_by_phone", { p_user: userId, p_phone: phone });

  const { data: profile } = await admin
    .from("profiles")
    .select("*")
    .eq("id", userId)
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
  rawPhone: string
): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const phone = normalizePhone(rawPhone);
  if (!phone) return { ok: false, error: "code_not_found" };
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
  rawPhone: string,
  fullName: string,
  email: string
): Promise<{ ok: true; userId: string; role: string } | { ok: false; error: string }> {
  const phone = normalizePhone(rawPhone);
  if (!phone) return { ok: false, error: "signup_failed" };
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

  // The handle_new_user trigger provisions profiles + players — and upgrades the
  // account to coach if the email was on the invite allowlist. Belt & braces in
  // case the trigger hasn't run yet (mirrors requireUser()).
  const { data: profile } = await admin
    .from("profiles")
    .select("id,role")
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

  return { ok: true, userId: created.user.id, role: profile?.role ?? "client" };
}
