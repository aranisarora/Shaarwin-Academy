"use client";

import { useSyncExternalStore } from "react";

/**
 * Client-only browser reads (device type, display mode, install flags) shared by
 * the install surfaces. They're external state, so `useSyncExternalStore` reads
 * them during render with a stable server snapshot (`false`) — no hydration
 * mismatch and no synchronous setState in an effect (react-hooks/set-state-in-
 * effect). These values don't change after mount, so `subscribe` is a no-op.
 */
const noopSubscribe = () => () => {};

function detectIos(): boolean {
  // navigator.userAgent is unreliable on modern iPadOS (Apple masks it), so we
  // also treat a Mac platform reporting touch points as iOS-on-iPad.
  const ua = navigator.userAgent;
  const iosViaUA = /iphone|ipad|ipod/i.test(ua);
  const iosViaTouch =
    /Mac/.test(navigator.platform ?? "") && navigator.maxTouchPoints > 1;
  return iosViaUA || iosViaTouch;
}

export function useIsIos(): boolean {
  return useSyncExternalStore(noopSubscribe, detectIos, () => false);
}

function detectStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // @ts-expect-error iOS Safari only
    window.navigator.standalone === true
  );
}

export function useIsStandalone(): boolean {
  return useSyncExternalStore(noopSubscribe, detectStandalone, () => false);
}

/** True when the given localStorage flag is set (any non-null value). */
export function useLocalFlag(key: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("storage", cb);
      return () => window.removeEventListener("storage", cb);
    },
    () => localStorage.getItem(key) !== null,
    () => false
  );
}
