"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import { enablePush, type PushState } from "@/lib/push";
import { AddressForm } from "@/components/app/AddressForm";
import {
  fromDetails,
  type StructuredAddress,
} from "@/lib/address";
import { saveProfile, addPlayer, removePlayer } from "@/app/app/profile/actions";
import { PREF_TYPES } from "@/lib/notification-prefs";

type Player = {
  id: string;
  full_name: string;
  date_of_birth: string | null;
  skill_level: string;
};

export function ProfileEditor({
  profile,
  players,
}: {
  profile: {
    fullName: string;
    phone: string;
    defaultAddress: string;
    addressDetails: Partial<StructuredAddress> | null;
    prefs: Record<string, boolean>;
  };
  players: Player[];
}) {
  const [form, setForm] = useState({
    fullName: profile.fullName,
    phone: profile.phone,
    prefs: profile.prefs,
  });
  const [address, setAddress] = useState<StructuredAddress>(() =>
    fromDetails(profile.addressDetails, { address: profile.defaultAddress })
  );
  const [newPlayer, setNewPlayer] = useState({ fullName: "", dateOfBirth: "", skillLevel: "beginner" });
  const [pushState, setPushState] = useState<PushState | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <p className="label">Your details</p>
        <Input
          label="Name"
          value={form.fullName}
          onChange={(e) => setForm({ ...form, fullName: e.target.value })}
        />
        <Input
          label="Phone"
          type="tel"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
        />
        <div>
          <p className="label mb-2">Default address (prefills private bookings)</p>
          <AddressForm
            value={address}
            onChange={setAddress}
            searchLabel="Search your address"
            searchPlaceholder="Start typing your address…"
            showLabel
          />
        </div>
      </div>

      <div>
        <p className="label mb-3">Notifications</p>
        <div className="space-y-2 rounded-[12px] border border-line bg-surface-2 p-4">
          {PREF_TYPES.map(([key, labelText]) => {
            const on = form.prefs[key] !== false; // default on
            return (
              <label key={key} className="flex min-h-11 items-center justify-between gap-3">
                <span className="text-sm">{labelText}</span>
                <button
                  role="switch"
                  aria-checked={on}
                  onClick={() =>
                    setForm({ ...form, prefs: { ...form.prefs, [key]: !on } })
                  }
                  className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
                    on ? "bg-ember" : "bg-line"
                  }`}
                >
                  <span
                    className={`absolute top-1 h-5 w-5 rounded-full bg-ivory transition-all ${
                      on ? "left-6" : "left-1"
                    }`}
                  />
                </button>
              </label>
            );
          })}
          <p className="pt-1 text-xs text-fg-2">
            Payment and cancellation notices always deliver.
          </p>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Button
            variant="ghost"
            onClick={async () => setPushState(await enablePush())}
          >
            Enable push notifications
          </Button>
          {pushState === "subscribed" && <Badge tone="ok">Push on</Badge>}
          {pushState === "denied" && (
            <p className="text-xs text-fg-2">
              Notifications: email. Re-enable them in your browser&apos;s site settings.
            </p>
          )}
          {pushState === "unsupported" && (
            <p className="text-xs text-fg-2">Notifications: email on this device.</p>
          )}
        </div>
      </div>

      <div>
        <p className="label mb-3">Household players</p>
        <ul className="mb-3 divide-y divide-line rounded-[12px] border border-line bg-surface-2">
          {players.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <Link href={`/app/players/${p.id}`} className="min-w-0 flex-1">
                <p className="font-medium">{p.full_name}</p>
                <p className="text-xs text-fg-2">
                  {p.skill_level}
                  {p.date_of_birth ? ` · born ${new Date(p.date_of_birth).getFullYear()}` : ""}
                  {" · attendance & notes →"}
                </p>
              </Link>
              <button
                disabled={pending}
                onClick={() => {
                  if (
                    !window.confirm(
                      `Remove ${p.full_name} from your household? Their attendance history and coach notes will no longer be visible.`
                    )
                  )
                    return;
                  startTransition(async () => {
                    const r = await removePlayer(p.id);
                    if (!r.ok) setMessage(r.error ?? null);
                  });
                }}
                className="text-xs text-fg-2 hover:text-err"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        <div className="space-y-2 rounded-[12px] border border-line p-4">
          <div className="grid grid-cols-2 gap-2">
            <Input
              placeholder="Player name"
              value={newPlayer.fullName}
              onChange={(e) => setNewPlayer({ ...newPlayer, fullName: e.target.value })}
            />
            <Input
              type="date"
              value={newPlayer.dateOfBirth}
              onChange={(e) => setNewPlayer({ ...newPlayer, dateOfBirth: e.target.value })}
            />
          </div>
          <Select
            value={newPlayer.skillLevel}
            onChange={(e) => setNewPlayer({ ...newPlayer, skillLevel: e.target.value })}
          >
            {["beginner", "intermediate", "advanced", "elite"].map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </Select>
          <Button
            variant="ghost"
            disabled={pending || !newPlayer.fullName}
            onClick={() =>
              startTransition(async () => {
                const r = await addPlayer(newPlayer);
                if (r.ok) setNewPlayer({ fullName: "", dateOfBirth: "", skillLevel: "beginner" });
                else setMessage(r.error ?? null);
              })
            }
            className="w-full"
          >
            Add player
          </Button>
        </div>
      </div>

      <Button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const r = await saveProfile({
              ...form,
              defaultAddress: address.formatted,
              addressDetails: address.formatted ? address : null,
            });
            setMessage(r.ok ? "Saved." : (r.error ?? "Save failed."));
          })
        }
        className="w-full"
      >
        {pending ? <Spinner /> : "Save profile"}
      </Button>
      {message && <p className="text-sm text-fg-2">{message}</p>}
    </div>
  );
}
