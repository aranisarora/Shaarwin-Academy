// Whether a venue is a school is a property of the venue now (migration 0059),
// not something guessed from the classes that happen to run at it.
//
// The old derivation read `classes` where is_school and collapsed by venue, and
// it was wrong three ways at once: a campus signed but not yet timetabled was
// invisible, one session published as an ordinary Group class dropped the whole
// school off the list, and deleting a school's last class took its row away
// while the login carried on working with nowhere left to revoke it. Each of
// those has a case below.
//
// The pupil count is here for a different reason. It is a number the founder
// reads and then repeats to a head teacher, so it has to agree with what the
// school sees when it logs in — which is decided by RLS (`school_has_player`),
// not by this query. One case pins the two together.
//
// The rest of the file is the credential itself (migration 0062). A school's
// password is shared by several people and has to be re-readable, so it is kept
// encrypted in Supabase Vault rather than thrown away — and "kept" is a claim
// that has to be proved, in both directions: it must survive a second look
// unchanged, it must change when the founder deliberately resets it, and it
// must not be readable by anyone who is not him.
//
// Two of those cases are about a null, because null is where this gets
// dangerous. "We couldn't read it" and "there is nothing to read" arrive the
// same way and the screen answers one of them with a reset, so they are pinned
// apart here — and so is the write that used to report a save it had not made.

import { describe, it, expect, beforeAll } from "vitest";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../lib/database.types";
import { admin, asUser } from "../../e2e/lib/supabase";
import { SUPABASE_URL, ANON_KEY } from "../../e2e/lib/env";
import {
  addSchoolPupil,
  createClient,
  createSchool,
  createSchoolAdmin,
  type CreatedSchool,
} from "../../e2e/lib/scenario";
import {
  listSchoolsCore,
  mintedEmailFor,
  openSchoolLoginCore,
  removeSchoolAccountCore,
  resetSchoolPasswordCore,
  schoolAccountName,
} from "../../lib/admin-ops-schools";
import { saveVenueCore } from "../../lib/admin-ops-venues";
import { SEED } from "../../e2e/lib/scenario";

/** The cores take the app's typed client; the harness hands out an untyped
 *  service-role one. Same object, and RLS is not what most cases are about. */
const founderClient = () => admin() as unknown as SupabaseClient<Database>;

/**
 * A client signed in as the seeded founder. Reading a stored password is
 * founder-only by design — the service key is refused too, deliberately, so the
 * plaintext sits behind a person rather than behind a deployment secret. Any
 * case that reads one has to come through here.
 */
const founderAuth = async () =>
  (await asUser("founder@sharwin.example")) as unknown as SupabaseClient<Database>;

/** Does this email and password actually open the door? Signing in is the only
 *  test of a password that can't be fooled by our own bookkeeping — and it is
 *  also what stamps `last_sign_in_at`, which the founder's screen reads back. */
async function canSignIn(email: string, password: string): Promise<boolean> {
  const client = createSupabaseClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  return !error;
}

async function markAsSchool(venueId: string): Promise<void> {
  const { error } = await admin().from("venues").update({ is_school: true }).eq("id", venueId);
  if (error) throw new Error(`markAsSchool: ${error.message}`);
}

