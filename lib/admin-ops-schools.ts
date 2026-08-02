// School access cores — create the login a school signs in with, reset it, and
// take it away again. RLS enforces on the caller's client; the admin client is
// used only where the auth schema has to be written (creating a user, setting a
// password), which no RLS policy can reach.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import type { OpResult } from "@/lib/admin-ops-types";

/** A campus that runs school classes, with whatever login it has today. */
export type SchoolRow = {
  venueId: string;
  name: string;
  unit: string | null;
  pupils: number;
  account: { userId: string; fullName: string; email: string } | null;
};

/** What a fresh credential looks like — shown to the founder exactly once. */
export type Credentials = { email: string; password: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Password words chosen to survive being read off a phone screen and retyped:
 * no lookalike pairs, nothing that needs spelling out. This is a shared
 * credential handed over on WhatsApp, so legibility beats entropy — and the
 * account it opens is read-only.
 */
const WORDS = [
  "falcon", "harbour", "lantern", "marble", "orchid", "pepper", "quartz",
  "ribbon", "saffron", "tundra", "velvet", "willow", "amber", "cobalt",
  "dune", "ember", "fern", "grove", "hazel", "indigo",
];

export function generatePassword(): string {
  const pick = () => WORDS[Math.floor(Math.random() * WORDS.length)];
  const digits = String(Math.floor(1000 + Math.random() * 9000));
  return `${pick()}-${pick()}-${digits}`;
}

/**
 * A minted address for a school, e.g. "tisb-sports-block@schools.sharwin.local".
 *
 * Nothing is ever delivered to it — the account is created with
 * `email_confirm: true` and signs in with a password — so it needs no MX record
 * and no inbox. That is the point: three people share this login, and a
 * personal address would tie it to whichever of them happens to leave first.
 * The founder can override it with a real address when a school insists.
 */
export function mintedEmailFor(venueName: string, unit: string | null): string {
  const slug = [venueName, unit]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `${slug || "school"}@schools.sharwin.local`;
}

/**
 * Every campus that has at least one school class, with its pupil count and its
 * login. Founder-only by RLS on all three tables.
 */
export async function listSchoolsCore(
  supabase: SupabaseClient<Database>
): Promise<SchoolRow[]> {
  const [{ data: classes }, { data: pupils }, { data: links }] = await Promise.all([
    supabase
      .from("classes")
      .select("venue_id,venues(name,unit)")
      .eq("is_school", true)
      .not("venue_id", "is", null),
    supabase.from("players").select("school_venue_id").not("school_venue_id", "is", null),
    // Hinted: school_admins points at profiles twice (user_id and created_by),
    // so an unqualified embed is ambiguous.
    supabase
      .from("school_admins")
      .select("user_id,venue_id,profiles!school_admins_user_id_fkey(full_name,email)"),
  ]);

  const counts = new Map<string, number>();
  for (const p of pupils ?? []) {
    const id = p.school_venue_id;
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  const accounts = new Map<string, SchoolRow["account"]>();
  for (const l of links ?? []) {
    accounts.set(l.venue_id, {
      userId: l.user_id,
      fullName: l.profiles?.full_name ?? "",
      email: l.profiles?.email ?? "",
    });
  }

  // A venue can host several school classes — collapse to one row each.
  const byVenue = new Map<string, SchoolRow>();
  for (const c of classes ?? []) {
    if (!c.venue_id || byVenue.has(c.venue_id)) continue;
    byVenue.set(c.venue_id, {
      venueId: c.venue_id,
      name: c.venues?.name ?? "School",
      unit: c.venues?.unit ?? null,
      pupils: counts.get(c.venue_id) ?? 0,
      account: accounts.get(c.venue_id) ?? null,
    });
  }

  return [...byVenue.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Create the school's login.
 *
 * The role, the profile and the `school_admins` link are all provisioned by the
 * `handle_new_user` trigger, which reads `school_venue_id` out of user metadata
 * — the same single provisioning path every other account goes through. This
 * function's job is to mint the credential and hand it back once.
 */
export async function createSchoolAccountCore(
  supabase: SupabaseClient<Database>,
  founderId: string,
  input: { venueId: string; fullName: string; email?: string }
): Promise<OpResult & { credentials?: Credentials }> {
  const fullName = input.fullName.trim();
  if (!fullName) return { ok: false, error: "Give the account a name." };

  const { data: venue } = await supabase
    .from("venues")
    .select("name,unit")
    .eq("id", input.venueId)
    .maybeSingle();
  if (!venue) return { ok: false, error: "That venue doesn't exist." };

  const { data: taken } = await supabase
    .from("school_admins")
    .select("user_id")
    .eq("venue_id", input.venueId)
    .maybeSingle();
  if (taken) return { ok: false, error: "That school already has a login." };

  const email = (input.email?.trim() || mintedEmailFor(venue.name, venue.unit)).toLowerCase();
  if (!EMAIL_RE.test(email)) return { ok: false, error: "That email doesn't look valid." };

  const password = generatePassword();
  const admin = createAdminClient();
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, school_venue_id: input.venueId },
  });
  if (error || !created.user) {
    const duplicate = /already|registered|exists/i.test(error?.message ?? "");
    return {
      ok: false,
      error: duplicate
        ? "An account already uses that email."
        : "Couldn't create the login.",
    };
  }

  // The trigger owns provisioning, but a link row missing here would leave a
  // school account that can see nothing at all — so confirm it landed and
  // repair it rather than hand over a credential that opens an empty app.
  const { data: link } = await admin
    .from("school_admins")
    .select("user_id")
    .eq("user_id", created.user.id)
    .eq("venue_id", input.venueId)
    .maybeSingle();
  if (!link) {
    await admin
      .from("school_admins")
      .insert({ user_id: created.user.id, venue_id: input.venueId, created_by: founderId });
  } else {
    await admin
      .from("school_admins")
      .update({ created_by: founderId })
      .eq("user_id", created.user.id)
      .eq("venue_id", input.venueId);
  }

  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "school.account_create",
    entity: "school_admins",
    entity_id: input.venueId,
    meta: { email, venue_id: input.venueId },
  });

  return { ok: true, credentials: { email, password } };
}

/**
 * Issue a new password for an existing school login. This is also how a school
 * "revokes" access from someone who has left: the credential is shared, so the
 * only way to take it off one person is to change it for everyone.
 */
export async function resetSchoolPasswordCore(
  supabase: SupabaseClient<Database>,
  founderId: string,
  userId: string
): Promise<OpResult & { credentials?: Credentials }> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("email,role")
    .eq("id", userId)
    .maybeSingle();
  if (!profile || profile.role !== "school") {
    return { ok: false, error: "That isn't a school account." };
  }

  const password = generatePassword();
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, { password });
  if (error) return { ok: false, error: "Couldn't set a new password." };

  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "school.password_reset",
    entity: "profiles",
    entity_id: userId,
  });

  return { ok: true, credentials: { email: profile.email, password } };
}

/**
 * Delete a school login outright. Nothing owned by the school is touched —
 * pupils belong to the venue, not to this account — so removal is just the
 * profile row, and the `school_admins` link cascades with it.
 */
export async function removeSchoolAccountCore(
  supabase: SupabaseClient<Database>,
  founderId: string,
  userId: string
): Promise<OpResult> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  if (!profile || profile.role !== "school") {
    return { ok: false, error: "That isn't a school account." };
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) return { ok: false, error: "Couldn't remove the login." };

  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "school.account_remove",
    entity: "profiles",
    entity_id: userId,
  });

  return { ok: true };
}
