// notification-fix-plan 2.6 / G9.
//
// The grouped-preference design has one real hazard: the type→group map is
// duplicated in supabase/functions/notify/index.ts, because the worker is Deno
// and can't import from lib/. If the two drift, a member turns a toggle off in
// the app and the messages keep coming — the exact failure the toggle exists to
// prevent, and one nobody would notice from the app side. This test reads the
// worker source and compares.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PREF_GROUP_FOR_TYPE,
  PREF_GROUPS,
  UNMUTABLE,
  isMuted,
} from "./notification-prefs";

function workerMap(): Record<string, string> {
  const src = readFileSync(
    join(process.cwd(), "supabase", "functions", "notify", "index.ts"),
    "utf8"
  );
  const block = /const PREF_GROUP_FOR_TYPE: Record<string, string> = \{([\s\S]*?)\n\};/.exec(src);
  if (!block) throw new Error("PREF_GROUP_FOR_TYPE not found in the notify worker");
  const map: Record<string, string> = {};
  for (const m of block[1].matchAll(/^\s{2}(\w+):\s*"(\w+)",/gm)) map[m[1]] = m[2];
  return map;
}

describe("preference groups", () => {
  it("keeps the worker's type→group map identical to the app's", () => {
    expect(workerMap()).toEqual(PREF_GROUP_FOR_TYPE);
  });

  it("assigns every mapped type to a group that actually exists", () => {
    const keys = new Set(PREF_GROUPS.map((g) => g.key));
    for (const [type, group] of Object.entries(PREF_GROUP_FOR_TYPE)) {
      expect(keys, `${type} → ${group}`).toContain(group);
    }
  });

  it("never makes a safety or money-at-risk type mutable", () => {
    for (const [type] of UNMUTABLE) {
      expect(PREF_GROUP_FOR_TYPE[type], type).toBeUndefined();
      expect(isMuted(type, { reminders: false, progress: false, news: false })).toBe(false);
    }
  });

  it("mutes a whole group with one toggle", () => {
    expect(isMuted("reminder_upcoming", { reminders: false })).toBe(true);
    expect(isMuted("coach_arrived", { reminders: false })).toBe(true);
    expect(isMuted("reminder_upcoming", { reminders: true })).toBe(false);
    // A different group's toggle doesn't touch it.
    expect(isMuted("reminder_upcoming", { news: false })).toBe(false);
  });

  it("honours a legacy per-type choice over the group toggle", () => {
    // A member who turned off just waitlist offers before the regrouping keeps
    // that, even with Reminders left on.
    expect(isMuted("waitlist_spot", { reminders: true, waitlist_spot: false })).toBe(true);
  });

  it("defaults to delivering when nothing is set", () => {
    expect(isMuted("reminder_upcoming", null)).toBe(false);
    expect(isMuted("reminder_upcoming", {})).toBe(false);
    expect(isMuted("some_future_type", { reminders: false })).toBe(false);
  });
});
