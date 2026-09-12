// A coach rostered at a school reads that school's pupils (migration 0076).
//
// The old rule was `coach_has_player` alone: a booking linking the pupil to a
// session this coach is on. For a school that is too narrow. `add_school_player`
// books a pupil onto the class's sessions from the one they were added to
// onwards, so a coach on a *different* class at the same campus — the other PE
// slot, a cover, a second coach on the same morning — sees none of them, and
// walks into a hall of children the app says they don't teach.
//
// The widening is still a fact about the coach's own diary, so the negatives
// carry the weight: a coach who teaches nothing at that campus must see
// nothing, and a private client's child who happens to attend the school stays
// out — the same line is_school_admin draws.

import { describe, it, expect, beforeAll } from "vitest";
import { admin, asUser } from "../../e2e/lib/supabase";
import {
  addSchoolPupil,
  createClient,
  createCoach,
  createGroupSession,
  createSchool,
  hoursFromNow,
  type CreatedCoach,
  type CreatedSchool,
} from "../../e2e/lib/scenario";

let campus: CreatedSchool;
let otherCampus: CreatedSchool;
/** Rostered on a second class at `campus`, never on the class the pupil is in. */
let sameCampusCoach: CreatedCoach;
let pupil: string;
let privateChild: string;

/** A second school class at an existing campus, taught by `coach`. */
async function secondClassAt(venueId: string, coach: CreatedCoach) {
  const db = admin();
  const { data: cls, error } = await db
    .from("classes")
    .insert({
      class_type: "group",
      is_school: true,
      title: "Campus — PE (afternoon)",
      capacity: 30,
      duration_minutes: 60,
      venue_id: venueId,
      starts_on: new Date().toISOString().slice(0, 10),
    })
    .select("id")
    .single();
  if (error || !cls) throw new Error(`secondClassAt: ${error?.message}`);
  await createGroupSession({
    classId: cls.id,
    coachId: coach.id,
    startsAt: hoursFromNow(30),
  });
}

beforeAll(async () => {
  campus = await createSchool({ name: "Ridgeview" });
  otherCampus = await createSchool({ name: "Fairmount" });

  pupil = await addSchoolPupil({ school: campus, fullName: "Ishaan K", grade: 6 });

  sameCampusCoach = await createCoach({ fullName: "Afternoon Coach" });
  await secondClassAt(campus.venueId, sameCampusCoach);

  // A private client's child who attends the same school. Attending is not
  // belonging: they have an account holder, so they are not the school's pupil.
  const parent = await createClient({ children: 1 });
  privateChild = parent.playerIds[0];
  await admin()
    .from("players")
    .update({ school_venue_id: campus.venueId })
    .eq("id", privateChild);
});

describe("a coach at a school reads that school's pupils (0076)", () => {
  it("sees a pupil of their campus they have no booking with", async () => {
    // Precondition: the widening is doing the work, not a stray booking.
    const { data: shared } = await admin()
      .from("bookings")
      .select("id,class_sessions!inner(coach_id)")
      .eq("player_id", pupil)
      .eq("class_sessions.coach_id", sameCampusCoach.id);
    expect(shared ?? []).toHaveLength(0);

    const db = await asUser(sameCampusCoach.email);
    const { data } = await db.from("players").select("id,full_name").eq("id", pupil).maybeSingle();
    expect(data?.id).toBe(pupil);
  });

  it("does not reach a pupil at a campus they teach nothing at", async () => {
    const theirPupil = await addSchoolPupil({
      school: otherCampus,
      fullName: "Other Pupil",
      grade: 8,
    });
    const db = await asUser(sameCampusCoach.email);
    const { data } = await db.from("players").select("id").eq("id", theirPupil).maybeSingle();
    expect(data).toBeNull();
  });

  it("does not reach a private client's child who merely attends the school", async () => {
    const db = await asUser(sameCampusCoach.email);
    const { data } = await db.from("players").select("id").eq("id", privateChild).maybeSingle();
    expect(data).toBeNull();
  });

  it("lists the campus for the coach, and not campuses they don't teach at", async () => {
    const db = await asUser(sameCampusCoach.email);
    const { data, error } = await db.rpc("coach_school_venues");
    expect(error).toBeNull();
    const ids = (data ?? []).map((v: { venue_id: string }) => v.venue_id);
    expect(ids).toContain(campus.venueId);
    expect(ids).not.toContain(otherCampus.venueId);
  });

  it("still shows the class's own coach their pupil", async () => {
    const db = await asUser(campus.coachEmail);
    const { data } = await db.from("players").select("id").eq("id", pupil).maybeSingle();
    expect(data?.id).toBe(pupil);
  });
});
