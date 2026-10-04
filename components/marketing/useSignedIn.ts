"use client";

import { useSyncExternalStore } from "react";

function sessionCookiePattern(): RegExp {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
  const key = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
  return new RegExp(`(?:^|;\\s*)${key}(?:\\.\\d+)?=`);
}

const SESSION_COOKIE = sessionCookiePattern();

const subscribe = () => () => {};

export function useSignedIn(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => SESSION_COOKIE.test(document.cookie),
    () => false
  );
}
