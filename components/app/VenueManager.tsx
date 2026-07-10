"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Sheet } from "@/components/ui/Sheet";
import { Spinner } from "@/components/ui/Spinner";
import { AddressForm, isAddressComplete } from "@/components/app/AddressForm";
import {
  EMPTY_ADDRESS,
  fromDetails,
  type StructuredAddress,
} from "@/lib/address";
import { saveVenue, setVenueActive, deleteVenue } from "@/app/admin/actions";

type Venue = {
  id: string;
  name: string;
  address: string;
  postcode: string;
  lat: number;
  lng: number;
  active: boolean;
  address_details?: Partial<StructuredAddress> | null;
};

type Editing = { id?: string; name: string; addr: StructuredAddress };

const BENGALURU = { lat: 12.9716, lng: 77.5946 };

export function VenueManager({ venues }: { venues: Venue[] }) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function openNew() {
    setEditing({ name: "", addr: EMPTY_ADDRESS });
  }

  function openEdit(v: Venue) {
    setEditing({
      id: v.id,
      name: v.name,
      addr: fromDetails(v.address_details, {
        address: v.address,
        postcode: v.postcode,
        lat: v.lat,
        lng: v.lng,
      }),
    });
  }

  function submit() {
    if (!editing || !editing.name.trim() || !isAddressComplete(editing.addr)) return;
    startTransition(async () => {
      const a = editing.addr;
      const r = await saveVenue({
        id: editing.id,
        name: editing.name,
        address: a.formatted,
        postcode: a.postcode ?? "",
        lat: a.lat ?? BENGALURU.lat,
        lng: a.lng ?? BENGALURU.lng,
        details: a,
      });
      setMessage(r.ok ? "Saved." : (r.error ?? "Save failed."));
      if (r.ok) setEditing(null);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="label">Venues</p>
        <Button onClick={openNew}>New venue</Button>
      </div>
      {message && <p className="text-sm text-fg-2">{message}</p>}

      <ul className="divide-y divide-line rounded-[12px] border border-line bg-surface-2">
        {venues.map((v) => (
          <li key={v.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <button onClick={() => openEdit(v)} className="text-left hover:text-ember">
              <p className="font-medium">{v.name}</p>
              <p className="text-sm text-fg-2">
                {v.address} · {v.postcode}
              </p>
            </button>
            <div className="flex flex-col items-end gap-1.5">
              <Badge tone={v.active ? "ok" : "err"}>
                {v.active ? "shown on website" : "hidden"}
              </Badge>
              <button
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    await setVenueActive(v.id, !v.active);
                  })
                }
                className="text-xs text-fg-2 underline-offset-4 hover:underline"
              >
                {v.active ? "Hide venue" : "Show venue"}
              </button>
            </div>
          </li>
        ))}
      </ul>

      <Sheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.id ? "Edit venue" : "New venue"}
      >
        {editing && (
          <div className="space-y-4">
            <Input
              label="Name"
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            />
            <AddressForm
              value={editing.addr}
              onChange={(addr) => setEditing({ ...editing, addr })}
              searchLabel="Address"
              searchPlaceholder="Start typing the venue address…"
              showAccessNotes
            />
            <Button onClick={submit} disabled={pending} className="w-full">
              {pending ? <Spinner /> : "Save venue"}
            </Button>
            {editing.id && (
              <Button
                variant="destructive"
                disabled={pending}
                className="w-full"
                onClick={() => {
                  if (
                    !window.confirm(
                      "Delete this venue for good? This only works if no classes use it."
                    )
                  )
                    return;
                  startTransition(async () => {
                    const r = await deleteVenue(editing.id!);
                    setMessage(r.ok ? "Venue deleted." : (r.error ?? "Delete failed."));
                    if (r.ok) setEditing(null);
                  });
                }}
              >
                Delete venue
              </Button>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}
