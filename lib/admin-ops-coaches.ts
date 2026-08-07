// Coach lifecycle cores — promote, edit details, activate/pause. Shared by the
// admin actions and the WhatsApp bot; RLS enforces on the caller's client.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { normalizePhoneInput } from "@/lib/whatsapp/phone";
import { reassignSessionCore } from "@/lib/admin-ops-calendar";
import type { OpResult, TableUpdate } from "@/lib/admin-ops-types";
import { BENGALURU } from "@/lib/coverage";
import { createAdminClient, hasServiceRoleKey } from "@/lib/supabase/admin";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The full set of details an admin enters when adding or editing a coach. */
export type CoachDetails = {
  fullName: string;
  email: string;
  phone: string;
  bio: string;
  baseAddress: string;
  baseLat: number;
  baseLng: number;
};

/** Turn an existing client account into a coach (they keep the same login). */
export async function promoteToCoachCore(
  supabase: SupabaseClient<Database>,
  founderId: string,
  profileId: string
): Promise<OpResult> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("id,role,full_name")
    .eq("id", profileId)
    .maybeSingle();
  if (!profile) return { ok: false, error: "That account wasn't found." };
  if (profile.role === "coach") return { ok: false, error: "They're already a coach." };
  if (profile.role === "founder") return { ok: false, error: "That's a founder account." };

  const { error: roleErr } = await supabase
    .from("profiles")
    .update({ role: "coach" })
    .eq("id", profileId);
  if (roleErr) return { ok: false, error: "Couldn't update the account." };

  const { error: coachErr } = await supabase.from("coaches").upsert({
    id: profileId,
    base_lat: BENGALURU.lat,
    base_lng: BENGALURU.lng,
    active: true,
  });
  if (coachErr) {
    await supabase.from("profiles").update({ role: "client" }).eq("id", profileId);
    return { ok: false, error: "Couldn't create the coach record." };
  }

  await supabase.from("notifications").insert({
    user_id: profileId,
    type: "role_changed",
    title: "You're a coach now",
    body: "Message me any time for your schedule, rosters and availability.",
    data: { url: "/coach" },
  });
  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "coach.promote",
    entity: "coaches",
    entity_id: profileId,
    meta: { name: profile.full_name },
  });
  return { ok: true };
}

export type CoachInput = {
  id: string;
  bio: string;
  baseAddress: string;
  baseLat: number;
  baseLng: number;
  // Optional identity fields — when present, the coach's profile is updated too.
  fullName?: string;
  phone?: string;
  // Optional public-profile fields shown on /coaches — when present, saved too.
  quote?: string;
  credentials?: string[];
};

export async function saveCoachCore(
  supabase: SupabaseClient<Database>,
  founderId: string,
  input: CoachInput
): Promise<OpResult> {
  if (input.fullName != null && !input.fullName.trim()) {
    return { ok: false, error: "Name can't be empty." };
  }
  // Validated up front so a bad number can't leave the coaches row written and
  // the profile row not.
  let phone: string | null = null;
  if (input.phone != null && input.phone.trim()) {
    phone = normalizePhoneInput(input.phone);
    if (!phone) return { ok: false, error: "That phone number doesn't look valid." };
  }
  const patch: TableUpdate<"coaches"> = {
    bio: input.bio || null,
    base_address: input.baseAddress || null,
    base_lat: input.baseLat,
    base_lng: input.baseLng,
  };
  if (input.quote !== undefined) patch.quote = input.quote.trim() || null;
  if (input.credentials !== undefined) {
    patch.credentials = input.credentials.map((c) => c.trim()).filter(Boolean);
  }
  const { error } = await supabase.from("coaches").update(patch).eq("id", input.id);
  if (error) return { ok: false, error: "Couldn't save the coach." };

  if (input.fullName != null || input.phone != null) {
    const patch: TableUpdate<"profiles"> = {};
    if (input.fullName != null) patch.full_name = input.fullName.trim();
    if (input.phone != null) patch.phone = phone;
    const { error: profErr } = await supabase
      .from("profiles")
      .update(patch)
      .eq("id", input.id)
      .eq("role", "coach");
    if (profErr) return { ok: false, error: "Couldn't save the coach's details." };
  }

  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "coach.update",
    entity: "coaches",
    entity_id: input.id,
  });
  return { ok: true };
}

/**
 * Add a coach from admin-entered details. If an account already exists for the
 * email, promote it now and apply the details; otherwise register an allowlist
 * invite so the account is provisioned as a coach the moment they sign up.
 */
