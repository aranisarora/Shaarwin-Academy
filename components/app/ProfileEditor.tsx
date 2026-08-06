"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { PhoneField } from "@/components/app/PhoneField";
import { Spinner } from "@/components/ui/Spinner";
import { ConfirmAction } from "@/components/ui/ConfirmAction";
import { Switch } from "@/components/ui/Switch";
import { PushToggle } from "@/components/app/PushToggle";
import { AddressForm } from "@/components/app/AddressForm";
import {
  fromDetails,
  type StructuredAddress,
} from "@/lib/address";
import { saveProfile, addPlayer, removePlayer } from "@/app/app/profile/actions";
import { PREF_GROUPS } from "@/lib/notification-prefs";

type Player = {
  id: string;
  full_name: string;
  date_of_birth: string | null;
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
  const [newPlayer, setNewPlayer] = useState({ fullName: "", dateOfBirth: "" });
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
        <PhoneField
          value={form.phone}
          onChange={(v) => setForm({ ...form, phone: v })}
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
          {PREF_GROUPS.map(({ key, label: labelText, description }) => {
            const on = form.prefs[key] !== false; // default on
            return (
              <label key={key} className="flex min-h-11 items-start justify-between gap-3 py-1">
                <span>
                  <span className="block text-sm">{labelText}</span>
                  <span className="block text-xs text-fg-2">{description}</span>
                </span>
                <Switch
                  checked={on}
                  onChange={(next) =>
                    setForm({ ...form, prefs: { ...form.prefs, [key]: next } })
                  }
                />
              </label>
            );
          })}
          <p className="pt-1 text-xs text-fg-2">
            Whatever these are set to, we&apos;ll always tell you if a session is
            cancelled, your coach is running late, your player was absent, or a
            payment fails.
          </p>
        </div>
        <PushToggle feedHref="/app/notifications" className="mt-3" />
      </div>

      <div>
        <p className="label mb-3">Household players</p>
        <ul className="mb-3 divide-y divide-line rounded-[12px] border border-line bg-surface-2">
          {players.map((p) => (
            <li
              key={p.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <Link href={`/app/players/${p.id}`} className="min-w-0 flex-1">
                <p className="font-medium">{p.full_name}</p>
                <p className="text-xs text-fg-2">
                  {p.date_of_birth ? `Born ${new Date(p.date_of_birth).getFullYear()} · ` : ""}
                  attendance &amp; notes →
                </p>
              </Link>
              <ConfirmAction
                variant="subtle"
                fullWidth={false}
                label="Remove"
                prompt={`Remove ${p.full_name}? Their history stays but won't be visible.`}
                confirmLabel="Remove"
                pending={pending}
                onConfirm={() =>
                  startTransition(async () => {
                    const r = await removePlayer(p.id);
                    if (!r.ok) setMessage(r.error ?? null);
                  })
                }
              />
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
          <Button
            variant="ghost"
            disabled={pending || !newPlayer.fullName}
            onClick={() =>
              startTransition(async () => {
                const r = await addPlayer(newPlayer);
                if (r.ok) setNewPlayer({ fullName: "", dateOfBirth: "" });
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
