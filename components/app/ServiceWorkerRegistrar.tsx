"use client";

import { useEffect } from "react";

/** Registers the PWA service worker; no-ops where unsupported. */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return null;
}
