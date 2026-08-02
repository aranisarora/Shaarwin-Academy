// A school login sees its own campus's pupils and nothing else, and cannot
// write. Both halves are enforced by RLS (migration 0058), so this is where
// they're proven — the UI simply not rendering a button is not enforcement.
//
// The negative cases carry the weight. A school head is an outside party: the
// cost of them seeing one private client's child, or one rival campus's roster,
// is not a rendering bug.

import { describe, it, expect, beforeAll } from "vitest";
import { admin, asUser } from "../../e2e/lib/supabase";
import {
  addSchoolPupil,
  createClient,
  createSchool,
  createSchoolAdmin,
  type CreatedSchool,
  type CreatedSchoolAdmin,
} from "../../e2e/lib/scenario";

let tisb: CreatedSchool;
let rival: CreatedSchool;
let head: CreatedSchoolAdmin;
let ourPupil: string;
let theirPupil: string;
let privateChild: string;

beforeAll(async () => {
  tisb = await createSchool({ name: "TISB" });
  rival = await createSchool({ name: "Inventure" });
  head = await createSchoolAdmin({ venueId: tisb.venueId });

  ourPupil = await addSchoolPupil({ school: tisb, fullName: "Ananya R", grade: 7 });
  theirPupil = await addSchoolPupil({ school: rival, fullName: "Rival Pupil", grade: 8 });

  // A private client's child, booked into TISB's own school session. This is
  // the boundary the owner chose: attending the class is not enough, the pupil
  // must belong to the school (school_venue_id set, no account holder).
  const parent = await createClient({ children: 1 });
  privateChild = parent.playerIds[0];
  await admin()
    .from("bookings")
    .insert({
      session_id: tisb.sessionId,
      client_id: parent.id,
      player_id: privateChild,
      status: "confirmed",
    });

  // A coach note on each pupil, written by the coach who teaches them.
  await admin().from("student_notes").insert([
    { player_id: ourPupil, author_id: tisb.coachId, body: "Great backhand progress." },
    { player_id: theirPupil, author_id: rival.coachId, body: "Rival note." },
    { player_id: privateChild, author_id: tisb.coachId, body: "Private note." },
  ]);
});

describe("school head — what they can read", () => {
  it("is provisioned as a school by the signup trigger, with no player row", async () => {
    const db = admin();
    const { data: profile } = await db
      .from("profiles")
      .select("role,approval_status")
      .eq("id", head.id)
      .maybeSingle();
    expect(profile?.role).toBe("school");
    // Never held at the approval gate — that gate is for self-signup clients.
    expect(profile?.approval_status).toBe("approved");

    const { data: link } = await db
      .from("school_admins")
      .select("venue_id")
      .eq("user_id", head.id);
    expect(link?.map((l) => l.venue_id)).toEqual([tisb.venueId]);

    // A school is not a household: handle_new_user must not create a player.
    const { data: players } = await db.from("players").select("id").eq("client_id", head.id);
    expect(players ?? []).toHaveLength(0);
  });

  it("reads its own pupils", async () => {
    const school = await asUser(head.email);
    const { data } = await school.from("players").select("id,full_name,grade");
    expect(data?.map((p) => p.id)).toEqual([ourPupil]);
    expect(data?.[0].grade).toBe(7);
  });

  it("reads its own pupils' attendance", async () => {
    const school = await asUser(head.email);
    // The point of the dedicated bookings policy: these rows carry client_id
    // null, so "clients read own bookings" matches none of them.
    const { data } = await school.from("bookings").select("player_id,session_id");
    expect(data?.length).toBeGreaterThan(0);
    expect(new Set(data?.map((b) => b.player_id))).toEqual(new Set([ourPupil]));

    // And the session + class behind them, which the insights view joins.
    const { data: sessions } = await school
      .from("class_sessions")
      .select("id,classes(title)")
      .eq("id", tisb.sessionId);
    expect(sessions?.[0]?.classes?.title).toContain("TISB");
  });

  it("reads its own pupils' coach notes and mastery", async () => {
    const school = await asUser(head.email);

    const { data: notes, error } = await school.rpc("get_player_notes", {
      p_player: ourPupil,
    });
    expect(error).toBeNull();
    expect(notes?.map((n: { body: string }) => n.body)).toEqual([
      "Great backhand progress.",
    ]);

    const { data: mastery } = await school.rpc("get_players_mastery", {
      p_players: [ourPupil],
    });
    expect(mastery?.map((m: { player_id: string }) => m.player_id)).toEqual([ourPupil]);
  });
});

describe("school head — what they must not read", () => {
  it("sees nothing of another school's pupils", async () => {
    const school = await asUser(head.email);

    const { data: player } = await school.from("players").select("id").eq("id", theirPupil);
    expect(player ?? []).toHaveLength(0);

    const { data: bookings } = await school
      .from("bookings")
      .select("id")
      .eq("player_id", theirPupil);
    expect(bookings ?? []).toHaveLength(0);

    const { error } = await school.rpc("get_player_notes", { p_player: theirPupil });
    expect(error?.message).toContain("not_authorised");

    const { data: mastery } = await school.rpc("get_players_mastery", {
      p_players: [theirPupil],
    });
    expect(mastery ?? []).toHaveLength(0);
  });

  it("sees nothing of a private client's child, even in its own class", async () => {
    const school = await asUser(head.email);

    const { data: player } = await school
      .from("players")
      .select("id")
      .eq("id", privateChild);
    expect(player ?? []).toHaveLength(0);

    const { data: bookings } = await school
      .from("bookings")
      .select("id")
      .eq("player_id", privateChild);
    expect(bookings ?? []).toHaveLength(0);

    const { error } = await school.rpc("get_player_notes", { p_player: privateChild });
    expect(error?.message).toContain("not_authorised");
  });

  it("cannot see the other school's link rows", async () => {
    const school = await asUser(head.email);
    const { data } = await school.from("school_admins").select("user_id,venue_id");
    expect(data?.map((r) => r.venue_id)).toEqual([tisb.venueId]);
  });
});

describe("school head — read-only", () => {
  it("cannot add, rename or remove a pupil", async () => {
    const school = await asUser(head.email);

    const { error: insertErr } = await school
      .from("players")
      .insert({ full_name: "Smuggled In", school_venue_id: tisb.venueId });
    expect(insertErr).not.toBeNull();

    await school.from("players").update({ full_name: "Renamed" }).eq("id", ourPupil);
    await school.from("players").delete().eq("id", ourPupil);

    // Assert against the truth, not the client's error: an update or delete
    // that matches no row under RLS succeeds with zero rows affected.
    const { data: after } = await admin()
      .from("players")
      .select("full_name")
      .eq("id", ourPupil)
      .maybeSingle();
    expect(after?.full_name).toBe("Ananya R");
  });

  it("cannot mark attendance or write a note", async () => {
    const school = await asUser(head.email);

    const { data: booking } = await admin()
      .from("bookings")
      .select("id")
      .eq("player_id", ourPupil)
      .limit(1)
      .single();

    await school.from("bookings").update({ status: "attended" }).eq("id", booking.id);
    const { data: after } = await admin()
      .from("bookings")
      .select("status")
      .eq("id", booking.id)
      .maybeSingle();
    expect(after?.status).toBe("confirmed");

    const { error: noteErr } = await school
      .from("student_notes")
      .insert({ player_id: ourPupil, author_id: head.id, body: "School says so." });
    expect(noteErr).not.toBeNull();
  });
});
