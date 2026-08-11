import { describe, it, expect } from "vitest";
import { appendLink, sessionLink, sessionPath } from "./links.ts";

// The founder reads these on WhatsApp, not in the app. A deep link that arrives
// truncated, doubled, or attached to the wrong kind of row costs him the tap it
// was added to save.

const APP = "https://sharwinacademy.com";

describe("sessionPath", () => {
  it("takes the founder's schedule link, which names the week AND the session", () => {
    expect(
      sessionPath({ session_id: "abc", url: "/admin/schedule?date=2026-08-11&session=abc" })
    ).toBe("/admin/schedule?date=2026-08-11&session=abc");
  });

  it("takes a coach's session page", () => {
    expect(sessionPath({ session_id: "abc", url: "/coach/session/abc" })).toBe(
      "/coach/session/abc"
    );
    // ?wrap=1 tells the app why the coach is arriving; it is still one session.
    expect(sessionPath({ session_id: "abc", url: "/coach/session/abc?wrap=1" })).toBe(
      "/coach/session/abc?wrap=1"
    );
  });

  it("refuses a bare schedule, which is a week to search rather than a session", () => {
    expect(sessionPath({ session_id: "abc", url: "/admin/schedule" })).toBe("");
    expect(sessionPath({ session_id: "abc", url: "/admin/schedule?date=2026-08-11" })).toBe("");
  });

  it("refuses a session_id that is only along for the ride", () => {
    // The parent's arrival ping carries session_id for the sender's benefit and
    // points at the app home. Promising "open the session" there is a lie.
    expect(sessionPath({ session_id: "abc", url: "/app" })).toBe("");
    expect(sessionPath({ session_id: "abc" })).toBe("");
  });

  it("refuses ?session= on a route where it means something else", () => {
    // /coach/players/<player>?session=<id> means "the class this assessment
    // belongs to". That link opens a player, not a session.
    expect(sessionPath({ session_id: "abc", url: "/coach/players/p1?session=abc" })).toBe("");
  });

  it("survives a data column that is not an object", () => {
    // jsonb is free-form and written by a dozen Postgres functions. A worker
    // that throws here stops delivering every notification behind it.
    expect(sessionPath(null)).toBe("");
    expect(sessionPath(undefined)).toBe("");
    expect(sessionPath([] as unknown as Record<string, unknown>)).toBe("");
    expect(sessionPath({ session_id: 42, url: 7 } as unknown as Record<string, unknown>)).toBe("");
  });
});

describe("sessionLink", () => {
  it("makes the path absolute", () => {
    expect(sessionLink({ session_id: "a", url: "/coach/session/a" }, APP)).toBe(
      "https://sharwinacademy.com/coach/session/a"
    );
  });

  it("does not double the slash when APP_URL is set with a trailing one", () => {
    expect(sessionLink({ session_id: "a", url: "/coach/session/a" }, `${APP}/`)).toBe(
      "https://sharwinacademy.com/coach/session/a"
    );
  });

  it("is empty for a row that is not about one session", () => {
    expect(sessionLink({ url: "/app" }, APP)).toBe("");
  });
});

describe("appendLink", () => {
  const link = `${APP}/admin/schedule?date=2026-08-11&session=abc`;

  it("puts the link on the end", () => {
    expect(appendLink("Ravi hasn't marked arrived.", link, 900, "\n")).toBe(
      `Ravi hasn't marked arrived.\n${link}`
    );
  });

  it("keeps the link whole when the budget bites", () => {
    // The defect this pins: cap the finished string and the URL loses its tail,
    // so the founder taps a 404 in the middle of the thing it was warning him
    // about. The words give way, never the link.
    const body = "x".repeat(2000);
    const out = appendLink(body, link, 900, " ");
    expect(out.length).toBeLessThanOrEqual(900);
    expect(out.endsWith(link)).toBe(true);
  });

  it("leaves a body that already links alone", () => {
    // coach_after_class writes its own url into its sentence. Two links a few
    // words apart is noise, and a chance for them to disagree.
    const body = `Please confirm attendance: ${APP}/coach/session/abc?wrap=1`;
    expect(appendLink(body, link, 900, "\n")).toBe(body);
  });

  it("keeps the words when there is no room to say anything beside the link", () => {
    const out = appendLink("Ravi hasn't marked arrived.", link, 60, " ");
    expect(out).toBe("Ravi hasn't marked arrived.");
  });

  it("is the plain body when there is no link", () => {
    expect(appendLink("Coach has arrived.", "", 900, "\n")).toBe("Coach has arrived.");
  });

  it("still respects the budget with no link to add", () => {
    expect(appendLink("x".repeat(2000), "", 900, "\n")).toHaveLength(900);
  });
});
