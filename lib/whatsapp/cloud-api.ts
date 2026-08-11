// Meta WhatsApp Cloud API — the transport Twilio is being replaced by.
//
// Why the swap is worth doing at all: inside the 24-hour customer-service
// window, Cloud API takes free-form INTERACTIVE messages — reply buttons, list
// pickers, CTA-URL buttons — with no template and no approval round trip.
// Through Twilio the same messages have to be pre-approved content templates,
// which is why today's bot pastes bare URLs into message text and offers
// numbered choices the person has to type back.
//
// It also reports what happened to each message (sent → delivered → read →
// failed), which is what "did Meera get the reminder?" needs in order to be
// answerable at all.
//
// NOTHING HERE IS LIVE UNTIL SOMEONE SAYS SO. The transport is chosen by
// WHATSAPP_TRANSPORT, which defaults to twilio. This module can be fully
// configured and still send nothing — that is the "test number first" rule from
// the plan, expressed in code rather than in a runbook.
//
// No SDK: this is three POSTs and one HMAC.

import { createHmac, timingSafeEqual } from "crypto";

/** Pinned rather than floating: a graph-version bump is a deliberate act. */
const GRAPH_VERSION = "v21.0";
const GRAPH_API = `https://graph.facebook.com/${GRAPH_VERSION}`;

/** WhatsApp's hard limit is 4096 for a text body; interactive bodies are 1024. */
const MAX_TEXT = 4000;
const MAX_INTERACTIVE_BODY = 1000;

/** Meta's limits, not ours: 3 reply buttons, 20 chars of label each. */
export const MAX_BUTTONS = 3;
export const MAX_BUTTON_LABEL = 20;

export function cloudApiConfigured(): boolean {
  return Boolean(
    process.env.WHATSAPP_CLOUD_TOKEN && process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID
  );
}

/**
 * Which transport is live.
 *
 * Defaults to twilio even when Cloud is fully configured, so that provisioning
 * the new number and its templates — which has to happen first, and takes days
 * of approvals — never silently moves live traffic. Flipping this is the
 * migration.
 */
export function activeTransport(): "cloud" | "twilio" {
  const choice = (process.env.WHATSAPP_TRANSPORT ?? "").trim().toLowerCase();
  if (choice === "cloud") return "cloud";
  if (choice === "twilio") return "twilio";
  return "twilio";
}

type SendResult = { ok: boolean; id?: string; error?: string };

