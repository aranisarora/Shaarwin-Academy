// Two permission dialogs must never be on screen together, and location must
// never be asked of anyone who has no arrival to mark. Both rules are enforced
// by *wiring* — which prompt is mounted where, and what holds the slot — so
// neither is reachable from a pure function call, and a component harness
// doesn't exist here (vitest runs in `node` by design).
//
// So these read the sources. That is unusual, and it is deliberate: the failure
// modes being guarded are "somebody moved <LocationPrompt /> into the shared
// layout" and "somebody let the queued prompt render before push had settled",
// and both are edits to wiring rather than to logic. lib/push-prompt.test.ts
// already does the same thing to keep PushToggle on the shared copy map.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isClaiming, markDismissed, readDismissed } from "./permission-prompt";

function source(...parts: string[]): string {
  return readFileSync(join(process.cwd(), ...parts), "utf8");
}

describe("isClaiming", () => {
  it("counts a dismissed prompt's card as still holding the slot", () => {
    // The coach has spent their patience for this session. Following a "Not now"
    // immediately with a different dialog is what teaches people to dismiss the
    // next one unread.
    expect(isClaiming({ show: true, kind: "enable", mode: "card" })).toBe(true);
    expect(isClaiming({ show: true, kind: "enable", mode: "modal" })).toBe(true);
  });

  it("frees the slot only when there is nothing to ask", () => {
    expect(isClaiming({ show: false })).toBe(false);
  });
});

describe("dismissal storage", () => {
  // vitest runs in `node`, so there is no sessionStorage here — which is exactly
  // the private-mode case these two have to survive on a real phone.
  it("reads as not-dismissed when storage is unavailable", () => {
    expect(readDismissed("sharwin:test-key")).toBe(false);
  });

  it("swallows a failed write rather than breaking the prompt", () => {
    expect(() => markDismissed("sharwin:test-key")).not.toThrow();
  });
});

describe("prompt queue wiring", () => {
  it("holds a queued prompt back until push has actually settled", () => {
    const src = source("components", "app", "PushPrompt.tsx");
    // `state === null` means the device is still being read. Rendering `thenAsk`
    // then would let the location dialog appear a millisecond before the push one
    // — two dialogs, in the order nobody chose.
    expect(src).toMatch(/if \(state === null\) return null;/);
    // And the slot is handed over on the *decision*, not on a hand-rolled state
    // check that could drift from pushPromptFor — isClaiming() is where "a card
    // still counts" is written down.
    expect(src).toMatch(/if \(!isClaiming\(decision\)\) return <>\{thenAsk\}<\/>;/);
  });

  it("asks for location in the coach shell and nowhere else", () => {
    const coach = source("app", "coach", "layout.tsx");
    expect(coach).toContain("<PushPrompt thenAsk={<LocationPrompt />} />");

    // Parents and the founder. A location request buys them nothing, and this is
    // the edit that would quietly undo that — one import in the wrong layout.
    for (const shell of ["app", "admin"]) {
      const src = source("app", shell, "layout.tsx");
      expect(src, shell).not.toContain("LocationPrompt");
      // They keep the plain push ask, with nothing queued behind it.
      expect(src, shell).toContain("<PushPrompt />");
    }
  });

  it("keeps every prompt on the shared shell rather than its own modal", () => {
    // A second focus trap is how two prompts start behaving differently on the
    // same phone — one of them trapping Tab, the other not.
    for (const prompt of ["PushPrompt.tsx", "LocationPrompt.tsx"]) {
      const src = source("components", "app", prompt);
      expect(src, prompt).toContain("PermissionPrompt");
      expect(src, prompt).not.toContain("createPortal");
    }
  });
});
