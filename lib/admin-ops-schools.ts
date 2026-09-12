// School access cores — hand a school the login it signs in with, read that
// login back whenever the founder asks, change it, take it away.
//
// Two things about this domain shape everything below.
//
// The credential is SHARED. Several people at one campus use it, so it can't be
// tied to a person's inbox and it can't be rotated casually — changing it
// changes it for everyone, including whoever is mid-term and depending on it.
// So revealing is a pure read, and rotation is a separate, deliberate act.
//
// The credential is RE-READABLE. Supabase keeps a bcrypt hash, which means the
// plaintext has to be kept somewhere ourselves for the founder to see it a
// second time. It lives encrypted in Supabase Vault; `school_admins` carries
// only the secret's uuid, and `public.school_password()` — founder-only — is
// the single way back to it. See migration 0062 for the full argument.
//
// RLS enforces on the caller's client. The admin client appears only where the
// auth schema has to be written (creating a user, setting a password), which no
// policy can reach.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createAdminClient, hasServiceRoleKey } from "@/lib/supabase/admin";
import type { OpResult } from "@/lib/admin-ops-types";

/** A campus the founder has marked as a school. */
export type SchoolRow = {
  venueId: string;
  name: string;
  unit: string | null;
  /** Live classes on the timetable at this campus — often zero before term
   *  starts, and zero again once every batch has ended. */
  classes: number;
  pupils: number;
  /** The login this campus has. Null until the founder first opens it: a login
   *  is minted on demand, not on the flag (see `openSchoolLoginCore`). */
  account: { userId: string; email: string } | null;
  /** When someone last signed in with these credentials, or null for never —
   *  which covers both "nobody has used it" and "there is nothing to use yet".
   *  The two read the same to the founder, and mean the same thing: the
   *  handover hasn't landed. */
  lastSignInAt: string | null;
};

/** One school's login, as the sheet shows it. */
export type SchoolLogin = {
  userId: string;
  /** The address the school types. Long, minted and not an inbox — but it is
   *  half the credential, so unlike everywhere else it is always shown whole. */
  email: string;
  /** Null when nothing is stored, and only then: an account made before the
   *  vault existed, or one whose save failed. A read that itself failed never
   *  reaches here — see `openSchoolLoginCore` — because the screen's answer to
   *  a blank is a reset, and that is not something to offer over a bad
   *  connection. */
  password: string | null;
  /** False when the password above is real but was not stored — it is on screen
   *  now and will not be here next time. */
  saved: boolean;
  lastSignInAt: string | null;
};

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
 *
 * Two venues are allowed to share a name and unit; two auth users are not
 * allowed to share an email. So the slug alone is a guess, and `suffix` is how
 * the caller makes a second attempt that can't collide — see the retry in
 * `provisionSchoolLogin`. Truncate first and trim hyphens after, or a name long
 * enough to be cut mid-word mints "…something-@schools.sharwin.local".
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

/** The name on a school's account, derived rather than typed — "TISB — Sports
 *  block". Nobody at the school ever sees it, and asking the founder to invent
 *  one was a required field standing between him and the thing he wanted. */
export function schoolAccountName(venue: { name: string; unit: string | null }): string {
  return venue.unit?.trim() ? `${venue.name} — ${venue.unit.trim()}` : venue.name;
}

/**
 * When each school login was last used, keyed by user id.
 *
 * `auth.users.last_sign_in_at` sits in the auth schema, which PostgREST does not
 * expose, so this goes through a definer-rights function (migration 0062)
 * rather than the admin API. One query for every school beats one HTTP call per
 * school on a screen that lists nine of them — and it keeps the Schools page
 * free of the service-role key, which it otherwise wouldn't need at all.
 *
 * A caller the function refuses gets an empty map, not an exception: a missing
 * timestamp costs the founder a nicety, and it must never cost him the list.
 */
