"use client";

import { createClient } from "@/lib/supabase/client";

/**
 * Web push, from the browser's side of the wire. The other half — signing the
 * VAPID token, encrypting the payload and POSTing it to the push service — is
 * `deliverPush()` in supabase/functions/notify/index.ts.
 *
 * This file used to answer nearly every question with the single word
 * "unsupported": a build with no VAPID key, a visitor who wasn't signed in, and
 * a browser that genuinely has no Push API all came back the same, and the
 * profile screen turned that one word into the reassuring "Notifications: email
 * on this device." Three quite different problems, one comforting lie, and no
 * way to tell which one you actually had. The states below are the honest set,
 * and PushToggle says the true one out loud.
 *
 * The other thing that was missing is a lifecycle. `enablePush` ran once from a
 * manual tap and was never revisited: a subscription the push service rotated
 * was never renewed, a row deleted server-side was never rewritten, and there
 * was no way to turn push off at all. `refreshPush` and `disablePush` close
 * both ends. The endpoint UNIQUE constraint plus `onConflict: "endpoint"` makes
 * re-subscribing free, so refreshing on every mount costs one upsert.
 *
 * That mount-time upsert now carries a second job. It stamps
 * push_subscriptions.last_seen_at (a trigger does it, migration 0060), which is
 * how the notify worker tells a device somebody still opens from a browser
 * profile that was signed into once a year ago and has returned a cheerful 201
 * to every push since. See docs/notifications.md §2b.
 */
export type PushState =
  /** Subscribed on this device, and push_subscriptions has the row. */
  | "subscribed"
  /** Push works here — it just isn't on, or the user turned it off. */
  | "off"
  /** The permission prompt was refused. Only site settings can undo that. */
  | "denied"
  /** No NEXT_PUBLIC_VAPID_PUBLIC_KEY in this build — nothing to subscribe to. */
  | "not_configured"
  /** No session, so there's nobody to attach the subscription to. */
  | "signed_out"
  /** Subscribed in the browser, but we couldn't write the row. Worth retrying. */
  | "save_failed"
  /** iOS: web push exists only once the site is on the Home Screen. */
  | "needs_install"
  /** This browser really has no Push API. */
  | "unsupported";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

// Remembers a deliberate "turn it off" on this device. Browser permission stays
// granted after an unsubscribe, so without this flag the next page load would
// silently re-subscribe someone who had just switched push off — which is the
// one behaviour that would make the toggle feel broken.
const OFF_FLAG = "sharwin:push-off";

/**
 * What this device can do, before we ask it anything. iOS is the case worth
 * separating: Safari in a tab exposes no PushManager at all, so "unsupported"
 * would be a lie — the very same phone works once Sharwin is on the Home
 * Screen. That distinction is the whole reason `needs_install` exists.
 */
function deviceSupport(): "ok" | "needs_install" | "unsupported" {
  if (typeof window === "undefined") return "unsupported";
  if ("serviceWorker" in navigator && "PushManager" in window && "Notification" in window) {
    return "ok";
  }
  const ua = navigator.userAgent;
  const isIos =
    /iphone|ipad|ipod/i.test(ua) ||
    (/Mac/.test(navigator.platform ?? "") && navigator.maxTouchPoints > 1);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return isIos && !standalone ? "needs_install" : "unsupported";
}

/** Where push stands on this device right now. Never prompts, never subscribes. */
export async function pushState(): Promise<PushState> {
  const support = deviceSupport();
  if (support !== "ok") return support;
  if (!VAPID_PUBLIC_KEY) return "not_configured";
  if (Notification.permission === "denied") return "denied";

  const registration = await navigator.serviceWorker.getRegistration();
  const existing = await registration?.pushManager.getSubscription();
  return existing && !turnedOff() ? "subscribed" : "off";
}

/** Ask for permission, subscribe, and store the row. The one prompting path. */
export async function enablePush(): Promise<PushState> {
  const support = deviceSupport();
  if (support !== "ok") return support;
  if (!VAPID_PUBLIC_KEY) return "not_configured";

  const permission = await Notification.requestPermission();
  // Only an actual refusal is "denied". Dismissing the prompt — tapping outside
  // it, or Esc, which is what most people do on mobile Chrome the first time —
  // leaves permission at "default", and telling that person their browser is
  // blocking us sends them hunting through site settings for a switch that
  // isn't set. Tapping the button again simply re-prompts, which is exactly
  // what the "off" copy already offers.
  if (permission === "denied") return "denied";
  if (permission !== "granted") return "off";

  const registration = await navigator.serviceWorker.ready;
  const subscription = await subscribeWith(registration);
  const saved = await storeSubscription(subscription);
  if (saved !== "ok") return saved === "no_user" ? "signed_out" : "save_failed";

  try {
    localStorage.removeItem(OFF_FLAG);
  } catch {
    // Private mode with storage blocked — the subscription still stands.
  }
  return "subscribed";
}

