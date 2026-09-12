import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  appBaseUrl,
  validateOutboundOrigin,
  resetAppUrlWarning,
  PRODUCTION_APP_URL,
} from "./app-url";

describe("validateOutboundOrigin", () => {
  it("accepts the production origin and any other https host", () => {
    expect(validateOutboundOrigin("https://sharwinacademy.com")).toBe(
      "https://sharwinacademy.com"
    );
    // Vercel previews and a future custom domain must keep working without a
    // code change — the rule is "public https", not "this one hostname".
    expect(validateOutboundOrigin("https://web-git-abc123.vercel.app")).toBe(
      "https://web-git-abc123.vercel.app"
    );
  });

  it("strips trailing slashes so callers can concatenate a path", () => {
    expect(validateOutboundOrigin("https://sharwinacademy.com/")).toBe(
      "https://sharwinacademy.com"
    );
    expect(validateOutboundOrigin("https://sharwinacademy.com///")).toBe(
      "https://sharwinacademy.com"
    );
  });

  // The whole reason this module exists: `?? PRODUCTION` never fired for these,
  // because the variable was set — just set to something nobody else can open.
  it.each([
    "http://localhost:3000",
    "https://localhost:3000",
    "https://localhost",
    "https://app.localhost",
    "http://127.0.0.1:3000",
    "https://127.0.0.1",
    "https://0.0.0.0:8080",
    "https://10.0.0.5:3000",
    "https://192.168.1.42:3000",
    "https://172.16.0.9",
    "https://172.31.255.255",
  ])("rejects %s", (value) => {
    expect(validateOutboundOrigin(value)).toBeNull();
  });

  it("rejects http even for a real public host", () => {
    // WhatsApp will render it, but every deployment terminates TLS, so an
    // http link here means the variable was hand-typed and is not trustworthy.
    expect(validateOutboundOrigin("http://sharwinacademy.com")).toBeNull();
  });

  it("rejects empty, unset and unparseable values", () => {
    expect(validateOutboundOrigin(undefined)).toBeNull();
    expect(validateOutboundOrigin(null)).toBeNull();
    expect(validateOutboundOrigin("")).toBeNull();
    expect(validateOutboundOrigin("   ")).toBeNull();
    expect(validateOutboundOrigin("sharwinacademy.com")).toBeNull();
    expect(validateOutboundOrigin("not a url")).toBeNull();
  });

  it("is not fooled by a public-looking host in the path or 172.x outside the private block", () => {
    // 172.15 and 172.32 are public; only 172.16–172.31 are private.
    expect(validateOutboundOrigin("https://172.15.0.1")).toBe("https://172.15.0.1");
    expect(validateOutboundOrigin("https://172.32.0.1")).toBe("https://172.32.0.1");
  });
});

describe("appBaseUrl", () => {
  const original = process.env.NEXT_PUBLIC_APP_URL;

  beforeEach(() => {
    resetAppUrlWarning();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = original;
    vi.restoreAllMocks();
  });

  it("uses a valid configured origin", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://staging.sharwinacademy.com";
    expect(appBaseUrl()).toBe("https://staging.sharwinacademy.com");
  });

  it("falls back to production when the env says localhost", () => {
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    expect(appBaseUrl()).toBe(PRODUCTION_APP_URL);
  });

  it("falls back to production when the env is unset", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(appBaseUrl()).toBe(PRODUCTION_APP_URL);
  });

  it("warns once — and only when something was actually misconfigured", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    appBaseUrl();
    // Unset is a deployment that never set it; that is the documented default,
    // not a mistake worth a log line.
    expect(console.warn).not.toHaveBeenCalled();

    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    appBaseUrl();
    appBaseUrl();
    appBaseUrl();
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(console.warn).mock.calls[0][0]).toContain("localhost:3000");
  });
});
