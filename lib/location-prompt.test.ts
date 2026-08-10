// The location prompt's whole job is to be shown to the right people and nobody
// else, and "nobody else" is doing more work here than it does for push: a parent
// or the founder has no arrival to mark, so a location request buys them nothing
// and costs the kind of trust that is expensive to get back.
//
// There is no component-test harness in this repo (vitest runs in `node` and
// `include` is lib/ + the worker's pure pieces), so the decision lives in lib/ as
// a pure function and the component is a shell over it. These are the tests that
// would otherwise need a browser.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { LocationState } from "./location";
import {
  LOCATION_PROMPT_COPY,
  LOCATION_STATE_COPY,
  locationPromptFor,
  type LocationPromptKind,
} from "./location-prompt";

/**
 * Every state lib/location.ts can return, read from the source so it can't rot.
 *
 * `\r?\n`, not `\n`: sources in this repo are CRLF, and a pattern anchored on a
 * bare newline matches nothing here.
 */
function declaredLocationStates(): LocationState[] {
  const src = readFileSync(join(process.cwd(), "lib", "location.ts"), "utf8");
  const block = /export type LocationState =([\s\S]*?);\r?\n/.exec(src);
  if (!block) throw new Error("LocationState union not found in lib/location.ts");
  return [...block[1].matchAll(/"(\w+)"/g)].map((m) => m[1] as LocationState);
}

describe("locationPromptFor", () => {
  it("says nothing while the permission is still being read", () => {
    expect(locationPromptFor(null, false, true)).toEqual({ show: false });
    expect(locationPromptFor(null, true, true)).toEqual({ show: false });
  });

  it("asks a coach only in the one state they can act on", () => {
    for (const state of declaredLocationStates()) {
      const decision = locationPromptFor(state, false, true);
      if (state === "prompt") {
        expect(decision, state).toEqual({ show: true, kind: "enable", mode: "modal" });
      } else {
        // granted needs nothing; denied can only be undone in browser site
        // settings; unsupported has no geolocation at all. Each would put a
        // button on screen that cannot finish the job.
        expect(decision, state).toEqual({ show: false });
      }
    }
  });

  it("never asks anyone who has no arrival to mark", () => {
    // Parents and the founder. The prompt is mounted only in the coach shell, so
    // this is belt and braces — but it is the rule most likely to be undone by
    // someone moving one <LocationPrompt /> into a shared layout.
    for (const state of declaredLocationStates()) {
      expect(locationPromptFor(state, false, false), state).toEqual({ show: false });
      expect(locationPromptFor(state, true, false), state).toEqual({ show: false });
    }
    expect(locationPromptFor(null, false, false)).toEqual({ show: false });
  });

  it("covers every declared state, so a new one can't slip past silently", () => {
    const declared = declaredLocationStates();
    expect(declared.length).toBeGreaterThan(0);
    // If lib/location.ts grows a state, this fails until someone decides whether
    // it is worth asking about and what to tell a coach it means.
    expect(new Set(Object.keys(LOCATION_STATE_COPY))).toEqual(new Set(declared));
  });

  it("interrupts once, then steps back to a card for the rest of the session", () => {
    expect(locationPromptFor("prompt", false, true)).toMatchObject({ mode: "modal" });
    expect(locationPromptFor("prompt", true, true)).toMatchObject({ mode: "card" });
  });

  it("keeps asking after a dismissal rather than going quiet for good", () => {
    // Session-scoped by design: a fresh session reads `dismissed: false` again.
    // A permanent opt-out is how push got to 1-of-75, and auto-arrival to 1-of-43.
    expect(locationPromptFor("prompt", true, true)).toMatchObject({ show: true });
  });
});

describe("location prompt copy", () => {
  it("gives the ask a button and a way out", () => {
    for (const kind of Object.keys(LOCATION_PROMPT_COPY) as LocationPromptKind[]) {
      expect(LOCATION_PROMPT_COPY[kind].confirm, kind).toBeTruthy();
      expect(LOCATION_PROMPT_COPY[kind].dismiss, kind).toBeTruthy();
      expect(LOCATION_PROMPT_COPY[kind].title, kind).toBeTruthy();
      expect(LOCATION_PROMPT_COPY[kind].body, kind).toBeTruthy();
    }
  });

  it("names both halves of the trade, because only one of them is obvious", () => {
    // A coach reading a location request assumes the opposite of what this does.
    // The body has to say when we look, and that we do not look otherwise —
    // that honesty is the thing being asked to earn the permission, so it is
    // worth a test rather than a comment somebody later trims.
    const body = LOCATION_PROMPT_COPY.enable.body;
    expect(body).toMatch(/open/i);
    expect(body).toMatch(/never follows you|doesn't follow|never track|does not track/i);
  });

  it("keeps LocationToggle reading the shared copy rather than its own fork", () => {
    const src = readFileSync(
      join(process.cwd(), "components", "app", "LocationToggle.tsx"),
      "utf8"
    );
    expect(src).toContain("LOCATION_STATE_COPY");
    // A second literal map in the component is the drift this module exists to
    // stop — two surfaces telling one coach different things about their phone.
    expect(src).not.toMatch(/Record<LocationState, string> = \{/);
  });
});
