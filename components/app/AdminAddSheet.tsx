"use client";

// One sheet, two homes:
//  - "create" (Weekly classes tab): create a repeating group, school or
//    private class.
//  - "oneoff" (Schedule tab): put a brand-new one-off group/school class or a
//    one-off private session on the calendar — nothing here repeats.
//
// Both variants share the same forms; the only difference is what the schedule
// picker means — weekdays that repeat vs specific dates — and each picked
// day/date carries its own time.

import { useState, useTransition } from "react";
import { formatWallDay } from "@/lib/academy-time";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import { createGroupClass } from "@/app/admin/actions";
import {
  createOneOffClass,
  createPrivateSession,
  createPrivateSessionForInvite,
} from "@/app/admin/schedule/actions";
import {
  EMPTY_CLASS_FORM,
  ItemTimesList,
  generateClassTitle,
  time12h,
  type ClassFormState,
} from "./ClassFields";
import { TimeSelect12h } from "./TimeSelect12h";
import { ActionResult } from "./ActionResult";
import {
  WEEKDAYS,
  WEEKDAY_NAME,
  type ClientOption,
  type Coach,
  type InviteOption,
  type Venue,
} from "./admin-calendar-types";

type Mode = "weekly" | "school" | "private";
type Variant = "create" | "oneoff";

const MODE_SETS: Record<Variant, { value: Mode; label: string }[]> = {
  create: [
    { value: "weekly", label: "Group class" },
    { value: "school", label: "School class" },
    { value: "private", label: "Private class" },
  ],
  oneoff: [
    { value: "weekly", label: "Group class" },
    { value: "school", label: "School class" },
    { value: "private", label: "Private session" },
  ],
};

// School blocks run far longer than a normal group class.
const WEEKLY_DURATIONS = [60, 90, 120, 150, 180, 210, 240];
const SCHOOL_DURATIONS = [60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360];

const WEEKDAY_DOW: Record<string, number> = {
  SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6,
};

/** First calendar date on or after `startDate` that falls on `weekdayCode`. */
function firstOccurrenceOnOrAfter(startDate: string, weekdayCode: string): string {
  const [y, m, d] = startDate.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const daysUntil = (((WEEKDAY_DOW[weekdayCode] ?? 1) - date.getDay()) + 7) % 7;
  const result = new Date(date.getTime() + daysUntil * 86400000);
  return `${result.getFullYear()}-${String(result.getMonth() + 1).padStart(2, "0")}-${String(result.getDate()).padStart(2, "0")}`;
}

/** "2025-07-14" → "Mon 14 Jul" */

