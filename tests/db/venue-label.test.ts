// A private held AT a known academy venue used to be described to the coach by
// its geocoded address ("Adarsh Palm Retreat, Bellandur, Bengaluru, Karnataka")
// rather than by the name everyone actually uses ("Adarsh Palm Retreat"). Four
// notification paths built that string independently; location_label() is now
// the single resolver they all share.
//
// The two cases that must not regress are opposites, so both are asserted here:
// a private whose address IS a venue's must be relabelled, and a private in a
// real home must keep its address verbatim — that address is the whole reason
// the message is useful to the coach.

import { describe, it, expect } from "vitest";
import { admin } from "../../e2e/lib/supabase";
import {
  coachMarkArrival,
  createCoach,
  createGroupSession,
  createPrivateSession,
  hoursFromNow,
} from "../../e2e/lib/scenario";
import { expectNotification } from "../../e2e/lib/notifications";

/** A venue seeded by migration 0009, with the address a picker would geocode. */
const SEEDED_VENUE = {
  name: "Adarsh Palm Retreat",
  address: "Adarsh Palm Retreat, Bellandur, Bengaluru, Karnataka",
};

/** Every seeded venue name — nothing that isn't a venue may resolve to one. */
const KNOWN_VENUE_NAMES = [
  "Adarsh Palm Retreat Lakefront",
  "Adarsh Palm Retreat",
  "La Palazzo",
  "Mantri Espana",
  "Prestige St. John's Wood",
];

/** Point a private session's address at `address`, as the booking flow would. */
async function setPrivateAddress(classId: string, address: string) {
  await setPrivateDetails(classId, { address });
}

/** Overwrite the geocoded fields on a private, as the address picker would. */
async function setPrivateDetails(
  classId: string,
  patch: { address?: string; address_details?: Record<string, unknown> }
) {
  const db = admin();
  const { error } = await db
    .from("private_class_details")
    .update(patch)
    .eq("class_id", classId);
  if (error) throw new Error(`setPrivateDetails: ${error.message}`);
}

async function labelOf(classId: string): Promise<string | null> {
  const db = admin();
  const { data, error } = await db.rpc("class_location_label", { p_class: classId });
  if (error) throw new Error(`class_location_label: ${error.message}`);
  return data as string | null;
}

describe("location_label — venue name over raw address", () => {
  it("names the venue when a private's address is that venue's address", async () => {
    const priv = await createPrivateSession({ startsAt: hoursFromNow(6) });
    await setPrivateAddress(priv.classId, SEEDED_VENUE.address);

    expect(await labelOf(priv.classId)).toBe(SEEDED_VENUE.name);
  });

  it("matches regardless of case and stray whitespace", async () => {
    const priv = await createPrivateSession({ startsAt: hoursFromNow(6) });
    await setPrivateAddress(priv.classId, `  ${SEEDED_VENUE.address.toUpperCase()}  `);

    expect(await labelOf(priv.classId)).toBe(SEEDED_VENUE.name);
  });

  it("never relabels a real home to a venue", async () => {
    // The factory's address is a house, not a venue. A coach sent to a family's
    // home must not be told to go to an academy venue instead. The factory also
    // writes a geocoded POI name, so that — not the full postal line — is the
    // label, which is the point of the POI tier.
    const priv = await createPrivateSession({ startsAt: hoursFromNow(6) });

    const label = await labelOf(priv.classId);
    expect(label).toBe(priv.locationName);
    expect(KNOWN_VENUE_NAMES).not.toContain(label);
  });

  it("keeps the street when a home has no geocoded POI name", async () => {
    // The pure-address case: nothing but what the client typed. The coach needs
    // the street, so it survives verbatim rather than collapsing to a locality.
    const priv = await createPrivateSession({ startsAt: hoursFromNow(6) });
    await setPrivateDetails(priv.classId, {
      address: "14 Dodda Banaswadi Main Road, Bengaluru, 560043, India",
      address_details: { city: "Bengaluru" },
    });

    expect(await labelOf(priv.classId)).toBe("14 Dodda Banaswadi Main Road");
  });

  // ── The 0050 tiers. Each of these was a real label on the production book. ──

  it("prefers the geocoded POI name over the street", async () => {
    const priv = await createPrivateSession({ startsAt: hoursFromNow(6) });
    await setPrivateDetails(priv.classId, {
      address: "51/3, Bengaluru, 560067, India",
      address_details: { name: "Windmills of your mind, Back Gate", city: "Bengaluru" },
    });

    expect(await labelOf(priv.classId)).toBe("Windmills of your mind, Back Gate");
  });

  it("keeps a real street rather than dropping to the neighbourhood", async () => {
    const priv = await createPrivateSession({ startsAt: hoursFromNow(6) });
    await setPrivateDetails(priv.classId, {
      address: "Prestige Mayberry Road 34، 560067 Bengaluru، India",
      address_details: { locality: "Chansandra", city: "Bengaluru" },
    });

    expect(await labelOf(priv.classId)).toBe("Prestige Mayberry Road 34");
  });

  it("falls back to the locality when the address names only a city", async () => {
    // Mapbox models a gated complex as a locality. Without this tier the coach
    // is told to go to "Bengaluru" — a city of 14 million.
    const priv = await createPrivateSession({ startsAt: hoursFromNow(6) });
    await setPrivateDetails(priv.classId, {
      address: "Bengaluru, 560103, India",
      address_details: { locality: "Adarsh Palm Retreat", city: "Bengaluru" },
    });

    expect(await labelOf(priv.classId)).toBe("Adarsh Palm Retreat");
  });

  it("treats a bare sub-unit past an Arabic comma as junk, not a place", async () => {
    // Two traps at once: the address is split on U+060C, and "Phase 3" reads
    // like a place but names nothing without the complex around it.
    const priv = await createPrivateSession({ startsAt: hoursFromNow(6) });
    await setPrivateDetails(priv.classId, {
      address: "Phase 3 ، 560035 Bengaluru، India",
      address_details: { locality: "Adarsh Palm Retreat", city: "Bengaluru" },
    });

    expect(await labelOf(priv.classId)).toBe("Adarsh Palm Retreat");
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
      .select("name")
      .eq("id", (cls as { venue_id: string }).venue_id)
      .single();

    expect(await labelOf(session.classId)).toBe((venue as { name: string }).name);
  });

  it("reaches the parent: 'coach has arrived' names the venue, not the address", async () => {
    // The end-to-end shape of the bug — a private at a known venue — through the
    // call site a parent actually reads.
    const coach = await createCoach();
    const priv = await createPrivateSession({
      startsAt: hoursFromNow(1),
      coachId: coach.id,
    });
    await setPrivateAddress(priv.classId, SEEDED_VENUE.address);

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
