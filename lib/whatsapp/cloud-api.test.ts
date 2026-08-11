import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "crypto";
import {
  activeTransport,
  normalizeButtons,
  parseCloudInbound,
  parseCloudStatuses,
  splitText,
  toRecipient,
  verifyCloudSignature,
  verifySubscription,
} from "./cloud-api";
import { buttonsAsText } from "./transport";

const ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ENV };
});

describe("activeTransport", () => {
  /**
   * The migration is a deliberate act, not a consequence of provisioning. The
   * new WABA and its templates have to exist and be approved BEFORE anything
   * moves, so having credentials must never be enough to redirect live traffic.
   */
  it("stays on twilio even when the cloud API is fully configured", () => {
    process.env.WHATSAPP_CLOUD_TOKEN = "tok";
    process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID = "123";
    delete process.env.WHATSAPP_TRANSPORT;
    expect(activeTransport()).toBe("twilio");
  });

  it("moves only when told to, in as many words", () => {
    process.env.WHATSAPP_TRANSPORT = "cloud";
    expect(activeTransport()).toBe("cloud");
    process.env.WHATSAPP_TRANSPORT = "twilio";
    expect(activeTransport()).toBe("twilio");
  });

  it("falls back to twilio on a value it doesn't understand", () => {
    process.env.WHATSAPP_TRANSPORT = "meta";
    expect(activeTransport()).toBe("twilio");
  });
});

describe("toRecipient", () => {
  it("drops the leading plus the graph API doesn't want", () => {
    expect(toRecipient("+919812345678")).toBe("919812345678");
    expect(toRecipient("919812345678")).toBe("919812345678");
  });
});

describe("splitText", () => {
  it("leaves a normal message alone", () => {
    expect(splitText("Hi there")).toEqual(["Hi there"]);
  });

  it("returns nothing for an empty body rather than one empty message", () => {
    expect(splitText("   ")).toEqual([]);
  });

  it("breaks a long body on a paragraph boundary", () => {
    const body = `${"a".repeat(60)}\n\n${"b".repeat(60)}`;
    expect(splitText(body, 80)).toEqual(["a".repeat(60), "b".repeat(60)]);
  });
});

describe("normalizeButtons", () => {
  /**
   * Meta rejects the entire message for an over-long label or a duplicate id,
   * so a cosmetic overrun would become a message nobody receives. Clip instead.
   */
  it("clips a label rather than letting the message be rejected", () => {
    const [button] = normalizeButtons([{ id: "yes", label: "Yes, I am definitely coming along" }]);
    expect(button.label).toHaveLength(20);
  });

  it("drops duplicates and keeps at most three", () => {
    const buttons = normalizeButtons([
      { id: "a", label: "One" },
      { id: "a", label: "One again" },
      { id: "b", label: "Two" },
      { id: "c", label: "Three" },
      { id: "d", label: "Four" },
    ]);
    expect(buttons.map((b) => b.id)).toEqual(["a", "b", "c"]);
  });

  it("drops the unusable ones", () => {
    expect(normalizeButtons([{ id: "", label: "No id" }, { id: "x", label: "  " }])).toEqual([]);
  });
});

describe("buttonsAsText — what Twilio gets instead", () => {
  /**
   * The fallback has to leave a way to ANSWER. A button that can be neither
   * tapped nor typed is worse than never having been offered.
   */
  it("turns buttons into a numbered list the person can type back", () => {
    expect(
      buttonsAsText("Which Aarav?", [
        { id: "a", label: "Aarav — Beginners" },
        { id: "b", label: "Aarav — Advanced" },
      ])
    ).toBe("Which Aarav?\n\n1. Aarav — Beginners\n2. Aarav — Advanced");
  });

  it("leaves the body alone when there is nothing to offer", () => {
    expect(buttonsAsText("All done.", [])).toBe("All done.");
  });
});

describe("verifyCloudSignature", () => {
  const body = '{"entry":[{"changes":[]}]}';
  beforeEach(() => {
    process.env.WHATSAPP_CLOUD_APP_SECRET = "s3cret";
  });

  const sign = (raw: string, secret = "s3cret") =>
    `sha256=${createHmac("sha256", secret).update(raw, "utf8").digest("hex")}`;

  it("accepts a signature over the raw body", () => {
    expect(verifyCloudSignature(body, sign(body))).toBe(true);
  });

  /**
   * The classic way this check gets quietly disabled: the handler parses the
   * JSON and signs what it re-serialises, which drops the whitespace Meta sent.
   * The signature then never matches and someone "fixes" it by deleting the
   * check. Verified here so the route keeps reading the raw body.
   */
  it("rejects a body whose whitespace has been normalised away", () => {
    const asSent = '{"entry":[ {"changes":[] } ]}';
    const reserialised = JSON.stringify(JSON.parse(asSent));
    expect(reserialised).not.toBe(asSent);
    // Signed as it arrived, checked after a round trip through JSON.parse.
    expect(verifyCloudSignature(reserialised, sign(asSent))).toBe(false);
    expect(verifyCloudSignature(asSent, sign(asSent))).toBe(true);
  });

  it("rejects a signature made with the wrong secret", () => {
    expect(verifyCloudSignature(body, sign(body, "wrong"))).toBe(false);
  });

  it("rejects a missing signature, and refuses to run without a secret", () => {
    expect(verifyCloudSignature(body, null)).toBe(false);
    delete process.env.WHATSAPP_CLOUD_APP_SECRET;
    expect(verifyCloudSignature(body, sign(body))).toBe(false);
  });
});

