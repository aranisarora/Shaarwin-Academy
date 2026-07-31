"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import {
  formatDate,
  formatSessionDate,
  formatWeeklySlot,
  wallWeekdayTime,
} from "@/lib/academy-time";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import { AddressForm, isAddressComplete } from "@/components/app/AddressForm";
import { SlotPicker } from "@/components/app/SlotPicker";
import { WhatsAppSayHi } from "@/components/app/WhatsAppSayHi";
import { fromDetails, type StructuredAddress } from "@/lib/address";
import { haversineMeters } from "@/lib/geo";
import {
  composeLocationLabel,
  composeUnitLabel,
  venueDisplayName,
} from "@/lib/venue-display";
import {
  checkCoverage,
  recordAreaInterest,
  getSlots,
  requestPrivateSessions,
  requestPrivateSeries,
  saveDefaultAddress,
  type Slot,
} from "@/app/app/book/private/actions";

type Coach = { id: string; name: string; lat: number; lng: number };

/** A place the academy already coaches at — offered by name near the pin. */
export type WizardVenue = {
  id: string;
  name: string;
  unit: string | null;
  lat: number;
  lng: number;
};

export type PrivatePlanLimits = {
  /** Weekly cap; null = legacy minutes-only (one-off booking). */
  sessionsPerWeek: number | null;
  /** Fixed session length; null = free 60/90 choice. */
  sessionMinutes: number | null;
};

// 60/90 only: the coach travels to the client, so anything shorter spends
// more time commuting than coaching.
const DURATIONS = [60, 90] as const;

/** "Every Tue, 5:00 pm" — the weekly identity of a slot. */
/** "4 Aug" — the date a weekly series' first session lands on. */
/** IST weekday+time key so two dates of the same weekly slot collide. */
const weeklyKey = wallWeekdayTime;

