"use client";

// "Add to schedule" sheet: a new weekly class, an extra one-off session of an
// existing class, or a private session booked for a client.

import { useState, useTransition } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import { createGroupClass } from "@/app/admin/actions";
import {
  createOneOffSession,
  createPrivateSession,
  createPrivateSessionForInvite,
} from "@/app/admin/calendar/actions";
import { AddressForm, isAddressComplete } from "@/components/app/AddressForm";
import { EMPTY_ADDRESS, type StructuredAddress } from "@/lib/address";
import { EMPTY_CLASS_FORM, generateClassTitle, time12h, type ClassFormState } from "./ClassFields";
import { TimeSelect12h } from "./TimeSelect12h";
import {
  WEEKDAYS,
  WEEKDAY_NAME,
  type ClassRow,
  type ClientOption,
  type Coach,
  type InviteOption,
  type Venue,
} from "./admin-calendar-types";

type Mode = "weekly" | "oneoff" | "private";

const MODES: { value: Mode; label: string }[] = [
  { value: "weekly", label: "Weekly class" },
  { value: "oneoff", label: "Extra session" },
  { value: "private", label: "Private session" },
];

/** "2025-07-14" → "Mon 14 Jul" */
function fmtDateTag(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(y, m - 1, d));
}

/** Label for each class in the extra-session dropdown. */
function classLabel(c: ClassRow): string {
  const day = WEEKDAY_NAME[c.weekday] ?? c.weekday;
  const t = time12h(c.time);
  return c.venueName ? `${day} ${t} · ${c.venueName}` : `${day} ${t}`;
}

