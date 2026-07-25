import { test, expect } from "./fixtures";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getStorageState } from "../lib/auth";
import {
  createCoach,
  createClient,
  createGroupSession,
  createPrivateSession,
  SEED,
  minutesFromNow,
  hoursFromNow,
} from "../lib/scenario";
import { expectNotification } from "../lib/notifications";

// A coach's day, the way a coach actually lives it: on a phone, opening the app
// for a moment when they need it — never left running. Each test is one COLD
// OPEN (a brand-new context: no warm session, empty sessionStorage so a pending
// takeover reappears, phone-sized screen). We drive a FRESHLY created coach so
// their world holds only the sessions we seed — deterministic, no interference
// from the seeded schedule. This layer stays thin (screens wire to the RPCs;
// depth lives in Layer 1); its job is the "blind coach" question — when the
// coach opens the app at each moment, is everything they need there and correct?
// Zero tokens per run — it's plain Playwright.

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } as const;

/** One cold open of the PWA as `coachEmail`, on a phone. */
async function coldOpen(
  browser: Browser,
  coachEmail: string
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    ...PHONE,
    storageState: await getStorageState(coachEmail),
  });
  const page = await context.newPage();
  return { context, page };
}

/** The correct venue name for a class, read from the DB — so we assert the UI
 *  shows the *right* location, not a hardcoded guess. */
async function venueNameFor(admin: SupabaseClient, classId: string): Promise<string> {
  const { data, error } = await admin
    .from("classes")
    .select("venues(name)")
    .eq("id", classId)
    .single();
  if (error) throw new Error(`venueNameFor: ${error.message}`);
  const v = (data as { venues: { name: string } | { name: string }[] | null }).venues;
  const name = Array.isArray(v) ? v[0]?.name : v?.name;
  if (!name) throw new Error("venueNameFor: class has no venue");
  return name;
}

const rx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// A clock range like "3:00 pm – 4:00 pm" (component uses an en-dash).
const TIME_RANGE = /\d{1,2}:\d{2}\s*[ap]m\s*[–-]\s*\d{1,2}:\d{2}\s*[ap]m/i;

// ── Moment 1 — "Which class do I go to, and when?" ───────────────────────────
// The coach glances at the app before heading out. The one thing they need —
// where and when their class is — has to be findable at a glance.
test("cold open before class → schedule answers which class, when and where", async ({
  browser,
  admin,
}) => {
  const coach = await createCoach({ fullName: "Blind Coach — Schedule" });
  const session = await createGroupSession({
    coachId: coach.id,
    classId: SEED.groupClass,
    startsAt: hoursFromNow(3),
  });
  // Pre-confirm "coming" so the home takeover doesn't cover the schedule — this
  // moment is purely "where am I going and when", not an action prompt.
  await admin
    .from("class_sessions")
    .update({ coach_confirmed_at: new Date().toISOString() })
    .eq("id", session.sessionId);

  const venueName = await venueNameFor(admin, session.classId);
  const { context, page } = await coldOpen(browser, coach.email);
  await page.goto("/coach");

  // The card is reachable by an accessible label carrying BOTH the place and the
  // time — the two facts "which class do I go to" actually needs.
  await expect(
    page.getByRole("link", { name: new RegExp(`${rx(venueName)}.*[ap]m`, "i") })
  ).toBeVisible();
  await expect(page.getByText(TIME_RANGE).first()).toBeVisible(); // when
  await expect(page.getByText("Group class").first()).toBeVisible(); // what kind
  await expect(page.getByText(/\d+\/\d+/).first()).toBeVisible(); // how full
  await expect(page.getByRole("link", { name: /open maps/i }).first()).toBeVisible(); // how to get there

  await page.screenshot({ path: "test-results/screens/coach-day/01-schedule.png", fullPage: true });
  await context.close();
});

