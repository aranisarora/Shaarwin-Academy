// The matcher is the risky half of opt-out: it runs ahead of the interactive
// handler and the LLM, so a false positive silences a paying family and nobody
// finds out until they complain. These tests pin the boundary in both
// directions. (notification-fix-plan 2.3.)

import { describe, it, expect } from "vitest";
import { matchOptOut } from "./optout";

describe("matchOptOut", () => {
  it("recognises the unambiguous stop words, however they're typed", () => {
    for (const word of ["STOP", "stop", " Stop ", "STOP.", "unsubscribe", "STOPALL"]) {
      expect(matchOptOut(word)).toBe("stop");
    }
  });

  it("recognises the resubscribe words", () => {
    for (const word of ["START", "start", " Start!", "unstop", "RESUME"]) {
      expect(matchOptOut(word)).toBe("start");
    }
  });

  it("does NOT treat cancel/end/quit as opt-out", () => {
    // Twilio's standard keyword set includes these, but in this product a
    // parent typing "cancel" means "cancel my booking" — silencing them
    // instead would be a serious, silent failure.
    for (const word of ["cancel", "CANCEL", "end", "quit"]) {
      expect(matchOptOut(word)).toBeNull();
    }
  });

  it("does NOT treat yes/no as resubscribe", () => {
    // Coaches type "yes" to confirm a class.
    for (const word of ["yes", "YES", "no", "y"]) {
      expect(matchOptOut(word)).toBeNull();
    }
  });

  it("only matches the whole message, never a substring", () => {
    for (const text of [
      "please stop sending me these",
      "can you stop the reminders",
      "we need to start early tomorrow",
      "stop by the venue at 6",
    ]) {
      expect(matchOptOut(text)).toBeNull();
    }
  });

  it("ignores ordinary conversation", () => {
    expect(matchOptOut("Where is he?")).toBeNull();
    expect(matchOptOut("I've arrived")).toBeNull();
    expect(matchOptOut("")).toBeNull();
  });
});
