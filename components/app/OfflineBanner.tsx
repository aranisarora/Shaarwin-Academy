"use client";

import { useEffect, useState } from "react";

/**
 * Global offline banner (P12): mutations are never queued offline — the app
 * says so instead. Booking buttons should be disabled while this shows;
 * server actions fail loudly anyway without a connection.
 *
 * It used to be `sticky top-14` inside each signed-in layout, which meant it was
 * invisible in exactly the moment it existed for: mounted as a sibling *above*
 * the shell, its natural position was already past the stick threshold, so it
 * offset itself 56px down onto StudioShell's own sticky header — which shares
 * its z-index and comes later in the DOM, so the header won and the strip was
 * never seen. The answer isn't a cleverer offset; it's a better place. StudioShell
 * renders it above <header>, in ordinary flow, inside the content column: it
 * pushes the header and the admin week pager down by its own height instead of
 * covering the arrows they navigate by, and it leaves the desktop rail alone.
 * A row of pixels, only while the connection is actually gone.
 */
export function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (!offline) return null;
  return (
    <div
      role="status"
      className="border-b border-err bg-surface-2 px-4 py-2 text-center text-sm text-err"
    >
      You&apos;re offline — booking needs a connection. Your schedule still works.
    </div>
  );
}
