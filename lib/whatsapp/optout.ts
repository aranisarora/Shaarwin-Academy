// STOP / START — the deterministic opt-out layer, ahead of both the interactive
// button handler and the LLM. (notification-fix-plan 2.3.)
//
// Matching is deliberately narrow: an EXACT match on an unambiguous keyword,
// never a substring. The tempting wider list is actively dangerous here —
// Twilio's standard set includes CANCEL, END and QUIT, and a parent typing
// "cancel" almost certainly means "cancel my booking", not "never message me
// again". Likewise START's usual companion YES is excluded: coaches type "yes"
// to confirm a class. A missed opt-out keyword is recoverable (the member can
// use the app, or say it in words to the assistant); a false positive silences
// a paying family and nobody finds out until they complain.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { PREF_TYPES } from "@/lib/notification-prefs";

export type OptOutAction = "stop" | "start";

const STOP_WORDS = new Set(["stop", "stopall", "unsubscribe"]);
const START_WORDS = new Set(["start", "unstop", "resume"]);

/**
 * Classify an inbound message as an opt-out command, or null for ordinary
 * traffic. Exact match only, after trimming and lowercasing; trailing
 * punctuation ("STOP.") is tolerated because phones add it.
 */
export function matchOptOut(text: string): OptOutAction | null {
  const word = text.trim().toLowerCase().replace(/[.!]+$/, "");
  if (STOP_WORDS.has(word)) return "stop";
  if (START_WORDS.has(word)) return "start";
  return null;
}

/**
 * Apply the opt-out decision and return the reply to send. Sets the hard
 * channel gate (`wa_muted`) AND every mutable per-type preference, so the app's
 * notification screen shows the same truth the worker is acting on.
 */
export async function applyOptOut(
  admin: SupabaseClient<Database>,
  userId: string,
  action: OptOutAction
): Promise<string> {
  const muted = action === "stop";

  const { data: profile } = await admin
    .from("profiles")
    .select("notification_prefs")
    .eq("id", userId)
    .maybeSingle();

  const prefs = {
    ...((profile?.notification_prefs as Record<string, boolean> | null) ?? {}),
  };
  for (const [key] of PREF_TYPES) prefs[key] = !muted;

  await admin
    .from("profiles")
    .update({ wa_muted: muted, notification_prefs: prefs })
    .eq("id", userId);

  return muted
    ? "You're unsubscribed — we won't message you here any more. " +
        "Anything urgent about a session you've paid for (a cancellation, or a payment problem) will still come through. " +
        'Send START whenever you want the rest back.'
    : "You're resubscribed — welcome back! You'll get session reminders and updates here again. " +
        "Send STOP any time to turn them off.";
}