export async function addCoachCore(
  supabase: SupabaseClient<Database>,
  founderId: string,
  d: CoachDetails
): Promise<OpResult & { pending?: boolean }> {
  const email = d.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { ok: false, error: "That email doesn't look valid." };
  if (!d.fullName.trim()) return { ok: false, error: "Enter the coach's name." };
  const phone = d.phone.trim() ? normalizePhoneInput(d.phone) : null;
  if (d.phone.trim() && !phone) {
    return { ok: false, error: "That phone number doesn't look valid." };
  }

  // Already an account? Promote (if needed) and apply the entered details.
  const { data: existing } = await supabase
    .from("profiles")
    .select("id,role")
    .eq("email", email)
    .maybeSingle();
  if (existing) {
    if (existing.role === "founder") return { ok: false, error: "That's a founder account." };
    if (existing.role !== "coach") {
      const promo = await promoteToCoachCore(supabase, founderId, existing.id);
      if (!promo.ok) return promo;
    }
    const saved = await saveCoachCore(supabase, founderId, {
      id: existing.id,
      bio: d.bio,
      baseAddress: d.baseAddress,
      baseLat: d.baseLat,
      baseLng: d.baseLng,
      fullName: d.fullName,
      phone: d.phone,
    });
    if (!saved.ok) return saved;
    return { ok: true };
  }

  // No account yet — register (or refresh) an allowlist invite.
  const { error } = await supabase.from("coach_invites").upsert(
    {
      email,
      full_name: d.fullName.trim(),
      phone,
      bio: d.bio || null,
      base_address: d.baseAddress || null,
      base_lat: d.baseLat || null,
      base_lng: d.baseLng || null,
      created_by: founderId,
      claimed_at: null,
      claimed_by: null,
    },
    { onConflict: "email" }
  );
  if (error) return { ok: false, error: "Couldn't save the invite." };
  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "coach.invite",
    entity: "coach_invites",
    meta: { email, name: d.fullName.trim() },
  });
  return { ok: true, pending: true };
}

/** Edit a not-yet-claimed invite. */
export async function savePendingCoachCore(
  supabase: SupabaseClient<Database>,
  founderId: string,
  id: string,
  d: CoachDetails
): Promise<OpResult> {
  const email = d.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { ok: false, error: "That email doesn't look valid." };
  if (!d.fullName.trim()) return { ok: false, error: "Enter the coach's name." };
  const phone = d.phone.trim() ? normalizePhoneInput(d.phone) : null;
  if (d.phone.trim() && !phone) {
    return { ok: false, error: "That phone number doesn't look valid." };
  }
  const { error } = await supabase
    .from("coach_invites")
    .update({
      email,
      full_name: d.fullName.trim(),
      phone,
      bio: d.bio || null,
      base_address: d.baseAddress || null,
      base_lat: d.baseLat || null,
      base_lng: d.baseLng || null,
    })
    .eq("id", id)
    .is("claimed_at", null);
  if (error) return { ok: false, error: "Couldn't save the invite." };
  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "coach.invite_update",
    entity: "coach_invites",
    entity_id: id,
  });
  return { ok: true };
}

/** Revoke a not-yet-claimed invite. */
export async function deletePendingCoachCore(
  supabase: SupabaseClient<Database>,
  founderId: string,
  id: string
): Promise<OpResult> {
  const { error } = await supabase
    .from("coach_invites")
    .delete()
    .eq("id", id)
    .is("claimed_at", null);
  if (error) return { ok: false, error: "Couldn't remove the invite." };
  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "coach.invite_revoke",
    entity: "coach_invites",
    entity_id: id,
  });
  return { ok: true };
}

/** Tables that would make a hard delete destroy paying-customer records. A coach
 *  promoted from an existing client account (see `promoteToCoachCore`) can still
 *  have a child enrolled and a payment history; those rows cascade off
 *  `profiles` and do not come back. */
const CLIENT_FOOTPRINT = [
  ["bookings", "client_id", "bookings"],
  ["players", "client_id", "players"],
  ["subscriptions", "client_id", "subscriptions"],
  ["orders", "client_id", "orders"],
  ["invoices", "client_id", "invoices"],
  ["class_credits", "client_id", "class credits"],
  ["private_credit_ledger", "client_id", "private-minute entries"],
] as const;

