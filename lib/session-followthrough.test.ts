import { describe, it, expect } from "vitest";
import { foldFollowThrough, sessionClientIds, NO_FOLLOW_THROUGH } from "./session-followthrough";

const b = (
  session_id: string,
  player_id: string | null,
  status: string,
  // The family that pays. Null is a real case, not a placeholder: a school pupil
  // registered in the hall has no client account behind them.
  client_id: string | null = null
) => ({ session_id, player_id, status, client_id });

describe("foldFollowThrough", () => {
  it("counts a booking still on 'confirmed' as an unkept register", () => {
    const out = foldFollowThrough([b("s1", "p1", "confirmed"), b("s1", "p2", "confirmed")], []);
    expect(out.get("s1")).toEqual({ rosterUnmarked: 2, assessPending: 0, clientIds: [] });
  });

  it("counts an attended player with no assessment as owed", () => {
    const out = foldFollowThrough([b("s1", "p1", "attended")], []);
    expect(out.get("s1")).toEqual({ rosterUnmarked: 0, assessPending: 1, clientIds: [] });
  });

  it("clears the assessment once one exists for that player AND that session", () => {
    const out = foldFollowThrough(
      [b("s1", "p1", "attended")],
      [{ session_id: "s1", player_id: "p1" }]
    );
    expect(out.get("s1")).toEqual({ rosterUnmarked: 0, assessPending: 0, clientIds: [] });
  });

  it("does not let another session's assessment clear this one", () => {
    // skill_assessments_once_per_session is keyed on (player, session), so an
    // assessment written last week is not this week's work done.
    const out = foldFollowThrough(
      [b("s1", "p1", "attended")],
      [{ session_id: "s2", player_id: "p1" }]
    );
    expect(out.get("s1")).toEqual({ rosterUnmarked: 0, assessPending: 1, clientIds: [] });
  });

  it("never asks for an assessment on a no_show", () => {
    // You cannot rate a player who was not there, and get_coach_wrapup_queue
    // does not ask anyone to.
    const out = foldFollowThrough([b("s1", "p1", "no_show")], []);
    expect(out.get("s1")).toEqual({ rosterUnmarked: 0, assessPending: 0, clientIds: [] });
  });

  it("does not count assessments as owed behind an unkept register", () => {
    // The gate that matters: a confirmed booking is not yet an attended one, so
    // its assessment work does not exist. Marking the register is what reveals
    // it — showing both at once would chase the coach for work they cannot do.
    const out = foldFollowThrough([b("s1", "p1", "confirmed")], []);
    expect(out.get("s1")).toEqual({ rosterUnmarked: 1, assessPending: 0, clientIds: [] });
  });

  it("keeps sessions apart", () => {
    const out = foldFollowThrough(
      [b("s1", "p1", "confirmed"), b("s2", "p2", "attended")],
      []
    );
    expect(out.get("s1")).toEqual({ rosterUnmarked: 1, assessPending: 0, clientIds: [] });
    expect(out.get("s2")).toEqual({ rosterUnmarked: 0, assessPending: 1, clientIds: [] });
  });

  it("leaves a session with nothing booked out of the map entirely", () => {
    // A school class registered in the hall has no online roster, so it owes
    // nothing — the caller reads the miss as NO_FOLLOW_THROUGH, not "unknown".
    const out = foldFollowThrough([], []);
    expect(out.get("s1")).toBeUndefined();
  });

  it("names each family on a session once, whatever the booking said", () => {
    // Two children of one family in the same class is two bookings and one name
    // to filter by; a family whose child was marked absent is still in that
    // class this week; and the school pupil with no account behind them adds
    // nobody. Statuses are irrelevant here — the query has already thrown away
    // waitlisted and cancelled rows before this sees them.
    const out = foldFollowThrough(
      [
        b("s1", "p1", "confirmed", "sharma"),
        b("s1", "p2", "attended", "sharma"),
        b("s1", "p3", "no_show", "rao"),
        b("s1", "p4", "confirmed", null),
      ],
      []
    );
    expect(out.get("s1")?.clientIds).toEqual(["sharma", "rao"]);
  });
});

describe("sessionClientIds", () => {
  it("keeps a private's own client even with no booking row naming them", () => {
    // The case that would otherwise lose a family their private lessons: the
    // client hangs off the class, not off a booking.
    expect(sessionClientIds(NO_FOLLOW_THROUGH, "sharma")).toEqual(["sharma"]);
  });

  it("does not list a client twice when they are also booked", () => {
    const owed = { rosterUnmarked: 0, assessPending: 0, clientIds: ["sharma"] };
    expect(sessionClientIds(owed, "sharma")).toEqual(["sharma"]);
  });

  it("leaves a group session's families alone", () => {
    const owed = { rosterUnmarked: 0, assessPending: 0, clientIds: ["sharma", "rao"] };
    expect(sessionClientIds(owed, null)).toEqual(["sharma", "rao"]);
  });
});
