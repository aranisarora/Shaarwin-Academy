"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import { AddressSearch, type GeocodeHit } from "@/components/app/AddressSearch";
import {
  checkCoverage,
  recordAreaInterest,
  getSlots,
  requestPrivateSeries,
  type Slot,
} from "@/app/app/book/private/actions";

const WEEKDAY_FMT = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  timeZone: "Asia/Kolkata",
});

type Coach = { id: string; name: string; lat: number; lng: number; radiusKm: number };

const DURATIONS = [45, 60, 90] as const;

function fmtSlot(iso: string) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(new Date(iso));
}

export function PrivateWizard({
  players,
  coaches,
  minutesBalance,
  defaultAddress,
}: {
  players: { id: string; full_name: string }[];
  coaches: Coach[];
  minutesBalance: number;
  defaultAddress: string | null;
}) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // Step 1 — where
  const [query, setQuery] = useState(defaultAddress ?? "");
  const [address, setAddress] = useState<string | null>(null);
  const [postcode, setPostcode] = useState("");
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [covered, setCovered] = useState<boolean | null>(null);
  const [interestEmail, setInterestEmail] = useState("");
  const [interestSent, setInterestSent] = useState(false);
  const [playerId, setPlayerId] = useState(players[0]?.id ?? "");
  const [hasTable, setHasTable] = useState(true);
  const [accessNotes, setAccessNotes] = useState("");

  // Step 2 — when
  const [duration, setDuration] = useState<number>(60);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [preferredCoach, setPreferredCoach] = useState("");

  const [recurring, setRecurring] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [parked, setParked] = useState(false);
  const [booked, setBooked] = useState(1);
  const [ranOut, setRanOut] = useState(false);
  const [pending, startTransition] = useTransition();

  const mapContainer = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markerRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);

  // Draggable pin map once an address is picked
  useEffect(() => {
    if (!pin || !mapContainer.current || mapRef.current) return;
    let cancelled = false;
    (async () => {
      const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
      if (!token) return;
      const mapboxgl = (await import("mapbox-gl")).default;
      await import("mapbox-gl/dist/mapbox-gl.css");
      if (cancelled || !mapContainer.current) return;
      mapboxgl.accessToken = token;
      const map = new mapboxgl.Map({
        container: mapContainer.current,
        style: "mapbox://styles/mapbox/dark-v11",
        center: [pin.lng, pin.lat],
        zoom: 15,
        attributionControl: false,
      });
      mapRef.current = map;
      const el = document.createElement("div");
      el.style.cssText =
        "width:20px;height:20px;border-radius:999px;background:#E8590C;border:3px solid #F4F1EA;cursor:grab;box-shadow:0 0 0 6px rgb(232 89 12 / 0.25)";
      const marker = new mapboxgl.Marker({ element: el, draggable: true })
        .setLngLat([pin.lng, pin.lat])
        .addTo(map);
      marker.on("dragend", () => {
        const pos = marker.getLngLat();
        setPin({ lat: pos.lat, lng: pos.lng });
      });
      markerRef.current = marker;
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin === null]);

  function pickAddress(hit: GeocodeHit) {
    setAddress(hit.place_name);
    setQuery(hit.place_name);
    setPostcode(hit.postcode);
    const [lng, lat] = hit.center;
    setPin({ lat, lng });
    startTransition(async () => {
      const { covered } = await checkCoverage(lat, lng);
      setCovered(covered);
    });
  }

  function toStep2() {
    if (!pin) return;
    setSlots(null);
    setStep(2);
    startTransition(async () => {
      const result = await getSlots(pin.lat, pin.lng, duration, playerId);
      setSlots(result);
    });
  }

  function changeDuration(d: number) {
    setDuration(d);
    setSlot(null);
    if (!pin) return;
    setSlots(null);
    startTransition(async () => {
      const result = await getSlots(pin.lat, pin.lng, d, playerId);
      setSlots(result);
    });
  }

  function confirm() {
    if (!pin || !slot || !address) return;
    setError(null);
    startTransition(async () => {
      const result = await requestPrivateSeries(
        {
          playerId,
          duration,
          startsAt: slot,
          address,
          postcode,
          lat: pin.lat,
          lng: pin.lng,
          hasTable,
          accessNotes,
          preferredCoach: preferredCoach || undefined,
        },
        recurring
      );
      if (result.ok) {
        setParked(result.parked > 0);
        setBooked(result.booked);
        setRanOut(result.ranOut);
        setStep(4);
      } else {
        setError(result.error);
      }
    });
  }

  const coveringCoaches = pin
    ? coaches.filter((c) => {
        const dLat = (c.lat - pin.lat) * 111.32;
        const dLng = (c.lng - pin.lng) * 111.32 * Math.cos((pin.lat * Math.PI) / 180);
        return Math.sqrt(dLat * dLat + dLng * dLng) <= c.radiusKm;
      })
    : [];

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-6 flex items-center gap-2" aria-hidden>
        {[1, 2, 3].map((n) => (
          <span
            key={n}
            className={`h-1.5 flex-1 rounded-full ${step >= n ? "bg-ember" : "bg-line"}`}
          />
        ))}
      </div>

      {step === 1 && (
        <div className="space-y-5">
          <h2 className="font-display text-2xl">Where&apos;s the table?</h2>
          <AddressSearch
            placeholder="Start typing your address…"
            query={query}
            selected={address !== null}
            onQueryChange={(q) => {
              setQuery(q);
              setAddress(null);
              setCovered(null);
            }}
            onSelect={pickAddress}
          />

          {pin && (
            <div>
              <p className="label mb-2">Drag to your door</p>
              <div
                ref={mapContainer}
                className="h-56 overflow-hidden rounded-[12px] border border-line"
              />
            </div>
          )}

          {covered === false && (
            <div className="rounded-[12px] border border-line bg-surface-2 p-4">
              <p className="font-medium">We don&apos;t cover this area yet.</p>
              {interestSent ? (
                <p className="mt-2 text-sm text-ok">
                  Noted — we&apos;ll email you when a coach covers your postcode.
                </p>
              ) : (
                <div className="mt-3 flex gap-2">
                  <Input
                    placeholder="you@email.com"
                    type="email"
                    value={interestEmail}
                    onChange={(e) => setInterestEmail(e.target.value)}
                    className="flex-1"
                  />
                  <Button
                    variant="ghost"
                    onClick={() =>
                      startTransition(async () => {
                        if (!pin || !interestEmail) return;
                        await recordAreaInterest(interestEmail, postcode, pin.lat, pin.lng);
                        setInterestSent(true);
                      })
                    }
                  >
                    Notify me
                  </Button>
                </div>
              )}
            </div>
          )}

          {players.length > 1 && (
            <Select
              label="Who's playing?"
              value={playerId}
              onChange={(e) => setPlayerId(e.target.value)}
            >
              {players.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </Select>
          )}

          <div className="flex items-center justify-between rounded-[12px] border border-line bg-surface-2 p-4">
            <div>
              <p className="font-medium">Do you have a table?</p>
              {!hasTable && (
                <p className="mt-1 text-sm text-fg-2">
                  Home sessions need a table. No table?{" "}
                  <Link href="/locations" className="text-ember underline-offset-4 hover:underline">
                    Book at your nearest venue
                  </Link>{" "}
                  instead.
                </p>
              )}
            </div>
            <button
              role="switch"
              aria-checked={hasTable}
              onClick={() => setHasTable(!hasTable)}
              className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
                hasTable ? "bg-ember" : "bg-line"
              }`}
            >
              <span
                className={`absolute top-1 h-5 w-5 rounded-full bg-ivory transition-all ${
                  hasTable ? "left-6" : "left-1"
                }`}
              />
            </button>
          </div>

          <Input
            label="Access notes (parking, gate codes…)"
            value={accessNotes}
            onChange={(e) => setAccessNotes(e.target.value)}
          />

          <Button
            onClick={toStep2}
            disabled={!pin || covered !== true || !hasTable || pending}
            className="w-full"
          >
            {pending ? <Spinner /> : "Choose a time"}
          </Button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-5">
          <h2 className="font-display text-2xl">When works?</h2>

          <div>
            <p className="label mb-2">Duration</p>
            <div className="grid grid-cols-3 gap-2">
              {DURATIONS.map((d) => {
                const disabled = minutesBalance < d;
                return (
                  <button
                    key={d}
                    disabled={disabled}
                    onClick={() => changeDuration(d)}
                    className={`min-h-11 rounded-[8px] border text-sm font-semibold disabled:opacity-40 ${
                      duration === d
                        ? "border-ember bg-ember text-ivory"
                        : "border-line hover:border-ember"
                    }`}
                    title={disabled ? "Not enough minutes left" : undefined}
                  >
                    {d} min
                  </button>
                );
              })}
            </div>
            <p className="tnum mt-2 text-xs text-fg-2">
              {minutesBalance} private minutes available.
            </p>
          </div>

          {coveringCoaches.length > 1 && (
            <Select
              label="Preferred coach (optional)"
              value={preferredCoach}
              onChange={(e) => setPreferredCoach(e.target.value)}
            >
              <option value="">No preference</option>
              {coveringCoaches.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}

          <div>
            <p className="label mb-2">Pick a slot</p>
            {slots === null ? (
              <div className="flex justify-center py-8">
                <Spinner />
              </div>
            ) : slots.length === 0 ? (
              <p className="py-6 text-sm text-fg-2">
                No servable times in the next two weeks — try a shorter duration.
              </p>
            ) : (
              <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto pr-1">
                {slots.slice(0, 60).map((s) => (
                  <button
                    key={s.starts_at}
                    onClick={() => setSlot(s.starts_at)}
                    className={`tnum min-h-11 rounded-[8px] border px-2 text-sm ${
                      slot === s.starts_at
                        ? "border-ember bg-ember text-ivory"
                        : "border-line hover:border-ember"
                    }`}
                  >
                    {fmtSlot(s.starts_at)}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <Button variant="ghost" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button onClick={() => setStep(3)} disabled={!slot} className="flex-1">
              Review
            </Button>
          </div>
        </div>
      )}

      {step === 3 && slot && (
        <div className="space-y-5">
          <h2 className="font-display text-2xl">Confirm</h2>
          <div className="space-y-3 rounded-[12px] border border-line bg-surface-2 p-5">
            <p className="tnum font-display text-3xl">{fmtSlot(slot)}</p>
            <p className="text-fg-2">{address}</p>
            <p className="text-fg-2">{duration} minutes</p>
            <p className="tnum text-sm">
              Uses {duration} of your {minutesBalance} min
              {recurring ? " per week, while minutes last" : ` — ${minutesBalance - duration} left after`}.
            </p>
            <p className="text-sm text-fg-2">
              Coach: assigned automatically — we&apos;ll introduce them right away.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setRecurring(true)}
              aria-pressed={recurring}
              className={`rounded-[10px] border p-3 text-left ${recurring ? "border-ember bg-ember/5" : "border-line hover:border-fg-2"}`}
            >
              <p className="text-sm font-semibold">Every week</p>
              <p className="mt-0.5 text-xs text-fg-2">
                {WEEKDAY_FMT.format(new Date(slot))}s at this time, until your minutes
                run out.
              </p>
            </button>
            <button
              type="button"
              onClick={() => setRecurring(false)}
              aria-pressed={!recurring}
              className={`rounded-[10px] border p-3 text-left ${!recurring ? "border-ember bg-ember/5" : "border-line hover:border-fg-2"}`}
            >
              <p className="text-sm font-semibold">Just once</p>
              <p className="mt-0.5 text-xs text-fg-2">Only {fmtSlot(slot)}.</p>
            </button>
          </div>
          {error && <p className="text-sm text-err">{error}</p>}
          <div className="flex gap-3">
            <Button variant="ghost" onClick={() => setStep(2)}>
              Back
            </Button>
            <Button onClick={confirm} disabled={pending} className="flex-1">
              {pending ? <Spinner /> : "Request session"}
            </Button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="py-10 text-center">
          <span aria-hidden className="ball-drop mx-auto mb-4 block h-5 w-5 rounded-full bg-ember" />
          <h2 className="font-display text-2xl">
            {parked ? "We're confirming your coach" : "You're on."}
          </h2>
          <p className="mt-2 text-fg-2">
            {booked > 1
              ? `${booked} weekly sessions booked${ranOut ? " — as far as your minutes stretch" : ""}.`
              : parked
                ? "You'll hear from us within 24 hours."
                : "Coach confirmed — details are in your schedule."}
          </p>
          <Link
            href="/app/schedule"
            className="mt-6 inline-flex min-h-11 items-center rounded-[8px] bg-ember px-6 font-semibold text-ivory hover:bg-ember-2"
          >
            View schedule
          </Link>
        </div>
      )}
    </div>
  );
}
