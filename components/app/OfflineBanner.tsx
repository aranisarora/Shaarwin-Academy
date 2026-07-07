"use client";

import { useEffect, useState } from "react";

/**
 * Global offline banner (P12): mutations are never queued offline — the app
 * says so instead. Booking buttons should be disabled while this shows;
 * server actions fail loudly anyway without a connection.
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
      className="sticky top-14 z-30 border-b border-err bg-surface-2 px-4 py-2 text-center text-sm text-err"
    >
      You&apos;re offline — booking needs a connection. Your schedule still works.
    </div>
  );
}