export function PrivateWizard({
  players,
  coaches,
  venues,
  minutesBalance,
  defaultAddress,
  defaultAddressDetails = null,
  privatePlan = null,
  onboarding = false,
}: {
  players: { id: string; full_name: string }[];
  coaches: Coach[];
  venues: WizardVenue[];
  minutesBalance: number;
  defaultAddress: string | null;
  /** The saved structured default address (profiles.address_details), if any —
   * lets a returning client land on step 1 with pin + coverage pre-solved. */
  defaultAddressDetails?: Partial<StructuredAddress> | null;
  privatePlan?: PrivatePlanLimits | null;
  onboarding?: boolean;
}) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // A plan with a weekly frequency books standing weekly slots; legacy
  // minutes-only clients keep the one-off multi-slot flow.
  const weeklyMode = privatePlan?.sessionsPerWeek != null;
  const planMinutes = privatePlan?.sessionMinutes ?? null;

  // Step 1 — where. A single structured address drives the whole step; the pin
  // lives in addr.lat/lng. Seed from the saved structured address (pin + all)
  // when present, else the bare formatted line.
  const [addr, setAddr] = useState<StructuredAddress>(() =>
    fromDetails(defaultAddressDetails, { address: defaultAddress })
  );
  // A returning client with a complete saved address sees a tappable summary
  // card instead of the empty form; "Change" reveals the form.
  const [editingAddress, setEditingAddress] = useState(
    () =>
      !isAddressComplete(
        fromDetails(defaultAddressDetails, { address: defaultAddress }),
        true
      )
  );
  const [covered, setCovered] = useState<boolean | null>(null);
  const [interestEmail, setInterestEmail] = useState("");
  const [interestSent, setInterestSent] = useState(false);
  const [playerId, setPlayerId] = useState(players[0]?.id ?? "");
  const [hasTable, setHasTable] = useState(true);

  const pin = addr.lat !== null && addr.lng !== null
    ? { lat: addr.lat, lng: addr.lng }
    : null;

  // Step 2 — when. Multiple slots can be picked; each becomes its own session
  // (or, in weekly mode, its own standing weekly slot).
  const [duration, setDuration] = useState<number>(planMinutes ?? 60);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [preferredCoach, setPreferredCoach] = useState("");

  // Prefetched slots keyed by the inputs that determine them, so tapping
  // "Choose a time" renders instantly instead of blocking on the round-trip.
  const [prefetch, setPrefetch] = useState<{ key: string; slots: Slot[] } | null>(
    null
  );

  // Which place this is. A coach is told the venue plus the unit inside it, and
  // nothing downstream re-derives either — so it's answered once, here.
  //
  // `venueId` is preferred over a typed name: renaming the venue later corrects
  // every message it has ever appeared in. Null means "somewhere else", and
  // then `venueLabel` carries what the client calls it.
  const [venueId, setVenueId] = useState<string | null>(null);
  const [venueLabel, setVenueLabel] = useState("");
  const [venuePicked, setVenuePicked] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [parked, setParked] = useState(false);
  const [booked, setBooked] = useState(1);
  const [ranOut, setRanOut] = useState(false);
  const [pending, startTransition] = useTransition();

  // Re-check coverage whenever the pin moves (fresh geocode or drag). State is
  // only set inside the async callback; the cleared-address case is handled in
  // updateAddr so we never setState synchronously in the effect body.
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

  // Wrap the address setter so clearing the pin also clears stale coverage.
  function updateAddr(next: StructuredAddress) {
    setAddr(next);
    if (next.lat === null || next.lng === null) setCovered(null);
  }

  // Identifies a slot list by everything that determines it — the prefetch
  // cache is only reused when this key matches the current inputs.
  const slotKey = (lat: number, lng: number, dur: number, player: string) =>
    `${lat.toFixed(6)},${lng.toFixed(6)},${dur},${player}`;

  // Prefetch on step 1 the moment the address is covered, so step 2 is instant.
  // Same cancelled-flag guard as the coverage effect above — a stale prefetch
  // (address dragged, duration changed) must never overwrite a newer one.
  useEffect(() => {
    if (!pin || covered !== true) return;
    const { lat, lng } = pin;
    const key = slotKey(lat, lng, duration, playerId);
    if (prefetch?.key === key) return;
    let cancelled = false;
    (async () => {
      const result = await getSlots(lat, lng, duration, playerId);
      if (!cancelled) setPrefetch({ key, slots: result });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin?.lat, pin?.lng, covered, duration, playerId]);

  function toStep2() {
    if (!pin) return;
    setStep(2);
    const key = slotKey(pin.lat, pin.lng, duration, playerId);
    if (prefetch?.key === key) {
      setSlots(prefetch.slots); // already in memory — no spinner
      return;
    }
    setSlots(null);
    startTransition(async () => {
      const result = await getSlots(pin.lat, pin.lng, duration, playerId);
      setSlots(result);
    });
  }

  function changeDuration(d: number) {
    setDuration(d);
    setSelected([]); // minutes-per-slot changed — start the pick over
    if (!pin) return;
    const key = slotKey(pin.lat, pin.lng, d, playerId);
    if (prefetch?.key === key) {
      setSlots(prefetch.slots);
      return;
    }
    setSlots(null);
    startTransition(async () => {
      const result = await getSlots(pin.lat, pin.lng, d, playerId);
      setSlots(result);
    });
  }

  // How many slots can be picked: the plan's weekly frequency in weekly mode,
  // else however many sessions of this duration the balance still covers.
  const maxSlots = weeklyMode
    ? (privatePlan?.sessionsPerWeek ?? 1)
    : Math.floor(minutesBalance / duration);

  function toggleSlot(startsAt: string) {
    setSelected((prev) => {
      if (prev.includes(startsAt)) return prev.filter((s) => s !== startsAt);
      if (prev.length >= maxSlots) return prev;
      // Weekly mode: two dates of the same weekday+time are the same slot.
      if (weeklyMode && prev.some((s) => weeklyKey(s) === weeklyKey(startsAt))) {
        return prev;
      }
      return [...prev, startsAt];
    });
  }

  const sortedSelected = [...selected].sort();

  // Venues close enough to the pin to be worth offering by name. Offered, not
  // assumed: two APR venues sit 36 metres apart, so no radius can pick between
  // them — but the person standing there can, in one tap.
  const nearbyVenues = pin
    ? venues
        .map((v) => ({ v, m: haversineMeters(pin.lat, pin.lng, v.lat, v.lng) }))
        .filter(({ m }) => m <= 500)
        .sort((a, b) => a.m - b.m)
        .slice(0, 4)
        .map(({ v }) => v)
    : [];

  // What to call somewhere that isn't one of ours — the client's own words
  // first (they typed the complex name), then the geocoder's.
  const suggestedLabel =
    addr.building?.trim() || addr.name?.trim() || addr.locality?.trim() || "";

  const unitLabel = composeUnitLabel(addr.floorTower, addr.flat);
  const chosenVenue = venues.find((v) => v.id === venueId) ?? null;
  const locationPreview = composeLocationLabel(
    chosenVenue ? venueDisplayName(chosenVenue) : venueLabel || suggestedLabel,
    unitLabel
  );

  function confirm() {
    if (!pin || selected.length === 0 || !addr.formatted) return;
    setError(null);
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
      venueId,
      venueLabel: venueId ? null : venueLabel.trim() || suggestedLabel || null,
      unitLabel,
      preferredCoach: preferredCoach || undefined,
    };
    startTransition(async () => {
      if (weeklyMode) {
        const result = await requestPrivateSeries(req, sortedSelected);
        if (result.ok) {
          void saveDefaultAddress(addr); // pre-solve step 1 next time
          setBooked(result.booked);
          setRanOut(result.skipped > 0);
          setStep(4);
        } else {
          setError(result.error);
        }
        return;
      }
      const result = await requestPrivateSessions(req, sortedSelected);
      if (result.ok) {
        void saveDefaultAddress(addr); // pre-solve step 1 next time
        setParked(result.parked > 0);
        setBooked(result.booked);
        setRanOut(result.ranOut);
        setStep(4);
      } else {
        setError(result.error);
      }
    });
  }

  // Every active coach serves Bengaluru, so once the address is inside our
  // coverage area they're all candidates for the preferred-coach picker.
  const coveringCoaches = covered ? coaches : [];

  // §1c — name the first unmet condition under the disabled CTA, in priority
  // order. Coverage (its own card) and the table toggle (inline) explain
  // themselves, so only the pin and flat need a line here.
  const disabledReason: string | null = !pin
    ? "Search your address or use your current location to drop a pin."
    : !addr.flat?.trim()
      ? "Add your flat / unit number."
      : !venuePicked
        ? "Tell us what this place is called."
        : !venueId && !(venueLabel.trim() || suggestedLabel)
          ? "Name the building or complex, so your coach knows where to head."
          : null;

  // A compact one-line summary for the returning-client saved-address card,
  // e.g. "Home — Prestige Lakeside, flat 402".
  const savedSummary = (() => {
    const label = addr.label
      ? addr.label[0].toUpperCase() + addr.label.slice(1)
      : "Saved";
    const place = addr.building?.trim() || addr.formatted.split(",")[0].trim();
    const flat = addr.flat?.trim() ? `, flat ${addr.flat.trim()}` : "";
    return `${label} — ${place}${flat}`;
  })();

  // Minutes are the entitlement — without enough for even one session, the
  // wizard can't finish, so point at the membership page up front.
  if (minutesBalance < (planMinutes ?? 60)) {
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
        <div className="space-y-5">
          <h2 className="font-display text-2xl">Where&apos;s the table?</h2>
          {editingAddress ? (
            <AddressForm
              value={addr}
              onChange={updateAddr}
              requireFlat
              showAccessNotes
              showUseMyLocation
              searchLabel="Address"
              searchPlaceholder="Start typing your address…"
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditingAddress(true)}
              className="flex w-full items-center justify-between gap-3 rounded-[12px] border border-line bg-surface-2 p-4 text-left hover:border-ember"
            >
              <span>
                <span className="block font-medium">{savedSummary}</span>
                <span className="mt-0.5 block text-sm text-fg-2">{addr.formatted}</span>
              </span>
              <span className="shrink-0 text-sm font-medium text-ember">Change</span>
            </button>
          )}

          {pin && (
            <div className="rounded-[12px] border border-line bg-surface-2 p-4">
              <p className="font-medium">What&apos;s this place called?</p>
              <p className="mt-1 text-sm text-fg-2">
                It&apos;s what your coach is told, so they head to the right
                gate.
              </p>

              <div className="mt-3 flex flex-wrap gap-2">
                {nearbyVenues.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => {
                      setVenueId(v.id);
                      setVenuePicked(true);
                    }}
                    className={`min-h-11 rounded-[8px] border px-3 text-sm font-medium ${
                      venueId === v.id
                        ? "border-ember bg-ember text-ivory"
                        : "border-line hover:border-ember"
                    }`}
                  >
                    {venueDisplayName(v)}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setVenueId(null);
                    setVenuePicked(true);
                    if (!venueLabel) setVenueLabel(suggestedLabel);
                  }}
                  className={`min-h-11 rounded-[8px] border px-3 text-sm font-medium ${
                    venuePicked && venueId === null
                      ? "border-ember bg-ember text-ivory"
                      : "border-line hover:border-ember"
                  }`}
                >
                  {nearbyVenues.length > 0 ? "Somewhere else" : "Name it"}
                </button>
              </div>

              {venuePicked && venueId === null && (
                <div className="mt-3">
                  <Input
                    label="Building or complex"
                    value={venueLabel}
                    onChange={(e) => setVenueLabel(e.target.value)}
                    placeholder="Prestige Mayberry"
                  />
                </div>
              )}

              {locationPreview && venuePicked && (
                <p className="mt-3 text-sm text-fg-2">
                  Your coach will see{" "}
                  <span className="font-medium text-fg">{locationPreview}</span>.
                </p>
              )}
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
            <Switch
              checked={hasTable}
              onChange={setHasTable}
              label="Do you have a table?"
            />
          </div>

          <div>
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
            {disabledReason && covered !== false && (
              <p className="mt-2 text-sm text-fg-2">{disabledReason}</p>
            )}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-5">
          <h2 className="font-display text-2xl">When works?</h2>

          {planMinutes !== null ? (
            <div className="rounded-[12px] border border-line bg-surface-2 p-4">
              <p className="font-medium">{planMinutes}-minute sessions</p>
              <p className="mt-1 text-sm text-fg-2">
                Your plan includes {privatePlan?.sessionsPerWeek}{" "}
                {planMinutes}-minute session
                {(privatePlan?.sessionsPerWeek ?? 1) > 1 ? "s" : ""} a week.
              </p>
            </div>
          ) : (
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
              <p className="label">
                {weeklyMode ? "Pick your weekly slot(s)" : "Pick one or more slots"}
              </p>
              {selected.length > 0 && (
                <p className="tnum text-xs text-fg-2">
                  {weeklyMode
                    ? `${selected.length} of ${maxSlots} weekly slot${maxSlots > 1 ? "s" : ""}`
                    : `${selected.length} selected · ${selected.length * duration} min`}
                </p>
              )}
            </div>
            {weeklyMode && (
              <p className="mb-2 text-xs text-fg-2">
                The time you pick repeats every week while your plan is active —
                the first session is on the date shown.
              </p>
            )}
            {slots === null ? (
              <div className="flex justify-center py-8">
                <Spinner />
              </div>
            ) : slots.length === 0 ? (
              <p className="py-6 text-sm text-fg-2">
                No servable times in the next two weeks — try a shorter duration.
              </p>
            ) : (
              <SlotPicker
                slots={slots}
                mode={weeklyMode ? "weekly" : "dates"}
                selected={selected}
                maxSlots={maxSlots}
                onToggle={toggleSlot}
              />
            )}
            {maxSlots > 1 && (
              <p className="mt-2 text-xs text-fg-2">
                {weeklyMode
                  ? `Pick up to ${maxSlots} weekly slots — that's your plan's frequency.`
                  : `Pick up to ${maxSlots} — each uses ${duration} of your ${minutesBalance} minutes.`}
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
        <div className="space-y-5">
          <h2 className="font-display text-2xl">Confirm</h2>
          <div className="space-y-3 rounded-[12px] border border-line bg-surface-2 p-5">
            <p className="font-display text-2xl">
              {weeklyMode
                ? `${selected.length} weekly slot${selected.length > 1 ? "s" : ""}`
                : `${selected.length} session${selected.length > 1 ? "s" : ""}`}
            </p>
            <ul className="tnum space-y-1 text-sm">
              {sortedSelected.map((s) => (
                <li key={s} className="flex items-center gap-2">
                  <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-ember" />
                  {weeklyMode ? (
                    <span>
                      <span className="font-semibold">Every {formatWeeklySlot(s)}</span>
                      <span className="text-fg-2"> — first session {formatDate(s)}</span>
                    </span>
                  ) : (
                    formatSessionDate(s)
                  )}
                </li>
              ))}
            </ul>
            <p className="text-fg-2">{addr.formatted}</p>
            <p className="text-fg-2">{duration} minutes each</p>
            {weeklyMode ? (
              <p className="text-sm text-fg-2">
                Repeats every week while your plan is active — cancel any single
                week or end the slot from your schedule.
              </p>
            ) : (
              <p className="tnum text-sm">
                Uses {selected.length * duration} of your {minutesBalance} min —{" "}
                {minutesBalance - selected.length * duration} left after.
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
              {pending ? (
                <Spinner />
              ) : weeklyMode ? (
                `Set ${selected.length} weekly slot${selected.length > 1 ? "s" : ""}`
              ) : (
                `Request ${selected.length} session${selected.length > 1 ? "s" : ""}`
              )}
            </Button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="py-10 text-center">
          <span aria-hidden className="ball-drop mx-auto mb-4 block h-5 w-5 rounded-full bg-ember" />
          <h2 className="font-display text-2xl">
            {weeklyMode
              ? "Your weekly slot is set."
              : parked
                ? "We're confirming your coach"
                : "You're on."}
          </h2>
          <p className="mt-2 text-fg-2">
            {weeklyMode
              ? `${booked} session${booked > 1 ? "s" : ""} booked over the coming weeks — the slot repeats automatically while your plan is active.`
              : booked > 1
                ? `${booked} sessions booked${ranOut ? " — as far as your minutes stretched" : ""}.`
                : parked
                  ? "You'll hear from us within 24 hours."
                  : "Coach confirmed — details are in your schedule."}
          </p>
          <div className="mx-auto mt-6 max-w-xs">
            <WhatsAppSayHi label="Want a reminder?" />
          </div>
          <Link
            href={onboarding ? "/app/onboarding/done" : "/app/schedule"}
            className="mt-4 inline-flex min-h-11 items-center rounded-[8px] bg-ember px-6 font-semibold text-ivory hover:bg-ember-2"
          >
            {onboarding ? "Continue" : "View schedule"}
          </Link>
        </div>
      )}
    </div>
  );
}
