"use server";

// Generates the one-time code that ties a WhatsApp number to the signed-in
// account. Shared by the client, coach, and admin profile surfaces.

import { createClient } from "@/lib/supabase/server";
import { createLinkCode } from "@/lib/whatsapp/identity";

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