describe("verifySubscription", () => {
  beforeEach(() => {
    process.env.WHATSAPP_CLOUD_VERIFY_TOKEN = "let-me-in";
  });

  it("echoes the challenge when the token matches", () => {
    const params = new URLSearchParams({
      "hub.mode": "subscribe",
      "hub.verify_token": "let-me-in",
      "hub.challenge": "12345",
    });
    expect(verifySubscription(params)).toBe("12345");
  });

  it("refuses a wrong token, so nobody can point their webhook at us", () => {
    const params = new URLSearchParams({
      "hub.mode": "subscribe",
      "hub.verify_token": "guess",
      "hub.challenge": "12345",
    });
    expect(verifySubscription(params)).toBeNull();
  });

  it("refuses when no verify token is configured at all", () => {
    delete process.env.WHATSAPP_CLOUD_VERIFY_TOKEN;
    expect(
      verifySubscription(
        new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "", "hub.challenge": "1" })
      )
    ).toBeNull();
  });
});

describe("parseCloudInbound", () => {
  const envelope = (messages: unknown[]) => ({
    entry: [{ changes: [{ value: { messages } }] }],
  });

  it("reads a typed message", () => {
    const [msg] = parseCloudInbound(
      envelope([
        { from: "919812345678", id: "wamid.A", type: "text", text: { body: "what's on tomorrow" } },
      ])
    );
    expect(msg).toMatchObject({
      phone: "+919812345678",
      text: "what's on tomorrow",
      messageId: "wamid.A",
      buttonPayload: "",
      hasMedia: false,
    });
  });

  it("reads an interactive button tap, with the id the router needs", () => {
    const [msg] = parseCloudInbound(
      envelope([
        {
          from: "919812345678",
          id: "wamid.B",
          type: "interactive",
          context: { id: "wamid.SENT" },
          interactive: { type: "button_reply", button_reply: { id: "coach_arrived", title: "I've arrived" } },
        },
      ])
    );
    expect(msg).toMatchObject({
      buttonPayload: "coach_arrived",
      buttonText: "I've arrived",
      text: "I've arrived",
      // The join key back to the message being replied to — Cloud API's
      // equivalent of Twilio's OriginalRepliedMessageSid.
      contextId: "wamid.SENT",
    });
  });

  /**
   * A quick-reply on a TEMPLATE arrives as type "button" with its own shape,
   * not as `interactive`. Miss it and a tapped template button reads as an
   * empty message — the reminder buttons are all templates.
   */
  it("reads a template quick-reply, which has a different shape entirely", () => {
    const [msg] = parseCloudInbound(
      envelope([
        {
          from: "919812345678",
          id: "wamid.C",
          type: "button",
          button: { payload: "rem_yes", text: "Yes, coming" },
        },
      ])
    );
    expect(msg.buttonPayload).toBe("rem_yes");
    expect(msg.text).toBe("Yes, coming");
  });

  it("flags media so the router can say it only reads text", () => {
    const [msg] = parseCloudInbound(
      envelope([{ from: "919812345678", id: "wamid.D", type: "image", image: { id: "x" } }])
    );
    expect(msg.hasMedia).toBe(true);
    expect(msg.text).toBe("");
  });

  it("survives an empty or malformed envelope", () => {
    expect(parseCloudInbound(null)).toEqual([]);
    expect(parseCloudInbound({})).toEqual([]);
    expect(parseCloudInbound({ entry: [{}] })).toEqual([]);
    // A status-only delivery — the same webhook carries both.
    expect(parseCloudInbound({ entry: [{ changes: [{ value: { statuses: [] } }] }] })).toEqual([]);
  });

  it("reads every message in a batched delivery", () => {
    const msgs = parseCloudInbound(
      envelope([
        { from: "919812345678", id: "w1", type: "text", text: { body: "cancel tomorrow" } },
        { from: "919812345678", id: "w2", type: "text", text: { body: "actually just move it" } },
      ])
    );
    expect(msgs.map((m) => m.text)).toEqual(["cancel tomorrow", "actually just move it"]);
  });
});

describe("parseCloudStatuses", () => {
  const envelope = (statuses: unknown[]) => ({
    entry: [{ changes: [{ value: { statuses } }] }],
  });

  it("reads a delivery receipt with its timestamp", () => {
    const [status] = parseCloudStatuses(
      envelope([
        { id: "wamid.A", status: "delivered", recipient_id: "919812345678", timestamp: "1754000000" },
      ])
    );
    expect(status).toMatchObject({
      messageId: "wamid.A",
      status: "delivered",
      recipient: "+919812345678",
    });
    expect(status.at).toBe(new Date(1754000000 * 1000).toISOString());
  });

  it("carries the carrier's reason on a failure", () => {
    const [status] = parseCloudStatuses(
      envelope([
        {
          id: "wamid.B",
          status: "failed",
          recipient_id: "919812345678",
          timestamp: "1754000000",
          errors: [{ title: "Re-engagement message", message: "outside the 24 hour window" }],
        },
      ])
    );
    expect(status.error).toBe("Re-engagement message: outside the 24 hour window");
  });

  it("survives a missing or unreadable timestamp", () => {
    const [status] = parseCloudStatuses(
      envelope([{ id: "wamid.C", status: "sent", recipient_id: "919812345678" }])
    );
    expect(status.at).toBeNull();
  });
});
