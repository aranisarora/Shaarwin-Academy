// Where a coach is told to go. A location is two stored parts — the venue and
// the unit inside it — chosen by a human at booking (migrations 0052-0054).
// Nothing is derived from the address string any more, so what these tests pin
// is composition, precedence, and the two properties that make the model worth
// having:
//
//   1. A venue rename reaches every message, past and future. That's the whole
//      argument for storing venue_id instead of a frozen label.
//   2. A unit is never shown without the venue detail that disambiguates it.
//      Within one complex the villas' clubhouse and the apartments' clubhouse
//      are mutually inaccessible, so a bare "Clubhouse" sends a coach to a gate
//      that won't open for them.
//
// lib/venue-display.test.ts holds the TypeScript mirror of the same rules.

import { describe, it, expect } from "vitest";
import { admin, asUser } from "../../e2e/lib/supabase";
import {
  coachMarkArrival,
  createClient,
  createCoach,
  createGroupSession,
  createPrivateSession,
  hoursFromNow,
} from "../../e2e/lib/scenario";
import { createPrivateSessionCore } from "../../lib/admin-ops-calendar";
import { expectNotification } from "../../e2e/lib/notifications";

const FOUNDER_EMAIL = "founder@sharwin.example";
const FOUNDER_ID = "00000000-0000-4000-8000-000000000001";

/** A venue seeded by migration 0009. */
const SEEDED_VENUE = { name: "Adarsh Palm Retreat" };

async function venueIdByName(name: string): Promise<string> {
  const db = admin();
  const { data, error } = await db
    .from("venues")
    .select("id")
    .eq("name", name)
    .limit(1)
    .single();
  if (error) throw new Error(`venueIdByName(${name}): ${error.message}`);
  return (data as { id: string }).id;
}

/** Create a venue for a test, returning its id. */
async function makeVenue(name: string, unit: string | null): Promise<string> {
  const db = admin();
  const { data, error } = await db
    .from("venues")
    .insert({
      name,
      unit,
      address: `${name} ${unit ?? ""}, Bengaluru`.trim(),
      postcode: "560103",
      lat: 12.921,
      lng: 77.688,
    })
    .select("id")
    .single();
  if (error) throw new Error(`makeVenue: ${error.message}`);
  return (data as { id: string }).id;
}

async function labelOf(classId: string): Promise<string | null> {
  const db = admin();
  const { data, error } = await db.rpc("class_location_label", { p_class: classId });
  if (error) throw new Error(`class_location_label: ${error.message}`);
  return data as string | null;
}

