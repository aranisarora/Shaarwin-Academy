// The hourly sweep that closes finished sessions — and, just as importantly,
// the register it refuses to write.
//
// `sweep_session_status()` has existed since migration 0006 and had never been
// scheduled, so a session only ever left 'scheduled' when a coach tapped a
// register. Hundreds of finished sessions on production still read as
// still-to-come because of it, and the confirmed bookings hanging off them read
// as places somebody is still holding. Migration 0065 puts the function on an
// hourly cron, which is the half of it these tests are least worried about.
//
// The half that needs pinning down is the statement 0065 DELETED. The 0006
// function also defaulted every un-marked 'confirmed' booking to 'attended'
// after 48 hours, and scheduling it as written would have run that too.
// 'attended' is not internal bookkeeping — it is what a parent is told about
// their child, what a school sees of its pupils, and the answer the WhatsApp bot
// gives to "did my child go to class?". A fabricated register is
// indistinguishable afterwards from a real one, and nobody could ever tell them
// apart again. So the sweep closes sessions and touches no booking, ever, and
// the case below with a session five days old is the one that would catch a
// well-meaning future edit putting the second statement back.

import { describe, it, expect, beforeAll } from "vitest";
import { admin } from "../../e2e/lib/supabase";
import {
  createClient,
  createCoach,
  createGroupSession,
  hoursFromNow,
  type CreatedClient,
  type CreatedCoach,
} from "../../e2e/lib/scenario";

let coach: CreatedCoach;
let parent: CreatedClient;

/** Sessions this file created, and therefore the only ones it may leave swept. */
const owned = new Set<string>();

/**
 * Run the sweep, then put back every past session that wasn't ours.
 *
 * `sweep_session_status()` is a whole-database statement — that is the point of
 * it — but Layer 1 shares one database across every spec file, so a test that
 * calls it for real rewrites the world the other files reason about. This is not
 * hypothetical: `offer_cover_session` offers to `rank_coaches(...) limit 10`, and
 * a coach's rank is computed from the hours they have booked at
 * `status = 'scheduled'`. Closing another file's past sessions freed up its
 * coaches, reshuffled the ranking, and pushed the coach `cover-offers.test.ts`
 * was waiting on out of the top ten — a failure two files away from its cause,
 * and only when the whole suite ran.
 *
 * So the blast radius is confined here rather than in the function, which must
 * stay global: snapshot the past-and-scheduled sessions we don't own, sweep for
 * real, and restore exactly those. Our own sessions stay swept, which is what
 * every assertion below is about.
 */
async function sweep(): Promise<void> {
  const db = admin();
  const { data: before, error: readErr } = await db
    .from("class_sessions")
    .select("id")
    .eq("status", "scheduled")
    .lt("ends_at", new Date().toISOString());
  if (readErr) throw new Error(`sweep snapshot: ${readErr.message}`);

  const foreign = (before ?? []).map((s) => s.id as string).filter((id) => !owned.has(id));

  const { error } = await db.rpc("sweep_session_status");
  if (error) throw new Error(`sweep_session_status: ${error.message}`);

  if (foreign.length) {
    const { error: restoreErr } = await db
      .from("class_sessions")
      .update({ status: "scheduled" })
      .in("id", foreign);
    if (restoreErr) throw new Error(`sweep restore: ${restoreErr.message}`);
  }
}