async function lastSignInByUser(
  supabase: SupabaseClient<Database>
): Promise<Map<string, string | null>> {
  const { data } = await supabase.rpc("school_last_sign_in");
  const seen = new Map<string, string | null>();
  for (const row of data ?? []) seen.set(row.school_user_id, row.signed_in_at);
  return seen;
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

  const [{ data: classes }, { data: pupils }, { data: links }, signedIn] =
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
        .select("user_id,venue_id,profiles!school_admins_user_id_fkey(email)"),
      lastSignInByUser(supabase),
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
      email: l.profiles?.email ?? "",
    });
  }

  return (venues ?? [])
    .map((v) => {
      const account = accounts.get(v.id) ?? null;
      return {
        venueId: v.id,
        name: v.name,
        unit: v.unit,
        classes: classCounts.get(v.id) ?? 0,
        pupils: pupilCounts.get(v.id) ?? 0,
        account,
        lastSignInAt: account ? signedIn.get(account.userId) ?? null : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Mint the auth user for a campus that doesn't have one yet.
 *
 * The role, the profile and the `school_admins` link are all provisioned by the
 * `handle_new_user` trigger, which reads `school_venue_id` out of user metadata
 * — the same single provisioning path every other account goes through. This
 * function's job is to mint the credential and store it.
 *
 * Nothing is asked of the founder. The account's name comes off the venue and
 * so does its address, and the address is the only one on offer: the "use a
 * real email instead" field went with the create form, taking a validation
 * message and a whole class of collision error with it.
 */
async function provisionSchoolLogin(
  supabase: SupabaseClient<Database>,
  founderId: string,
  venueId: string,
  venue: { name: string; unit: string | null }
): Promise<OpResult & { created?: boolean; login?: SchoolLogin }> {
  // Without this the missing key surfaces as a thrown error out of a server
  // action, which reaches the founder as a blank sheet and nothing else.
  if (!hasServiceRoleKey()) {
    return { ok: false, error: "Logins can't be created from this deployment." };
  }

  const fullName = schoolAccountName(venue);
  const password = generatePassword();
  const admin = createAdminClient();

  // Two venues may legitimately share a name and unit; two auth users may not
  // share an email. There is no manual way out of a collision any more, so the
  // second attempt disambiguates with a slice of the venue id, which is unique
  // by construction.
  const attempts = [
    mintedEmailFor(venue.name, venue.unit),
    mintedEmailFor(venue.name, venue.unit, venueId.slice(0, 4)),
  ];

  let email = attempts[0];
  let created: Awaited<ReturnType<typeof admin.auth.admin.createUser>>["data"] | null = null;
  let lastError = "";
  for (const candidate of attempts) {
    const { data, error } = await admin.auth.admin.createUser({
      email: candidate,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName, school_venue_id: venueId },
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
    return {
      ok: false,
      error: /already|registered|exists/i.test(lastError)
        ? "An account already uses that address. Rename the campus and try again."
        : "Couldn't create the login.",
    };
  }
  const userId = created.user.id;

  // The trigger owns provisioning, but a link row missing here would leave a
  // school account that can see nothing at all — so confirm it landed and
  // repair it rather than hand over a credential that opens an empty app.
  const { data: link } = await admin
    .from("school_admins")
    .select("user_id")
    .eq("user_id", userId)
    .eq("venue_id", venueId)
    .maybeSingle();
  if (!link) {
    await admin
      .from("school_admins")
      .insert({ user_id: userId, venue_id: venueId, created_by: founderId });
  } else {
    await admin
      .from("school_admins")
      .update({ created_by: founderId })
      .eq("user_id", userId)
      .eq("venue_id", venueId);
  }

  // Stored on the same client that set it, so both halves of "the password is
  // now this" travel together. If the store fails the account still works and
  // the plaintext is still in hand — so hand it over and say it wasn't saved,
  // rather than delete a working login over a bookkeeping failure.
  const saved = await storePassword(admin, userId, password);

  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "school.account_create",
    entity: "school_admins",
    entity_id: venueId,
    meta: { email, venue_id: venueId },
  });

  return {
    ok: true,
    created: true,
    login: { userId, email, password, saved, lastSignInAt: null },
  };
}

/** Put the plaintext in the vault. Returns whether it landed — and it really
 *  does mean landed: since 0063 the function refuses a user with no
 *  `school_admins` row rather than quietly storing nothing and returning as if
 *  it had. */
async function storePassword(
  client: SupabaseClient<Database>,
  userId: string,
  password: string
): Promise<boolean> {
  const { error } = await client.rpc("set_school_password", {
    p_user: userId,
    p_password: password,
  });
  return !error;
}

/**
 * Open a school's login: the one thing the row's tap does.
 *
 * There is no "create login" any more — a campus marked as a school HAS a
 * login, and this is what makes that true. Provisioning happens here rather
 * than when the venue flag flips, for three reasons. It is the only moment a
 * failure has somewhere to be read (a server action behind a sheet, not a
 * background write during a page render). It keeps the flag reversible: a
 * campus flagged and unflagged in the same sitting never mints an account, so
 * `saveVenueCore`'s refusal to unflag a school that still has a login only
 * fires for schools he has actually handed over. And it means the first render
 * of the tab doesn't sit through nine account creations to show a list.
 *
 * Reading does not rotate. The founder asked for this in as many words: he
 * wants to open a school and see the password he already sent, because several
 * people at that school are using it and a fresh one would lock them all out.
 */
export async function openSchoolLoginCore(
  supabase: SupabaseClient<Database>,
  founderId: string,
  venueId: string
): Promise<OpResult & { created?: boolean; login?: SchoolLogin }> {
  const { data: venue } = await supabase
    .from("venues")
    .select("name,unit,is_school")
    .eq("id", venueId)
    .maybeSingle();
  if (!venue) return { ok: false, error: "That venue doesn't exist." };
  if (!venue.is_school) {
    return { ok: false, error: "That campus isn't marked as a school any more." };
  }

  // A list, not maybeSingle(): the table is keyed on (user_id, venue_id), so a
  // campus may already carry more than one row, and maybeSingle() answers two
  // rows with an error and a null — which this would read as "no login yet" and
  // mint a third.
  const { data: existing } = await supabase
    .from("school_admins")
    .select("user_id,profiles!school_admins_user_id_fkey(email)")
    .eq("venue_id", venueId)
    .limit(1);

  const row = existing?.[0];
  if (!row) return provisionSchoolLogin(supabase, founderId, venueId, venue);

  const [{ data: password, error: readError }, signedIn] = await Promise.all([
    supabase.rpc("school_password", { p_user: row.user_id }),
    lastSignInByUser(supabase),
  ]);

  // A read that FAILED and a vault with nothing in it both arrive as null, and
  // only one of them has a safe answer. The screen's answer to "nothing saved"
  // is the reset — the one action here that takes the password away from every
  // person at that campus, mid-term. So a dropped connection, an expired token
  // or a decryption failure must never be dressed up as an empty vault: it
  // would walk the founder into locking out a school whose password was
  // sitting safely in the vault the whole time. Say we couldn't read it, and
  // let him try again — which is the actual remedy for all three.
  //
  // It catches a wiring fault too. `school_password` refuses the service key by
  // design, so a caller that reached here on the admin client used to be told
  // there was no password saved, over and over, for every school.
  if (readError) {
    return { ok: false, error: "Couldn't read this school's password." };
  }

  return {
    ok: true,
    login: {
      userId: row.user_id,
      email: row.profiles?.email ?? "",
      password: password ?? null,
      // It came out of the vault, so by definition it is in the vault. Null
      // here is now only ever the honest blank — the read worked and there was
      // nothing to read — and the screen says so plainly.
      saved: password !== null,
      lastSignInAt: signedIn.get(row.user_id) ?? null,
    },
  };
}

/**
 * Issue a new password for an existing school login.
 *
 * Deliberately separate from opening one, and deliberately quiet in the UI:
 * this is the only action here that takes access away from someone. The
 * credential is shared, so it is also the only way to cut off a coordinator who
 * has left — at the cost of everyone else at the school having to be told the
 * new one.
 */
export async function resetSchoolPasswordCore(
  supabase: SupabaseClient<Database>,
  founderId: string,
  userId: string
): Promise<OpResult & { login?: SchoolLogin }> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("email,role")
    .eq("id", userId)
    .maybeSingle();
  if (!profile || profile.role !== "school") {
    return { ok: false, error: "That isn't a school account." };
  }
  if (!hasServiceRoleKey()) {
    return { ok: false, error: "Passwords can't be changed from this deployment." };
  }

  const password = generatePassword();
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, { password });
  if (error) return { ok: false, error: "Couldn't set a new password." };

  const saved = await storePassword(admin, userId, password);
  const signedIn = await lastSignInByUser(supabase);

  await supabase.from("audit_log").insert({
    actor_id: founderId,
    action: "school.password_reset",
    entity: "profiles",
    entity_id: userId,
  });

  return {
    ok: true,
    login: {
      userId,
      email: profile.email,
      password,
      saved,
      lastSignInAt: signedIn.get(userId) ?? null,
    },
  };
}

/**
 * Delete a school login outright. Nothing owned by the school is touched —
 * pupils belong to the venue, not to this account — so removal is just the
 * profile row, and the `school_admins` link cascades with it.
 *
 * The vault secret goes first. Deleting the auth user cascades through profiles
 * to `school_admins`, taking with it the only row that names the secret; clear
 * it while that row still exists or it is stranded in the vault forever.
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
  if (!hasServiceRoleKey()) {
    return { ok: false, error: "Logins can't be removed from this deployment." };
  }

  const admin = createAdminClient();
  await admin.rpc("clear_school_password", { p_user: userId });

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
