/* Sharwin TTA service worker: an offline fallback and the push handlers (P12).
 *
 * WebKit does not implement notification action buttons. On iOS the actions
 * array is ignored, so every action offered here must also be reachable by
 * tapping the notification body and landing on data.url. */
const CACHE = "sharwin-v4";
const OFFLINE_URL = "/offline";
const ACTION_ENDPOINT = "/api/push-action";

self.addEventListener("install", (event) => {
  event.waitUntil(precacheOffline().then(() => self.skipWaiting()));
});

async function precacheOffline() {
  const res = await fetch(OFFLINE_URL, { cache: "reload" });
  if (!res.ok) throw new Error(`offline page answered ${res.status}`);
  const html = await res.clone().text();
  const styles = [...html.matchAll(/href="(\/_next\/static\/[^"]+\.css)"/g)].map((m) => m[1]);
  const cache = await caches.open(CACHE);
  await cache.addAll(styles);
  await cache.put(OFFLINE_URL, res);
}

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.registration.navigationPreload && self.registration.navigationPreload.enable())
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(navigate(event));
    return;
  }

  if (url.pathname.startsWith("/_next/static/") && url.pathname.endsWith(".css")) {
    event.respondWith(
      fetch(request).catch(() => caches.match(request).then((cached) => cached || Response.error()))
    );
  }
});

async function navigate(event) {
  try {
    return (await event.preloadResponse) || (await fetch(event.request));
  } catch {
    return (await caches.match(OFFLINE_URL)) || Response.error();
  }
}

/**
 * How many buttons this browser will actually draw. Chrome and Firefox publish
 * it as Notification.maxActions (2 in practice); anything past that is dropped
 * silently, which is worse than not offering it. Safari publishes nothing and
 * renders none at all — see the file header.
 */
function maxActions() {
  const n = self.Notification && self.Notification.maxActions;
  return typeof n === "number" && n > 0 ? n : 2;
}

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { body: event.data.text() };
  }
  const actions = Array.isArray(payload.actions)
    ? payload.actions.slice(0, maxActions())
    : undefined;

  event.waitUntil(
    self.registration.showNotification(payload.title ?? "Sharwin TTA", {
      body: payload.body ?? "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      // The three coach prompts about one session — coming? / still nothing? /
      // reached? — arrive under a single `coach:<session>` tag, so the live
      // question replaces the last one rather than stacking three banners about
      // one 6:30 class in the tray. `renotify` is what makes the replacement
      // buzz instead of swapping in silently, which for a prompt we need
      // answered is the point of sending it again.
      //
      // Every other type keeps its own per-type tag, where this is only a
      // safety net: the worker's alreadyFired() already guarantees one row per
      // (type, session, person), so those tags should never collide.
      tag: payload.tag,
      renotify: !!payload.tag,
      actions,
      data: payload.data ?? {},
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  const data = event.notification.data || {};
  const url = data.url || "/app";
  const tag = event.notification.tag;
  const action = event.action;
  event.notification.close();

  // No action, "open", or a button this build doesn't know: open the deep link.
  // That is also the whole of the iOS path, where no button was ever drawn.
  if (!action || action === "open") {
    event.waitUntil(openApp(url));
    return;
  }

  event.waitUntil(
    runPushAction(action, data).then((message) =>
      message
        ? self.registration.showNotification("Sharwin TTA", {
            body: message,
            icon: "/icon-192.png",
            badge: "/icon-192.png",
            tag,
            data: { url },
          })
        : // Anything we couldn't do from here — signed out, offline, a session
          // that moved on — hands over to the app rather than failing quietly.
          openApp(url)
    )
  );
});

/**
 * Push services rotate an endpoint whenever they feel like it, and the old one
 * stops delivering the moment they do. Without this the subscription simply
 * dies and the user never learns why. Re-subscribe with the same application
 * server key and tell the app; the endpoint UNIQUE constraint makes the write
 * idempotent, and old_endpoint lets the server drop the row that just expired.
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const old = event.oldSubscription || (await self.registration.pushManager.getSubscription());
      let fresh = event.newSubscription || null;
      if (!fresh) {
        // Chrome fires this with neither subscription attached, so the key has
        // to come off the one that just died — the worker has no other copy of
        // it, and subscribing without one is rejected.
        const key = old && old.options ? old.options.applicationServerKey : null;
        if (!key) return;
        fresh = await self.registration.pushManager
          .subscribe({ userVisibleOnly: true, applicationServerKey: key })
          .catch(() => null);
      }
      if (!fresh) return;

      await fetch(ACTION_ENDPOINT, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "subscription_changed",
          old_endpoint: old ? old.endpoint : null,
          subscription: fresh.toJSON(),
        }),
      }).catch(() => {});
    })()
  );
});

/** Run a notification button server-side. Returns the reply to show, or null. */
function runPushAction(action, data) {
  return fetch(ACTION_ENDPOINT, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, session_id: data.session_id || null }),
  })
    .then((res) => (res.ok ? res.json().catch(() => ({})) : null))
    .then((json) => (json && typeof json.message === "string" ? json.message : null))
    .catch(() => null);
}

function openApp(url) {
  return clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const client of list) {
      if (client.url.includes(url) && "focus" in client) return client.focus();
    }
    return clients.openWindow(url);
  });
}
