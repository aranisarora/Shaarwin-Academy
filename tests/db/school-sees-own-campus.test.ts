// A school reads its own campus, public or not (migration 0080).
//
// The other half of the hole 0079 closed for coaches. Every campus is
// `is_public = false` — a campus is not offered to clients — and the only read
// policy on `venues` was `is_public = true OR is_founder()` (called `active`
// then, which is how it came to be read as visibility), so a school account
// could not read the one venue row that is entirely about it.
//
// The symptom hid behind a fallback, which is why it lasted: getCampuses()
// embeds `venues(name,unit)` off `school_admins` and ends
// `row.venues?.name ?? "School"`. Unreadable row -> null embed -> every school
// in production sees its campus called "School".
//
// As in 0079's spec, the venue is made non-public explicitly: createSchool()
// builds a public one, which is why the suite stayed green against this.

import { describe, it, expect, beforeAll } from "vitest";
import { admin, asUser } from "../../e2e/lib/supabase";
import {
  createSchool,
  createSchoolAdmin,
  type CreatedSchool,
  type CreatedSchoolAdmin,
} from "../../e2e/lib/scenario";

let campus: CreatedSchool;
let otherCampus: CreatedSchool;
let office: CreatedSchoolAdmin;

beforeAll(async () => {
  campus = await createSchool({ name: "Northgate" });
  otherCampus = await createSchool({ name: "Southgate" });

  // Production's actual state for every campus.
  await admin()
    .from("venues")
    .update({ is_public: false })
    .in("id", [campus.venueId, otherCampus.venueId]);

  office = await createSchoolAdmin({ venueId: campus.venueId });
});

describe("a school reads its own campus (0080)", () => {
  it("reads its own non-public campus row", async () => {
    // Precondition: non-public, so the old policy would have hidden it.
    const { data: row } = await admin()
      .from("venues")
      .select("is_public")
      .eq("id", campus.venueId)
      .single();
    expect(row?.is_public).toBe(false);

    const db = await asUser(office.email);
    const { data } = await db
      .from("venues")
      .select("id,name,unit")
      .eq("id", campus.venueId)
      .maybeSingle();

    expect(data?.id).toBe(campus.venueId);
    expect(data?.name).toBe("Northgate");
  });

  it("names the campus through the embed getCampuses() actually uses", async () => {
    // The real shape: without the policy this embed is null and the caller's
    // `?? "School"` fallback renders that as the campus name.
    const db = await asUser(office.email);
    const { data } = await db.from("school_admins").select("venue_id,venues(name,unit)");

    const rows = (data ?? []) as unknown as {
      venue_id: string;
      venues: { name: string } | null;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].venues?.name).toBe("Northgate");
  });

  it("does not reach another school's campus", async () => {
    const db = await asUser(office.email);
    const { data } = await db
      .from("venues")
      .select("id")
      .eq("id", otherCampus.venueId)
      .maybeSingle();
    expect(data).toBeNull();
  });
});
