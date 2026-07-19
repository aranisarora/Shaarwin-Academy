"use client";

// One "people" hub: account holders (billing, credits, invites) and players
// (every household player, by level) as two views of the same tab, so the
// admin never hunts for a separate Players page.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ClientManager, type PendingClientRow } from "./ClientManager";
import { PlayerManager } from "./PlayerManager";
import type { ComponentProps } from "react";

type View = "clients" | "players";

export function PeopleTabs({
  initialView,
  clients,
  plans,
  pending,
  players,
}: {
  initialView: View;
  clients: ComponentProps<typeof ClientManager>["clients"];
  plans: ComponentProps<typeof ClientManager>["plans"];
  pending: PendingClientRow[];
  players: ComponentProps<typeof PlayerManager>["players"];
}) {
  const [view, setView] = useState<View>(initialView);
  const router = useRouter();

  function switchTo(next: View) {
    setView(next);
    // Keep the URL shareable/bookmarkable without a server round-trip.
    router.replace(next === "clients" ? "/admin/players?view=clients" : "/admin/players", {
      scroll: false,
    });
  }

  const tabBtn = (v: View, label: string, count: number) => (
    <button
      type="button"
      onClick={() => switchTo(v)}
      aria-pressed={view === v}
      className={`min-h-11 flex-1 rounded-[8px] border px-3 text-sm font-semibold ${
        view === v ? "border-ember bg-ember text-ivory" : "border-line hover:border-ember"
      }`}
    >
      {label} <span className="tnum opacity-70">{count}</span>
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {tabBtn("players", "Players", players.length)}
        {tabBtn("clients", "Account holders", clients.length)}
      </div>
      {view === "clients" ? (
        <ClientManager clients={clients} plans={plans} pending={pending} />
      ) : (
        <PlayerManager players={players} />
      )}
    </div>
  );
}