// ── Moment 2 — "The app should tell me what to do." ──────────────────────────
// Opening the app well before the session, the coach shouldn't have to hunt for
// their next action: the "are you coming?" nudge should meet them at the door.
test("cold open well before → app nudges the coach to confirm they're coming", async ({
  browser,
  admin,
}) => {
  const coach = await createCoach({ fullName: "Blind Coach — Coming" });
  const session = await createGroupSession({
    coachId: coach.id,
    classId: SEED.groupClass,
    startsAt: hoursFromNow(3), // >1h out → a "coming?" nudge (not "arrived?"), and <12h
  });

  const { context, page } = await coldOpen(browser, coach.email);
  await page.goto("/coach");

  await expect(page.getByText(/are you coming/i)).toBeVisible();
  await page.screenshot({ path: "test-results/screens/coach-day/02-coming.png", fullPage: true });

  await page.getByRole("button", { name: /yes, i.?m coming/i }).click();
  await expect(page.getByText(/confirmed/i)).toBeVisible();

  // Screen wired to the RPC: the confirmation is actually persisted.
  await expect
    .poll(async () => {
      const { data } = await admin
        .from("class_sessions")
        .select("coach_confirmed_at")
        .eq("id", session.sessionId)
        .single();
      return (data as { coach_confirmed_at: string | null } | null)?.coach_confirmed_at ?? null;
    })
    .not.toBeNull();

  await context.close();
});

// ── Moment 3 — "I'm at the venue, in the class." ─────────────────────────────
// The busiest moment: everything the coach needs mid-class has to live on one
// screen — where/when/who, mark arrival, take the register, and the escape
// hatches if something's gone wrong.
test("cold open at the venue → arrive, take attendance, escape hatches present", async ({
  browser,
  admin,
}) => {
  const coach = await createCoach({ fullName: "Blind Coach — Session" });
  const session = await createGroupSession({
    coachId: coach.id,
    classId: SEED.groupClass,
    startsAt: minutesFromNow(5), // arrival window (opens 1h before) + attendance (15m before) both open
  });
  const parent = await createClient({ children: 1, fullName: "Aanya Rao" });
  const { error } = await admin.from("bookings").insert({
    session_id: session.sessionId,
    client_id: parent.id,
    player_id: parent.playerIds[0],
    status: "confirmed",
  });
  expect(error).toBeNull();

  const venueName = await venueNameFor(admin, session.classId);
  const { data: pl } = await admin
    .from("players")
    .select("full_name")
    .eq("id", parent.playerIds[0])
    .single();
  const childName = (pl as { full_name: string }).full_name;

  const { context, page } = await coldOpen(browser, coach.email);
  await page.goto(`/coach/session/${session.sessionId}`);

  // Everything the coach needs mid-class is on this one screen:
  await expect(page.getByText(venueName).first()).toBeVisible(); // where
  await expect(page.getByText(TIME_RANGE).first()).toBeVisible(); // when
  await expect(page.getByText(childName).first()).toBeVisible(); // who's booked

  // Arrive → parents told, and it actually queues the ping (screen ↔ RPC).
  await page.getByRole("button", { name: /arrived/i }).click();
  await expect(page.getByText(/parents notified/i)).toBeVisible();
  await expectNotification(admin, {
    userId: parent.id,
    type: "coach_arrived",
    dataContains: { session_id: session.sessionId },
  });

  // Attendance → the register records who showed up.
  await page.getByRole("button", { name: new RegExp(`Mark ${rx(childName)} present`, "i") }).click();
  await expect
    .poll(async () => {
      const { data } = await admin
        .from("bookings")
        .select("status")
        .eq("session_id", session.sessionId)
        .single();
      return (data as { status: string } | null)?.status ?? null;
    })
    .toBe("attended");

  // The escape hatches a blind coach must be able to find if something's wrong.
  await expect(page.getByRole("button", { name: /can.?t make it/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /report a problem/i })).toBeVisible();

  await page.screenshot({ path: "test-results/screens/coach-day/03-session.png", fullPage: true });
  await context.close();
});

