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

/** Point a private session's address at `address`, as the booking flow would. */
async function setPrivateAddress(classId: string, address: string) {
  const db = admin();
  const { error } = await db
    .from("private_class_details")
    .update({ address })
    .eq("class_id", classId);
  if (error) throw new Error(`setPrivateAddress: ${error.message}`);
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

  it("keeps a real home address untouched", async () => {
    // The factory's default address is a house, not a venue — a coach sent to a
    // family's home needs the street, and relabelling it would strand them.
    const priv = await createPrivateSession({ startsAt: hoursFromNow(6) });

    expect(await labelOf(priv.classId)).toBe(priv.address);
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
