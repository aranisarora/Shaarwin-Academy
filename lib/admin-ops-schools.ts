// School access cores — create the login a school signs in with, reset it, and
// take it away again. RLS enforces on the caller's client; the admin client is
// used only where the auth schema has to be written (creating a user, setting a
// password), which no RLS policy can reach.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import type { OpResult } from "@/lib/admin-ops-types";

/** A campus the founder has marked as a school, with whatever login it has. */
export type SchoolRow = {
  venueId: string;
  name: string;
  unit: string | null;
  /** Live classes on the timetable at this campus — often zero before term
   *  starts, and zero again once every batch has ended. */
  classes: number;
  pupils: number;
  account: { userId: string; fullName: string; email: string } | null;
  /** The address this school would most likely be given if a login were created
   *  now — the founder is about to hand it over, so the sheet shows it before he
   *  commits. Only "most likely": two campuses may share a name, and the second
   *  one to ask collides and is given a suffixed address instead. That is why
   *  the sheet says "something like" and the handover screen states the address
   *  that was actually minted. */
  mintedEmail: string;
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
 *
 * Two venues are allowed to share a name and unit; two auth users are not
 * allowed to share an email. So the slug alone is a guess, and `suffix` is how
 * the caller makes a second attempt that can't collide — see the retry in
 * `createSchoolAccountCore`. Truncate first and trim hyphens after, or a name
 * long enough to be cut mid-word mints "…something-@schools.sharwin.local".
 */
export function mintedEmailFor(
  venueName: string,
  unit: string | null,
  suffix?: string
): string {
  const slug =
    [venueName, unit]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 48)
      .replace(/^-+|-+$/g, "") || "school";
  return `${suffix ? `${slug}-${suffix}` : slug}@schools.sharwin.local`;
}

/**
 * Every campus the founder has marked as a school, with its class count, its
 * pupil count and its login. Founder-only by RLS on all four tables.
 *
 * The venue flag is the source of truth (migration 0059). This used to be read
 * off `classes` where is_school, collapsed by venue, and that derivation was
 * wrong in three ways at once: a campus we'd signed but not timetabled yet was
 * invisible, a session published as an ordinary Group class dropped its whole
 * school off the list, and deleting a school's last class took the row away
 * while leaving the login working with nowhere to revoke it. Reading the flag
 * and left-joining the rest fixes all three, at the cost of a row that
 * sometimes says "no classes yet" — which is the truth, and actionable.
 */
