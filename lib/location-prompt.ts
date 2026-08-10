// Who gets asked for location, and what we tell them we do with it.
//
// Geofenced auto-arrival has been built and working since it shipped: the fence,
// the haversine, the 10-minute Undo, and a coach_mark_arrival that already
// stores the source and the distance. Measured in production on 2026-08-10 it
// had fired exactly once, at 42 m, perfectly — against 42 arrivals marked by
// hand. 37 of those 42 carried no GPS fix at all.
//
// That is not a fence-width problem and not a venue-data problem (31 of 31
// venues have coordinates, 536 of 536 sessions are geofenceable). In 88% of
// arrival markings the browser returned no position, because nobody has ever
// been asked for location — exactly as nobody had ever been asked for push.
// This module is the asking.
//
// It is a pure decision so it can be tested in `node`; the shared modal/card
// shell is lib/permission-prompt.ts, and the browser side — reading the
// permission without triggering it, and getting a fix — is lib/location.ts.

import { HIDDEN, type PromptCopy, type PromptDecision } from "@/lib/permission-prompt";
import type { LocationState } from "@/lib/location";

/**
 * Location has one variant, unlike push. There is no iOS special case: Safari
 * has had `navigator.geolocation` in a plain tab forever, so nothing here
 * depends on being on the Home Screen.
 */
export type LocationPromptKind = "enable";

/** The dismissal key for the location ask. Session-scoped — see readDismissed(). */
export const LOCATION_DISMISSED_KEY = "sharwin:location-prompt-dismissed";

/**
 * The four honest location states, worded for a person. Mirrors PUSH_STATE_COPY
 * so a settings surface can describe location the same way PushToggle describes
 * push, and so the two can never tell one coach different stories about the same
 * phone.
 */
export const LOCATION_STATE_COPY: Record<LocationState, string> = {
  granted:
    "When you open the app at a venue, we mark you as arrived without you tapping anything.",
  prompt:
    "Let this device check you're at the venue and it can mark you as arrived on its own. We only look when you open the app near a session.",
  denied:
    "Your browser is blocking location for Sharwin, so arrival stays a manual tap. Switch it back on in its site settings if you'd rather it was automatic.",
  unsupported: "This browser can't check location. Marking arrival stays a tap.",
};

/**
 * What the prompt says.
 *
 * The body has one job beyond asking: naming the trade honestly. A coach reading
 * "Sharwin wants your location" assumes the opposite of what this does — that we
 * follow them around between sessions — and that assumption, not the permission
 * dialog, is what gets refused. So it says when we look, and it says the thing
 * we do not do, because both are true and only one of them is obvious.
 *
 * No marketing, second person, concrete about what it saves them: this is the
 * repo's voice, the same as PROMPT_COPY in lib/push-prompt.ts.
 */
export const LOCATION_PROMPT_COPY: Record<LocationPromptKind, PromptCopy> = {
  enable: {
    title: "Let the app mark you as arrived",
    body: "When you open Sharwin at a venue, it can see you're there and mark you as arrived — parents get told without you tapping anything. It only checks the moment you open the app near a session, and it never follows you between them.",
    confirm: "Allow location",
    dismiss: "Not now",
  },
};

/**
 * Should we ask, and how?
 *
 * Only `prompt` is worth interrupting for, and it is the same test push uses —
 * can this person finish the job from here?
 *
 *   prompt      — one tap away, and the tap is the browser's own dialog. Ask.
 *   granted     — nothing to do. Auto-arrival already works.
 *   denied      — only browser site settings can undo it, same as push's denied.
 *   unsupported — there is no geolocation here at all. No path.
 *
 * Coaches only, and this is the part that would be easy to get wrong by being
 * generous with it. Parents and the founder have no arrival to mark, so a
 * location request buys them nothing — and an app that asks for your location
 * for no reason you can see is the kind of thing people remember about it.
 *
 * @param state     from locationState(); null while the permission is still being read
 * @param dismissed has "Not now" been tapped in this browsing session
 * @param isCoach   only a coach has an arrival for this to automate
 */
export function locationPromptFor(
  state: LocationState | null,
  dismissed: boolean,
  isCoach: boolean
): PromptDecision<LocationPromptKind> {
  if (!isCoach) return HIDDEN;
  // Still reading the permission. Rendering nothing beats flashing a prompt at
  // someone who turns out to have granted it already.
  if (state === null) return HIDDEN;
  if (state !== "prompt") return HIDDEN;

  return { show: true, kind: "enable", mode: dismissed ? "card" : "modal" };
}
