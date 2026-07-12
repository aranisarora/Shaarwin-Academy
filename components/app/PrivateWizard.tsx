"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import { AddressForm, isAddressComplete } from "@/components/app/AddressForm";
import { EMPTY_ADDRESS, type StructuredAddress } from "@/lib/address";
import {
  checkCoverage,
  recordAreaInterest,
  getSlots,
  requestPrivateSessions,
  requestPrivateSeries,
  type Slot,
} from "@/app/app/book/private/actions";

type Coach = { id: string; name: string; lat: number; lng: number; radiusKm: number };

const DURATIONS = [60, 90] as const;

function fmtSlot(iso: string) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  }).format(new Date(iso));
}

export function PrivateWizard({
  players,
  coaches,
  minutesBalance,
  privateSessionsPerWeek,
  defaultAddress,
}: {
  players: { id: string; full_name: string }[];
  coaches: Coach[];
  minutesBalance: number;
  privateSessionsPerWeek: number | null;
  defaultAddress: string | null;
}) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  const [addr, setAddr] = useState<StructuredAddress>(() =>
    defaultAddress ? { ...EMPTY_ADDRESS, formatted: defaultAddress } : EMPTY_ADDRESS
  );
  const [covered, setCovered] = useState<boolean | null>(null);
  const [interestEmail, setInterestEmail] = useState("");
  const [interestSent, setInterestSent] = useState(false);
  const [playerId, setPlayerId] = useState(players[0]?.id ?? "");
  const [hasTable, setHasTable] = useState(true);

  const pin = addr.lat !== null && addr.lng !== null
    ? { lat: addr.lat, lng: addr.lng }
    : null;

  const [duration, setDuration] = useState<number>(60);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [preferredCoach, setPreferredCoach] = useState("");
  const [recurring, setRecurring] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [parked, setParked] = useState(false);
  const [booked, setBooked] = useState(1);
  const [ranOut, setRanOut] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (addr.lat === null || addr.lng === null) return;
    const lat = addr.lat;
    const lng = addr.lng;
    let cancelled = false;
    (async () => {
      const { covered } = await checkCoverage(lat, lng);
      if (!cancelled) setCovered(covered);
    })();
    return () => {
      cancelled = true;
    };
  }, [addr.lat, addr.lng]);

  function updateAddr(next: StructuredAddress) {
    setAddr(next);
    if (next.lat === null || next.lng === null) setCovered(null);
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
    setSelected([]);
    if (!pin) return;
    setSlots(null);
    startTransition(async () => {
      const result = await getSlots(pin.lat, pin.lng, d, playerId);
      setSlots(result);
    });
  }

  const maxSlots = Math.floor(minutesBalance / duration);

  function toggleSlot(startsAt: string) {
    setSelected((prev) => {
      if (recurring) {
        return prev.includes(startsAt) ? [] : [startsAt];
      }
      return prev.includes(startsAt)
        ? prev.filter((s) => s !== startsAt)
        : prev.length < maxSlots
          ? [...prev, startsAt]
          : prev;
    });
  }

  // When toggling recurring mode, clear selection if it's invalid
  useEffect(() => {
    if (recurring && selected.length > 1) {
      setSelected([selected[0]]);
    }
  }, [recurring]);

  const sortedSelected = [...selected].sort();

  function confirm() {
    if (!pin || selected.length === 0 || !addr.formatted) return;
    setError(null);
    startTransition(async () => {
      const req = {
        playerId,
        duration,
        address: addr.formatted,
        postcode: addr.postcode ?? "",
        lat: pin.lat,
        lng: pin.lng,
        hasTable,
        accessNotes: addr.accessNotes ?? "",
        details: addr,
        preferredCoach: preferredCoach || undefined,
      };

      if (recurring) {
        const result = await requestPrivateSeries({ ...req, startsAt: sortedSelected[0] });
        if (result.ok) {
          setParked(false);
          setBooked(result.booked);
          setRanOut(false);
          setStep(4);
        } else {
          setError(result.error);
        }
      } else {
        const result = await requestPrivateSessions(req, sortedSelected);
        if (result.ok) {
          setParked(result.parked > 0);
          setBooked(result.booked);
          setRanOut(result.ranOut);
          setStep(4);
        } else {
          setError(result.error);
        }
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

  if (minutesBalance < 60) {
    return (
      <div className="mx-auto max-w-xl">
        <div className="rounded-[12px] border border-line bg-surface-2 p-5">
          <h2 className="font-display text-2xl">Private coaching, at home</h2>
          <p className="mt-2 text-fg-2">
            A coach comes to you — your home, or your local clubhouse. To book,
            you need private minutes: buy a single session, or a monthly plan
            if it&apos;s becoming a routine.
          </p>
          <Link
            href="/app/membership"
            className="mt-4 inline-flex min-h-11 items-center justify-center rounded-[8px] bg-ember px-5 font-semibold text-ivory hover:bg-ember-2"
          >
            See private sessions &amp; plans
          </Link>
        </div>
      </div>
    );
  }

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
        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4">
          <h2 className="font-display text-2xl">Where&apos;s the table?</h2>
          <AddressForm
            value={addr}
            onChange={updateAddr}
            requireFlat
            showAccessNotes
            searchLabel="Address"
            searchPlaceholder="Start typing your address…"
          />

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
                        await recordAreaInterest(interestEmail, addr.postcode ?? "", pin.lat, pin.lng);
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

          <Button
            onClick={toStep2}
            disabled={
              !isAddressComplete(addr, true) ||
              covered !== true ||
              !hasTable ||
              pending
            }
            className="w-full"
          >
            {pending ? <Spinner /> : "Choose a time"}
          </Button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4">
          <h2 className="font-display text-2xl">When works?</h2>

          <div>
            <p className="label mb-2">Duration</p>
            <div className="grid grid-cols-2 gap-2">
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
              {minutesBalance} private minutes available.{" "}
              <Link
                href="/app/membership"
                className="text-ember underline-offset-4 hover:underline"
              >
                Get more
              </Link>
            </p>
          </div>
          
          {privateSessionsPerWeek && privateSessionsPerWeek > 0 && (
            <div className="rounded-[12px] border border-line bg-surface-2 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Book weekly</p>
                  <p className="mt-1 text-sm text-fg-2">
                    Your plan covers {privateSessionsPerWeek} recurring session{privateSessionsPerWeek > 1 ? "s" : ""} a week.
                  </p>
                </div>
                <button
                  role="switch"
                  aria-checked={recurring}
                  onClick={() => setRecurring(!recurring)}
                  className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
                    recurring ? "bg-ember" : "bg-line"
                  }`}
                >
                  <span
                    className={`absolute top-1 h-5 w-5 rounded-full bg-ivory transition-all ${
                      recurring ? "left-6" : "left-1"
                    }`}
                  />
                </button>
              </div>
            </div>
          )}

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
            <div className="mb-2 flex items-baseline justify-between">
              <p className="label">{recurring ? "Pick a weekly slot" : "Pick one or more slots"}</p>
              {selected.length > 0 && !recurring && (
                <p className="tnum text-xs text-fg-2">
                  {selected.length} selected · {selected.length * duration} min
                </p>
              )}
            </div>
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
                {slots.slice(0, 60).map((s) => {
                  const isSelected = selected.includes(s.starts_at);
                  const atCap = !isSelected && !recurring && selected.length >= maxSlots;
                  return (
                    <button
                      key={s.starts_at}
                      onClick={() => toggleSlot(s.starts_at)}
                      disabled={atCap}
                      aria-pressed={isSelected}
                      title={atCap ? "Not enough minutes for another session" : undefined}
                      className={`tnum min-h-11 rounded-[8px] border px-2 text-sm disabled:opacity-40 ${
                        isSelected
                          ? "border-ember bg-ember text-ivory"
                          : "border-line hover:border-ember"
                      }`}
                    >
                      {fmtSlot(s.starts_at)}
                    </button>
                  );
                })}
              </div>
            )}
            {!recurring && maxSlots > 1 && (
              <p className="mt-2 text-xs text-fg-2">
                Pick up to {maxSlots} — each uses {duration} of your {minutesBalance} minutes.
              </p>
            )}
          </div>

          <div className="flex gap-3">
            <Button variant="ghost" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button
              onClick={() => setStep(3)}
              disabled={selected.length === 0}
              className="flex-1"
            >
              Review
            </Button>
          </div>
        </div>
      )}

      {step === 3 && selected.length > 0 && (
        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4">
          <h2 className="font-display text-2xl">Confirm</h2>
          <div className="space-y-3 rounded-[12px] border border-line bg-surface-2 p-5">
            <p className="font-display text-2xl">
              {recurring ? "Weekly session" : `${selected.length} session${selected.length > 1 ? "s" : ""}`}
            </p>
            <ul className="tnum space-y-1 text-sm">
              {sortedSelected.map((s) => (
                <li key={s} className="flex items-center gap-2">
                  <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-ember" />
                  {fmtSlot(s)} {recurring && "and every week"}
                </li>
              ))}
            </ul>
            <p className="text-fg-2">{addr.formatted}</p>
            <p className="text-fg-2">{duration} minutes each</p>
            {!recurring && (
              <p className="tnum text-sm">
                Uses {selected.length * duration} of your {minutesBalance} min —{" "}
                {minutesBalance - selected.length * duration} left after.
              </p>
            )}
            {recurring && (
              <p className="tnum text-sm">
                This will automatically book sessions into the future.
              </p>
            )}
            <p className="text-sm text-fg-2">
              Coach: assigned automatically — we&apos;ll introduce them right away.
            </p>
          </div>
          {error && <p className="text-sm text-err">{error}</p>}
          <div className="flex gap-3">
            <Button variant="ghost" onClick={() => setStep(2)}>
              Back
            </Button>
            <Button onClick={confirm} disabled={pending} className="flex-1">
              {pending
                ? <Spinner />
                : recurring ? "Set up weekly series" : `Request ${selected.length} session${selected.length > 1 ? "s" : ""}`}
            </Button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="py-10 text-center animate-in zoom-in-95">
          <span aria-hidden className="ball-drop mx-auto mb-4 block h-5 w-5 rounded-full bg-ember" />
          <h2 className="font-display text-2xl">
            {parked ? "We're confirming your coach" : "You're on."}
          </h2>
          <p className="mt-2 text-fg-2">
            {recurring 
              ? `${booked} sessions generated so far. We'll keep booking them weekly.`
              : booked > 1
                ? `${booked} sessions booked${ranOut ? " — as far as your minutes stretched" : ""}.`
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