export function AdminAddSheet({
  variant = "create",
  onClose,
  onDone,
  coaches,
  venues,
  clients,
  invites,
}: {
  variant?: Variant;
  onClose: () => void;
  onDone: (message: string) => void;
  coaches: Coach[];
  venues: Venue[];
  clients: ClientOption[];
  invites: InviteOption[];
}) {
  const modes = MODE_SETS[variant];
  const [mode, setMode] = useState<Mode>(modes[0].value);

  // The most recently chosen time anywhere in the sheet — newly picked
  // days/dates start from it so a run of same-time picks needs no re-entry.
  const [lastTime, setLastTime] = useState("18:30");

  // ── Group / school class state ──────────────────────────────────────────────
  const [form, setForm] = useState<ClassFormState>(() => ({
    ...EMPTY_CLASS_FORM,
    venueId: venues[0]?.id ?? "",
  }));

  // "create": repeating weekdays, each with its own time.
  const [weekdays, setWeekdays] = useState<string[]>(["MO"]);
  const [dayTimes, setDayTimes] = useState<Record<string, string>>({ MO: "18:30" });

  function toggleDay(code: string) {
    setWeekdays((prev) =>
      prev.includes(code) ? prev.filter((d) => d !== code) : [...prev, code]
    );
    setDayTimes((t) => (t[code] ? t : { ...t, [code]: lastTime }));
  }

  function setDayTime(code: string, time: string) {
    setDayTimes((t) => ({ ...t, [code]: time }));
    setLastTime(time);
  }

  // "oneoff": specific dates, each with its own time.
  const [dates, setDates] = useState<string[]>([]);
  const [dateTimes, setDateTimes] = useState<Record<string, string>>({});
  const [dateKey, setDateKey] = useState(0);

  function addDate(d: string) {
    if (!d || dates.includes(d)) return;
    setDates((prev) => [...prev, d].sort());
    setDateTimes((t) => ({ ...t, [d]: lastTime }));
    setDateKey((k) => k + 1);
  }

  function removeDate(d: string) {
    setDates((prev) => prev.filter((x) => x !== d));
  }

  function setDateTime(d: string, time: string) {
    setDateTimes((t) => ({ ...t, [d]: time }));
    setLastTime(time);
  }

  // ── Private session state ───────────────────────────────────────────────────
  const [priv, setPriv] = useState({
    clientId: "",
    playerId: "",
    date: "",       // used when one-off
    startFrom: "",  // used when recurring — anchor for weekday calculation
    time: "17:00",
    duration: 60,
    coachId: "",
    venueId: venues[0]?.id ?? "",
    overrideLimits: false,
    // On the Weekly classes tab a private class repeats by default; the
    // Schedule tab only ever books one-offs.
    recurring: variant === "create",
    recurWeeks: 4,
  });
  const [privWeekdays, setPrivWeekdays] = useState<string[]>(["MO"]);
  const [privDayTimes, setPrivDayTimes] = useState<Record<string, string>>({ MO: "17:00" });
  const [showAdvanced, setShowAdvanced] = useState(false);

  function togglePrivDay(code: string) {
    setPrivWeekdays((prev) =>
      prev.includes(code) ? prev.filter((d) => d !== code) : [...prev, code]
    );
    setPrivDayTimes((t) => (t[code] ? t : { ...t, [code]: lastTime }));
  }

  function setPrivDayTime(code: string, time: string) {
    setPrivDayTimes((t) => ({ ...t, [code]: time }));
    setLastTime(time);
  }

  // ── Shared ──────────────────────────────────────────────────────────────────
  const [message, setMessage] = useState<string | null>(null);
  // Set on a successful add — shows the confirmation + "Add another like this"
  // so migrating a whole timetable is a handful of taps per class, not a full
  // form each time. Closing (Done) is what tells the parent to refresh.
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Keep the setup (venue, type, coach, length, spots) and clear only the
  // day/time (and client, for privates) so the next class is a few taps.
  function addAnother() {
    setSuccess(null);
    setMessage(null);
    if (mode === "weekly" || mode === "school") {
      setWeekdays([]);
      setDayTimes({});
      setDates([]);
      setDateTimes({});
      setDateKey((k) => k + 1);
    } else {
      setPriv((p) => ({ ...p, clientId: "", playerId: "", date: "", startFrom: "" }));
      setPrivWeekdays([]);
      setPrivDayTimes({});
    }
  }

  const isInvite = priv.clientId.startsWith("invite:");
  // "open" → hold a private slot with no client, to be assigned later.
  const isOpen = priv.clientId === "open";
  const client =
    isInvite || isOpen ? null : (clients.find((c) => c.id === priv.clientId) ?? null);

  function resetMode(next: Mode) {
    setMode(next);
    setMessage(null);
    if (next === "weekly") {
      setForm({ ...EMPTY_CLASS_FORM, venueId: venues[0]?.id ?? "" });
      setWeekdays(["MO"]);
      setDayTimes({ MO: lastTime });
      setDates([]);
      setDateTimes({});
      setDateKey((k) => k + 1);
    }
    if (next === "school") {
      // School blocks hold a whole class of pupils and run longer.
      setForm({ ...EMPTY_CLASS_FORM, venueId: venues[0]?.id ?? "", capacity: 30, durationMinutes: 120 });
      setWeekdays(["MO"]);
      setDayTimes({ MO: lastTime });
      setDates([]);
      setDateTimes({});
      setDateKey((k) => k + 1);
    }
    if (next === "private") {
      setPriv({
        clientId: "",
        playerId: "",
        date: "",
        startFrom: "",
        time: "17:00",
        duration: 60,
        coachId: "",
        venueId: venues[0]?.id ?? "",
        overrideLimits: false,
        recurring: variant === "create",
        recurWeeks: 4,
      });
      setPrivWeekdays(["MO"]);
      setPrivDayTimes({ MO: "17:00" });
      setShowAdvanced(false);
    }
  }

  const venueName = venues.find((v) => v.id === form.venueId)?.name;

  /** Title for a one-off class: date-led when it's a single date, venue-led
   * when it spans several. */
  function oneOffTitle(): string {
    if (dates.length === 1) {
      const t = time12h(dateTimes[dates[0]] ?? lastTime);
      return venueName ? `${formatWallDay(dates[0])} ${t} · ${venueName}` : `${formatWallDay(dates[0])} ${t}`;
    }
    return venueName ? `${venueName} · one-time` : "One-time class";
  }

  function submit() {
    setMessage(null);
    startTransition(async () => {
      if (mode === "weekly" || mode === "school") {
        const isSchool = mode === "school";
        if (variant === "oneoff") {
          const r = await createOneOffClass({
            title: oneOffTitle(),
            description: form.description,
            skillLevel: form.skillLevel,
            capacity: form.capacity,
            durationMinutes: form.durationMinutes,
            venueId: form.venueId,
            coachId: form.coachId || undefined,
            isSchool,
            occurrences: dates.map((d) => ({ date: d, time: dateTimes[d] ?? lastTime })),
          });
          if (!r.ok) {
            setMessage(r.error ?? "Couldn't add the class.");
            return;
          }
          setSuccess(
            dates.length > 1
              ? `One-time ${isSchool ? "school class" : "class"} added — ${dates.length} on the schedule.`
              : `One-time ${isSchool ? "school class" : "class"} added to the schedule.`
          );
        } else {
          for (const day of weekdays) {
            const time = dayTimes[day] ?? lastTime;
            const r = await createGroupClass({
              ...form,
              weekday: day,
              time,
              title: generateClassTitle(day, time, venueName),
              isSchool,
            });
            if (!r.ok) {
              setMessage(r.error ?? "Couldn't create the class.");
              return;
            }
          }
          const dayNames = weekdays.map((d) => WEEKDAY_NAME[d] ?? d).join(", ");
          const noun = isSchool ? "school class" : "class";
          setSuccess(
            weekdays.length > 1
              ? `${weekdays.length} ${noun}es published — ${dayNames}.`
              : `${isSchool ? "School class" : "Class"} published — the next 8 weeks of sessions are on the schedule.`
          );
        }
      } else {
        const venue = venues.find((v) => v.id === priv.venueId);
        if (!venue) {
          setMessage("Please select a venue.");
          return;
        }
        const locationDetails = {
          durationMinutes: priv.duration,
          address: venue.address,
          postcode: venue.postcode,
          lat: venue.lat,
          lng: venue.lng,
          addressDetails: venue.address_details
            ? { ...venue.address_details, name: venue.name }
            : { name: venue.name },
          coachId: priv.coachId || undefined,
          overridePlanLimits: priv.overrideLimits,
        };

        if (isOpen) {
          // Open slot: a single held session with no client, no minutes debit.
          const r = await createPrivateSession({
            ...locationDetails,
            time: priv.time,
            date: priv.date,
            recurWeeks: 1,
          });
          if (r.ok) {
            setSuccess("Open private slot added — assign a client to it any time.");
          } else setMessage(r.error ?? "Couldn't add the slot.");
        } else if (priv.recurring) {
          // Recurring: one series per selected weekday at that day's own time,
          // starting from the first occurrence of that weekday on or after
          // startFrom.
          for (const day of privWeekdays) {
            const date = firstOccurrenceOnOrAfter(priv.startFrom, day);
            const baseDetails = {
              ...locationDetails,
              time: privDayTimes[day] ?? priv.time,
              recurWeeks: priv.recurWeeks,
            };
            const r = isInvite
              ? await createPrivateSessionForInvite(priv.clientId.slice("invite:".length), {
                  ...baseDetails,
                  date,
                })
              : await createPrivateSession({
                  ...baseDetails,
                  date,
                  clientId: priv.clientId,
                  playerId: priv.playerId || undefined,
                });
            if (!r.ok) {
              setMessage(r.error ?? "Couldn't book the session.");
              return;
            }
          }
          const totalSessions = privWeekdays.length * priv.recurWeeks;
          const dayNames = privWeekdays.map((d) => WEEKDAY_NAME[d] ?? d).join(", ");
          setSuccess(
            isInvite
              ? `Account created and ${totalSessions} private sessions booked (${dayNames}) — waiting when they sign in.`
              : `${totalSessions} private sessions booked (${dayNames}) — the client has been told.`
          );
        } else {
          // One-off
          const details = { ...locationDetails, time: priv.time, date: priv.date, recurWeeks: 1 };
          const r = isInvite
            ? await createPrivateSessionForInvite(priv.clientId.slice("invite:".length), details)
            : await createPrivateSession({
                ...details,
                clientId: priv.clientId,
                playerId: priv.playerId || undefined,
              });
          if (r.ok) {
            setSuccess(
              isInvite
                ? "Account created and private session booked — it'll be waiting when they sign in."
                : "Private session booked — the client has been told."
            );
          } else setMessage(r.error ?? "Couldn't book the session.");
        }
      }
    });
  }

  const canSubmit =
    mode === "weekly" || mode === "school"
      ? variant === "oneoff"
        ? !!form.venueId && dates.length > 0
        : !!form.venueId && weekdays.length > 0
      : !!priv.clientId && !!priv.time && !!priv.venueId &&
        (isOpen
          ? !!priv.date
          : priv.recurring
            ? privWeekdays.length > 0 && !!priv.startFrom
            : !!priv.date);

  const totalPrivSessions = privWeekdays.length * priv.recurWeeks;
  const submitLabel =
    mode === "weekly" || mode === "school"
      ? variant === "oneoff"
        ? dates.length > 1
          ? `Add ${dates.length} sessions`
          : "Add to the schedule"
        : weekdays.length > 1
          ? `Publish ${weekdays.length} classes`
          : mode === "school"
            ? "Publish school class"
            : "Publish class"
      : isOpen
        ? "Add open slot"
        : priv.recurring
          ? privWeekdays.length > 1
            ? `Book ${totalPrivSessions} sessions`
            : `Book ${priv.recurWeeks} weekly sessions`
          : "Book private session";

  return (
    <Sheet
      open
      onClose={onClose}
      title={variant === "oneoff" ? "Add a one-time class" : "Create a class"}
    >
      {success ? (
        <div className="space-y-5">
          <ActionResult>{success}</ActionResult>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="ghost" onClick={addAnother}>
              Add another like this
            </Button>
            <Button onClick={() => onDone(success)}>Done</Button>
          </div>
          <p className="text-sm text-fg-2">
            &ldquo;Add another&rdquo; keeps the venue, type and length — just pick the next
            day and time.
          </p>
        </div>
      ) : (
      <div className="space-y-5">
        {/* Mode tabs */}
        <div className="grid grid-cols-3 gap-2">
          {modes.map((m) => (
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

        {/* ── Group / school class ──────────────────────────────────────────── */}
        {(mode === "weekly" || mode === "school") && (
          <>
            {mode === "school" && (
              <p className="rounded-[12px] border border-line bg-surface-2 px-4 py-3 text-sm text-fg-2">
                A school class is held at a school or university and isn&apos;t bookable online.
                Pick the school as the venue — coaches add the pupils who turn up, right from
                the session.
              </p>
            )}
            {variant === "oneoff" && (
              <p className="rounded-[12px] border border-line bg-surface-2 px-4 py-3 text-sm text-fg-2">
                A one-time class appears on the schedule only on the dates you pick — it never
                repeats. Repeating classes live in the Weekly classes tab.
              </p>
            )}
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
                {(mode === "school" ? SCHOOL_DURATIONS : WEEKLY_DURATIONS).map((d) => (
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
            </div>

            <Input
              label="Description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              hint="Optional — shown to clients when they book."
            />

            {variant === "create" ? (
              <div>
                <p className="label mb-2">Days</p>
                <p className="mb-2 text-sm text-fg-2">
                  Pick one or more — a separate class is created for each, at its own time.
                </p>
                <div className="mb-3 flex flex-wrap gap-2">
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
                <ItemTimesList
                  items={WEEKDAYS.map(([code]) => code).filter((c) => weekdays.includes(c))}
                  labelOf={(c) => WEEKDAY_NAME[c] ?? c}
                  times={dayTimes}
                  onSetTime={setDayTime}
                />
              </div>
            ) : (
              <div>
                <p className="label mb-2">Dates</p>
                <p className="mb-2 text-sm text-fg-2">
                  Add one or more — a session is created for each, at its own time.
                </p>
                <ItemTimesList
                  items={dates}
                  labelOf={formatWallDay}
                  times={dateTimes}
                  onSetTime={setDateTime}
                  onRemove={removeDate}
                />
                <input
                  key={dateKey}
                  type="date"
                  onChange={(e) => addDate(e.target.value)}
                  className="mt-2 rounded-[8px] border border-line bg-surface-2 px-3 py-2 text-sm focus:border-ember focus:outline-none"
                  aria-label="Add a date"
                />
              </div>
            )}

            {variant === "create" && weekdays.length > 0 && form.venueId && (
              <p className="rounded-[12px] border border-line bg-surface-2 px-4 py-3 text-sm text-fg-2">
                {weekdays.length === 1
                  ? `Will create: ${generateClassTitle(weekdays[0], dayTimes[weekdays[0]] ?? lastTime, venueName)}`
                  : `Will create ${weekdays.length} classes — ${weekdays
                      .map((d) => generateClassTitle(d, dayTimes[d] ?? lastTime, venueName))
                      .join(", ")}`}
              </p>
            )}
          </>
        )}

        {/* ── Private session ───────────────────────────────────────────────── */}
        {mode === "private" && (
          <>
            <Select
              label="Client"
              value={priv.clientId}
              onChange={(e) => {
                const v = e.target.value;
                // Open slots are single held sessions — never recurring.
                setPriv({ ...priv, clientId: v, playerId: "", recurring: v === "open" ? false : priv.recurring });
              }}
            >
              <option value="">— pick a client —</option>
              <option value="open">No client — open slot (assign later)</option>
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

            {isOpen && (
              <p className="text-sm text-fg-2">
                Holds an empty private slot — pick a coach, venue and time now, then assign
                a client from the session later. No minutes are charged until you do.
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

            {/* One-off sessions from the Schedule tab never repeat — the
                repeating kind lives in the Weekly classes tab. */}
            {!isOpen && variant === "create" && (
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
            )}

            {/* One-off: single date picker */}
            {!priv.recurring && (
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Date"
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
            )}

            {/* Recurring: day multiselect with per-day times + start-from anchor */}
            {priv.recurring && (
              <>
                <div>
                  <p className="label mb-2">Days</p>
                  <p className="mb-2 text-sm text-fg-2">
                    Pick one or more — a recurring series is created for each day, at its own time.
                  </p>
                  <div className="mb-3 flex flex-wrap gap-2">
                    {WEEKDAYS.map(([code, name]) => (
                      <button
                        key={code}
                        type="button"
                        onClick={() => togglePrivDay(code)}
                        aria-pressed={privWeekdays.includes(code)}
                        className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
                          privWeekdays.includes(code)
                            ? "border-ember bg-ember text-ivory"
                            : "border-line hover:border-ember"
                        }`}
                      >
                        {name.slice(0, 3)}
                      </button>
                    ))}
                  </div>
                  <ItemTimesList
                    items={WEEKDAYS.map(([code]) => code).filter((c) => privWeekdays.includes(c))}
                    labelOf={(c) => WEEKDAY_NAME[c] ?? c}
                    times={privDayTimes}
                    onSetTime={setPrivDayTime}
                  />
                </div>
                <Input
                  label="Start from"
                  type="date"
                  value={priv.startFrom}
                  onChange={(e) => setPriv({ ...priv, startFrom: e.target.value })}
                />
              </>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Select
                label="Venue"
                value={priv.venueId}
                onChange={(e) => setPriv({ ...priv, venueId: e.target.value })}
              >
                {venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.active ? v.name : `${v.name} (hidden)`}
                  </option>
                ))}
              </Select>
              <Select
                label="Length"
                value={priv.duration}
                onChange={(e) => setPriv({ ...priv, duration: Number(e.target.value) })}
              >
                {[60, 90].map((d) => (
                  <option key={d} value={d}>{d} min</option>
                ))}
              </Select>
            </div>

            {!isOpen && (
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
            )}

            {!isOpen && (
              <p className="text-sm text-fg-2">
                This takes the session&apos;s minutes from the client&apos;s private balance —
                top it up from the Clients tab if needed.
              </p>
            )}
          </>
        )}

        <Button onClick={submit} disabled={pending || !canSubmit} className="w-full">
          {pending ? <Spinner /> : submitLabel}
        </Button>

        {message && <p className="text-sm text-err">{message}</p>}
      </div>
      )}
    </Sheet>
  );
}
