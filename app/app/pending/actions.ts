"use server";

import { createClient } from "@/lib/supabase/server";
import { normalizePhoneInput } from "@/lib/whatsapp/phone";

export type SignupRequestResult = {
  ok: boolean;
  /** Set when the request (or an invite match) resolved the account. */
  status?: "pending" | "approved" | "denied";
  error?: string;
};

/**
 * Submit the closed-membership access request: name + phone. Reuses the exact
 * phone validation savePhone uses, then calls submit_signup_request (which
 * captures the details, fires the founder notification, and is idempotent so a
 * corrected phone updates the pending request in place). A phone that matches a
 * founder pre-registration auto-approves and returns { status: 'approved' } —
 * the page then sends the user straight into onboarding.
 */
export async function submitSignupRequest(
  rawName: string,
  rawPhone: string
): Promise<SignupRequestResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const name = rawName.trim();
  if (!name) return { ok: false, error: "Please tell us your name." };

  const phone = normalizePhoneInput(rawPhone);
  if (!phone) {
    return {
      ok: false,
      error: "That doesn't look like a phone number — include the country code, e.g. +91.",
    };
  }

  const { data, error } = await supabase.rpc("submit_signup_request", {
    p_name: name,
    p_phone: phone,
  });
  if (error) return { ok: false, error: "Couldn't send your request. Try again." };

  const result = (data ?? {}) as { status?: string; error?: string };
  if (result.status === "error") {
    if (result.error === "phone_taken") {
      return {
        ok: false,
        error: "That number is already registered — try logging in instead.",
      };
    }
    return { ok: false, error: "Couldn't send your request. Try again." };
  }

  return { ok: true, status: result.status as SignupRequestResult["status"] };
}
