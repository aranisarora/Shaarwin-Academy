// One seam, two carriers.
//
// The plan swaps Twilio for Meta's Cloud API "behind the seam" — the agent
// loop, the tools, the lint layer and the notification orchestration must not
// know which one is carrying the message. This is that seam.
//
// It also decides what happens to the things only ONE carrier can do. Buttons
// and CTA-URL links are free-form on Cloud API and impossible on Twilio without
// a pre-approved template, so a caller that asks for buttons gets buttons on
// Cloud and a numbered list on Twilio. Callers never branch on the carrier;
// this file does it once, and the degradation is a real message rather than a
// silent no-op.

import {
  activeTransport,
  cloudApiConfigured,
  sendCloudButtons,
  sendCloudLink,
  sendCloudText,
  markReadAndTyping,
  type ReplyButton,
} from "./cloud-api";
import { sendWhatsApp as sendTwilioText, twilioConfigured } from "./twilio";

export type SendResult = { ok: boolean; id?: string; error?: string };

/** Is ANY carrier ready to send? */
export function transportConfigured(): boolean {
  return activeTransport() === "cloud" ? cloudApiConfigured() : twilioConfigured();
}

export function transportName(): "cloud" | "twilio" {
  return activeTransport();
}

/** Plain words. The path every reply takes today. */
export async function sendText(toPhone: string, body: string): Promise<SendResult> {
  return activeTransport() === "cloud"
    ? sendCloudText(toPhone, body)
    : sendTwilioText(toPhone, body);
}

/**
 * Render buttons as the numbered list Twilio can actually carry.
 *
 * Exported because it is the thing worth testing: the fallback has to leave the
 * person a way to answer. A button they cannot tap and cannot type is worse
 * than never having offered it.
 */
export function buttonsAsText(body: string, buttons: readonly ReplyButton[]): string {
  const usable = buttons.filter((b) => b.label.trim());
  if (usable.length === 0) return body;
  const list = usable.map((b, i) => `${i + 1}. ${b.label.trim()}`).join("\n");
  return `${body.trim()}\n\n${list}`;
}

/** A question with a small number of answers. */
export async function sendButtons(
  toPhone: string,
  opts: { body: string; buttons: readonly ReplyButton[]; header?: string; footer?: string }
): Promise<SendResult> {
  if (activeTransport() === "cloud") return sendCloudButtons(toPhone, opts);
  return sendTwilioText(toPhone, buttonsAsText(opts.body, opts.buttons));
}

/**
 * A link. On Cloud it is a labelled button; on Twilio the URL has to go in the
 * text, which is exactly the habit the migration exists to end.
 */
export async function sendLink(
  toPhone: string,
  opts: { body: string; label: string; url: string; footer?: string }
): Promise<SendResult> {
  if (activeTransport() === "cloud") return sendCloudLink(toPhone, opts);
  return sendTwilioText(toPhone, `${opts.body.trim()}\n\n${opts.url}`);
}

/**
 * Acknowledge an inbound message: blue ticks plus "typing…".
 *
 * A no-op on Twilio, which has neither. Never awaited for its result by the
 * caller's happy path — a failed courtesy must not cost a reply.
 */
export async function acknowledge(messageId: string): Promise<void> {
  if (activeTransport() !== "cloud" || !messageId) return;
  try {
    await markReadAndTyping(messageId);
  } catch (err) {
    console.warn("wa: read/typing ack failed", err);
  }
}
