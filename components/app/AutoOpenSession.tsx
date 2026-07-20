"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// When a session is live as the coach opens the app, jump straight to it so
// they can mark attendance without hunting for the card. sessionStorage guards
// the redirect: coming back to the schedule mid-session doesn't bounce them
// again, but a fresh app launch (new tab / PWA start) does.
export function AutoOpenSession({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  useEffect(() => {
    const key = `auto-opened:${sessionId}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
    router.replace(`/coach/session/${sessionId}`);
  }, [sessionId, router]);
  return null;
}