/** Turn push off on this device: drop our row first, then the subscription. */
export async function disablePush(): Promise<PushState> {
  const support = deviceSupport();
  if (support !== "ok") return support;

  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) {
    // Row first: if the unsubscribe succeeded and the delete didn't, we'd keep
    // pushing at a dead endpoint until the push service finally 410s it.
    await forgetSubscription(subscription.endpoint);
    await subscription.unsubscribe().catch(() => {});
  }
  try {
    localStorage.setItem(OFF_FLAG, "1");
  } catch {
    // Nothing to do — worst case the next load offers to turn it back on.
  }
  return "off";
}

/**
 * Silent re-subscribe for someone who already said yes. Called on mount, so a
 * rotated endpoint or a row lost server-side repairs itself on the next visit
 * instead of going quiet forever. Never prompts: it returns early unless
 * permission is already granted.
 */
export async function refreshPush(): Promise<PushState> {
  const support = deviceSupport();
  if (support !== "ok") return support;
  if (!VAPID_PUBLIC_KEY) return "not_configured";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission !== "granted" || turnedOff()) return "off";

  const registration = await navigator.serviceWorker.ready;
  const subscription = await subscribeWith(registration);
  const saved = await storeSubscription(subscription);
  if (saved === "no_user") return "signed_out";
  return saved === "ok" ? "subscribed" : "save_failed";
}

/**
 * The subscription for this registration, reusing one if it matches the key we
 * sign with. A push service rejects a re-subscribe that swaps applicationServer-
 * Key out from under an existing subscription, so a rotated VAPID key would
 * otherwise throw InvalidStateError on this device forever — drop the stale one
 * and start again.
 */
async function subscribeWith(
  registration: ServiceWorkerRegistration
): Promise<PushSubscription> {
  const key = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
  const existing = await registration.pushManager.getSubscription();
  if (existing) {
    if (sameKey(existing.options.applicationServerKey, key)) return existing;
    await forgetSubscription(existing.endpoint);
    await existing.unsubscribe().catch(() => {});
  }
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key,
  });
}

/**
 * Where the write ended up. This used to be a bare boolean, and both callers
 * read `false` as "signed out" — so a device that was offline, or that hit a
 * transient PostgREST error, or that hit the shared-endpoint case below, was
 * told "we couldn't tell who you are, sign in again" on a screen it had reached
 * by being signed in, with no button to try anything. Three outcomes, three
 * different things to say.
 */
type SaveResult = "ok" | "no_user" | "write_failed";

/** Upsert by endpoint, reclaiming the row if another account holds it. */
async function storeSubscription(subscription: PushSubscription): Promise<SaveResult> {
  const json = subscription.toJSON();
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "no_user";

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint: subscription.endpoint,
      p256dh: json.keys?.p256dh ?? "",
      auth: json.keys?.auth ?? "",
      user_agent: navigator.userAgent,
    },
    { onConflict: "endpoint" }
  );
  if (!error) return "ok";

  // The shared device, and it is reproducible rather than exotic: `endpoint` is
  // globally UNIQUE and a browser profile has exactly one, so the moment a
  // second person signs in on the family iPad the upsert collides with the row
  // the first one left behind. The "own push subscriptions" policy hides that
  // row from us, so Postgres refuses the merge with 42501 instead of doing it —
  // and we can't delete what RLS won't show us. The server can, so the reclaim
  // happens there. Everything else that lands here (no signal, a 5xx) fails
  // there too, and then we say so.
  return (await reclaimEndpoint(subscription)) ? "ok" : "write_failed";
}

/**
 * Ask the server to take this endpoint over. Same route the service worker
 * already posts a rotated subscription to — it is the same conversation, and it
 * is the only place that holds the service role needed to clear a row belonging
 * to somebody else.
 */
async function reclaimEndpoint(subscription: PushSubscription): Promise<boolean> {
  try {
    const res = await fetch("/api/push-action", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "subscription_changed",
        subscription: subscription.toJSON(),
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function forgetSubscription(endpoint: string): Promise<void> {
  const supabase = createClient();
  await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
}

function turnedOff(): boolean {
  try {
    return localStorage.getItem(OFF_FLAG) !== null;
  } catch {
    return false;
  }
}

function sameKey(stored: ArrayBuffer | null, key: Uint8Array): boolean {
  if (!stored) return false;
  const a = new Uint8Array(stored);
  if (a.length !== key.length) return false;
  return a.every((byte, i) => byte === key[i]);
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
