"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { AddressSearch, type GeocodeHit } from "@/components/app/AddressSearch";
import { LocationPinMap } from "@/components/app/LocationPinMap";
import { saveCoachProfile } from "@/app/coach/more/actions";

export function CoachProfileEditor({
  fullName,
  bio,
  baseLat,
  baseLng,
  baseAddress,
}: {
  fullName: string;
  bio: string;
  baseLat: number;
  baseLng: number;
  baseAddress: string;
}) {
  const [form, setForm] = useState({ bio, baseLat, baseLng, baseAddress });
  const [addressQuery, setAddressQuery] = useState(baseAddress);
  const [addressSelected, setAddressSelected] = useState(baseAddress.length > 0);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function pickAddress(hit: GeocodeHit) {
    const [lng, lat] = hit.center;
    setForm((f) => ({ ...f, baseLat: lat, baseLng: lng, baseAddress: hit.place_name }));
    setAddressQuery(hit.place_name);
    setAddressSelected(true);
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="label mb-1">Coach</p>
        <p className="font-display text-2xl">{fullName}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="coach-bio" className="label">
          Bio (shown on the public coaches page)
        </label>
        <textarea
          id="coach-bio"
          value={form.bio}
          onChange={(e) => setForm({ ...form, bio: e.target.value })}
          rows={3}
          className="rounded-[8px] border border-line bg-surface-2 p-3.5 text-base"
        />
      </div>

      <div>
        <p className="label mb-2">Base location — type an address or drag the pin</p>
        <div className="mb-3">
          <AddressSearch
            label="Search your address"
            placeholder="Start typing your address…"
            query={addressQuery}
            selected={addressSelected}
            onQueryChange={(q) => {
              setAddressQuery(q);
              setAddressSelected(false);
              setForm((f) => ({ ...f, baseAddress: q }));
            }}
            onSelect={pickAddress}
          />
        </div>
        <LocationPinMap
          lat={form.baseLat}
          lng={form.baseLng}
          zoom={11}
          onMove={(lat, lng) => setForm((f) => ({ ...f, baseLat: lat, baseLng: lng }))}
          className="mb-3 h-56 overflow-hidden rounded-[12px] border border-line"
        />
      </div>

      <Button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const r = await saveCoachProfile(form);
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
