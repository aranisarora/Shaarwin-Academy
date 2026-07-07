"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Subscribes to Postgres changes on the given tables and refreshes the route,
 * coalesced to ≥1s (P12). Live capacity, roster badges, calendar lanes.
 */
export function RealtimeRefresh({ tables }: { tables: string[] }) {
  const router = useRouter();
  const throttleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`refresh-${tables.join("-")}`);
    for (const table of tables) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => {
          if (throttleRef.current) return;
          throttleRef.current = setTimeout(() => {
            throttleRef.current = null;
            router.refresh();
          }, 1000);
        }
      );
    }
    channel.subscribe();

    // Reconnect on wake (PWA resume).
    const onVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      supabase.removeChannel(channel);
      document.removeEventListener("visibilitychange", onVisible);
      if (throttleRef.current) clearTimeout(throttleRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables.join(",")]);

  return null;
}
