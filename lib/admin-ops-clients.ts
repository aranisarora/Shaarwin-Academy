// Client lifecycle cores — edit, block (payment-dispute freeze), archive.
// Shared by the admin actions and the WhatsApp bot; RLS enforces.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { normalizePhoneInput } from "@/lib/whatsapp/phone";
import { adminClient, autoProvisionClient, linkPhoneToUser } from "@/lib/whatsapp/identity";
import type { OpResult } from "@/lib/admin-ops-types";

export async function updateClientCore(
  supabase: SupabaseClient<Database>,
  founderId: string,
  clientId: string,
  fullName: string,
  phone: string
): Promise<OpResult> {
  if (!fullName.trim()) return { ok: false, error: "Name can't be empty." };
  const normalized = phone.trim() ? normalizePhoneInput(phone) : null;
  if (phone.trim() && !normalized) {
    return { ok: false, error: "That phone number doesn't look valid." };
  }

  // profiles.phone is unique — surface a friendly message, not a DB error.
  const admin = adminClient();
  if (normalized) {
    const { data: taken } = await admin
      .from("profiles")
      .select("id")
      .eq("phone", normalized)
      .neq("id", clientId)
      .maybeSingle();
    if (taken) {
      return { ok: false, error: "That number is already on another account." };
    }
  }

  const { error } = await supabase
    .from("profiles")
    .update({ full_name: fullName.trim(), phone: normalized })
    .eq("id", clientId)
    .eq("role", "client");
  if (error) return { ok: false, error: "Couldn't save the details." };

  // Keep WhatsApp identity/delivery in step with the number.
  if (normalized) await linkPhoneToUser(admin, normalized, clientId);
  else await admin.from("wa_links").delete().eq("user_id", clientId);

  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "client.update",
    entity: "profiles",
    entity_id: clientId,
  });
  return { ok: true };
}

/** What an admin enters when pre-registering an offline client by phone. */
export type ClientInviteDetails = {
  phone: string;
  fullName: string;
  notes: string;
  /** Plan gifted on signup (comp subscription, like "Give a free plan"). "" = none. */
  planId: string;
};

/**
 * Pre-register a client by phone number. When any account ends up with this
 * phone (web signup + WhatsApp link, or messaging the bot cold), the
 * profiles-phone trigger claims the invite and applies the name/notes.
 */
export async function addClientInviteCore(
  supabase: SupabaseClient<Database>,
  founderId: string,
  d: ClientInviteDetails
): Promise<OpResult> {
  const phone = normalizePhoneInput(d.phone);
  if (!phone) return { ok: false, error: "That phone number doesn't look valid." };

  // Already an account with this number? Nothing to pre-register.
  const { data: existing } = await supabase
    .from("profiles")
    .select("id,full_name")
    .eq("phone", phone)
    .maybeSingle();
  if (existing) {
    return {
      ok: false,
      error: `${existing.full_name || "Someone"} already has an account with that number.`,
    };
  }

  const { error } = await supabase.from("client_invites").upsert(
    {
      phone,
      full_name: d.fullName.trim() || null,
      notes: d.notes.trim() || null,
      plan_id: d.planId || null,
      created_by: founderId,
      claimed_at: null,
      claimed_by: null,
    },
    { onConflict: "phone" }
  );
  if (error) return { ok: false, error: "Couldn't save the client." };
  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "client.invite",
    entity: "client_invites",
    meta: { phone, name: d.fullName.trim(), plan_id: d.planId || null },
  });
  return { ok: true };
}

/** Edit a not-yet-claimed client invite. */
export async function savePendingClientCore(
  supabase: SupabaseClient<Database>,
  founderId: string,
  id: string,
  d: ClientInviteDetails
): Promise<OpResult> {
  const phone = normalizePhoneInput(d.phone);
  if (!phone) return { ok: false, error: "That phone number doesn't look valid." };
  const { error } = await supabase
    .from("client_invites")
    .update({
      phone,
      full_name: d.fullName.trim() || null,
      notes: d.notes.trim() || null,
      plan_id: d.planId || null,
    })
    .eq("id", id)
    .is("claimed_at", null);
  if (error) return { ok: false, error: "Couldn't save the client." };
  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "client.invite_update",
    entity: "client_invites",
    entity_id: id,
  });
  return { ok: true };
}

