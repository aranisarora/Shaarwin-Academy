// A coach reads the venue they are rostered at, active or not (migration 0079).
//
// `venues.active` is a booking flag — it decides what a client can book — but
// the only read policy on the table was `active = true OR is_founder()`, so it
// was doing duty as a visibility flag too. Every school in production is
// inactive by design (they are managed internally, not booked), so PostgREST
// handed a coach a NULL venue for every school session: no coordinates, so
// geofenced auto-arrival could never fire, and no `location_label` either, so
// the campus name rendered blank.
//
// Note the factory: createSchool() builds an *active* venue, which is why the
// suite was green against a broken production. These specs set active=false
// explicitly, because that is the state the bug lives in.

import { describe, it, expect, beforeAll } from "vitest";
import { admin, asUser } from "../../e2e/lib/supabase";
import { createClient, createCoach, createSchool, type CreatedSchool } from "../../e2e/lib/scenario";

let campus: CreatedSchool;
let otherCampus: CreatedSchool;
/** Signed-in coach who teaches nothing at `campus`. */
let strangerEmail: string;
let parentEmail: string;

beforeAll(async () => {
  campus = await createSchool({ name: "Inactive Campus" });
  otherCampus = await createSchool({ name: "Unrelated Campus" });

  // Production's actual state, and the whole point of the test.
  await admin().from("venues").update({ active: false }).eq("id", campus.venueId);
  await admin().from("venues").update({ active: false }).eq("id", otherCampus.venueId);

  strangerEmail = (await createCoach({ fullName: "Stranger Coach" })).email;
  parentEmail = (await createClient({ children: 1 })).email;
});

describe("a coach reads the venue they are rostered at (0079)", () => {
  it("reads an inactive venue's coordinates when rostered there", async () => {
    // Precondition: it really is inactive, so the old policy would have hidden it.
    const { data: row } = await admin()
      .from("venues")
      .select("active")
      .eq("id", campus.venueId)
      .single();
    expect(row?.active).toBe(false);

    const db = await asUser(campus.coachEmail);
    const { data } = await db
      .from("venues")
      .select("id,name,lat,lng")
      .eq("id", campus.venueId)
      .maybeSingle();

    expect(data?.id).toBe(campus.venueId);
    // The geofence needs both of these and got neither.
    expect(data?.lat).not.toBeNull();
    expect(data?.lng).not.toBeNull();
  });

  it("resolves location_label for the class at that venue", async () => {
    // location_venue() is invoker-rights and reads `venues`, so it went NULL
    // through the same hole — a blank where the campus name should be.
    const db = await asUser(campus.coachEmail);
    const { data } = await db
      .from("class_sessions")
      .select("id,classes!inner(location_label)")
      .eq("id", campus.sessionId)
      .maybeSingle();

    const cls = data?.classes as unknown as { location_label: string | null } | undefined;
    expect(cls?.location_label).toBeTruthy();
  });

  it("does not reach an inactive venue the coach teaches nothing at", async () => {
    const db = await asUser(strangerEmail);
    const { data } = await db.from("venues").select("id").eq("id", campus.venueId).maybeSingle();
    expect(data).toBeNull();
  });

  it("keeps an inactive venue away from a client — active still governs booking", async () => {
    const db = await asUser(parentEmail);
    const { data } = await db.from("venues").select("id").eq("id", campus.venueId).maybeSingle();
    expect(data).toBeNull();
  });
});
