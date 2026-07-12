import { describe, expect, it } from "vitest";
import { normalizePhone, normalizePhoneInput } from "./phone";

describe("normalizePhone", () => {
  it("keeps a clean E.164 number", () => {
    expect(normalizePhone("+919812345678")).toBe("+919812345678");
  });

  it("strips spaces, dashes and parentheses", () => {
    expect(normalizePhone("+91 98123-45678")).toBe("+919812345678");
    expect(normalizePhone("+91 (98) 1234 5678")).toBe("+919812345678");
  });

  it("strips a whatsapp: transport prefix", () => {
    expect(normalizePhone("whatsapp:+919812345678")).toBe("+919812345678");
  });

  it("adds a leading + when missing", () => {
    expect(normalizePhone("919812345678")).toBe("+919812345678");
  });

  it("converts a 00 international prefix to +", () => {
    expect(normalizePhone("00919812345678")).toBe("+919812345678");
  });

  it("treats format variants of the same number as equal (the guest-mode bug)", () => {
    const a = normalizePhone("+91 98123 45678");
    const b = normalizePhone("whatsapp:+919812345678");
    expect(a).toBe(b);
  });

  it("rejects junk / implausible lengths", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone("abc")).toBeNull();
    expect(normalizePhone("+12")).toBeNull();
  });
});

describe("normalizePhoneInput (typed into a form)", () => {
  it("passes explicit country codes through", () => {
    expect(normalizePhoneInput("+91 98123 45678")).toBe("+919812345678");
    expect(normalizePhoneInput("0044 7911 123456")).toBe("+447911123456");
  });

  it("assumes +91 for a bare 10-digit Indian mobile", () => {
    expect(normalizePhoneInput("9812345678")).toBe("+919812345678");
    expect(normalizePhoneInput("98123 45678")).toBe("+919812345678");
  });

  it("rejects local numbers it can't safely place (the account-fork bug)", () => {
    // normalizePhone would turn this into junk E.164 "+9812345678" that never
    // matches the WhatsApp sender — the input variant must refuse instead.
    expect(normalizePhoneInput("0812345678")).toBeNull();
    expect(normalizePhoneInput("98123")).toBeNull();
    expect(normalizePhoneInput("")).toBeNull();
    expect(normalizePhoneInput(null)).toBeNull();
  });
});