/**
 * Turn a pending phone invite into a real client account right now, so the
 * founder can book sessions before the person ever signs in. Reuses the
 * WhatsApp phone-first provisioning (synthetic email, phone as identity);
 * setting the phone fires the profiles-phone trigger which claims the invite
 * and applies its name/notes/gifted plan. The auto-created placeholder player
 * is renamed to the invite's name so it reads sensibly in rosters.
 */
export async function materializeInviteCore(
  supabase: SupabaseClient<Database>,
  founderId: string,
  inviteId: string
): Promise<OpResult & { clientId?: string }> {
  const { data: invite } = await supabase
    .from("client_invites")
    .select("id,phone,full_name")
    .eq("id", inviteId)
    .is("claimed_at", null)
    .maybeSingle();
  if (!invite) return { ok: false, error: "That pre-registered client no longer exists." };

  const admin = adminClient();
  const profile = await autoProvisionClient(admin, invite.phone);
  if (!profile) return { ok: false, error: "Couldn't create the account." };

  const name = (invite.full_name ?? "").trim();
  if (name) {
    // Trigger applies the name to the profile; the placeholder player needs it too.
    await admin
      .from("players")
      .update({ full_name: name })
      .eq("client_id", profile.id)
      .eq("full_name", "there");
    if (!profile.full_name) {
      await admin.from("profiles").update({ full_name: name }).eq("id", profile.id);
    }
  }

  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "client.invite_materialize",
    entity: "profiles",
    entity_id: profile.id,
    meta: { invite_id: inviteId, phone: invite.phone },
  });
  return { ok: true, clientId: profile.id };
}

/** Remove a not-yet-claimed client invite. */
export async function deletePendingClientCore(
  supabase: SupabaseClient<Database>,
  founderId: string,
  id: string
): Promise<OpResult> {
  const { error } = await supabase
    .from("client_invites")
    .delete()
    .eq("id", id)
    .is("claimed_at", null);
  if (error) return { ok: false, error: "Couldn't remove the client." };
  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "client.invite_revoke",
    entity: "client_invites",
    entity_id: id,
  });
  return { ok: true };
}

/**
 * The notification types a human-composed message may be filed under.
 *
 * `notifications.type` is not decoration — supabase/functions/notify keys the
 * whole delivery pipeline off it: which mute group silences it, whether it
 * bypasses preferences (TRANSACTIONAL), whether it counts against the 3-a-day
 * cap (CAP_EXEMPT), whether it goes push-and-WhatsApp rather than first-wins,
 * and whether quiet hours can hold it. A type the worker doesn't know is
 * UNMUTABLE by design ("an omission fails loud rather than silent"), so a free
 * string here would let a typo build a channel no one can turn off.
 *
 * Both values below are in the worker's PREF_GROUP_FOR_TYPE, so both stay
 * mutable, and neither is TRANSACTIONAL — a composed message can never
 * impersonate an account-critical alert like session_cancelled, which the
 * cancel path sends properly on its own.
 */
export const NOTIFY_TYPES = ["announcement", "class_updated"] as const;
export type NotifyType = (typeof NOTIFY_TYPES)[number];

/**
 * Send an announcement to an explicit set of users. Rows land in
 * `notifications`; the delivery worker fans them out over push / WhatsApp /
 * email per each user's preferences.
 *
 * This is the primitive: WHO is a parameter, not an enum. `broadcastNotificationCore`
 * below is the same thing with the audience resolved from a role, and the
 * WhatsApp `notify` tool is the same thing with the audience resolved from
 * whatever `find` returned — "the coaches at La Plazza on Saturday", "the three
 * clients whose payment failed". Recipient caps belong to the caller, not here:
 * a broadcast legitimately reaches everyone, while a model-chosen set should be
 * bounded (see NOTIFY_CAP in the bot's notify tool).
 */
