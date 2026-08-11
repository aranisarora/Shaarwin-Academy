import { describe, it, expect } from "vitest";
import {
  clockRange,
  locationPhrase,
  notArrivedBody,
  notArrivedTitle,
  unconfirmedBody,
  unconfirmedTitle,
  type EscalationFacts,
  type NotArrivedFacts,
} from "./escalation.ts";

// The two founder escalations. The bug pinned here reached production and was
// invisible in the data: a coach who tapped "Running late" left the session row
// looking exactly like a coach who had ignored everything, because
// coach_mark_arrival's late branch wrote nothing to class_sessions. So the
// founder's phone buzzed with "Coach Augustine is running a few minutes late"
// and then, minutes later, "Augustine never responded at all today — likely a
// no-show, act now."

function facts(over: Partial<EscalationFacts> = {}): EscalationFacts {
  return {
    coachName: "Augustine",
    classTitle: "Beginners Batch",
    location: "MCF Court",
    startsClock: "6:30 pm",
    endsClock: "7:30 pm",
    ...over,
  };
}

function notArrived(over: Partial<NotArrivedFacts> = {}): NotArrivedFacts {
  return { ...facts(), confirmed: false, lateAtClock: null, ...over };
}

describe("clockRange", () => {
  it("says one am/pm when both ends share it", () => {
    expect(clockRange("6:30 pm", "7:30 pm")).toBe("6:30-7:30 pm");
  });

  // Collapsing here would move the class by twelve hours — the one formatting
  // slip in this file that sends the founder to an empty hall.
  it("keeps both when the session straddles noon or midnight", () => {
    expect(clockRange("11:30 am", "12:30 pm")).toBe("11:30 am-12:30 pm");
    expect(clockRange("11:30 pm", "12:30 am")).toBe("11:30 pm-12:30 am");
  });

  it("degrades to whichever end it has rather than printing a dangling dash", () => {
    expect(clockRange("6:30 pm", "")).toBe("6:30 pm");
    expect(clockRange("", "7:30 pm")).toBe("7:30 pm");
  });
});

describe("locationPhrase", () => {
  // A dropped clause reads as "this class has no venue problem", which is the
  // opposite of what an empty location_label means.
  it("admits the venue is missing instead of dropping it", () => {
    expect(locationPhrase("")).toBe("location TBC");
    expect(locationPhrase("   ")).toBe("location TBC");
    expect(locationPhrase("MCF Court")).toBe("MCF Court");
  });
});

describe("titles", () => {
  // On a banner, or in a feed of twenty, the title is all the founder reads.
  // "Coach hasn't confirmed" twenty times over is one indistinguishable wall;
  // the name tells him who to ring before he opens anything.
  it("names the coach", () => {
    expect(unconfirmedTitle(facts())).toBe("Augustine hasn't confirmed");
    expect(notArrivedTitle(facts())).toBe("Augustine hasn't marked arrived");
  });

  it("still reads as English when the profile carries no name", () => {
    for (const blank of ["", "   "]) {
      expect(unconfirmedTitle(facts({ coachName: blank }))).toBe("Coach hasn't confirmed");
      expect(notArrivedTitle(facts({ coachName: blank }))).toBe("Coach hasn't marked arrived");
    }
  });

  // Push titles truncate around 40-50 characters, so the class, the venue and
  // the times stay in the body. A title that spends its budget on "Beginners
  // Batch at MCF Court" loses the name, which is the only part that varies.
  it("stays short enough to survive a push banner", () => {
    const long = facts({ coachName: "Augustine Rajkumar", classTitle: "Sunday Advanced Batch" });
    expect(unconfirmedTitle(long).length).toBeLessThanOrEqual(50);
    expect(notArrivedTitle(long).length).toBeLessThanOrEqual(50);
    expect(unconfirmedTitle(long)).not.toContain("Sunday Advanced Batch");
  });
});

describe("unconfirmedBody", () => {
  it("says who, which class, where and from when to when", () => {
    const body = unconfirmedBody(facts());
    expect(body).toContain("Augustine");
    expect(body).toContain("Beginners Batch");
    expect(body).toContain("MCF Court");
    expect(body).toContain("6:30-7:30 pm");
    expect(body).toContain("starts in ~10 min");
  });

  it("admits a missing venue rather than dropping the clause", () => {
    expect(unconfirmedBody(facts({ location: "" }))).toContain("location TBC");
  });
});

describe("notArrivedBody", () => {
  it("says the coach told us they were late, and when", () => {
    const body = notArrivedBody(notArrived({ lateAtClock: "6:32 pm", confirmed: true }));
    expect(body).toContain("said at 6:32 pm they were running late");
    expect(body).toContain("Beginners Batch");
    expect(body).toContain("6:30-7:30 pm");
    expect(body).toContain("worth a check");
  });

  it("never tells the founder a coach was silent when that coach reported lateness", () => {
    // The regression itself. Reporting lateness also stamps the confirmation
    // (migration 0071), so in practice `confirmed` is true here — but the copy
    // must not depend on that, because the contradiction is what caused the
    // damage, not the column ordering.
    for (const confirmed of [true, false]) {
      const body = notArrivedBody(notArrived({ lateAtClock: "6:32 pm", confirmed }));
      expect(body).not.toContain("never responded");
      expect(body).not.toContain("no-show");
      // "call them now" is for a coach who has gone quiet. Someone who just
      // messaged you is not that.
      expect(body).not.toContain("call them now");
    }
  });

  it("escalates harder for a coach who confirmed and then went quiet", () => {
    const body = notArrivedBody(notArrived({ confirmed: true }));
    expect(body).toContain("confirmed they were coming");
    expect(body).toContain("call them now");
    expect(body).not.toContain("running late");
  });

  it("assumes a no-show when the coach has said nothing about THIS session", () => {
    const body = notArrivedBody(notArrived());
    expect(body).toContain("hasn't answered anything about it");
    expect(body).toContain("likely a no-show");
  });

  // Every fact this function gets describes ONE session, so no sentence may
  // widen into a claim about the coach's day. On 10 Aug the silent branch told
  // three founders that Sunil Hatti had "never responded at all today" about a
  // 7pm class — eleven hours after he answered the 8:50am one on two channels,
  // and fifty minutes before the system congratulated him for finishing the
  // 7pm one. Same shape as the lateness bug above: a true row, a false
  // sentence.
  it("never makes a claim about the whole day from one session's silence", () => {
    const all = [
      notArrived(),
      notArrived({ confirmed: true }),
      notArrived({ lateAtClock: "6:32 pm" }),
    ];
    for (const f of all) {
      expect(notArrivedBody(f)).not.toContain("today");
    }
  });

  // Three Tuesday batches share a title shape and a coach; the founder decides
  // whether to drive across town from the banner alone, so every branch has to
  // carry the venue and the full window, not just a start time.
  it("names the coach, the class, the venue and both clock times in every case", () => {
    const all = [
      notArrived(),
      notArrived({ confirmed: true }),
      notArrived({ lateAtClock: "6:32 pm", confirmed: true }),
    ];
    for (const f of all) {
      const body = notArrivedBody(f);
      expect(body).toContain("Augustine");
      expect(body).toContain("Beginners Batch");
      expect(body).toContain("MCF Court");
      expect(body).toContain("6:30-7:30 pm");
      // Founder-facing copy never shows ids.
      expect(body).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
    }
    for (const f of all) {
      expect(notArrivedBody({ ...f, location: "" })).toContain("location TBC");
    }
  });
});