// ── Moment 4 — "My next stop is a private, at someone's home." ────────────────
// A private is the other half of a coach's day, and it reads differently: no
// venue name — the client's own address — so the schedule card names the *area*
// and marks the session "Private", where a group would name a venue and say
// "Group class". The blind coach must still get the two facts that matter
// (where, when) at a glance, plus a way to navigate. (The client/child identity
// lives on the session screen — Moment 5 — not on this card.)
test("cold open before a private → schedule names the area, marks it private, with the time", async ({
  browser,
  admin,
}) => {
  const coach = await createCoach({ fullName: "Blind Coach — Private Schedule" });
  const priv = await createPrivateSession({
    coachId: coach.id,
    startsAt: hoursFromNow(3),
    locationName: "Palm Meadows",
  });
  // Pre-confirm so the takeover doesn't cover the schedule — this moment is
  // "where am I going and when", not an action prompt.
  await admin
    .from("class_sessions")
    .update({ coach_confirmed_at: new Date().toISOString() })
    .eq("id", priv.sessionId);

  const { context, page } = await coldOpen(browser, coach.email);
  await page.goto("/coach");

  // The card is reachable by an accessible label carrying BOTH the area and the
  // time — a private names the area (never the exact street; "Open maps" covers
  // that), not a venue.
  await expect(
    page.getByRole("link", { name: new RegExp(`${rx(priv.locationName)}.*[ap]m`, "i") })
  ).toBeVisible();
  await expect(page.getByText(TIME_RANGE).first()).toBeVisible(); // when
  await expect(page.getByText("Private").first()).toBeVisible(); // what kind (badge)
  await expect(page.getByText(/private session/i).first()).toBeVisible(); // type line (not "Group class")
  await expect(page.getByRole("link", { name: /open maps/i }).first()).toBeVisible(); // how to get there

  await page.screenshot({
    path: "test-results/screens/coach-day/04-private-schedule.png",
    fullPage: true,
  });
  await context.close();
});

// ── Moment 5 — "I'm at the client's door for the private." ───────────────────
// Mid-private, the one screen has to answer where/when/who and — because it's
// someone's home, not a venue — whether there's a table there. Then arrive
// (parent pinged) and take the register, exactly as for a group.
test("cold open at a private → address not venue, table note, arrive + attendance", async ({
  browser,
  admin,
}) => {
  const coach = await createCoach({ fullName: "Blind Coach — Private Session" });
  const priv = await createPrivateSession({
    coachId: coach.id,
    startsAt: minutesFromNow(5), // arrival + attendance windows both open
    locationName: "Prestige Shantiniketan",
    hasTable: false, // exercise the "none — check with client" branch
  });

  const { context, page } = await coldOpen(browser, coach.email);
  await page.goto(`/coach/session/${priv.sessionId}`);

  // Everything the coach needs mid-private is on this one screen:
  await expect(page.getByText(TIME_RANGE).first()).toBeVisible(); // when
  await expect(page.getByText(priv.playerName).first()).toBeVisible(); // who's booked
  await expect(page.getByText(/private/i).first()).toBeVisible(); // the private badge
  // It's a home, not a venue: the client's own address shows, and the table
  // note tells the coach to bring/expect one.
  await expect(page.getByText(new RegExp(rx(priv.locationName), "i")).first()).toBeVisible();
  await expect(page.getByText(/none.*check with client/i)).toBeVisible();

  // Arrive → parent (the client) told, and it actually queues the ping.
  await page.getByRole("button", { name: /arrived/i }).click();
  await expect(page.getByText(/parents notified/i)).toBeVisible();
  await expectNotification(admin, {
    userId: priv.clientId,
    type: "coach_arrived",
    dataContains: { session_id: priv.sessionId },
  });

  // Attendance → the register records the child showed up.
  await page
    .getByRole("button", { name: new RegExp(`Mark ${rx(priv.playerName)} present`, "i") })
    .click();
  await expect
    .poll(async () => {
      const { data } = await admin
        .from("bookings")
        .select("status")
        .eq("session_id", priv.sessionId)
        .single();
      return (data as { status: string } | null)?.status ?? null;
    })
    .toBe("attended");

  // The same escape hatches must be reachable on a private.
  await expect(page.getByRole("button", { name: /can.?t make it/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /report a problem/i })).toBeVisible();

  await page.screenshot({
    path: "test-results/screens/coach-day/05-private-session.png",
    fullPage: true,
  });
  await context.close();
});