describe("location_label — venue plus the unit inside it", () => {
  it("names the venue a private is attached to", async () => {
    const venueId = await venueIdByName(SEEDED_VENUE.name);
    const priv = await createPrivateSession({ startsAt: hoursFromNow(6), venueId });

    expect(await labelOf(priv.classId)).toBe(SEEDED_VENUE.name);
  });

  it("appends the unit after the venue", async () => {
    const venueId = await venueIdByName(SEEDED_VENUE.name);
    const priv = await createPrivateSession({
      startsAt: hoursFromNow(6),
      venueId,
      unitLabel: "Villa 659",
    });

    expect(await labelOf(priv.classId)).toBe(`${SEEDED_VENUE.name}, Villa 659`);
  });

  it("folds the venue's own unit into the name, before the session's", async () => {
    // "Adarsh Palm Retreat" + "Villas" + "Clubhouse".
    const villas = await makeVenue("Test Palm Retreat", "Villas");
    const priv = await createPrivateSession({
      startsAt: hoursFromNow(6),
      venueId: villas,
      unitLabel: "Clubhouse",
    });

    expect(await labelOf(priv.classId)).toBe("Test Palm Retreat Villas, Clubhouse");
  });

  it("never shows the same unit for two parts of one complex", async () => {
    // The wrong-gate bug, asserted directly: a coach sent to the villas'
    // clubhouse and one sent to the towers' clubhouse must not read the same
    // sentence. This holds because location_label composes venue_display —
    // which carries venues.unit — before appending the session's unit.
    const villas = await makeVenue("Twin Complex", "Villas");
    const towers = await makeVenue("Twin Complex", "Apartments");

    const atVillas = await createPrivateSession({
      startsAt: hoursFromNow(6),
      venueId: villas,
      unitLabel: "Clubhouse",
    });
    const atTowers = await createPrivateSession({
      startsAt: hoursFromNow(7),
      venueId: towers,
      unitLabel: "Clubhouse",
    });

    const a = await labelOf(atVillas.classId);
    const b = await labelOf(atTowers.classId);
    expect(a).toBe("Twin Complex Villas, Clubhouse");
    expect(b).toBe("Twin Complex Apartments, Clubhouse");
    expect(a).not.toBe(b);
  });

  it("follows a venue rename — that is why venue_id beats a stored string", async () => {
    const venueId = await makeVenue("Old Name", null);
    const priv = await createPrivateSession({ startsAt: hoursFromNow(6), venueId });
    expect(await labelOf(priv.classId)).toBe("Old Name");

    const { error } = await admin()
      .from("venues")
      .update({ name: "New Name" })
      .eq("id", venueId);
    if (error) throw new Error(error.message);

    // No backfill, no re-derivation: the existing session reads the new name.
    expect(await labelOf(priv.classId)).toBe("New Name");
  });

  it("falls back to the stored label for somewhere that isn't a venue", async () => {
    // A genuine one-off — a client's own home in a complex we hold no row for.
    // The factory writes venue_label when no venueId is given.
    const priv = await createPrivateSession({
      startsAt: hoursFromNow(6),
      locationName: "Whitefield Court",
    });

    expect(await labelOf(priv.classId)).toBe("Whitefield Court");
  });

  it("uses the venue name for a group class", async () => {
    const session = await createGroupSession({ startsAt: hoursFromNow(24) });
    const db = admin();
    const { data: cls } = await db
      .from("classes")
      .select("venue_id")
      .eq("id", session.classId)
      .single();
    const { data: venue } = await db
      .from("venues")
      .select("name,unit")
      .eq("id", (cls as { venue_id: string }).venue_id)
      .single();
    const v = venue as { name: string; unit: string | null };

    expect(await labelOf(session.classId)).toBe(
      v.unit ? `${v.name} ${v.unit}` : v.name
    );
  });

  it("reaches the coach at booking time: 'New private session' names the venue", async () => {
    // This path composes its body when the booking is made, and a notification
    // body is frozen at INSERT — so a read-time fix never touches it. It books
    // ~96% of the academy's privates.
    const parent = await createClient({ children: 1 });
    const coach = await createCoach();
    const founder = await asUser(FOUNDER_EMAIL);
    const venueId = await venueIdByName(SEEDED_VENUE.name);

    const result = await createPrivateSessionCore(founder, FOUNDER_ID, {
      clientId: parent.id,
      playerId: parent.playerIds[0],
      date: new Date(Date.now() + 86400_000).toISOString().slice(0, 10),
      time: "16:00",
      durationMinutes: 60,
      address: "Adarsh Palm Retreat, Bellandur, Bengaluru, Karnataka",
      lat: 12.9268,
      lng: 77.681,
      venueId,
      unitLabel: "Clubhouse",
      coachId: coach.id,
    } as Parameters<typeof createPrivateSessionCore>[2]);
    expect(result.ok).toBe(true);

    const msg = await expectNotification(admin(), {
      type: "new_private_session",
      userId: coach.id,
    });
    expect(String(msg.body)).toContain(`${SEEDED_VENUE.name}, Clubhouse`);
    expect(String(msg.body)).not.toContain("Bellandur");
    expect(msg.data.location_str).toBe(`${SEEDED_VENUE.name}, Clubhouse`);
    // Directions ride along, for when the name still isn't enough.
    expect(String(msg.data.maps_url ?? "")).toContain("maps.google.com");
  });

  it("reaches the parent: 'coach has arrived' names the venue, not the address", async () => {
    const coach = await createCoach();
    const venueId = await venueIdByName(SEEDED_VENUE.name);
    const priv = await createPrivateSession({
      startsAt: hoursFromNow(1),
      coachId: coach.id,
      venueId,
    });

    await coachMarkArrival({ coachEmail: coach.email, sessionId: priv.sessionId });

    const arrived = await expectNotification(admin(), {
      type: "coach_arrived",
      userId: priv.clientId,
      dataContains: { session_id: priv.sessionId },
    });
    expect(arrived.data.location_str).toBe(SEEDED_VENUE.name);
    expect(String(arrived.body)).toContain(SEEDED_VENUE.name);
    expect(String(arrived.body)).not.toContain("Bellandur");
  });
});

describe("location_maps_url — directions that match the arrival geofence", () => {
  it("uses the private's own pin, not its venue's", async () => {
    // coach_mark_arrival geofences a private against private_class_details
    // lat/lng. A map pointing at the venue centroid instead would send a coach
    // to a spot that then fails the arrival check.
    const venueId = await venueIdByName(SEEDED_VENUE.name);
    const priv = await createPrivateSession({ startsAt: hoursFromNow(6), venueId });

    const db = admin();
    const { data: pcd } = await db
      .from("private_class_details")
      .select("lat,lng")
      .eq("class_id", priv.classId)
      .single();
    const { data: url, error } = await db.rpc("class_location_maps_url", {
      p_class: priv.classId,
    });
    if (error) throw new Error(error.message);

    const { lat, lng } = pcd as { lat: number; lng: number };
    expect(String(url)).toBe(`https://maps.google.com/?q=${lat},${lng}`);
  });
});
