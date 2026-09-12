// notification-fix-plan 2.6 / G9.
//
// The declarative type table has one real hazard: it is duplicated in
// supabase/functions/notify/index.ts, because the worker is Deno and can't
// import from lib/. If the two drift, a member turns a toggle off in the app
// and the messages keep coming — the exact failure the toggle exists to
// prevent, and one nobody would notice from the app side.
//
// This test reads the worker source and compares. It used to check only the
// type→group map; now that routing, quiet hours, STOP-override and feed-only
// all live in the same table, it compares every column — a drift in `answer`
// (does this go out on WhatsApp at all?) is a worse bug than a drift in `mute`
// and was previously untested.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  NOTIFICATION_TYPES,
  PREF_GROUP_FOR_TYPE,
  PREF_GROUPS,
  UNMUTABLE,
  isMuted,
  type NotificationRule,
} from "./notification-prefs";

/**
 * Parse the worker's TYPES table out of its source.
 *
 * Every entry is deliberately written on one line in a fixed field order, which
 * is what makes this parseable without a TypeScript compiler in the test. A
 * malformed or multi-line entry makes the count assertion below fail rather
 * than silently going unchecked.
 */
function workerTable(): Record<string, NotificationRule> {
  const src = readFileSync(
    join(process.cwd(), "supabase", "functions", "notify", "index.ts"),
    "utf8"
  );
  const block = /const TYPES: Record<string, NotificationRule> = \{([\s\S]*?)\n\};/.exec(src);
  if (!block) throw new Error("TYPES not found in the notify worker");

  const table: Record<string, NotificationRule> = {};
  for (const m of block[1].matchAll(/^\s{2}(\w+):\s*\{([^}]*)\},\s*$/gm)) {
    const [, type, fields] = m;
    const who = /who:\s*"(\w+)"/.exec(fields)?.[1];
    const answer = /answer:\s*(true|false)/.exec(fields)?.[1];
    const muteRaw = /mute:\s*(?:"(\w+)"|false)/.exec(fields);
    const defer = /defer:\s*(true|false)/.exec(fields)?.[1];
    if (!who || !answer || !muteRaw || !defer) {
      throw new Error(`unparseable TYPES entry in the worker: ${type}`);
    }
    const rule: NotificationRule = {
      who: who as NotificationRule["who"],
      answer: answer === "true",
      mute: (muteRaw[1] as NotificationRule["mute"]) ?? false,
      defer: defer === "true",
    };
    if (/critical:\s*true/.test(fields)) rule.critical = true;
    if (/feedOnly:\s*true/.test(fields)) rule.feedOnly = true;
    table[type] = rule;
  }
  return table;
}

describe("the notification type table", () => {
  it("is identical in the worker and the app", () => {
    expect(workerTable()).toEqual(NOTIFICATION_TYPES);
  });

  it("parsed every row rather than skipping malformed ones", () => {
    // Guards the regex above: if an entry is reformatted onto two lines it
    // would silently vanish from the comparison and the drift check with it.
    expect(Object.keys(workerTable()).length).toBe(Object.keys(NOTIFICATION_TYPES).length);
  });

  it("assigns every muted type to a group that actually exists", () => {
    const keys = new Set(PREF_GROUPS.map((g) => g.key));
    for (const [type, group] of Object.entries(PREF_GROUP_FOR_TYPE)) {
      expect(keys, `${type} → ${group}`).toContain(group);
    }
  });

  it("never makes a safety or money-at-risk type mutable", () => {
    for (const [type] of UNMUTABLE) {
      expect(PREF_GROUP_FOR_TYPE[type], type).toBeUndefined();
      expect(NOTIFICATION_TYPES[type]?.mute, type).toBe(false);
      expect(isMuted(type, { reminders: false, progress: false, news: false })).toBe(false);
    }
  });

  it("never delivers a feed-only type", () => {
    // feedOnly short-circuits before routing, so an `answer: true` feed row
    // would be a contradiction the worker resolves silently in favour of the
    // feed. Better to catch it here than to wonder why it never arrived.
    for (const [type, rule] of Object.entries(NOTIFICATION_TYPES)) {
      if (rule.feedOnly) expect(rule.answer, type).toBe(false);
    }
  });

  it("keeps every critical type on WhatsApp", () => {
    // `critical` means it overrides a preference and a STOP. Letting a push
    // banner satisfy one would undo the point: these are the messages we send
    // when someone's money or their child is involved.
    for (const [type, rule] of Object.entries(NOTIFICATION_TYPES)) {
      if (rule.critical) expect(rule.answer, type).toBe(true);
    }
  });
});

describe("preference groups", () => {
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