async function post(path: string, payload: unknown): Promise<SendResult> {
  const token = process.env.WHATSAPP_CLOUD_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) return { ok: false, error: "cloud_not_configured" };

  const res = await fetch(`${GRAPH_API}/${phoneNumberId}/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("wa cloud send failed", res.status, detail.slice(0, 500));
    return { ok: false, error: `cloud_${res.status}` };
  }
  const json = (await res.json().catch(() => null)) as {
    messages?: { id?: string }[];
  } | null;
  return { ok: true, id: json?.messages?.[0]?.id };
}

/** Recipients are given without the leading "+" on this API. */
export function toRecipient(phone: string): string {
  return phone.replace(/^\+/, "");
}

export function splitText(body: string, max = MAX_TEXT): string[] {
  const text = body.trim();
  if (text.length <= max) return text ? [text] : [];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n\n", max);
    if (cut < max / 2) cut = rest.lastIndexOf("\n", max);
    if (cut < max / 2) cut = max;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

export async function sendCloudText(toPhone: string, body: string): Promise<SendResult> {
  let last: SendResult = { ok: true };
  for (const chunk of splitText(body)) {
    last = await post("messages", {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: toRecipient(toPhone),
      type: "text",
      // Links render as links without a preview card stealing the message.
      text: { preview_url: false, body: chunk },
    });
    if (!last.ok) return last;
  }
  return last;
}

export type ReplyButton = { id: string; label: string };

/**
 * Meta rejects the whole message for a label over 20 chars or a duplicate id,
 * which would turn a cosmetic overrun into a message nobody receives. Truncate
 * and de-duplicate instead — a slightly clipped label beats silence.
 */
export function normalizeButtons(buttons: readonly ReplyButton[]): ReplyButton[] {
  const seen = new Set<string>();
  const out: ReplyButton[] = [];
  for (const button of buttons) {
    const id = button.id.trim().slice(0, 256);
    const label = button.label.trim().slice(0, MAX_BUTTON_LABEL);
    if (!id || !label || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label });
    if (out.length === MAX_BUTTONS) break;
  }
  return out;
}

/**
 * A question with buttons on it. Inside the 24h window this needs no template,
 * which is the whole reason for the migration: today the same question is
 * either a pre-approved template or a numbered list the person types back.
 */
export async function sendCloudButtons(
  toPhone: string,
  opts: { body: string; buttons: readonly ReplyButton[]; header?: string; footer?: string }
): Promise<SendResult> {
  const buttons = normalizeButtons(opts.buttons);
  // No buttons left after normalising means the caller passed nothing usable.
  // Send the words rather than an interactive message Meta will reject.
  if (buttons.length === 0) return sendCloudText(toPhone, opts.body);

  return post("messages", {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: toRecipient(toPhone),
    type: "interactive",
    interactive: {
      type: "button",
      ...(opts.header ? { header: { type: "text", text: opts.header.slice(0, 60) } } : {}),
      body: { text: opts.body.trim().slice(0, MAX_INTERACTIVE_BODY) },
      ...(opts.footer ? { footer: { text: opts.footer.slice(0, 60) } } : {}),
      action: {
        buttons: buttons.map((b) => ({
          type: "reply",
          reply: { id: b.id, title: b.label },
        })),
      },
    },
  });
}

/**
 * A link, as a labelled button rather than a URL pasted into a sentence.
 *
 * "Every link becomes a button" in the plan: session links, dashboards and
 * payment links all arrive as something to tap. A bare https:// in message text
 * is the thing this replaces.
 */
export async function sendCloudLink(
  toPhone: string,
  opts: { body: string; label: string; url: string; footer?: string }
): Promise<SendResult> {
  return post("messages", {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: toRecipient(toPhone),
    type: "interactive",
    interactive: {
      type: "cta_url",
      body: { text: opts.body.trim().slice(0, MAX_INTERACTIVE_BODY) },
      ...(opts.footer ? { footer: { text: opts.footer.slice(0, 60) } } : {}),
      action: {
        name: "cta_url",
        parameters: { display_text: opts.label.slice(0, MAX_BUTTON_LABEL), url: opts.url },
      },
    },
  });
}

/** A business-initiated message, outside the 24h window. */
export async function sendCloudTemplate(
  toPhone: string,
  opts: { name: string; language?: string; components?: unknown[] }
): Promise<SendResult> {
  return post("messages", {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: toRecipient(toPhone),
    type: "template",
    template: {
      name: opts.name,
      language: { code: opts.language ?? "en" },
      ...(opts.components?.length ? { components: opts.components } : {}),
    },
  });
}

/**
 * Blue ticks on the inbound message, plus a typing indicator.
 *
 * The plan counts this as prevention, not decoration: a visible "typing…" is
 * the strongest known reducer of the impatient double-send that the coalescing
 * layer otherwise has to clean up after.
 */
export async function markReadAndTyping(messageId: string): Promise<SendResult> {
  if (!messageId) return { ok: false, error: "no_message_id" };
  return post("messages", {
    messaging_product: "whatsapp",
    status: "read",
    message_id: messageId,
    typing_indicator: { type: "text" },
  });
}

// ── Inbound ─────────────────────────────────────────────────────────────────

/**
 * Meta signs the RAW request body with the app secret (SHA-256), unlike
 * Twilio's HMAC over the URL and sorted params. The body must be the bytes as
 * received — re-serialising parsed JSON changes whitespace and key order and
 * the signature stops matching, which is the classic way this check gets
 * "mysteriously" broken.
 */
export function verifyCloudSignature(rawBody: string, header: string | null): boolean {
  const secret = process.env.WHATSAPP_CLOUD_APP_SECRET;
  if (!secret || !header) return false;
  const given = header.startsWith("sha256=") ? header.slice("sha256=".length) : header;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(given, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The GET handshake Meta performs when the webhook URL is first saved. */
export function verifySubscription(params: URLSearchParams): string | null {
  const token = process.env.WHATSAPP_CLOUD_VERIFY_TOKEN;
  if (!token) return null;
  if (params.get("hub.mode") !== "subscribe") return null;
  if (params.get("hub.verify_token") !== token) return null;
  return params.get("hub.challenge");
}

export type CloudInbound = {
  phone: string;
  text: string;
  /** Set when the person tapped a reply button rather than typing. */
  buttonPayload: string;
  buttonText: string;
  messageId: string;
  /** The message being replied to, when there is one — the join key back to
   *  whatever we sent. Cloud API's answer to OriginalRepliedMessageSid. */
  contextId: string;
  hasMedia: boolean;
};

export type CloudStatus = {
  messageId: string;
  /** sent | delivered | read | failed */
  status: string;
  recipient: string;
  at: string | null;
  error?: string;
};

type Envelope = {
  entry?: {
    changes?: {
      value?: {
        messages?: Record<string, unknown>[];
        statuses?: Record<string, unknown>[];
      };
    }[];
  }[];
};

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Normalise Meta's envelope into the shape the router already speaks.
 *
 * Deliberately total: one malformed change must not discard the batch, because
 * Meta sends messages and delivery statuses through the same webhook and a
 * batch can carry both.
 */
export function parseCloudInbound(payload: unknown): CloudInbound[] {
  const out: CloudInbound[] = [];
  const entries = (payload as Envelope)?.entry ?? [];
  for (const entry of entries) {
    for (const change of entry?.changes ?? []) {
      for (const raw of change?.value?.messages ?? []) {
        const type = text(raw.type);
        const interactive = raw.interactive as
          | { type?: string; button_reply?: { id?: string; title?: string }; list_reply?: { id?: string; title?: string } }
          | undefined;
        const reply = interactive?.button_reply ?? interactive?.list_reply;
        // A quick-reply on a TEMPLATE arrives as type "button" with its own
        // shape, not as `interactive` — miss this and a tapped template button
        // reads as an empty message.
        const templateButton = raw.button as { payload?: string; text?: string } | undefined;

        const body = (raw.text as { body?: string } | undefined)?.body;
        const context = raw.context as { id?: string } | undefined;

        out.push({
          phone: `+${text(raw.from).replace(/^\+/, "")}`,
          text: text(body) || text(reply?.title) || text(templateButton?.text),
          buttonPayload: text(reply?.id) || text(templateButton?.payload),
          buttonText: text(reply?.title) || text(templateButton?.text),
          messageId: text(raw.id),
          contextId: text(context?.id),
          hasMedia: ["image", "audio", "video", "document", "sticker"].includes(type),
        });
      }
    }
  }
  return out;
}

/** Delivery receipts, which arrive on the same webhook as messages. */
export function parseCloudStatuses(payload: unknown): CloudStatus[] {
  const out: CloudStatus[] = [];
  const entries = (payload as Envelope)?.entry ?? [];
  for (const entry of entries) {
    for (const change of entry?.changes ?? []) {
      for (const raw of change?.value?.statuses ?? []) {
        const errors = raw.errors as { title?: string; message?: string }[] | undefined;
        const stamp = text(raw.timestamp);
        out.push({
          messageId: text(raw.id),
          status: text(raw.status),
          recipient: `+${text(raw.recipient_id).replace(/^\+/, "")}`,
          // Meta sends seconds since the epoch, as a string.
          at: /^\d+$/.test(stamp) ? new Date(Number(stamp) * 1000).toISOString() : null,
          ...(errors?.length
            ? { error: [errors[0].title, errors[0].message].filter(Boolean).join(": ") }
            : {}),
        });
      }
    }
  }
  return out;
}
