"use server";

// Generates the one-time code that ties a WhatsApp number to the signed-in
// account. Shared by the client, coach, and admin profile surfaces.

import { createClient } from "@/lib/supabase/server";
import { adminClient, createLinkCode } from "@/lib/whatsapp/identity";

export type LinkCodeResult =
  | { ok: true; code: string; waLink: string | null; expiresMinutes: number }
  | { ok: false; error: string };

export async function generateWhatsAppLinkCode(): Promise<LinkCodeResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const code = await createLinkCode(user.id);
  const number = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER;
  const waLink = number
    ? `https://wa.me/${number.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(
        `Link my account: ${code}`
      )}`
    : null;
  return { ok: true, code, waLink, expiresMinutes: 15 };
}

/** The phone linked to the signed-in account, or null if not connected.
 *  wa_links has no user-facing RLS policy, so this goes through the admin
 *  client after verifying the session. */
export async function getWhatsAppLinkedPhone(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await adminClient()
    .from("wa_links")
    .select("phone")
    .eq("user_id", user.id)
    .maybeSingle();
  return data?.phone ?? null;
}

/** Remove the WhatsApp link for the signed-in account. Keeps profiles.phone
 *  (it's contact info used elsewhere); note the bot will re-link automatically
 *  if this same number messages it again, since resolveIdentity falls back to
 *  a profiles.phone match. */
export async function unlinkWhatsApp(): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false };

  const { error } = await adminClient()
    .from("wa_links")
    .delete()
    .eq("user_id", user.id);
  if (error) {
    console.error("wa: unlink failed", error.message);
    return { ok: false };
  }
  return { ok: true };
}