export async function notifyUsersCore(
  supabase: SupabaseClient<Database>,
  actorId: string,
  userIds: readonly string[],
  message: string,
  title?: string,
  audit?: { action?: string; meta?: Record<string, unknown> },
  type: NotifyType = "announcement"
): Promise<OpResult & { recipients?: number }> {
  const body = message.trim();
  if (!body) return { ok: false, error: "The message can't be empty." };

  // The same person can arrive twice when a set is stitched from two queries
  // (e.g. a coach who is also a parent); one message each is what's meant.
  const ids = [...new Set(userIds.filter((id) => typeof id === "string" && id.trim()))];
  if (ids.length === 0) return { ok: false, error: "No recipients found." };

  const heading = title?.trim() || "Message from the academy";
  const { error } = await supabase.from("notifications").insert(
    ids.map((id) => ({
      user_id: id,
      type,
      title: heading,
      body,
    }))
  );
  if (error) return { ok: false, error: "Couldn't queue the messages." };

  await supabase.from("audit_log").insert({
    actor_id: actorId,
    action: audit?.action ?? "notify.send",
    entity: "notifications",
    // The resolved ids are the point of this record: when a targeted send goes
    // to the wrong group, the filter that produced it is gone but this isn't.
    // Capped so one broadcast can't write a megabyte of jsonb.
    meta: {
      ...audit?.meta,
      title: heading,
      body,
      recipients: ids.length,
      recipient_ids: ids.slice(0, 100),
    },
  });
  return { ok: true, recipients: ids.length };
}

/**
 * Send an announcement to every active coach or every active client.
 * A thin audience resolver over notifyUsersCore.
 */
export async function broadcastNotificationCore(
  supabase: SupabaseClient<Database>,
  founderId: string,
  audience: "coaches" | "clients",
  message: string,
  title?: string
): Promise<OpResult & { recipients?: number }> {
  const { data: targets, error: targetErr } = await supabase
    .from("profiles")
    .select("id")
    .eq("role", audience === "coaches" ? "coach" : "client")
    .is("deleted_at", null);
  if (targetErr) return { ok: false, error: "Couldn't load the recipients." };
  if (!targets?.length) return { ok: false, error: "No recipients found." };

  return notifyUsersCore(
    supabase,
    founderId,
    targets.map((t) => t.id),
    message,
    title,
    { action: "notify.broadcast", meta: { audience } }
  );
}

/** Payment-dispute freeze: a blocked client can sign in but can't book. */
export async function setClientBlockedCore(
  supabase: SupabaseClient<Database>,
  founderId: string,
  clientId: string,
  blocked: boolean
): Promise<OpResult> {
  const { error } = await supabase
    .from("profiles")
    .update({ disputed: blocked })
    .eq("id", clientId)
    .eq("role", "client");
  if (error) return { ok: false, error: "Couldn't update the account." };
  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: blocked ? "client.block" : "client.unblock",
    entity: "profiles",
    entity_id: clientId,
  });
  return { ok: true };
}

/** Archive hides the client from lists; nothing is lost and it's reversible. */
export async function setClientArchivedCore(
  supabase: SupabaseClient<Database>,
  founderId: string,
  clientId: string,
  archived: boolean
): Promise<OpResult> {
  const { error } = await supabase
    .from("profiles")
    .update({ deleted_at: archived ? new Date().toISOString() : null })
    .eq("id", clientId)
    .eq("role", "client");
  if (error) return { ok: false, error: "Couldn't update the account." };
  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: archived ? "client.archive" : "client.restore",
    entity: "profiles",
    entity_id: clientId,
  });
  return { ok: true };
}