export function AdminAddSheet({
  onClose,
  onDone,
  classes,
  coaches,
  venues,
  clients,
  invites,
}: {
  onClose: () => void;
  onDone: (message: string) => void;
  classes: ClassRow[];
  coaches: Coach[];
  venues: Venue[];
  clients: ClientOption[];
  invites: InviteOption[];
}) {
  const [mode, setMode] = useState<Mode>("weekly");

  // ── Weekly class state ──────────────────────────────────────────────────────
  const [form, setForm] = useState<ClassFormState>(() => ({
    ...EMPTY_CLASS_FORM,
    venueId: venues[0]?.id ?? "",
  }));
  const [weekdays, setWeekdays] = useState<string[]>(["MO"]);

  function toggleDay(code: string) {
    setWeekdays((prev) =>
      prev.includes(code) ? prev.filter((d) => d !== code) : [...prev, code]
    );
  }

  // ── Extra session state ─────────────────────────────────────────────────────
  const firstClass = classes[0];
  const [oneOff, setOneOff] = useState({
    classId: firstClass?.id ?? "",
    dates: [] as string[],
    time: firstClass?.time ?? "18:30",
    coachId: "",
  });
  const [dateKey, setDateKey] = useState(0);

  function addDate(d: string) {
    if (!d || oneOff.dates.includes(d)) return;
    setOneOff((o) => ({ ...o, dates: [...o.dates, d].sort() }));
    setDateKey((k) => k + 1);
  }

  function removeDate(i: number) {
    setOneOff((o) => ({ ...o, dates: o.dates.filter((_, j) => j !== i) }));
  }

  // ── Private session state ───────────────────────────────────────────────────
  const [priv, setPriv] = useState({
    clientId: "",
    playerId: "",
    date: "",
    time: "17:00",
    duration: 60,
    coachId: "",
    overrideLimits: false,
    recurring: false,
    recurWeeks: 4,
  });
  const [address, setAddress] = useState<StructuredAddress>(EMPTY_ADDRESS);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // ── Shared ──────────────────────────────────────────────────────────────────
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isInvite = priv.clientId.startsWith("invite:");
  const client = isInvite ? null : (clients.find((c) => c.id === priv.clientId) ?? null);

  function resetMode(next: Mode) {
    setMode(next);
    setMessage(null);
    if (next === "weekly") {
      setForm({ ...EMPTY_CLASS_FORM, venueId: venues[0]?.id ?? "" });
      setWeekdays(["MO"]);
    }
    if (next === "oneoff") {
      const cls = classes[0];
      setOneOff({ classId: cls?.id ?? "", dates: [], time: cls?.time ?? "18:30", coachId: "" });
      setDateKey((k) => k + 1);
    }
    if (next === "private") {
      setPriv({
        clientId: "",
        playerId: "",
        date: "",
        time: "17:00",
        duration: 60,
        coachId: "",
        overrideLimits: false,
        recurring: false,
        recurWeeks: 4,
      });
      setAddress(EMPTY_ADDRESS);
      setShowAdvanced(false);
    }
  }

  function submit() {
    setMessage(null);
    startTransition(async () => {
      if (mode === "weekly") {
        const venueName = venues.find((v) => v.id === form.venueId)?.name;
        for (const day of weekdays) {
          const r = await createGroupClass({
            ...form,
            weekday: day,
            title: generateClassTitle(day, form.time, venueName),
          });
          if (!r.ok) {
            setMessage(r.error ?? "Couldn't create the class.");
            return;
          }
        }
        const dayNames = weekdays.map((d) => WEEKDAY_NAME[d] ?? d).join(", ");
        onDone(
          weekdays.length > 1
            ? `${weekdays.length} classes published — ${dayNames} at ${time12h(form.time)}.`
            : "Class published — the next 8 weeks of sessions are on the schedule."
        );
      } else if (mode === "oneoff") {
        for (const date of oneOff.dates) {
          const r = await createOneOffSession(
            oneOff.classId,
            date,
            oneOff.time,
            oneOff.coachId
          );
          if (!r.ok) {
            setMessage(r.error ?? "Couldn't add the session.");
            return;
          }
        }
        onDone(
          oneOff.dates.length > 1
            ? `${oneOff.dates.length} sessions added to the schedule.`
            : "Session added to the schedule."
        );
      } else {
        const details = {
          date: priv.date,
          time: priv.time,
          durationMinutes: priv.duration,
          address: address.formatted,
          postcode: address.postcode ?? "",
          lat: address.lat!,
          lng: address.lng!,
          accessNotes: address.accessNotes ?? undefined,
          addressDetails: address as unknown as Record<string, unknown>,
          coachId: priv.coachId || undefined,
          overridePlanLimits: priv.overrideLimits,
          recurWeeks: priv.recurring ? priv.recurWeeks : 1,
        };
        const r = isInvite
          ? await createPrivateSessionForInvite(priv.clientId.slice("invite:".length), details)
          : await createPrivateSession({
              ...details,
              clientId: priv.clientId,
              playerId: priv.playerId || undefined,
            });
        if (r.ok) {
          const recurring = priv.recurring && priv.recurWeeks > 1;
          onDone(
            isInvite
              ? recurring
                ? `Account created and ${priv.recurWeeks} weekly private sessions booked — waiting when they sign in.`
                : "Account created and private session booked — it'll be waiting when they sign in."
              : recurring
                ? `${priv.recurWeeks} weekly private sessions booked — the client has been told.`
                : "Private session booked — the client has been told."
          );
        } else setMessage(r.error ?? "Couldn't book the session.");
      }
    });
  }

  const venueName = venues.find((v) => v.id === form.venueId)?.name;

  const canSubmit =
    mode === "weekly"
      ? !!form.venueId && weekdays.length > 0
      : mode === "oneoff"
        ? !!oneOff.classId && oneOff.dates.length > 0 && !!oneOff.time
        : !!priv.clientId && !!priv.date && !!priv.time && isAddressComplete(address);

  const submitLabel =
    mode === "weekly"
      ? weekdays.length > 1
        ? `Publish ${weekdays.length} classes`
        : "Publish class"
      : mode === "oneoff"
        ? oneOff.dates.length > 1
          ? `Add ${oneOff.dates.length} sessions`
          : "Add session"
        : priv.recurring && priv.recurWeeks > 1
          ? `Book ${priv.recurWeeks} weekly sessions`
          : "Book private session";

  return (
    <Sheet open onClose={onClose} title="Add to schedule">
      <div className="space-y-5">
        {/* Mode tabs */}
        <div className="grid grid-cols-3 gap-2">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => resetMode(m.value)}
              aria-pressed={mode === m.value}
              className={`min-h-11 rounded-[8px] border px-2 text-sm font-semibold ${
                mode === m.value
                  ? "border-ember bg-ember text-ivory"
                  : "border-line hover:border-ember"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* ── Weekly class ──────────────────────────────────────────────────── */}
        {mode === "weekly" && (
          <>
            <Select
              label="Coach"
              hint="Leave on automatic and the best-fitting coach is picked for you."
              value={form.coachId}
              onChange={(e) => setForm({ ...form, coachId: e.target.value })}
            >
              <option value="">Automatic — pick the best fit</option>
              {coaches.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>

            <div className="grid grid-cols-2 gap-3">
              <Select
                label="Venue"
                value={form.venueId}
                onChange={(e) => setForm({ ...form, venueId: e.target.value })}
              >
                {venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.active ? v.name : `${v.name} (hidden)`}
                  </option>
                ))}
              </Select>
              <Select
                label="Length"
                value={form.durationMinutes}
                onChange={(e) => setForm({ ...form, durationMinutes: Number(e.target.value) })}
              >
                {[60, 90, 120, 150, 180, 210, 240].map((d) => (
                  <option key={d} value={d}>{d} min</option>
                ))}
              </Select>
              <Input
                label="Spots"
                type="number"
                min={1}
                value={form.capacity}
                onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })}
              />
              <TimeSelect12h
                label="Time"
                value={form.time}
                onChange={(time) => setForm({ ...form, time })}
              />
            </div>

            <Input
              label="Description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              hint="Optional — shown to clients when they book."
            />

            <div>
              <p className="label mb-2">Days</p>
              <p className="mb-2 text-sm text-fg-2">
                Pick one or more — a separate class is created for each.
              </p>
              <div className="flex flex-wrap gap-2">
                {WEEKDAYS.map(([code, name]) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => toggleDay(code)}
                    aria-pressed={weekdays.includes(code)}
                    className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
                      weekdays.includes(code)
                        ? "border-ember bg-ember text-ivory"
                        : "border-line hover:border-ember"
                    }`}
                  >
                    {name.slice(0, 3)}
                  </button>
                ))}
              </div>
            </div>

            {weekdays.length > 0 && form.venueId && (
              <p className="rounded-[12px] border border-line bg-surface-2 px-4 py-3 text-sm text-fg-2">
                {weekdays.length === 1
                  ? `Will create: ${generateClassTitle(weekdays[0], form.time, venueName)}`
                  : `Will create ${weekdays.length} classes — ${weekdays
                      .map((d) => generateClassTitle(d, form.time, venueName))
                      .join(", ")}`}
              </p>
            )}
          </>
        )}

        {/* ── Extra session ─────────────────────────────────────────────────── */}
        {mode === "oneoff" && (
          <>
            <Select
              label="Class"
              value={oneOff.classId}
              onChange={(e) => {
                const cls = classes.find((c) => c.id === e.target.value);
                setOneOff((o) => ({
                  ...o,
                  classId: e.target.value,
                  time: cls?.time ?? o.time,
                }));
              }}
            >
              {classes.map((c) => (
                <option key={c.id} value={c.id}>{classLabel(c)}</option>
              ))}
            </Select>

            <Select
              label="Coach"
              hint="Leave on automatic and the best-fitting coach is picked for you."
              value={oneOff.coachId}
              onChange={(e) => setOneOff((o) => ({ ...o, coachId: e.target.value }))}
            >
              <option value="">Automatic — pick the best fit</option>
              {coaches.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>

            <div>
              <p className="label mb-2">Dates</p>
              <p className="mb-2 text-sm text-fg-2">
                Add one or more — a session is created for each.
              </p>
              {oneOff.dates.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {oneOff.dates.map((d, i) => (
                    <span
                      key={d}
                      className="flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-3 py-1 text-sm"
                    >
                      {fmtDateTag(d)}
                      <button
                        type="button"
                        onClick={() => removeDate(i)}
                        className="text-fg-2 hover:text-err"
                        aria-label={`Remove ${fmtDateTag(d)}`}
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <input
                key={dateKey}
                type="date"
                onChange={(e) => addDate(e.target.value)}
                className="rounded-[8px] border border-line bg-surface-2 px-3 py-2 text-sm focus:border-ember focus:outline-none"
                aria-label="Add a date"
              />
            </div>

            <TimeSelect12h
              label="Time"
              value={oneOff.time}
              onChange={(time) => setOneOff((o) => ({ ...o, time }))}
            />
          </>
        )}

        {/* ── Private session ───────────────────────────────────────────────── */}
        {mode === "private" && (
          <>
            <Select
              label="Client"
              value={priv.clientId}
              onChange={(e) => setPriv({ ...priv, clientId: e.target.value, playerId: "" })}
            >
              <option value="">— pick a client —</option>
              {clients.length > 0 && (
                <optgroup label="Clients">
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.name || "Unnamed client"}</option>
                  ))}
                </optgroup>
              )}
              {invites.length > 0 && (
                <optgroup label="Pre-registered — no account yet">
                  {invites.map((i) => (
                    <option key={i.id} value={`invite:${i.id}`}>
                      {i.name ? `${i.name} · ${i.phone}` : i.phone}
                    </option>
                  ))}
                </optgroup>
              )}
            </Select>

            {isInvite && (
              <p className="text-sm text-fg-2">
                Booking this creates their account right away — when they sign in with
                this phone number, the session is already on their schedule.
              </p>
            )}

            {client && client.players.length > 1 && (
              <Select
                label="Player"
                value={priv.playerId}
                onChange={(e) => setPriv({ ...priv, playerId: e.target.value })}
              >
                <option value="">{client.players[0].name} (default)</option>
                {client.players.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </Select>
            )}

            <Select
              label="Coach"
              hint="Leave on automatic and the best-fitting coach is picked for you."
              value={priv.coachId}
              onChange={(e) => setPriv({ ...priv, coachId: e.target.value })}
            >
              <option value="">Automatic — pick the best fit</option>
              {coaches.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>

            <div className="grid grid-cols-2 gap-3">
              <Input
                label={priv.recurring ? "First session" : "Date"}
                type="date"
                value={priv.date}
                onChange={(e) => setPriv({ ...priv, date: e.target.value })}
              />
              <TimeSelect12h
                label="Time"
                value={priv.time}
                onChange={(time) => setPriv({ ...priv, time })}
              />
            </div>

            <Select
              label="Length"
              value={priv.duration}
              onChange={(e) => setPriv({ ...priv, duration: Number(e.target.value) })}
            >
              {[60, 90].map((d) => (
                <option key={d} value={d}>{d} min</option>
              ))}
            </Select>

            <fieldset className="space-y-2">
              <legend className="label">Repeat</legend>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[12px] border border-line bg-surface-2 px-4 py-3">
                <input
                  type="radio"
                  name="priv-repeat"
                  checked={!priv.recurring}
                  onChange={() => setPriv((p) => ({ ...p, recurring: false }))}
                  className="h-4 w-4 accent-[var(--ember,#c2410c)]"
                />
                <span className="text-sm">Just this once</span>
              </label>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[12px] border border-line bg-surface-2 px-4 py-3">
                <input
                  type="radio"
                  name="priv-repeat"
                  checked={priv.recurring}
                  onChange={() => setPriv((p) => ({ ...p, recurring: true }))}
                  className="h-4 w-4 accent-[var(--ember,#c2410c)]"
                />
                <span className="flex items-center gap-2 text-sm">
                  Every week for
                  <select
                    value={priv.recurWeeks}
                    onChange={(e) => setPriv((p) => ({ ...p, recurWeeks: Number(e.target.value) }))}
                    className="rounded-[6px] border border-line bg-surface-2 px-2 py-0.5 text-sm"
                    onClick={() => setPriv((p) => ({ ...p, recurring: true }))}
                  >
                    {[2, 3, 4, 5, 6, 7, 8, 10, 12].map((w) => (
                      <option key={w} value={w}>{w} weeks</option>
                    ))}
                  </select>
                </span>
              </label>
            </fieldset>

            <AddressForm
              value={address}
              onChange={setAddress}
              searchLabel="Where does the session happen?"
            />

            <div>
              <button
                type="button"
                onClick={() => setShowAdvanced((s) => !s)}
                className="text-sm text-fg-2 underline-offset-4 hover:underline"
              >
                {showAdvanced ? "▼" : "▶"} Advanced
              </button>
              {showAdvanced && (
                <div className="mt-3 rounded-[12px] border border-line bg-surface-2 p-4">
                  <label className="flex cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      checked={priv.overrideLimits}
                      onChange={(e) => setPriv({ ...priv, overrideLimits: e.target.checked })}
                      className="mt-0.5 h-4 w-4 accent-[var(--ember,#c2410c)]"
                    />
                    <span className="text-sm">
                      <span className="font-medium">Override plan restrictions</span>
                      <span className="mt-0.5 block text-fg-2">
                        Lets you book beyond this client&apos;s weekly session limit or maximum
                        session length.
                      </span>
                    </span>
                  </label>
                </div>
              )}
            </div>

            <p className="text-sm text-fg-2">
              This takes the session&apos;s minutes from the client&apos;s private balance —
              top it up from the Clients tab if needed.
            </p>
          </>
        )}

        <Button onClick={submit} disabled={pending || !canSubmit} className="w-full">
          {pending ? <Spinner /> : submitLabel}
        </Button>

        {message && <p className="text-sm text-err">{message}</p>}
      </div>
    </Sheet>
  );
}
