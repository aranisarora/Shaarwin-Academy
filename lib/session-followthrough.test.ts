import { describe, it, expect } from "vitest";
import {
  foldFollowThrough,
  owesFollowThrough,
  NO_FOLLOW_THROUGH,
} from "./session-followthrough";

const b = (session_id: string, player_id: string | null, status: string) => ({
  session_id,
  player_id,
  status,
});

describe("foldFollowThrough", () => {
  it("counts a booking still on 'confirmed' as an unkept register", () => {
    const out = foldFollowThrough([b("s1", "p1", "confirmed"), b("s1", "p2", "confirmed")], []);
    expect(out.get("s1")).toEqual({ rosterUnmarked: 2, assessPending: 0 });
  });

  it("counts an attended player with no assessment as owed", () => {
    const out = foldFollowThrough([b("s1", "p1", "attended")], []);
    expect(out.get("s1")).toEqual({ rosterUnmarked: 0, assessPending: 1 });
  });

  it("clears the assessment once one exists for that player AND that session", () => {
    const out = foldFollowThrough(
      [b("s1", "p1", "attended")],
      [{ session_id: "s1", player_id: "p1" }]
    );
    expect(out.get("s1")).toEqual({ rosterUnmarked: 0, assessPending: 0 });
  });

  it("does not let another session's assessment clear this one", () => {
    // skill_assessments_once_per_session is keyed on (player, session), so an
    // assessment written last week is not this week's work done.
    const out = foldFollowThrough(
      [b("s1", "p1", "attended")],
      [{ session_id: "s2", player_id: "p1" }]
    );
    expect(out.get("s1")).toEqual({ rosterUnmarked: 0, assessPending: 1 });
  });

  it("never asks for an assessment on a no_show", () => {
    // You cannot rate a player who was not there, and get_coach_wrapup_queue
    // does not ask anyone to.
    const out = foldFollowThrough([b("s1", "p1", "no_show")], []);
    expect(out.get("s1")).toEqual({ rosterUnmarked: 0, assessPending: 0 });
  });

  it("does not count assessments as owed behind an unkept register", () => {
    // The gate that matters: a confirmed booking is not yet an attended one, so
    // its assessment work does not exist. Marking the register is what reveals
    // it — showing both at once would chase the coach for work they cannot do.
    const out = foldFollowThrough([b("s1", "p1", "confirmed")], []);
    expect(out.get("s1")).toEqual({ rosterUnmarked: 1, assessPending: 0 });
  });

  it("keeps sessions apart", () => {
    const out = foldFollowThrough(
      [b("s1", "p1", "confirmed"), b("s2", "p2", "attended")],
      []
    );
    expect(out.get("s1")).toEqual({ rosterUnmarked: 1, assessPending: 0 });
    expect(out.get("s2")).toEqual({ rosterUnmarked: 0, assessPending: 1 });
  });

  it("leaves a session with nothing booked out of the map entirely", () => {
    // A school class registered in the hall has no online roster, so it owes
    // nothing — the caller reads the miss as NO_FOLLOW_THROUGH, not "unknown".
    const out = foldFollowThrough([], []);
    expect(out.get("s1")).toBeUndefined();
    expect(owesFollowThrough(NO_FOLLOW_THROUGH)).toBe(false);
  });

  it("owesFollowThrough is true if either half is outstanding", () => {
    expect(owesFollowThrough({ rosterUnmarked: 1, assessPending: 0 })).toBe(true);
    expect(owesFollowThrough({ rosterUnmarked: 0, assessPending: 1 })).toBe(true);
    expect(owesFollowThrough({ rosterUnmarked: 0, assessPending: 0 })).toBe(false);
  });
});