/**
 * Remove a coach from the roster after handing their upcoming sessions to a
 * replacement. Every future scheduled session they own is reassigned (the
 * engine notifies the old coach, new coach and booked clients); private-series
 * preferences pointing at them are repointed; then the account itself is
 * deleted.
 *
 * Removed means removed. This academy is closed — membership is by invitation
 * and approval — so a coach who is taken off the roster must not keep a working
 * login. Demoting them to `role = 'client'` (what this used to do) left them
 * signed in as a customer, listed among the families, offerable in the private
 * booking dropdown, and still bound to the WhatsApp bot through `wa_links`.
 *
 * Deleting the auth user is the whole operation: `profiles.id` → `auth.users`
 * is ON DELETE CASCADE, and everything hanging off the profile — the `coaches`
 * row with its assignments/availability/time-off, notifications, wa_links —
 * goes with it. `audit_log.actor_id` and the `coach_invites` row are ON DELETE
 * SET NULL, so the record that they were here, and were removed, survives them.
 *
 * Two things this deliberately will not do:
 *   • Run without a service-role key. Deleting an auth user needs one, and
 *     falling back to a demote would quietly reinstate the bug this fixes.
 *   • Delete an account that carries client-side records. That is a family's
 *     enrolment and billing history, it cascades, and it does not come back —
 *     so the founder is told what is there and decides.
 *
 * Caveat, unchanged: class_sessions.coach_id → coaches is ON DELETE SET NULL,
 * so past completed sessions lose the record of who taught them.
 */
export async function deleteCoachCore(
  supabase: SupabaseClient<Database>,
  founderId: string,
  coachId: string,
  replacementCoachId?: string | null
): Promise<OpResult & { changed?: number; skipped?: number }> {
  // Reassignment is optional. When a replacement is given, hand every upcoming
  // session to them; otherwise the coach is simply removed and their upcoming
  // sessions become unassigned (the FK is ON DELETE SET NULL).
  const replacement = replacementCoachId || null;
  if (replacement === coachId) {
    return { ok: false, error: "Pick a different coach to take over their classes." };
  }

  // Both guards run before a single session is moved: refusing after a handover
  // would leave the roster rearranged around a coach who is still on it.
  if (!hasServiceRoleKey()) {
    return { ok: false, error: "Coaches can't be removed from this deployment." };
  }

  const carries: string[] = [];
  for (const [table, column, label] of CLIENT_FOOTPRINT) {
    const { count } = await supabase
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq(column, coachId);
    if (count) carries.push(`${count} ${label}`);
  }
  if (carries.length > 0) {
    return {
      ok: false,
      error:
        `This account is also a family here — it holds ${carries.join(", ")}. ` +
        `Removing the coach would delete that too. Pause them instead, or clear ` +
        `the family's records first.`,
    };
  }

  let changed = 0;
  let skipped = 0;
  if (replacement) {
    const { data: rep } = await supabase
      .from("coaches")
      .select("id,active")
      .eq("id", replacement)
      .maybeSingle();
    if (!rep) return { ok: false, error: "That replacement coach wasn't found." };
    if (!rep.active) return { ok: false, error: "The replacement coach is paused." };

    // force=true so the handover is never blocked by fit rules; lock=true so
    // the engine won't silently reassign it elsewhere afterwards.
    const { data: sessions } = await supabase
      .from("class_sessions")
      .select("id")
      .eq("coach_id", coachId)
      .eq("status", "scheduled")
      .gt("starts_at", new Date().toISOString());

    for (const s of sessions ?? []) {
      const r = await reassignSessionCore(supabase, founderId, s.id, replacement, true, true);
      if (r.ok) changed += 1;
      else skipped += 1;
    }
  }

  // Repoint (or clear) recurring-private preferences so future bookings don't
  // ask for a coach who no longer exists.
  await supabase
    .from("private_booking_series")
    .update({ preferred_coach: replacement })
    .eq("preferred_coach", coachId);

  // Delete the account. One call: profiles cascades off auth.users, and the
  // coaches row (with its assignments, availability and time-off), the
  // notifications and the wa_links binding all cascade off profiles.
  const { error: delErr } = await createAdminClient().auth.admin.deleteUser(coachId);
  if (delErr) return { ok: false, error: "Couldn't remove the coach." };

  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "coach.delete",
    entity: "coaches",
    entity_id: coachId,
    meta: { reassigned_to: replacement, changed, skipped },
  });
  return { ok: true, changed, skipped };
}

/** Pause = stop new assignments; existing sessions stay until reassigned. */
export async function setCoachActiveCore(
  supabase: SupabaseClient<Database>,
  founderId: string,
  coachId: string,
  active: boolean
): Promise<OpResult> {
  const { error } = await supabase.from("coaches").update({ active }).eq("id", coachId);
  if (error) return { ok: false, error: "Couldn't update the coach." };
  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: active ? "coach.activate" : "coach.pause",
    entity: "coaches",
    entity_id: coachId,
  });
  return { ok: true };
}