async function bareVenue(name: string): Promise<string> {
  const { data, error } = await admin()
    .from("venues")
    .insert({
      name,
      address: `${name}, Bengaluru, Karnataka`,
      postcode: "560103",
      lat: 12.93,
      lng: 77.68,
      is_school: true,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`bareVenue: ${error?.message}`);
  return data.id as string;
}

let signedNotTimetabled: string;
let flagged: CreatedSchool;
let unflagged: CreatedSchool;
let publishedAsGroup: CreatedSchool;

beforeAll(async () => {
  // A campus we've signed and marked as a school, with nothing on the timetable
  // yet — the TISB case that used to be invisible.
  signedNotTimetabled = await bareVenue(`Signed Not Timetabled ${Date.now()}`);

  flagged = await createSchool({ name: "Flagged Campus" });
  await markAsSchool(flagged.venueId);

  // Runs school classes but nobody said it was a school. The flag is the whole
  // answer now, so it must not appear.
  unflagged = await createSchool({ name: "Unflagged Campus" });

  // Flagged, but its only class got published as an ordinary Group class. The
  // old derivation lost the entire school over this.
  publishedAsGroup = await createSchool({ name: "Group Published Campus" });
  await markAsSchool(publishedAsGroup.venueId);
  await admin().from("classes").update({ is_school: false }).eq("id", publishedAsGroup.classId);
});

describe("listSchoolsCore reads the venue flag", () => {
  it("lists a school that has no classes and no pupils yet", async () => {
    const rows = await listSchoolsCore(founderClient());
    const row = rows.find((r) => r.venueId === signedNotTimetabled);
    expect(row).toBeDefined();
    expect(row?.classes).toBe(0);
    expect(row?.pupils).toBe(0);
    // No login until the founder opens it, and no sign-in either — which is the
    // line his screen shows, in both cases, as "Never signed in".
    expect(row?.account).toBeNull();
    expect(row?.lastSignInAt).toBeNull();
  });

  it("keeps a school whose class was published as an ordinary Group class", async () => {
    const rows = await listSchoolsCore(founderClient());
    const row = rows.find((r) => r.venueId === publishedAsGroup.venueId);
    expect(row).toBeDefined();
    expect(row?.classes).toBe(1);
  });

  it("leaves out a campus nobody marked as a school, school classes or not", async () => {
    const rows = await listSchoolsCore(founderClient());
    expect(rows.map((r) => r.venueId)).not.toContain(unflagged.venueId);
  });

  it("counts the campus's classes", async () => {
    const rows = await listSchoolsCore(founderClient());
    const row = rows.find((r) => r.venueId === flagged.venueId);
    expect(row?.classes).toBe(1);
  });
});

describe("the pupil count the founder reads", () => {
  it("matches what the school itself can see", async () => {
    await addSchoolPupil({ school: flagged, fullName: "Ananya R", grade: 7 });
    await addSchoolPupil({ school: flagged, fullName: "Dev S", grade: 8 });

    // A private client's child who is also tagged to this campus. RLS hides
    // them from the school (`school_has_player` requires client_id is null), so
    // counting them here would have the founder quoting a number the head
    // teacher can never reconcile.
    const parent = await createClient({ children: 1 });
    await admin()
      .from("players")
      .update({ school_venue_id: flagged.venueId })
      .eq("id", parent.playerIds[0]);

    const head = await createSchoolAdmin({ venueId: flagged.venueId });
    const school = await asUser(head.email);
    const { data: visible } = await school.from("players").select("id");

    const rows = await listSchoolsCore(founderClient());
    const row = rows.find((r) => r.venueId === flagged.venueId);

    expect(row?.pupils).toBe(2);
    expect(row?.pupils).toBe(visible?.length);
  });

  it("still manages the login of a school with nothing on its timetable", async () => {
    // The stranded case: the row is there, so the account is reachable.
    const head = await createSchoolAdmin({ venueId: signedNotTimetabled });
    const rows = await listSchoolsCore(founderClient());
    const row = rows.find((r) => r.venueId === signedNotTimetabled);
    expect(row?.classes).toBe(0);
    expect(row?.account?.userId).toBe(head.id);
  });
});

describe("un-marking a school", () => {
  it("is refused while the campus still has a login to manage", async () => {
    const venueId = await bareVenue(`Second Thoughts ${Date.now()}`);
    await createSchoolAdmin({ venueId });

    const r = await saveVenueCore(founderClient(), SEED.founder, {
      id: venueId,
      name: "Second Thoughts",
      address: "Second Thoughts, Bengaluru, Karnataka",
      postcode: "560103",
      lat: 12.93,
      lng: 77.68,
      isSchool: false,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Schools tab");

    const { data: after } = await admin()
      .from("venues")
      .select("is_school")
      .eq("id", venueId)
      .maybeSingle();
    expect(after?.is_school).toBe(true);
  });

  it("goes through for a campus nobody ever opened", async () => {
    // The reason a login is minted when the founder opens a school, not when he
    // flips the flag: a campus he marked and thought better of the same morning
    // has no account to strand, so the guard above never fires on it.
    const venueId = await bareVenue(`Clean Exit ${Date.now()}`);
    const r = await saveVenueCore(founderClient(), SEED.founder, {
      id: venueId,
      name: "Clean Exit",
      address: "Clean Exit, Bengaluru, Karnataka",
      postcode: "560103",
      lat: 12.93,
      lng: 77.68,
      isSchool: false,
    });
    expect(r.ok).toBe(true);

    const rows = await listSchoolsCore(founderClient());
    expect(rows.map((s) => s.venueId)).not.toContain(venueId);
  });

  it("leaves the flag alone when the caller doesn't mention it", async () => {
    // The WhatsApp tool edits an address and knows nothing about schools; a
    // bare update must not quietly demote a campus.
    const r = await saveVenueCore(founderClient(), SEED.founder, {
      id: signedNotTimetabled,
      name: "Signed Not Timetabled",
      address: "Somewhere else, Bengaluru, Karnataka",
      postcode: "560037",
      lat: 12.95,
      lng: 77.7,
    });
    expect(r.ok).toBe(true);

    const { data: after } = await admin()
      .from("venues")
      .select("is_school")
      .eq("id", signedNotTimetabled)
      .maybeSingle();
    expect(after?.is_school).toBe(true);
  });
});

describe("the address a school is given", () => {
  it("never ends in a hyphen, however long the name", () => {
    const email = mintedEmailFor(
      "The International School Bangalore Whitefield",
      "Senior sports block"
    );
    expect(email.split("@")[0]).not.toMatch(/-$/);
    expect(email.endsWith("@schools.sharwin.local")).toBe(true);
  });

  it("falls back to something usable when the name has no letters at all", () => {
    expect(mintedEmailFor("!!!", null)).toBe("school@schools.sharwin.local");
  });

  it("takes the venue's name and unit, and the account's name with it", () => {
    expect(mintedEmailFor("TISB", "Sports block")).toBe(
      "tisb-sports-block@schools.sharwin.local"
    );
    expect(schoolAccountName({ name: "TISB", unit: "Sports block" })).toBe(
      "TISB — Sports block"
    );
    expect(schoolAccountName({ name: "TISB", unit: null })).toBe("TISB");
  });
});

describe("opening a school's login", () => {
  it("mints one on the first open, and hands back the same one after that", async () => {
    const venueId = await bareVenue(`First Open ${Date.now()}`);
    const founder = await founderAuth();

    const first = await openSchoolLoginCore(founder, SEED.founder, venueId);
    expect(first.ok).toBe(true);
    expect(first.created).toBe(true);
    expect(first.login?.email).toMatch(/@schools\.sharwin\.local$/);
    expect(first.login?.password).toBeTruthy();
    expect(first.login?.saved).toBe(true);
    expect(first.login?.lastSignInAt).toBeNull();

    // The second open is a read. Nothing is created, nothing is rotated — this
    // is the whole point of the rework: the founder can look the password up as
    // often as he likes without locking the school out of its own account.
    const second = await openSchoolLoginCore(founder, SEED.founder, venueId);
    expect(second.ok).toBe(true);
    expect(second.created).toBeUndefined();
    expect(second.login?.userId).toBe(first.login?.userId);
    expect(second.login?.password).toBe(first.login?.password);

    // And it is the live password, not a copy of one we threw away.
    expect(await canSignIn(second.login!.email, second.login!.password!)).toBe(true);
  });

  it("mints a second address when two campuses share a name", async () => {
    // Nothing stops two venues being called the same thing; `auth.users.email`
    // is unique regardless. With no address field left anywhere in the UI, the
    // retry is the only thing standing between the founder and a dead end.
    const shared = `Twin Campus ${Date.now()}`;
    const first = await bareVenue(shared);
    const second = await bareVenue(shared);

    const a = await openSchoolLoginCore(founderClient(), SEED.founder, first);
    const b = await openSchoolLoginCore(founderClient(), SEED.founder, second);

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(a.login?.email).not.toBe(b.login?.email);
    expect(b.login?.email).toMatch(/@schools\.sharwin\.local$/);

    // Both really exist and are wired to their own campus.
    const rows = await listSchoolsCore(founderClient());
    expect(rows.find((r) => r.venueId === first)?.account).not.toBeNull();
    expect(rows.find((r) => r.venueId === second)?.account).not.toBeNull();
  });

  it("refuses a campus that isn't marked as a school", async () => {
    const venueId = await bareVenue(`Demoted ${Date.now()}`);
    await admin().from("venues").update({ is_school: false }).eq("id", venueId);

    const r = await openSchoolLoginCore(founderClient(), SEED.founder, venueId);
    expect(r.ok).toBe(false);
    // No account was minted for a campus that has left the tab.
    const { data: links } = await admin()
      .from("school_admins")
      .select("user_id")
      .eq("venue_id", venueId);
    expect(links ?? []).toHaveLength(0);
  });
});

describe("the password the founder can read back", () => {
  it("survives a reveal unchanged, and changes only on a reset", async () => {
    const venueId = await bareVenue(`Rotation ${Date.now()}`);
    const founder = await founderAuth();

    const opened = await openSchoolLoginCore(founder, SEED.founder, venueId);
    const { userId, email, password: original } = opened.login!;

    // Reveal, twice more. Reading is a read.
    for (let i = 0; i < 2; i++) {
      const again = await openSchoolLoginCore(founder, SEED.founder, venueId);
      expect(again.login?.password).toBe(original);
    }
    expect(await canSignIn(email, original!)).toBe(true);

    // Reset is the deliberate act, and it really does take the old one away.
    const reset = await resetSchoolPasswordCore(founder, SEED.founder, userId);
    expect(reset.ok).toBe(true);
    expect(reset.login?.password).not.toBe(original);
    expect(reset.login?.saved).toBe(true);
    expect(await canSignIn(email, original!)).toBe(false);
    expect(await canSignIn(email, reset.login!.password!)).toBe(true);

    // And the new one is what a later open hands back — the vault was updated,
    // not left holding the password the school can no longer use.
    const after = await openSchoolLoginCore(founder, SEED.founder, venueId);
    expect(after.login?.password).toBe(reset.login?.password);
  });

  it("is refused to everyone but the founder", async () => {
    const venueId = await bareVenue(`Private ${Date.now()}`);
    const founder = await founderAuth();
    const opened = await openSchoolLoginCore(founder, SEED.founder, venueId);
    const userId = opened.login!.userId;

    // A parent. The plaintext of a school's shared credential is not theirs.
    const parent = await createClient({ children: 1 });
    const asParent = await asUser(parent.email);
    const parentRead = await asParent.rpc("school_password", { p_user: userId });
    expect(parentRead.error).not.toBeNull();

    // The school itself — it already knows its own password, but a definer
    // function that leaks one school's credential leaks every school's.
    const school = await asUser(opened.login!.email, opened.login!.password!);
    const schoolRead = await school.rpc("school_password", { p_user: userId });
    expect(schoolRead.error).not.toBeNull();

    // And the service key, deliberately: it is the key our own servers carry,
    // and refusing it keeps the plaintext behind a person.
    const serviceRead = await admin().rpc("school_password", { p_user: userId });
    expect(serviceRead.error).not.toBeNull();

    // The founder, meanwhile, still gets it.
    const founderRead = await founder.rpc("school_password", { p_user: userId });
    expect(founderRead.error).toBeNull();
    expect(founderRead.data).toBe(opened.login!.password);
  });

  it("comes back after being cleared, rather than colliding with its own ghost", async () => {
    // `vault.secrets.name` is unique and derived from the user id, so a clear
    // that only nulled the pointer would leave a secret nobody could replace —
    // and the founder would be stuck on a school that can never be reset.
    const venueId = await bareVenue(`Cleared ${Date.now()}`);
    const founder = await founderAuth();
    const opened = await openSchoolLoginCore(founder, SEED.founder, venueId);
    const userId = opened.login!.userId;

    const cleared = await admin().rpc("clear_school_password", { p_user: userId });
    expect(cleared.error).toBeNull();

    const { data: row } = await admin()
      .from("school_admins")
      .select("password_secret_id")
      .eq("user_id", userId)
      .maybeSingle();
    expect(row?.password_secret_id).toBeNull();

    // The screen's honest blank: an account with no password saved for it.
    const blank = await openSchoolLoginCore(founder, SEED.founder, venueId);
    expect(blank.login?.password).toBeNull();
    expect(blank.login?.saved).toBe(false);

    const reset = await resetSchoolPasswordCore(founder, SEED.founder, userId);
    expect(reset.ok).toBe(true);
    expect(reset.login?.saved).toBe(true);
    expect(await canSignIn(opened.login!.email, reset.login!.password!)).toBe(true);
  });

  it("says it couldn't read one, rather than that there isn't one", async () => {
    // The two arrive identically — null — and only one of them has a safe
    // answer. The screen's answer to "nothing saved" is the reset, and a reset
    // takes the password off everyone at that campus. So a read that merely
    // FAILED must never come back wearing the empty vault's clothes, or a
    // dropped connection walks the founder into locking out a school whose
    // password was in the vault the whole time.
    //
    // The service key is the failure we can stage on purpose: `school_password`
    // refuses it by design, which also makes this the wiring fault the swallow
    // used to hide — every school reading "no password saved", forever.
    const venueId = await bareVenue(`Unreadable ${Date.now()}`);
    const founder = await founderAuth();
    const opened = await openSchoolLoginCore(founder, SEED.founder, venueId);
    expect(opened.login?.password).toBeTruthy();

    const refused = await openSchoolLoginCore(founderClient(), SEED.founder, venueId);
    expect(refused.ok).toBe(false);
    expect(refused.login).toBeUndefined();

    // And nothing was rotated to get that answer: the password he already sent
    // is still the password.
    const again = await openSchoolLoginCore(founder, SEED.founder, venueId);
    expect(again.login?.password).toBe(opened.login?.password);
    expect(again.login?.saved).toBe(true);
  });

  it("refuses to be saved against a login that no longer exists", async () => {
    // The UPDATE used to touch zero rows and the function returned happily, so
    // the founder was told the password was saved while the next open read back
    // nothing — and a secret nobody could reach was banked in the vault. Both
    // halves are asserted here: the write fails, and a reset that ran into it
    // admits the password is his only copy.
    const venueId = await bareVenue(`No Link Row ${Date.now()}`);
    const founder = await founderAuth();
    const opened = await openSchoolLoginCore(founder, SEED.founder, venueId);
    const userId = opened.login!.userId;

    // The auth user and its 'school' profile survive; only the link row goes —
    // which is all `resetSchoolPasswordCore` ever checks for.
    await admin().rpc("clear_school_password", { p_user: userId });
    const { error: unlinked } = await admin()
      .from("school_admins")
      .delete()
      .eq("user_id", userId);
    expect(unlinked).toBeNull();

    const { error } = await admin().rpc("set_school_password", {
      p_user: userId,
      p_password: "orchid-willow-1234",
    });
    expect(error).not.toBeNull();

    const reset = await resetSchoolPasswordCore(founder, SEED.founder, userId);
    expect(reset.ok).toBe(true);
    expect(reset.login?.password).toBeTruthy();
    expect(reset.login?.saved).toBe(false);
    // The new password is real even though we couldn't keep it — which is why
    // the screen says "send it now" rather than pretending nothing happened.
    expect(await canSignIn(opened.login!.email, reset.login!.password!)).toBe(true);
  });

  it("goes when the login goes", async () => {
    const venueId = await bareVenue(`Removed ${Date.now()}`);
    const founder = await founderAuth();
    const opened = await openSchoolLoginCore(founder, SEED.founder, venueId);
    const userId = opened.login!.userId;

    const r = await removeSchoolAccountCore(founder, SEED.founder, userId);
    expect(r.ok).toBe(true);

    const { data: links } = await admin()
      .from("school_admins")
      .select("user_id")
      .eq("venue_id", venueId);
    expect(links ?? []).toHaveLength(0);
    expect(await canSignIn(opened.login!.email, opened.login!.password!)).toBe(false);
  });
});

describe("when a school last signed in", () => {
  it("reads never until someone actually uses the credentials", async () => {
    const venueId = await bareVenue(`Handover ${Date.now()}`);
    const founder = await founderAuth();
    const opened = await openSchoolLoginCore(founder, SEED.founder, venueId);

    const before = await listSchoolsCore(founderClient());
    expect(before.find((r) => r.venueId === venueId)?.lastSignInAt).toBeNull();

    expect(await canSignIn(opened.login!.email, opened.login!.password!)).toBe(true);

    const after = await listSchoolsCore(founderClient());
    const stamp = after.find((r) => r.venueId === venueId)?.lastSignInAt;
    expect(stamp).toBeTruthy();
    expect(Date.now() - new Date(stamp!).getTime()).toBeLessThan(120_000);

    // The sheet reads it too, so the founder sees the same answer wherever he
    // is standing.
    const reopened = await openSchoolLoginCore(founder, SEED.founder, venueId);
    expect(reopened.login?.lastSignInAt).toBe(stamp);
  });

  it("tells nobody but the founder and our own servers", async () => {
    const parent = await createClient({ children: 1 });
    const asParent = await asUser(parent.email);
    const { error } = await asParent.rpc("school_last_sign_in");
    expect(error).not.toBeNull();
  });
});