export async function listSchoolsCore(
  supabase: SupabaseClient<Database>
): Promise<SchoolRow[]> {
  // The flagged venues come first because the counts are scoped to them — there
  // is no reason to pull every class row in the database to count the handful
  // that belong to a school.
  const { data: venues } = await supabase
    .from("venues")
    .select("id,name,unit")
    .eq("is_school", true)
    .order("name");
  const venueIds = (venues ?? []).map((v) => v.id);
  if (venueIds.length === 0) return [];

  const [{ data: classes }, { data: pupils }, { data: links }] =
    await Promise.all([
      // `active` is the difference between "6 classes" and the truth: a campus
      // whose batches have all ended still has its rows, and without this filter
      // the row would keep claiming a live timetable long after the last session.
      supabase
        .from("classes")
        .select("venue_id")
        .in("venue_id", venueIds)
        .eq("active", true),
      // `client_id is null` is not decoration: it is the same test the school's
      // own RLS applies (`school_has_player`). Without it a private client's
      // child who attends a school session would be counted here and nowhere
      // else, and the founder's number would quietly exceed what the school can
      // actually see when it logs in.
      supabase
        .from("players")
        .select("school_venue_id")
        .not("school_venue_id", "is", null)
        .is("client_id", null),
      // Hinted: school_admins points at profiles twice (user_id and created_by),
      // so an unqualified embed is ambiguous.
      supabase
        .from("school_admins")
        .select("user_id,venue_id,profiles!school_admins_user_id_fkey(full_name,email)"),
    ]);

  const classCounts = new Map<string, number>();
  for (const c of classes ?? []) {
    const id = c.venue_id;
    if (id) classCounts.set(id, (classCounts.get(id) ?? 0) + 1);
  }

  const pupilCounts = new Map<string, number>();
  for (const p of pupils ?? []) {
    const id = p.school_venue_id;
    if (id) pupilCounts.set(id, (pupilCounts.get(id) ?? 0) + 1);
  }

  const accounts = new Map<string, SchoolRow["account"]>();
  for (const l of links ?? []) {
    accounts.set(l.venue_id, {
      userId: l.user_id,
      fullName: l.profiles?.full_name ?? "",
      email: l.profiles?.email ?? "",
    });
  }

  return (venues ?? [])
    .map((v) => ({
      venueId: v.id,
      name: v.name,
      unit: v.unit,
      classes: classCounts.get(v.id) ?? 0,
      pupils: pupilCounts.get(v.id) ?? 0,
      account: accounts.get(v.id) ?? null,
      mintedEmail: mintedEmailFor(v.name, v.unit),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The name on a school's account, derived rather than typed — "TISB — Sports
 *  block". Nobody at the school ever sees it, and asking the founder to invent
 *  one was a required field standing between him and the thing he wanted. */
export function schoolAccountName(venue: { name: string; unit: string | null }): string {
  return venue.unit?.trim() ? `${venue.name} — ${venue.unit.trim()}` : venue.name;
}

/**
 * Create the school's login.
 *
 * The role, the profile and the `school_admins` link are all provisioned by the
 * `handle_new_user` trigger, which reads `school_venue_id` out of user metadata
 * — the same single provisioning path every other account goes through. This
 * function's job is to mint the credential and hand it back once.
 *
 * Nothing is required of the caller but the venue. The account's name comes off
 * the venue, and so does its address unless a real one is supplied — a school
 * that insists on its own inbox is the exception, not the shape of the form.
 */
export async function createSchoolAccountCore(
  supabase: SupabaseClient<Database>,
  founderId: string,
  input: { venueId: string; email?: string }
): Promise<OpResult & { credentials?: Credentials }> {
  const { data: venue } = await supabase
    .from("venues")
    .select("name,unit")
    .eq("id", input.venueId)
    .maybeSingle();
  if (!venue) return { ok: false, error: "That venue doesn't exist." };

  // A list, not maybeSingle(): the table is keyed on (user_id, venue_id), so a
  // campus may already carry more than one row, and maybeSingle() answers two
  // rows with an error and a null — which this would read as "no login yet" and
  // mint a third. Asking for one row means the messier the state, the firmer the
  // refusal.
  const { data: taken } = await supabase
    .from("school_admins")
    .select("user_id")
    .eq("venue_id", input.venueId)
    .limit(1);
  if (taken && taken.length > 0) {
    return { ok: false, error: "That school already has a login." };
  }

  const fullName = schoolAccountName(venue);
  const override = input.email?.trim().toLowerCase() || null;
  if (override && !EMAIL_RE.test(override)) {
    return { ok: false, error: "That email doesn't look valid." };
  }

  // Two venues may legitimately share a name and unit; two auth users may not
  // share an email. With the override field gone from the sheet there is no
  // manual way out of a collision, so the second attempt disambiguates with a
  // slice of the venue id — which is unique by construction.
  const password = generatePassword();
  const admin = createAdminClient();
  const attempts = override
    ? [override]
    : [
        mintedEmailFor(venue.name, venue.unit),
        mintedEmailFor(venue.name, venue.unit, input.venueId.slice(0, 4)),
      ];

  let email = attempts[0];
  let created: Awaited<ReturnType<typeof admin.auth.admin.createUser>>["data"] | null = null;
  let lastError: string | null = null;
  for (const candidate of attempts) {
    const { data, error } = await admin.auth.admin.createUser({
      email: candidate,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName, school_venue_id: input.venueId },
    });
    if (!error && data.user) {
      email = candidate;
      created = data;
      break;
    }
    lastError = error?.message ?? "";
    // Anything that isn't a duplicate won't be fixed by a different address.
    if (!/already|registered|exists/i.test(lastError)) break;
  }

  if (!created?.user) {
    const duplicate = /already|registered|exists/i.test(lastError ?? "");
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