/** A session at a fixed offset from now, with one booking hung off it. */
async function sessionWithBooking(args: {
  hours: number;
  status?: "confirmed" | "waitlisted" | "attended";
  sessionStatus?: "scheduled" | "cancelled";
}): Promise<{ sessionId: string; bookingId: string }> {
  const db = admin();
  const session = await createGroupSession({
    startsAt: hoursFromNow(args.hours),
    coachId: coach.id,
  });
  owned.add(session.sessionId);

  if (args.sessionStatus === "cancelled") {
    const { error } = await db
      .from("class_sessions")
      .update({ status: "cancelled" })
      .eq("id", session.sessionId);
    if (error) throw new Error(`sessionWithBooking cancel: ${error.message}`);
  }

  // Inserted directly rather than through book_session: the RPC rightly refuses
  // to sell a seat in a class that has already happened, and a past booking is
  // exactly what this file is about.
  const { data, error } = await db
    .from("bookings")
    .insert({
      session_id: session.sessionId,
      client_id: parent.id,
      player_id: parent.playerIds[0],
      status: args.status ?? "confirmed",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`sessionWithBooking booking: ${error?.message}`);

  return { sessionId: session.sessionId, bookingId: data.id as string };
}

const sessionStatus = async (id: string) =>
  (
    await admin().from("class_sessions").select("status").eq("id", id).maybeSingle()
  ).data?.status;

const bookingStatus = async (id: string) =>
  (await admin().from("bookings").select("status").eq("id", id).maybeSingle()).data?.status;

beforeAll(async () => {
  coach = await createCoach();
  parent = await createClient({ children: 1 });
});

describe("sweep_session_status closes what has finished", () => {
  it("marks a session whose hour has passed as completed", async () => {
    // Three hours back, so `ends_at` is comfortably behind us whatever the
    // seeded class's duration turns out to be.
    const past = await sessionWithBooking({ hours: -3 });
    expect(await sessionStatus(past.sessionId)).toBe("scheduled");

    await sweep();

    expect(await sessionStatus(past.sessionId)).toBe("completed");
  });

  it("leaves a session that hasn't happened yet alone", async () => {
    const future = await sessionWithBooking({ hours: 30 });

    await sweep();

    expect(await sessionStatus(future.sessionId)).toBe("scheduled");
  });

  it("leaves a cancelled session cancelled", async () => {
    // The cut is on `status = 'scheduled'`, not on the clock. A class the
    // academy called off did not quietly go ahead because its hour came round.
    const called_off = await sessionWithBooking({ hours: -4, sessionStatus: "cancelled" });

    await sweep();

    expect(await sessionStatus(called_off.sessionId)).toBe("cancelled");
  });
});

describe("sweep_session_status writes no register", () => {
  it("leaves a confirmed booking confirmed when it closes its session", async () => {
    const past = await sessionWithBooking({ hours: -5 });

    await sweep();

    expect(await sessionStatus(past.sessionId)).toBe("completed");
    // The whole point. Nobody marked this child present or absent, and the
    // academy does not get to decide which on their behalf.
    expect(await bookingStatus(past.bookingId)).toBe("confirmed");
  });

  it("still says nothing about a session five days old", async () => {
    // The 48-hour trigger from the deleted statement, well and truly passed.
    // If this ever comes back green as 'attended', a register has been invented
    // and every attendance figure the academy shows a parent is now fiction.
    const old = await sessionWithBooking({ hours: -24 * 5 });

    await sweep();

    expect(await sessionStatus(old.sessionId)).toBe("completed");
    expect(await bookingStatus(old.bookingId)).toBe("confirmed");
  });

  it("leaves a waitlisted place waitlisted", async () => {
    // A place never granted must not become attendance either — that would be
    // the same invention, on a child who was told there was no room.
    const old = await sessionWithBooking({ hours: -24 * 4, status: "waitlisted" });

    await sweep();

    expect(await bookingStatus(old.bookingId)).toBe("waitlisted");
  });

  it("does not disturb a register a coach actually marked", async () => {
    const marked = await sessionWithBooking({ hours: -24 * 3, status: "attended" });

    await sweep();

    expect(await sessionStatus(marked.sessionId)).toBe("completed");
    expect(await bookingStatus(marked.bookingId)).toBe("attended");
  });

  it("changes no booking anywhere in the database", async () => {
    // The per-row cases above prove the shapes we thought of. This one proves
    // the statement is gone: a full before/after of every booking's status,
    // which no future re-addition of an attendance default could slip past.
    const db = admin();
    const before = await db.from("bookings").select("id,status").order("id");

    await sweep();

    const after = await db.from("bookings").select("id,status").order("id");
    expect(after.data).toEqual(before.data);
    expect((before.data ?? []).length).toBeGreaterThan(0);
  });
});
