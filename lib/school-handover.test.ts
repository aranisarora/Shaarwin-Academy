// The handover message is the only instruction a school ever gets, and nobody
// on our side reads it before it is sent. These are the promises it makes.

import { describe, it, expect } from "vitest";
import {
  APP_ORIGIN,
  LINK_TOKEN_KEY,
  SCHOOL_ENTER_PATH,
  SCHOOL_LOGIN_PATH,
  handoverText,
  instantLoginUrl,
  schoolLoginUrl,
  unpack,
} from "./school-handover";

const EMAIL = "tisb-sports-block@schools.sharwin.local";
const PASSWORD = "falcon-orchid-4821";

/** What the school's page does with the link, in one line — so the round trip
 *  is tested end to end and not just half of it. */
const redeem = (url: string) =>
  unpack(new URLSearchParams(new URL(url).hash.slice(1)).get(LINK_TOKEN_KEY) ?? "");

describe("instantLoginUrl", () => {
  it("hands the page back exactly what was packed", () => {
    expect(redeem(instantLoginUrl(EMAIL, PASSWORD))).toEqual({
      email: EMAIL,
      password: PASSWORD,
    });
  });

  it("survives a password with URL punctuation in it", () => {
    // Generated passwords are word-word-digits today. This is here so the day
    // someone widens the alphabet, the link does not quietly start truncating.
    const awkward = "a+b/c=d&e?f#g h%i";
    expect(redeem(instantLoginUrl(EMAIL, awkward))?.password).toBe(awkward);
  });

  it("survives a school's own address with a plus tag", () => {
    const tagged = "sports+tt@inventureacademy.com";
    expect(redeem(instantLoginUrl(tagged, PASSWORD))?.email).toBe(tagged);
  });

  it("keeps the credential in the fragment, never the query", () => {
    const url = new URL(instantLoginUrl(EMAIL, PASSWORD));
    // The whole design rests on this: a fragment is not sent to any server, so
    // it stays out of our logs and out of WhatsApp's preview fetch.
    expect(url.search).toBe("");
    expect(url.hash).not.toBe("");
    expect(url.pathname).toBe(SCHOOL_ENTER_PATH);
    // And the plaintext itself must not be readable straight off the URL.
    expect(url.hash).not.toContain(PASSWORD);
  });

  it("lands on the redeem screen, which sits under the school form", () => {
    // Nested on purpose: whatever gates one gates the other.
    expect(SCHOOL_ENTER_PATH.startsWith(`${SCHOOL_LOGIN_PATH}/`)).toBe(true);
  });
});

describe("unpack", () => {
  it("refuses rubbish rather than throwing", () => {
    // This parses a string a stranger controls. Every one of these has to come
    // back as "no credential", because the page's answer to null is the form.
    for (const junk of ["", "!!!!", "not-base64", "YWJj", btoa("only-an-email")]) {
      expect(unpack(junk)).toBeNull();
    }
  });
});

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

  it("leads with the tap-to-enter link", () => {
    const link = instantLoginUrl(EMAIL, PASSWORD);
    expect(text).toContain(link);
    // Before the typed fallback, or the fallback is what gets read first — and
    // the whole point is that almost nobody should have to read it.
    expect(text.indexOf(link)).toBeLessThan(text.indexOf(`Email: ${EMAIL}`));
  });

  it("carries a link that really does redeem to this credential", () => {
    // The message is the only place these two are ever put side by side, so a
    // link built from stale state would be invisible everywhere else.
    const link = text.split("\n").find((l) => l.includes("#"));
    expect(redeem(link!)).toEqual({ email: EMAIL, password: PASSWORD });
  });

  it("still spells out both halves for a broken link", () => {
    expect(text).toContain(`${APP_ORIGIN}${SCHOOL_LOGIN_PATH}`);
    expect(text.split("\n")).toContain(`Email: ${EMAIL}`);
    expect(text.split("\n")).toContain(`Password: ${PASSWORD}`);
  });

  it("warns that the link lets in whoever taps it", () => {
    // A school forwarding this to a parents' group has given away the account.
    expect(text).toContain("signs in whoever taps it");
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
