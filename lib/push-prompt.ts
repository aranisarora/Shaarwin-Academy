// Who gets asked to turn push on, and in what shape.
//
// Push sat at ONE subscriber against 75 profiles. Not because anyone said no —
// NEXT_PUBLIC_VAPID_PUBLIC_KEY only reached production on 2026-08-06, so until
// then there was nothing to subscribe to, and since then the only way to find
// the switch has been a card on a settings page nobody visits. Nothing has ever
// asked. This module is the asking, kept as a pure decision so it can be tested
// without a browser (there is no component-test harness here by design — the
// logic lives in lib/ and the component stays a shell around it).
//
// The copy map below is the same one PushToggle renders. It lives here rather
// than in the component because two surfaces now describe the same eight states,
// and the failure mode of duplicating it is that they drift and start telling
// the same person two different stories about their own phone.

import type { PushState } from "@/lib/push";

/** What we are asking for. `install` is iOS: there is no permission to grant yet. */
export type PromptKind = "enable" | "install";

/**
 * How hard we ask. The first ask in a browsing session interrupts; after that
 * it steps back to a card for the rest of the session.
 *
 * There is deliberately no snooze, no decline counter and no persisted timer.
 * A dismissal lasts the session and nothing longer — open the app again with
 * push still off and it asks again, because "everyone has it on" is the goal
 * and a permanent dismissal is how you get one subscriber out of seventy-five.
 */
export type PromptMode = "modal" | "card";

export type PromptDecision =
  | { show: false }
  | { show: true; kind: PromptKind; mode: PromptMode };

const HIDDEN: PromptDecision = { show: false };

/**
 * The eight honest push states, worded for a person. Shared with PushToggle.
 *
 * Every one of these used to be the single sentence "Notifications: email on
 * this device", which read as a settled decision rather than the several
 * separate, fixable things it actually was.
 */
export const PUSH_STATE_COPY: Record<PushState, string> = {
  subscribed: "This device buzzes the moment something needs you.",
  off: "Get a buzz on this device the moment something needs you. Anything urgent still reaches you on WhatsApp either way.",
  denied:
    "Your browser is blocking notifications for Sharwin. Switch them back on in its site settings, then tap again.",
  not_configured:
    "Push isn't switched on for the academy yet. WhatsApp carries everything in the meantime.",
  signed_out: "We couldn't tell who you are. Sign in again and turn this back on.",
  save_failed:
    "This device is ready, but we couldn't save it on our side — so nothing would reach you yet. Tap to try again.",
  needs_install:
    "On iPhone and iPad, notifications only work once Sharwin is on your Home Screen. Tap Share, then “Add to Home Screen”, and open it from there.",
  unsupported: "This browser can't show notifications. WhatsApp still reaches you.",
};

/**
 * What the prompt itself says. Distinct from PUSH_STATE_COPY above: a settings
 * card describes where you stand, a prompt has to make the case — so it names
 * what you'd actually miss rather than what the switch does.
 *
 * `install` has no action button. On iOS the Home Screen step is the whole of
 * the work and it happens in Safari's own share menu; a "Turn on" button there
 * would open a permission prompt that cannot exist yet.
 */
export const PROMPT_COPY: Record<
  PromptKind,
  { title: string; body: string; confirm: string | null; dismiss: string }
> = {
  enable: {
    title: "Get a buzz when something needs you",
    body: "Sessions get moved, coaches run late, classes get called off. With notifications on, this device tells you the moment it happens — not the next time you open the app.",
    confirm: "Turn on notifications",
    dismiss: "Not now",
  },
  install: {
    title: "Add Sharwin to your Home Screen",
    body: PUSH_STATE_COPY.needs_install,
    confirm: null,
    dismiss: "Got it",
  },
};

/**
 * Should we ask, and how?
 *
 * Only two states are worth interrupting for, and the test is whether the
 * person can actually do something about it from here:
 *
 *   off           — one tap away. Ask.
 *   needs_install — iOS, and the Home Screen step is the fix. Ask, differently.
 *
 * Everything else is silence on purpose. `denied` can only be undone in browser
 * site settings, `unsupported` and `not_configured` have no path at all, and
 * `signed_out` has nobody to attach a subscription to. A prompt that cannot
 * lead anywhere is worse than no prompt: it spends the one interruption we get
 * on a dead end, and teaches the reader to dismiss the next one unread.
 *
 * `subscribed` and `save_failed` are also silent here — the first needs nothing
 * and the second is a retry that PushToggle already offers on the settings
 * page, where someone who has just been told a write failed can see it.
 *
 * @param state     from pushState(); null while the device is still being read
 * @param dismissed has "Not now" been tapped in this browsing session
 */
export function pushPromptFor(
  state: PushState | null,
  dismissed: boolean
): PromptDecision {
  // Still reading the device. Rendering nothing beats flashing a prompt at
  // someone who turns out to have push on already.
  if (state === null) return HIDDEN;

  const kind: PromptKind | null =
    state === "off" ? "enable" : state === "needs_install" ? "install" : null;
  if (!kind) return HIDDEN;

  return { show: true, kind, mode: dismissed ? "card" : "modal" };
}
