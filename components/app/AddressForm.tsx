"use client";

import { useState } from "react";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import {
  AddressSearch,
  reverseGeocode,
  resolveTopSuggestion,
  type GeocodeHit,
} from "@/components/app/AddressSearch";
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
  showUseMyLocation = false,
  searchLabel = "Address",
  searchPlaceholder = "Start typing the address…",
  onGeocoded,
}: {
  value: StructuredAddress;
  onChange: (next: StructuredAddress) => void;
  requireFlat?: boolean;
  showLabel?: boolean;
  showAccessNotes?: boolean;
  /** Show the "Use my current location" GPS button above the search input. */
  showUseMyLocation?: boolean;
  searchLabel?: string;
  searchPlaceholder?: string;
  onGeocoded?: (next: StructuredAddress) => void;
}) {
  // The typeahead text is local; `selected` suppresses the dropdown until the
  // user edits again, mirroring the existing AddressSearch callers.
  const [query, setQuery] = useState(value.formatted);
  const [selected, setSelected] = useState(value.formatted.length > 0);
  // Async states for the two "get me a pin" affordances. `notice` is a quiet
  // inline message (permission denied / nothing found) — never a blocker.
  const [locating, setLocating] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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
    setNotice(null);
    onChange(next);
    onGeocoded?.(next);
  }

  const hasPin = value.lat !== null && value.lng !== null;

  // GPS → reverse-geocode → pin. Opt-in on tap only (never on mount). GPS gets
  // the user close; they drag the pin to the exact door afterwards.
  function useMyLocation() {
    if (!navigator.geolocation) {
      setNotice("Couldn't get your location — search instead.");
      return;
    }
    setNotice(null);
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const hit = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
        setLocating(false);
        if (hit) pick(hit);
        else setNotice("Couldn't get your location — search instead.");
      },
      () => {
        setLocating(false);
        setNotice("Couldn't get your location — search instead.");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }

  // Free-typed / autofilled / pasted text with no pin: resolve the top /suggest
  // match so the user is never dead-ended by a geocoder they didn't tap.
  function findOnMap() {
    setNotice(null);
    setResolving(true);
    resolveTopSuggestion(value.formatted).then((hit) => {
      setResolving(false);
      if (hit) pick(hit);
      else setNotice("Couldn't find that address — try adding more detail.");
    });
  }

  // Typed text but no pin yet → offer a way forward (autofill, paste, prefill).
  const needsPin = !hasPin && value.formatted.trim().length >= 3;

  return (
    <div className="space-y-4">
      {showUseMyLocation && (
        <button
          type="button"
          onClick={useMyLocation}
          disabled={locating}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-[8px] border border-line font-semibold text-fg transition-colors hover:border-ember hover:text-ember disabled:opacity-50"
        >
          {locating ? (
            <Spinner />
          ) : (
            <>
              <svg
                aria-hidden
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M12 2v3m0 14v3M2 12h3m14 0h3" />
              </svg>
              Use my current location
            </>
          )}
        </button>
      )}

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

      {needsPin && (
        <div className="-mt-1 space-y-1.5">
          <p className="text-xs text-fg-2">Pick a match so we can pin your door.</p>
          <button
            type="button"
            onClick={findOnMap}
            disabled={resolving}
            className="inline-flex items-center gap-2 text-sm font-medium text-ember underline-offset-4 hover:underline disabled:opacity-50"
          >
            {resolving ? <Spinner /> : null}
            Find this address on the map
          </button>
        </div>
      )}

      {notice && <p className="-mt-1 text-xs text-fg-2">{notice}</p>}

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
