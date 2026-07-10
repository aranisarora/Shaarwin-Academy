"use client";

import { useState } from "react";
import { Input } from "@/components/ui/Input";
import { AddressSearch, type GeocodeHit } from "@/components/app/AddressSearch";
import { LocationPinMap } from "@/components/app/LocationPinMap";
import {
  applyGeocode,
  type AddressLabel,
  type StructuredAddress,
} from "@/lib/address";

const LABELS: { value: AddressLabel; text: string }[] = [
  { value: "home", text: "Home" },
  { value: "work", text: "Work" },
  { value: "other", text: "Other" },
];

/**
 * The one standardized address-entry form used across every stakeholder
 * surface. Mapbox (`AddressSearch`) fills the geocoded base line + pin; the
 * user adds the fine-grained fields a geocoder can't know (flat, building,
 * floor, landmark) plus how to get in. Fully controlled — the parent owns the
 * `StructuredAddress` and persists it.
 */
export function AddressForm({
  value,
  onChange,
  requireFlat = false,
  showLabel = false,
  showAccessNotes = true,
  searchLabel = "Address",
  searchPlaceholder = "Start typing the address…",
  onGeocoded,
}: {
  value: StructuredAddress;
  onChange: (next: StructuredAddress) => void;
  requireFlat?: boolean;
  showLabel?: boolean;
  showAccessNotes?: boolean;
  searchLabel?: string;
  searchPlaceholder?: string;
  onGeocoded?: (next: StructuredAddress) => void;
}) {
  // The typeahead text is local; `selected` suppresses the dropdown until the
  // user edits again, mirroring the existing AddressSearch callers.
  const [query, setQuery] = useState(value.formatted);
  const [selected, setSelected] = useState(value.formatted.length > 0);

  function set<K extends keyof StructuredAddress>(
    key: K,
    v: StructuredAddress[K]
  ) {
    onChange({ ...value, [key]: v });
  }

  function pick(hit: GeocodeHit) {
    const next = applyGeocode(value, hit);
    setQuery(next.formatted);
    setSelected(true);
    onChange(next);
    onGeocoded?.(next);
  }

  const hasPin = value.lat !== null && value.lng !== null;

  return (
    <div className="space-y-4">
      <AddressSearch
        label={searchLabel}
        placeholder={searchPlaceholder}
        query={query}
        selected={selected}
        onQueryChange={(q) => {
          setQuery(q);
          setSelected(false);
          set("formatted", q);
        }}
        onSelect={pick}
      />

      {hasPin && (
        <div>
          <p className="label mb-2">Drag the pin to the exact entrance</p>
          <LocationPinMap
            lat={value.lat!}
            lng={value.lng!}
            onMove={(lat, lng) => onChange({ ...value, lat, lng })}
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Input
          label={`Flat / unit no.${requireFlat ? "" : " (optional)"}`}
          value={value.flat ?? ""}
          onChange={(e) => set("flat", e.target.value)}
        />
        <Input
          label="Floor / tower / block"
          placeholder="optional"
          value={value.floorTower ?? ""}
          onChange={(e) => set("floorTower", e.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Building / society name"
          placeholder="optional"
          value={value.building ?? ""}
          onChange={(e) => set("building", e.target.value)}
        />
        <Input
          label="Postcode / PIN"
          value={value.postcode ?? ""}
          onChange={(e) => set("postcode", e.target.value)}
        />
      </div>

      <Input
        label="Landmark"
        placeholder="e.g. opposite HDFC Bank (optional)"
        value={value.landmark ?? ""}
        onChange={(e) => set("landmark", e.target.value)}
      />

      {showAccessNotes && (
        <Input
          label="Entry notes (gate code, parking, which door…)"
          value={value.accessNotes ?? ""}
          onChange={(e) => set("accessNotes", e.target.value)}
        />
      )}

      {showLabel && (
        <div>
          <p className="label mb-2">Save as</p>
          <div className="grid grid-cols-3 gap-2">
            {LABELS.map((l) => (
              <button
                key={l.value}
                type="button"
                onClick={() => set("label", l.value)}
                aria-pressed={value.label === l.value}
                className={`min-h-11 rounded-[8px] border text-sm font-semibold ${
                  value.label === l.value
                    ? "border-ember bg-ember text-ivory"
                    : "border-line hover:border-ember"
                }`}
              >
                {l.text}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** True when the form holds enough to persist: a geocoded line + a pin (+ a
 * flat number when the surface requires one). */
export function isAddressComplete(
  a: StructuredAddress,
  requireFlat = false
): boolean {
  if (!a.formatted.trim() || a.lat === null || a.lng === null) return false;
  if (requireFlat && !a.flat?.trim()) return false;
  return true;
}
