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
// not by this query. The last case pins the two together.

import { describe, it, expect, beforeAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../lib/database.types";
import { admin, asUser } from "../../e2e/lib/supabase";
import {
  addSchoolPupil,
  createClient,
  createSchool,
  createSchoolAdmin,
  type CreatedSchool,
} from "../../e2e/lib/scenario";
import {
  createSchoolAccountCore,
  listSchoolsCore,
  mintedEmailFor,
  schoolAccountName,
} from "../../lib/admin-ops-schools";
import { saveVenueCore } from "../../lib/admin-ops-venues";
import { SEED } from "../../e2e/lib/scenario";

/** The cores take the app's typed client; the harness hands out an untyped
 *  service-role one. Same object, and RLS is not what these cases are about. */
const founderClient = () => admin() as unknown as SupabaseClient<Database>;

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
    expect(row?.account).toBeNull();
    // The sheet shows this before the founder commits, so it has to be there.
    expect(row?.mintedEmail).toMatch(/@schools\.sharwin\.local$/);
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

  it("goes through once the login is gone", async () => {
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

describe("creating a login without typing anything", () => {
  it("mints a second address when two campuses share a name", async () => {
    // Nothing stops two venues being called the same thing; `auth.users.email`
    // is unique regardless. With the override field gone from the sheet, the
    // retry is the only thing standing between the founder and a dead end.
    const shared = `Twin Campus ${Date.now()}`;
    const first = await bareVenue(shared);
    const second = await bareVenue(shared);

    const a = await createSchoolAccountCore(founderClient(), SEED.founder, {
      venueId: first,
    });
    const b = await createSchoolAccountCore(founderClient(), SEED.founder, {
      venueId: second,
    });

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(a.credentials?.email).not.toBe(b.credentials?.email);
    expect(b.credentials?.email).toMatch(/@schools\.sharwin\.local$/);

    // Both really exist and are wired to their own campus.
    const rows = await listSchoolsCore(founderClient());
    expect(rows.find((r) => r.venueId === first)?.account).not.toBeNull();
    expect(rows.find((r) => r.venueId === second)?.account).not.toBeNull();
  });

  it("takes a real address when the school insists on one", async () => {
    const venueId = await bareVenue(`Insistent School ${Date.now()}`);
    const real = `sports+${Date.now()}@insistent.example`;
    const r = await createSchoolAccountCore(founderClient(), SEED.founder, {
      venueId,
      email: real,
    });
    expect(r.ok).toBe(true);
    expect(r.credentials?.email).toBe(real);
  });

  it("refuses an address that isn't one", async () => {
    const venueId = await bareVenue(`Typo School ${Date.now()}`);
    const r = await createSchoolAccountCore(founderClient(), SEED.founder, {
      venueId,
      email: "not-an-email",
    });
    expect(r.ok).toBe(false);
  });
});
