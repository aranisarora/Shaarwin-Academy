// WhatsApp identity layer — who is this phone number, and how does the bot
// act as them?
//
// Security model (phone-first):
//  - The WhatsApp sender number is Twilio-verified. It maps to an account by a
//    direct profiles.phone match — the column carries a partial UNIQUE index
//    (profiles_phone_key, WHERE phone IS NOT NULL), so one number is one
//    account by construction. Genuinely unknown numbers get a fresh client
//    account auto-provisioned.
//  - There is no separate link table and no link code. If we hold the number,
//    we can both recognise an inbound message and send an outbound one; the
//    two directions read the SAME column, so they can never disagree. (They
//    used to: wa_links gated outbound only, which silently demoted two active
//    coaches and eleven clients to email for months.)
//  - For every conversation turn the bot mints a REAL Supabase session for the
//    linked user (admin generateLink → verifyOtp), so all reads/writes run as
//    that user and Postgres RLS is the enforcement layer — not the LLM.

import {
  createClient as createSupabaseClient,
  type SupabaseClient,
} from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { Profile } from "@/lib/auth";
import { normalizePhone } from "./phone";

/** Supabase Auth needs an email; for phone-first users we mint a synthetic one
 *  that never receives mail. profiles.phone is the real identity. */
function syntheticEmailFor(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return `wa${digits}@sharwin.local`;
}

export function adminClient(): SupabaseClient<Database> {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

/** Why a message is being handled without an account — for logging. */
type GuestReason = "no_account" | "db_error";

export type IdentityResult =
  | { profile: Profile; reason: null }
  | { profile: null; reason: GuestReason };

/**
 * Resolve the account behind a phone number: the profile whose phone matches.
 * profiles_phone_key (partial UNIQUE, WHERE phone IS NOT NULL) guarantees at
 * most one, so maybeSingle() is exact rather than a "pick the first" guess.
 *
 * Returns a typed reason when nothing matches so the caller can log/act.
 *
 * NOTE the db_error branch is load-bearing and must not be "simplified" into
 * the no_account path. It is now the ONLY thing standing between a transient
 * query failure and autoProvisionClient minting a SECOND account for a member
 * who already has one — stranding their bookings, credits and membership on
 * the original. There is no second lookup left to fall back on.
 */
export async function resolveIdentity(
  admin: SupabaseClient<Database>,
  rawPhone: string
): Promise<IdentityResult> {
  const phone = normalizePhone(rawPhone);
  if (!phone) return { profile: null, reason: "no_account" };

  try {
    const { data: byPhone, error: byPhoneErr } = await admin
      .from("profiles")
      .select("*")
      .eq("phone", phone)
      .maybeSingle();
    if (byPhoneErr) {
      console.error("wa: profiles.phone lookup failed", byPhoneErr.message);
      return { profile: null, reason: "db_error" };
    }
    if (byPhone) return { profile: byPhone as Profile, reason: null };

    return { profile: null, reason: "no_account" };
  } catch (err) {
    console.error("wa: resolveIdentity crashed", err);
    return { profile: null, reason: "db_error" };
  }
}

/**
 * Phone-first onboarding: the number is already Twilio-verified, so create a
 * client account bound to it (synthetic email, no OTP, no code). The name is a
 * placeholder until the bot collects the real one via update_profile.
 * Returns the fresh profile, or null on failure.
 */
export async function autoProvisionClient(
  admin: SupabaseClient<Database>,
  rawPhone: string
): Promise<Profile | null> {
  const phone = normalizePhone(rawPhone);
  if (!phone) return null;

  // Guard against races: if an account already owns this phone, return it
  // instead of creating a duplicate. A db_error here is NOT "no account" —
  // provisioning on a failed lookup is exactly how duplicates get minted.
  const existing = await resolveIdentity(admin, phone);
  if (existing.profile) return existing.profile;
  if (existing.reason === "db_error") return null;

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
      .insert({ id: userId, role: "client", full_name: "", email, phone });
    await admin.from("players").insert({ client_id: userId, full_name: "there" });
  }

  // The phone IS the identity now, so it must land on the row. Carried on the
  // insert above when we create the profile ourselves; this update covers the
  // handle_new_user trigger path, which does not know the number.
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
): Promise<SupabaseClient<Database> | null> {
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
