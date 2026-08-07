import { describe, it, expect } from "vitest";
import { notArrivedBody, type NotArrivedFacts } from "./escalation.ts";

// The start+10 founder escalation. The bug pinned here reached production and
// was invisible in the data: a coach who tapped "Running late" left the session
// row looking exactly like a coach who had ignored everything, because
// coach_mark_arrival's late branch wrote nothing to class_sessions. So the
// founder's phone buzzed with "Coach Augustine is running a few minutes late"
// and then, minutes later, "Augustine never responded at all today — likely a
// no-show, act now."

function facts(over: Partial<NotArrivedFacts> = {}): NotArrivedFacts {
  return {
    coachName: "Augustine",
    classTitle: "Beginners Batch",
    when: "6:30 pm",
    confirmed: false,
    lateAtClock: null,
    ...over,
  };
}

describe("notArrivedBody", () => {
  it("says the coach told us they were late, and when", () => {
    const body = notArrivedBody(facts({ lateAtClock: "6:32 pm", confirmed: true }));
    expect(body).toContain("said at 6:32 pm they were running late");
    expect(body).toContain("Beginners Batch");
    expect(body).toContain("6:30 pm");
    expect(body).toContain("worth a check");
  });

  it("never tells the founder a coach was silent when that coach reported lateness", () => {
    // The regression itself. Reporting lateness also stamps the confirmation
    // (migration 0071), so in practice `confirmed` is true here — but the copy
    // must not depend on that, because the contradiction is what caused the
    // damage, not the column ordering.
    for (const confirmed of [true, false]) {
      const body = notArrivedBody(facts({ lateAtClock: "6:32 pm", confirmed }));
      expect(body).not.toContain("never responded");
      expect(body).not.toContain("no-show");
      // "call them now" is for a coach who has gone quiet. Someone who just
      // messaged you is not that.
      expect(body).not.toContain("call them now");
    }
  });

  it("escalates harder for a coach who confirmed and then went quiet", () => {
    const body = notArrivedBody(facts({ confirmed: true }));
    expect(body).toContain("confirmed they were coming");
    expect(body).toContain("call them now");
    expect(body).not.toContain("running late");
  });

  it("assumes a no-show when the coach has said nothing at all", () => {
    const body = notArrivedBody(facts());
    expect(body).toContain("never responded at all today");
    expect(body).toContain("likely a no-show");
  });

  it("names the coach, the class and the time in every case", () => {
    const cases = [
      facts(),
      facts({ confirmed: true }),
      facts({ lateAtClock: "6:32 pm", confirmed: true }),
    ];
    for (const f of cases) {
      const body = notArrivedBody(f);
      expect(body).toContain("Augustine");
      expect(body).toContain("Beginners Batch");
      expect(body).toContain("6:30 pm");
      // Founder-facing copy never shows ids.
      expect(body).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
    }
  });
});
