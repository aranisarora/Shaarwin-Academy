// The handover message is the only instruction a school ever gets, and nobody
// on our side reads it before it is sent. These are the promises it makes.

import { describe, it, expect } from "vitest";
import {
  APP_ORIGIN,
  SCHOOL_LOGIN_PATH,
  handoverText,
  schoolLoginUrl,
} from "./school-handover";

const EMAIL = "tisb-sports-block@schools.sharwin.local";
const PASSWORD = "falcon-orchid-4821";

describe("schoolLoginUrl", () => {
  it("points at the school sign-in screen with the email prefilled", () => {
    const url = new URL(schoolLoginUrl(EMAIL));
    expect(url.pathname).toBe(SCHOOL_LOGIN_PATH);
    // Read back through URL parsing, because that is what the page does: if the
    // "@" is not escaped in a way the browser survives, the page fills in a
    // truncated address and the school types the rest of it into the password.
    expect(url.searchParams.get("email")).toBe(EMAIL);
  });

  it("never carries the password", () => {
    expect(schoolLoginUrl(EMAIL)).not.toContain(PASSWORD);
  });

  it("uses the configured origin, not a preview host", () => {
    expect(schoolLoginUrl(EMAIL).startsWith(`${APP_ORIGIN}/`)).toBe(true);
  });
});

describe("handoverText", () => {
  const text = handoverText("TISB · Sports block", EMAIL, PASSWORD);

  it("leads with the tappable prefilled link", () => {
    expect(text).toContain(schoolLoginUrl(EMAIL));
    // Before the typed fallback, or the fallback is what gets read first.
    expect(text.indexOf(schoolLoginUrl(EMAIL))).toBeLessThan(
      text.indexOf(`Email: ${EMAIL}`)
    );
  });

  it("still spells out both halves for a broken link", () => {
    expect(text).toContain(`${APP_ORIGIN}${SCHOOL_LOGIN_PATH}`);
    expect(text).toContain(`Email: ${EMAIL}`);
    expect(text).toContain(`Password: ${PASSWORD}`);
  });

  it("puts the password on a line of its own to copy", () => {
    expect(text.split("\n")).toContain(PASSWORD);
  });

  it("says a minted address is not an inbox", () => {
    expect(text).toContain("only a username");
  });

  it("does not say that about a school's real inbox", () => {
    const real = handoverText("Inventure", "sports@inventureacademy.com", PASSWORD);
    expect(real).not.toContain("only a username");
    expect(real).toContain('no "forgot password" link');
  });

  it("never tells a school to check its email", () => {
    expect(text.toLowerCase()).not.toContain("check your email");
  });

  it("is plain text — no markdown WhatsApp would show literally", () => {
    expect(text).not.toMatch(/\[.+\]\(.+\)/);
    expect(text).not.toMatch(/\*\*/);
  });
});
