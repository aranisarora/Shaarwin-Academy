// The shape of asking someone's browser for something, minus which thing.
//
// PR #24 built this for push: a real dialog on the first ask of a browsing
// session, the quieter card idiom for the rest of it after a dismissal, and a
// sessionStorage key that is *meant* to expire. Location is the second ask and
// there will be a third, so the shell lives here rather than being copied — two
// forks of a permission prompt drift, and then one of them keeps interrupting
// someone who already said yes on the other.
//
// What stays out of here: which states are worth asking about, and what the
// words are. Those are per-permission decisions, they are where the judgement
// is, and they live in lib/push-prompt.ts as pure functions so they can be
// tested in `node` (there is no component-test harness in this repo by design).
// Location was the second such module and is gone with its geofence; push is
// the only caller now, and this stays split for whatever asks next.

/**
 * How hard we ask. The first ask in a browsing session interrupts; after that it
 * steps back to a card for the rest of the session.
 *
 * There is deliberately no snooze, no decline counter and no persisted timer.
 * A dismissal lasts the session and nothing longer — open the app again with the
 * permission still ungranted and it asks again, because "everyone has it on" is
 * the goal and a permanent dismissal is how push got to one subscriber in
 * seventy-five.
 */
export type PromptMode = "modal" | "card";

/**
 * Whether to ask, in what shape, and for which variant of the ask. `kind` is
 * the per-permission discriminant — push has "enable" and "install", location
 * has only "enable" — and it indexes that permission's copy map.
 */
export type PromptDecision<Kind extends string = string> =
  | { show: false }
  | { show: true; kind: Kind; mode: PromptMode };

export const HIDDEN: PromptDecision<never> = { show: false };

/**
 * One prompt's words. `confirm: null` means there is no button to render — the
 * iOS install variant, where the whole of the work happens in Safari's own
 * share menu and a button would open a permission prompt that cannot exist yet.
 */
export type PromptCopy = {
  title: string;
  body: string;
  confirm: string | null;
  dismiss: string;
};

/**
 * Did this person dismiss `key` in this browsing session?
 *
 * sessionStorage, not localStorage, and the distinction is the whole design:
 * this is a dismissal, not an opt-out.
 */
export function readDismissed(key: string): boolean {
  try {
    return sessionStorage.getItem(key) !== null;
  } catch {
    // Private mode with storage blocked. Worst case the modal is the only shape
    // this session ever shows, which is the safe direction to fail.
    return false;
  }
}

/** Remember a "Not now" for the rest of this browsing session. */
export function markDismissed(key: string): void {
  try {
    sessionStorage.setItem(key, "1");
  } catch {
    // Nothing to do — the card is still reachable this render, and the next
    // load simply asks again.
  }
}

/**
 * Whether a prompt is holding the one interruption this session gets.
 *
 * Two permissions must never be on screen together — a coach opening the app
 * with push off and location unasked would otherwise get two stacked dialogs,
 * and the second one is read as noise no matter what it says. So push has the
 * first claim and location waits, which is also the sequence that reads as one
 * conversation: turn notifications on, and *then* be asked what they should be
 * about.
 *
 * `card` counts as claiming. A dismissed push prompt has stepped back to its
 * card but the coach has still spent their patience for this session, and
 * following a "Not now" immediately with a different dialog is exactly what
 * teaches people to dismiss the next one unread.
 *
 * Consequence worth knowing: a coach who dismisses push every session is never
 * asked for location, because push claims the slot again on each fresh open.
 * That is the strict-queue trade deliberately chosen over interrupting twice.
 */
export function isClaiming<Kind extends string>(
  decision: PromptDecision<Kind>
): decision is { show: true; kind: Kind; mode: PromptMode } {
  return decision.show;
}
