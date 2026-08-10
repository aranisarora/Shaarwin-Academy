// The prompt's whole job is to be shown to the right people and nobody else.
// Getting that wrong is expensive in both directions: too shy and push stays at
// one subscriber, too eager and we interrupt someone with a dialog whose button
// cannot do anything — a browser that blocks notifications, a build with no
// VAPID key, a session that has expired.
//
// There is no component-test harness in this repo (vitest runs in `node` and
// `include` is lib/ + the worker's pure pieces), so the decision lives in lib/
// as a pure function and the component is a shell over it. These are the tests
// that would otherwise need a browser.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PushState } from "./push";
import {
  PROMPT_COPY,
  PUSH_STATE_COPY,
  pushPromptFor,
  type PromptKind,
} from "./push-prompt";

/**
 * Every state lib/push.ts can return, read from the source so it can't rot.
 *
 * `\r?\n`, not `\n`: sources in this repo are CRLF, and a pattern anchored on a
 * bare newline matches nothing here.
 */
function declaredPushStates(): PushState[] {
  const src = readFileSync(join(process.cwd(), "lib", "push.ts"), "utf8");
  const block = /export type PushState =([\s\S]*?);\r?\n/.exec(src);
  if (!block) throw new Error("PushState union not found in lib/push.ts");
  return [...block[1].matchAll(/\|\s*"(\w+)"/g)].map((m) => m[1] as PushState);
}

const ASKED: Record<string, PromptKind> = { off: "enable", needs_install: "install" };

describe("pushPromptFor", () => {
  it("says nothing while the device is still being read", () => {
    expect(pushPromptFor(null, false)).toEqual({ show: false });
    expect(pushPromptFor(null, true)).toEqual({ show: false });
  });

  it("asks exactly the two states a person can act on, and no others", () => {
    for (const state of declaredPushStates()) {
      const decision = pushPromptFor(state, false);
      const expected = ASKED[state];
      if (expected) {
        expect(decision, state).toEqual({ show: true, kind: expected, mode: "modal" });
      } else {
        // denied, unsupported, not_configured, signed_out, save_failed,
        // subscribed — every one of these would put a button on screen that
        // cannot finish the job.
        expect(decision, state).toEqual({ show: false });
      }
    }
  });

  it("covers every declared state, so a new one can't slip past silently", () => {
    const declared = declaredPushStates();
    expect(declared.length).toBeGreaterThan(0);
    for (const state of declared) {
      expect(PUSH_STATE_COPY, state).toHaveProperty(state);
    }
    // If lib/push.ts grows a state, this fails until someone decides whether it
    // is worth asking about.
    expect(new Set(Object.keys(PUSH_STATE_COPY))).toEqual(new Set(declared));
  });

  it("interrupts once, then steps back to a card for the rest of the session", () => {
    expect(pushPromptFor("off", false)).toMatchObject({ mode: "modal" });
    expect(pushPromptFor("off", true)).toMatchObject({ mode: "card" });
    expect(pushPromptFor("needs_install", false)).toMatchObject({ mode: "modal" });
    expect(pushPromptFor("needs_install", true)).toMatchObject({ mode: "card" });
  });

  it("keeps asking after a dismissal rather than going quiet for good", () => {
    // The dismissal is session-scoped by design: a fresh session reads
    // `dismissed: false` again. A permanent opt-out is how push got to 1-of-75.
    const dismissed = pushPromptFor("off", true);
    expect(dismissed).toMatchObject({ show: true });
  });
});

describe("prompt copy", () => {
  it("offers an action for enable and deliberately none for iOS install", () => {
    expect(PROMPT_COPY.enable.confirm).toBeTruthy();
    // On iOS the work happens in Safari's share menu; a "Turn on" button would
    // open a permission prompt that cannot exist until the app is installed.
    expect(PROMPT_COPY.install.confirm).toBeNull();
  });

  it("always gives a way out", () => {
    for (const kind of Object.keys(PROMPT_COPY) as PromptKind[]) {
      expect(PROMPT_COPY[kind].dismiss, kind).toBeTruthy();
      expect(PROMPT_COPY[kind].title, kind).toBeTruthy();
      expect(PROMPT_COPY[kind].body, kind).toBeTruthy();
    }
  });

  it("tells iOS the same story the settings card does", () => {
    expect(PROMPT_COPY.install.body).toBe(PUSH_STATE_COPY.needs_install);
  });

  it("keeps PushToggle reading the shared copy rather than its own fork", () => {
    const src = readFileSync(
      join(process.cwd(), "components", "app", "PushToggle.tsx"),
      "utf8"
    );
    expect(src).toContain("PUSH_STATE_COPY");
    // A second literal map in the component is the drift this module exists to
    // stop — two surfaces telling one person different things about their phone.
    expect(src).not.toMatch(/const COPY: Record<PushState, string> = \{/);
  });
});
