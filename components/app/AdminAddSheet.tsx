"use client";

// One sheet. One ＋.
//
// Whether a class repeats used to be decided by WHICH TAB you tapped ＋ on —
// the schedule's button could only make one-offs, the weekly list's could only
// make repeats, and if you were on the wrong one you had to back out and switch
// tabs. That is a mode you cannot see, and it doubled the sheet: two variants ×
// three types was six forms in one file.
//
// Repeat is a field now, the way it is in every calendar app: pick the kind of
// class, then say whether it happens once or every week. The tab you came from
// only chooses which one starts selected. Six forms collapse to two, because a
// school class is a group class with a longer default and a flag — only a
// private is genuinely a different shape (it needs a family, and it spends
// their minutes).
//
// The two halves ask the same questions in the same shapes now. They did not:
// a group class picked its dates with tappable chips and a private got a bare
// native date wheel that took one date and no more; the group weekday chips
// were 34px with no press feedback while the private ones beside them were
// 44px with it; Location/Length/Spots were hand-rolled here and imported from
// ClassFields everywhere else, so the same three fields had two option sets and
// two labels. There is one of each now.

import { useEffect, useState, useTransition } from "react";
import {
  academyToday,
  formatClock,
  formatDay,
  formatWallDay,
  shiftWallDate,
} from "@/lib/academy-time";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { createGroupClass } from "@/app/admin/actions";
import {
  createOneOffClass,
  createPrivateSession,
  createPrivateSessionForInvite,
  previewSlotClashes,
  type SlotPreview,
} from "@/app/admin/schedule/actions";
import {
  ClassDetailFields,
  EMPTY_CLASS_FORM,
  ItemTimesList,
  durationOptions,
  generateClassTitle,
  time12h,
  type ClassFormState,
} from "./ClassFields";
import { DayChips } from "./DayChips";
import { ActionResult } from "./ActionResult";
import {
  WEEKDAY_NAME,
  playerChoiceValue,
  playerChoices,
  splitPlayerChoice,
  type ClientOption,
  type Coach,
  type InviteOption,
  type Venue,
} from "./admin-calendar-types";
import { venueDisplayName } from "@/lib/venue-display";

type Mode = "weekly" | "school" | "private";
/** Does it happen once, or every week? The one question the tabs used to
 *  answer behind his back. */
export type RepeatChoice = "once" | "weekly";

// The three kinds of class, named the same whichever way they repeat. They used
// to be "Private class" when repeating and "Private session" when not, which is
// two names for one thing on a screen whose whole job is telling three things
// apart.
const MODES: { value: Mode; label: string }[] = [
  { value: "weekly", label: "Group" },
  { value: "school", label: "School" },
  { value: "private", label: "Private" },
];

// The dates a one-time class is nearly always for. Two named days and then
// whatever the week is calling the day after — beyond that he wants a calendar,
// and the ＋ beside them is it.
const QUICK_DAYS: { offset: number; label?: string }[] = [
  { offset: 0, label: "Today" },
  { offset: 1, label: "Tomorrow" },
  { offset: 2 },
];

const WEEKDAY_DOW: Record<string, number> = {
  SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6,
};

/** MO..SU, so a picked set renders in the order a week is read rather than the
 *  order he happened to tap. */
const WEEKDAYS_IN_ORDER = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

/** First calendar date on or after `startDate` that falls on `weekdayCode`. */
function firstOccurrenceOnOrAfter(startDate: string, weekdayCode: string): string {
  const [y, m, d] = startDate.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const daysUntil = (((WEEKDAY_DOW[weekdayCode] ?? 1) - date.getDay()) + 7) % 7;
  const result = new Date(date.getTime() + daysUntil * 86400000);
  return `${result.getFullYear()}-${String(result.getMonth() + 1).padStart(2, "0")}-${String(result.getDate()).padStart(2, "0")}`;
}

/** The date chips + ＋, shared by the group and private one-off paths so
 *  "today" is one tap in both. Multi-select in both: a founder putting on two
 *  make-up sessions after a washout is doing one job, and the private half used
 *  to make him do it twice because the underlying call takes a single date —
 *  which is a fact about the call, not about the job. It is looped, exactly as
 *  the recurring private path already loops over weekdays. */
function DateChips({
  today,
  dates,
  onAdd,
  onRemove,
  dateKey,
}: {
  today: string;
  dates: string[];
  onAdd: (d: string) => void;
  onRemove: (d: string) => void;
  /** Bumped to reset the native picker so the same date can be re-added. */
  dateKey: number;
}) {
  return (
    <div className="mb-3 flex flex-wrap gap-2">
      {QUICK_DAYS.map(({ offset, label }) => {
        const d = shiftWallDate(today, offset);
        const on = dates.includes(d);
        return (
          <button
            key={d}
            type="button"
            onClick={() => (on ? onRemove(d) : onAdd(d))}
            aria-pressed={on}
            className={`pressable min-h-11 rounded-full border px-4 text-sm font-medium transition-colors ${
              on ? "border-ember bg-ember text-ivory" : "border-line hover:border-ember"
            }`}
          >
            {label ?? formatWallDay(d)}
          </button>
        );
      })}
      <label className="pressable flex min-h-11 cursor-pointer items-center rounded-full border border-line px-4 text-sm font-medium hover:border-ember">
        ＋
        <input
          key={dateKey}
          type="date"
          onChange={(e) => onAdd(e.target.value)}
          className="sr-only"
          aria-label="Add another date"
        />
      </label>
    </div>
  );
}

export function AdminAddSheet({
  defaultRepeat = "once",
  seed,
  onClose,
  onDone,
  coaches,
  venues,
  clients,
  invites,
}: {
  /** Which way the Repeat field starts. This is all the calling view decides —
   *  he can change it here, which is exactly what he could not do before. */
  defaultRepeat?: RepeatChoice;
  /** Prefill from an existing class ("Duplicate"). Everything but the day and
   *  time carries over, because the thing being duplicated is the setup — the
   *  slot is the one part he is about to change. */
  seed?: {
    mode?: Mode;
    venueId?: string | null;
    coachId?: string | null;
    capacity?: number;
    durationMinutes?: number;
  };
  onClose: () => void;
  onDone: (message: string) => void;
  coaches: Coach[];
  venues: Venue[];
  clients: ClientOption[];
  invites: InviteOption[];
}) {
  const [mode, setMode] = useState<Mode>(seed?.mode ?? "weekly");
  const [repeat, setRepeat] = useState<RepeatChoice>(defaultRepeat);
  const today = academyToday();

  // Has he put anything of his own into this form? Drives the discard guard on
  // the way out — the sheet opens pre-filled with sensible defaults, so "is
  // anything set" would be true from the first paint and would nag on every
  // close.
  const [touched, setTouched] = useState(false);
  const mark = () => setTouched(true);

  // The most recently chosen time anywhere in the sheet — newly picked
  // days/dates start from it so a run of same-time picks needs no re-entry.
  const [lastTime, setLastTime] = useState("18:30");

  // ── Group / school class state ──────────────────────────────────────────────
  const [form, setForm] = useState<ClassFormState>(() => ({
    ...EMPTY_CLASS_FORM,
    venueId: seed?.venueId ?? venues[0]?.id ?? "",
    coachId: seed?.coachId ?? "",
    ...(seed?.capacity ? { capacity: seed.capacity } : {}),
    ...(seed?.durationMinutes ? { durationMinutes: seed.durationMinutes } : {}),
  }));

  // "Every week": repeating weekdays, each with its own time.
  const [weekdays, setWeekdays] = useState<string[]>(["MO"]);
  const [dayTimes, setDayTimes] = useState<Record<string, string>>({ MO: "18:30" });

  function toggleDay(code: string) {
    mark();
    setWeekdays((prev) =>
      prev.includes(code) ? prev.filter((d) => d !== code) : [...prev, code]
    );
    setDayTimes((t) => (t[code] ? t : { ...t, [code]: lastTime }));
  }

  function setDayTime(code: string, time: string) {
    mark();
    setDayTimes((t) => ({ ...t, [code]: time }));
    setLastTime(time);
  }

  // "Just once": specific dates, each with its own time.
  //
  // Today is already picked. A one-time class is nearly always something he is
  // putting on today or tomorrow — a make-up session, a hall that came free —
  // and this used to open with nothing selected and no way forward but the
  // phone's native date wheel.
  const [dates, setDates] = useState<string[]>([today]);
  const [dateTimes, setDateTimes] = useState<Record<string, string>>({ [today]: "18:30" });
  const [dateKey, setDateKey] = useState(0);

  function addDate(d: string) {
    if (!d || dates.includes(d)) return;
    mark();
    setDates((prev) => [...prev, d].sort());
    setDateTimes((t) => ({ ...t, [d]: lastTime }));
    setDateKey((k) => k + 1);
  }

  function removeDate(d: string) {
    mark();
    setDates((prev) => prev.filter((x) => x !== d));
  }

  function setDateTime(d: string, time: string) {
    mark();
    setDateTimes((t) => ({ ...t, [d]: time }));
    setLastTime(time);
  }

  // ── Private session state ───────────────────────────────────────────────────
  const [priv, setPriv] = useState({
    clientId: "",
    playerId: "",
    startFrom: today, // used when it repeats — anchor for the weekday maths
    duration: seed?.durationMinutes ?? 60,
    coachId: seed?.coachId ?? "",
    venueId: seed?.venueId ?? venues[0]?.id ?? "",
    recurWeeks: 4,
  });
  function updatePriv(next: Partial<typeof priv>) {
    mark();
    setPriv((p) => ({ ...p, ...next }));
  }

  // Just once: the same multi-select dates a one-time group class gets.
  const [privDates, setPrivDates] = useState<string[]>([today]);
  const [privDateTimes, setPrivDateTimes] = useState<Record<string, string>>({
    [today]: "17:00",
  });
  const [privDateKey, setPrivDateKey] = useState(0);

  function addPrivDate(d: string) {
    if (!d || privDates.includes(d)) return;
    mark();
    setPrivDates((prev) => [...prev, d].sort());
    setPrivDateTimes((t) => ({ ...t, [d]: lastTime }));
    setPrivDateKey((k) => k + 1);
  }

  function removePrivDate(d: string) {
    mark();
    setPrivDates((prev) => prev.filter((x) => x !== d));
  }

  function setPrivDateTime(d: string, time: string) {
    mark();
    setPrivDateTimes((t) => ({ ...t, [d]: time }));
    setLastTime(time);
  }

  const [privWeekdays, setPrivWeekdays] = useState<string[]>(["MO"]);
  const [privDayTimes, setPrivDayTimes] = useState<Record<string, string>>({ MO: "17:00" });

  function togglePrivDay(code: string) {
    mark();
    setPrivWeekdays((prev) =>
      prev.includes(code) ? prev.filter((d) => d !== code) : [...prev, code]
    );
    setPrivDayTimes((t) => (t[code] ? t : { ...t, [code]: lastTime }));
  }

  function setPrivDayTime(code: string, time: string) {
    mark();
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
    setTouched(false);
    if (mode === "weekly" || mode === "school") {
      setWeekdays([]);
      setDayTimes({});
      setDates([today]);
      setDateTimes({ [today]: lastTime });
      setDateKey((k) => k + 1);
    } else {
      setPriv((p) => ({ ...p, clientId: "", playerId: "", startFrom: today }));
      setPrivWeekdays([]);
      setPrivDayTimes({});
      setPrivDates([today]);
      setPrivDateTimes({ [today]: lastTime });
      setPrivDateKey((k) => k + 1);
    }
  }

  const isInvite = priv.clientId.startsWith("invite:");
  // "open" → hold a private slot with no client, to be assigned later.
  const isOpen = priv.clientId === "open";

  // Derived from the one Repeat field rather than kept as a second flag.
  //
  // An open slot used to be forced to a single hour here — `repeats && !isOpen`
  // — on the reasoning that a standing weekly slot is a private_booking_series
  // row and that table's client_id is NOT NULL. But the series is only the
  // rolling template; the occurrences themselves never needed a client, so an
  // open run holds its N weeks the same way a client's booking does and simply
  // goes without the template. `createPrivateSessionCore` has said so for a
  // while (`recurring = weeks > 1 && !isOpen`) and tests/db/open-private-slot
  // pins it. The exception here outlived the reason for it, and cost more than
  // the repeat it refused: picking "open slot" while Repeats was on "Every
  // week" tore the days, the start date and the length of the run off the form
  // in one go — and hid the Repeats control on the way, so there was no way to
  // see what had happened or to put it back.
  const repeats = repeat === "weekly";
  const privRecurring = repeats;

  // ── What's already in the slot he's picking ────────────────────────────────
  //
  // Asked while he picks, not after he taps Publish. The old flow gave him a
  // sentence about a coach clash only once the class had failed to appear —
  // and by then the class row existed with nothing on it. This is the same
  // question the database is about to ask, put to it early.
  //
  // It is never a gate. For a repeating class a busy coach cannot refuse
  // anything any more; for a one-off it still can, so that row alone gets a
  // one-tap way out.
  const isClassMode = mode === "weekly" || mode === "school";
  const previewKeys = isClassMode
    ? repeats
      ? weekdays
      : dates
    : privRecurring
      ? privWeekdays
      : privDates;
  const previewTimes = isClassMode
    ? repeats
      ? dayTimes
      : dateTimes
    : privRecurring
      ? privDayTimes
      : privDateTimes;
  const previewVenueId = isClassMode ? form.venueId : priv.venueId;
  const previewCoachId = isClassMode ? form.coachId : priv.coachId;
  const previewDuration = isClassMode ? form.durationMinutes : priv.duration;
  const previewMode: "recurring" | "dates" =
    isClassMode ? (repeats ? "recurring" : "dates") : privRecurring ? "recurring" : "dates";

  // Serialised so the lookup re-runs on a real change of the question, not on
  // every keystroke elsewhere in the form.
  const previewSignature = JSON.stringify([
    previewMode,
    previewKeys,
    previewKeys.map((k) => previewTimes[k] ?? null),
    previewVenueId,
    previewCoachId,
    previewDuration,
  ]);
  const previewReady =
    !!previewVenueId && previewKeys.length > 0 && previewKeys.every((k) => previewTimes[k]);

  // The answer is STAMPED with the question it answers. That is what makes
  // "have we got an answer yet" a derived fact rather than a second piece of
  // state to keep in step — change the day and the old answer stops matching,
  // so it stops being shown, with nothing to clear and no window in which the
  // row says something confident about a slot he has already moved off.
  const [answered, setAnswered] = useState<{ sig: string; data: SlotPreview } | null>(null);
  const preview = answered?.sig === previewSignature ? answered.data : null;
  const checking = previewReady && !preview;

  useEffect(() => {
    if (!previewReady) return;
    let alive = true;
    // Debounced: the day chips and the time wheel both fire fast, and a lookup
    // per tap would have the line flickering under his thumb.
    const t = setTimeout(async () => {
      let data: SlotPreview;
      try {
        data = await previewSlotClashes({
          mode: previewMode,
          keys: previewKeys,
          timesByKey: Object.fromEntries(previewKeys.map((k) => [k, previewTimes[k]])),
          durationMinutes: previewDuration,
          venueId: previewVenueId,
          coachId: previewCoachId || undefined,
        });
      } catch {
        data = { byKey: {}, failed: true };
      }
      if (alive) setAnswered({ sig: previewSignature, data });
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // Every value read inside is covered by previewSignature, which is what the
    // effect is really keyed on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewSignature, previewReady]);

  /** Up to three dates, then "and N more" — a founder scanning a row wants to
   *  know which weeks, not to read a register. */
  function namedDates(isos: string[]): string {
    const shown = isos.slice(0, 3).map((d) => formatDay(d));
    return isos.length > 3
      ? `${shown.join(", ")} and ${isos.length - 3} more`
      : shown.join(", ");
  }

  /** The line under one day/date row. Coach first — it is the only part with a
   *  consequence — then the hall, which is information and nothing more. */
  function slotNote(key: string): React.ReactNode {
    if (checking) return "Checking what's already on…";
    if (!preview) return null;
    if (preview.failed)
      return "Couldn't check what's already on. Publishing still works.";
    const row = preview.byKey[key];
    if (!row) return null;

    const coachName = coaches.find((c) => c.id === previewCoachId)?.name;
    const lines: string[] = [];

    if (row.coachBusy.length > 0 && coachName) {
      const busyDates = namedDates(row.coachBusy.map((b) => b.startsAt));
      lines.push(
        previewMode === "recurring"
          ? `${coachName} is already teaching on ${row.coachBusy.length} of these ${row.occurrences.length} — ${busyDates}. Those weeks still go on; they arrive with no coach and one is picked automatically.`
          : `${coachName} is already teaching then (${busyDates}). Nothing is created while he's on it — pick another coach, or leave it on automatic.`
      );
    }
    if (row.venueBusy.length > 0) {
      const first = row.venueBusy[0];
      const more = row.venueBusy.length - 1;
      lines.push(
        `Also in this hall then: ${first.title}, ${formatClock(first.startsAt)}–${formatClock(first.endsAt)}${
          more > 0 ? ` and ${more} more` : ""
        }. Two classes in one hall is fine — just check a table is free.`
      );
    }
    if (lines.length === 0)
      return coachName
        ? `Nothing else here then, and ${coachName} is free.`
        : "Nothing else here then.";
    return lines.map((l, i) => <p key={i} className={i > 0 ? "mt-1" : ""}>{l}</p>);
  }

  /** Only a one-off or a private can still be REFUSED for a coach clash — the
   *  recurring path routes round it. That is the one case worth a button. */
  const hardCoachClash =
    previewMode === "dates" &&
    !!previewCoachId &&
    !!preview &&
    previewKeys.some((k) => (preview.byKey[k]?.coachBusy.length ?? 0) > 0);

  function resetMode(next: Mode) {
    setMode(next);
    setMessage(null);
    mark();
    if (next === "weekly" || next === "school") {
      const school = next === "school";
      // A school block holds a whole class of pupils and runs longer.
      setForm({
        ...EMPTY_CLASS_FORM,
        venueId: venues[0]?.id ?? "",
        ...(school ? { capacity: 30, durationMinutes: 120 } : {}),
      });
      setWeekdays(["MO"]);
      setDayTimes({ MO: lastTime });
      setDates([today]);
      setDateTimes({ [today]: lastTime });
      setDateKey((k) => k + 1);
    }
    if (next === "private") {
      setPriv({
        clientId: "",
        playerId: "",
        startFrom: today,
        duration: 60,
        coachId: "",
        venueId: venues[0]?.id ?? "",
        recurWeeks: 4,
      });
      setPrivWeekdays(["MO"]);
      setPrivDayTimes({ MO: "17:00" });
      setPrivDates([today]);
      setPrivDateTimes({ [today]: "17:00" });
      setPrivDateKey((k) => k + 1);
    }
  }

  const venueName = venues.find((v) => v.id === form.venueId)?.name;
  const totalPrivSessions = privWeekdays.length * priv.recurWeeks;

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
        if (!repeats) {
          const r = await createOneOffClass({
            title: oneOffTitle(),
            description: "",
            skillLevel: "any",
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
          // Publishing several weekdays is several classes, one call each. A
          // failure part-way used to `return` with only that day's error, so
          // the days already published went unmentioned and the founder had no
          // way to know whether to try the whole thing again. Now every day is
          // attempted and the outcome is reported as a whole.
          const done: string[] = [];
          const failed: { day: string; error: string }[] = [];
          let coachless = 0;
          for (const day of weekdays) {
            const time = dayTimes[day] ?? lastTime;
            const dayName = WEEKDAY_NAME[day] ?? day;
            const r = await createGroupClass({
              ...form,
              weekday: day,
              time,
              title: generateClassTitle(day, time, venueName),
              isSchool,
            });
            if (r.ok) {
              done.push(dayName);
              coachless += r.coachless ?? 0;
            } else {
              failed.push({ day: dayName, error: r.error ?? "Couldn't create the class." });
            }
          }

          const noun = isSchool ? "school class" : "class";
          // Weeks the chosen coach was already busy on still exist — they just
          // went out for the engine to fill. Saying so is the difference between
          // a class the founder can trust and one he finds holes in later.
          const coachLine =
            coachless > 0
              ? ` ${coachless} ${coachless === 1 ? "week" : "weeks"} clashed with that coach's diary and went out for a coach to be picked automatically — This week shows any that still need one.`
              : "";

          if (failed.length === 0) {
            setSuccess(
              (done.length > 1
                ? `${done.length} ${noun}es published — ${done.join(", ")}.`
                : `${isSchool ? "School class" : "Class"} published — the next 8 weeks of sessions are on the schedule.`) +
                coachLine
            );
          } else if (done.length === 0) {
            setMessage(failed[0].error);
          } else {
            // Part published. Name both halves: what exists now, and what to
            // try again — leaving either out is how the same class gets made
            // twice.
            setSuccess(
              `${done.join(", ")} published${coachLine ? "." + coachLine : "."} ${failed
                .map((f) => f.day)
                .join(", ")} didn't go through — ${failed[0].error}`
            );
          }
        }
      } else {
        const venue = venues.find((v) => v.id === priv.venueId);
        if (!venue) {
          setMessage("Pick a location first.");
          return;
        }
        const locationDetails = {
          durationMinutes: priv.duration,
          address: venue.address,
          postcode: venue.postcode,
          lat: venue.lat,
          lng: venue.lng,
          addressDetails: venue.address_details ?? null,
          // The id, not a copy of the venue's address. Copying it is what used
          // to force every read-time surface to parse a display name back out
          // of a geocoded string.
          venueId: venue.id,
          coachId: priv.coachId || undefined,
        };

        if (isOpen) {
          // Open slots take the same days/repeat as a client booking — the one
          // difference is downstream: with no client there's no series to key a
          // standing slot to, so a repeat holds exactly N weeks of empty
          // sessions. No booking and no minutes debit until one is assigned.
          if (privRecurring) {
            for (const day of privWeekdays) {
              const r = await createPrivateSession({
                ...locationDetails,
                time: privDayTimes[day] ?? "17:00",
                date: firstOccurrenceOnOrAfter(priv.startFrom, day),
                recurWeeks: priv.recurWeeks,
              });
              if (!r.ok) {
                setMessage(r.error ?? "Couldn't add the slot.");
                return;
              }
            }
            const dayNames = privWeekdays.map((d) => WEEKDAY_NAME[d] ?? d).join(", ");
            setSuccess(
              `${totalPrivSessions} open private slots held (${dayNames}) — assign a client to any of them later.`
            );
          } else {
            for (const date of privDates) {
              const r = await createPrivateSession({
                ...locationDetails,
                time: privDateTimes[date] ?? "17:00",
                date,
                recurWeeks: 1,
              });
              if (!r.ok) {
                setMessage(r.error ?? "Couldn't add the slot.");
                return;
              }
            }
            setSuccess(
              privDates.length > 1
                ? `${privDates.length} open private slots added — assign a client to any of them any time.`
                : "Open private slot added — assign a client to it any time."
            );
          }
        } else if (privRecurring) {
          // Recurring: one series per selected weekday at that day's own time,
          // starting from the first occurrence of that weekday on or after
          // startFrom.
          for (const day of privWeekdays) {
            const date = firstOccurrenceOnOrAfter(priv.startFrom, day);
            const baseDetails = {
              ...locationDetails,
              time: privDayTimes[day] ?? "17:00",
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
          const dayNames = privWeekdays.map((d) => WEEKDAY_NAME[d] ?? d).join(", ");
          setSuccess(
            isInvite
              ? `Account created and ${totalPrivSessions} private sessions booked (${dayNames}) — waiting when they sign in.`
              : `${totalPrivSessions} private sessions booked (${dayNames}) — the client has been told.`
          );
        } else {
          // One or more specific dates, one call each — the same loop the
          // recurring path runs over weekdays.
          const booked: string[] = [];
          for (const date of privDates) {
            const details = {
              ...locationDetails,
              time: privDateTimes[date] ?? "17:00",
              date,
              recurWeeks: 1,
            };
            const r = isInvite
              ? await createPrivateSessionForInvite(priv.clientId.slice("invite:".length), details)
              : await createPrivateSession({
                  ...details,
                  clientId: priv.clientId,
                  playerId: priv.playerId || undefined,
                });
            if (!r.ok) {
              // Say what already went through before naming what didn't — the
              // sessions that exist are real and he must not book them twice.
              setMessage(
                booked.length
                  ? `${booked.length} booked (${namedDates(booked)}), then ${formatWallDay(date)} failed — ${r.error ?? "couldn't book it."}`
                  : (r.error ?? "Couldn't book the session.")
              );
              return;
            }
            booked.push(date);
          }
          setSuccess(
            isInvite
              ? `Account created and ${booked.length > 1 ? `${booked.length} private sessions` : "a private session"} booked — waiting when they sign in.`
              : booked.length > 1
                ? `${booked.length} private sessions booked (${namedDates(booked)}) — the client has been told.`
                : "Private session booked — the client has been told."
          );
        }
      }
    });
  }

  const canSubmit =
    mode === "weekly" || mode === "school"
      ? !repeats
        ? !!form.venueId && dates.length > 0
        : !!form.venueId && weekdays.length > 0
      : !!priv.clientId && !!priv.venueId &&
        (privRecurring
          ? privWeekdays.length > 0 && !!priv.startFrom
          : privDates.length > 0);

  const submitLabel =
    mode === "weekly" || mode === "school"
      ? !repeats
        ? dates.length > 1
          ? `Add ${dates.length} sessions`
          : "Add to the schedule"
        : weekdays.length > 1
          ? `Publish ${weekdays.length} classes`
          : mode === "school"
            ? "Publish school class"
            : "Publish class"
      : isOpen
        ? privRecurring
          ? `Hold ${totalPrivSessions} open slots`
          : privDates.length > 1
            ? `Hold ${privDates.length} open slots`
            : "Add open slot"
        : privRecurring
          ? privWeekdays.length > 1
            ? `Book ${totalPrivSessions} sessions`
            : `Book ${priv.recurWeeks} weekly sessions`
          : privDates.length > 1
            ? `Book ${privDates.length} sessions`
            : "Book private session";

  return (
    <Sheet open onClose={onClose} dirty={touched && !success} title="Add a class">
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
            &ldquo;Add another&rdquo; keeps the location, type and length — just pick the next
            day and time.
          </p>
        </div>
      ) : (
      <div className="space-y-5">
        {/* The two questions that decide everything below, asked together and
            answered in one tap each: what kind of class, and how often.
            Neither used to be visible — the kind was three buttons whose labels
            changed depending on where you came from, and how often was not a
            control at all. */}
        <div>
          <p className="label mb-2">Kind</p>
          <div role="radiogroup" aria-label="Kind of class" className="grid grid-cols-3 gap-2">
            {MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                role="radio"
                aria-checked={mode === m.value}
                onClick={() => resetMode(m.value)}
                className={`pressable min-h-11 rounded-[8px] border px-2 text-sm font-semibold ${
                  mode === m.value
                    ? "border-ember bg-ember text-ivory"
                    : "border-line hover:border-ember"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Asked of every kind of class, including an open slot — holding the
            same free hour every week for a client you have not named yet is the
            ordinary reason to hold one at all. */}
        <div>
          <p className="label mb-2">Repeats</p>
          <div role="radiogroup" aria-label="How often" className="grid grid-cols-2 gap-2">
            {(
              [
                { value: "once", label: "Just once" },
                { value: "weekly", label: "Every week" },
              ] as const
            ).map((r) => (
              <button
                key={r.value}
                type="button"
                role="radio"
                aria-checked={repeat === r.value}
                onClick={() => {
                  mark();
                  setRepeat(r.value);
                }}
                className={`pressable min-h-11 rounded-[8px] border px-2 text-sm font-semibold ${
                  repeat === r.value
                    ? "border-ember bg-ember text-ivory"
                    : "border-line hover:border-ember"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Group / school class ──────────────────────────────────────────── */}
        {(mode === "weekly" || mode === "school") && (
          <>
            {/* No hint under this. The option says "Automatic — pick the best
                fit", which is the whole idea; a two-sentence explanation
                underneath repeated it and then described a failure state he has
                not reached, on the form where he is trying to get one thing
                made. The red card on the schedule teaches that failure at the
                moment it is true. */}
            <Select
              label="Coach"
              value={form.coachId}
              onChange={(e) => {
                mark();
                setForm({ ...form, coachId: e.target.value });
              }}
            >
              <option value="">Automatic — pick the best fit</option>
              {coaches.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>

            <ClassDetailFields
              form={form}
              onChange={(next) => {
                mark();
                setForm(next);
              }}
              venues={venues}
            />

            {repeats ? (
              <div>
                {/* No sentence explaining that picking two days makes two
                    classes. The chips show what is picked and a time row
                    appears under each one — the control already says it. */}
                <p className="label mb-2">Days</p>
                <div className="mb-3">
                  <DayChips
                    multiple
                    label="Days"
                    selected={weekdays}
                    onSelect={toggleDay}
                  />
                </div>
                <ItemTimesList
                  items={WEEKDAYS_IN_ORDER.filter((c) => weekdays.includes(c))}
                  labelOf={(c) => WEEKDAY_NAME[c] ?? c}
                  times={dayTimes}
                  onSetTime={setDayTime}
                  noteOf={slotNote}
                  railOf={(c) => (preview?.byKey[c]?.coachBusy.length ?? 0) > 0}
                />
              </div>
            ) : (
              <div>
                <p className="label mb-2">Dates</p>
                {/* The days he actually means, one tap each. Opening a native
                    date wheel to say "today" was the single worst tap in the
                    app: the thing he wants most often was the thing furthest
                    away. Anything else is still one tap, on the ＋. */}
                <DateChips
                  today={today}
                  dates={dates}
                  onAdd={addDate}
                  onRemove={removeDate}
                  dateKey={dateKey}
                />
                <ItemTimesList
                  items={dates}
                  labelOf={formatWallDay}
                  times={dateTimes}
                  onSetTime={setDateTime}
                  onRemove={removeDate}
                  noteOf={slotNote}
                  railOf={(d) => (preview?.byKey[d]?.coachBusy.length ?? 0) > 0}
                />
              </div>
            )}

            {/* A one-off is the only class a busy coach can still refuse — the
                repeating kind routes round him week by week. So this is the one
                place worth handing back a way out rather than a sentence. */}
            {hardCoachClash && (
              <div className="space-y-2">
                <Button
                  variant="ghost"
                  className="w-full"
                  onClick={() => setForm({ ...form, coachId: "" })}
                >
                  Leave the coach on automatic
                </Button>
                <p className="text-sm text-fg-2">
                  Automatic gives each date whoever is free.
                </p>
              </div>
            )}

            {repeats && weekdays.length > 0 && form.venueId && (
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
            {/* Player-first: the founder is booking a child, not an account.
                The family name rides along in brackets so two players with the
                same first name stay tellable apart. */}
            <Select
              label="Player"
              value={playerChoiceValue(priv.clientId, priv.playerId)}
              onChange={(e) => {
                const { clientId, playerId } = splitPlayerChoice(e.target.value);
                updatePriv({ clientId, playerId });
              }}
            >
              <option value="">— pick a player —</option>
              <option value="open">No client — open slot (assign later)</option>
              {clients.length > 0 && (
                <optgroup label="Players">
                  {playerChoices(clients).map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
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

            <Select
              label="Coach"
              value={priv.coachId}
              onChange={(e) => updatePriv({ coachId: e.target.value })}
            >
              <option value="">Automatic — pick the best fit</option>
              {coaches.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>

            {/* Where and how long, ABOVE the schedule — the same order a group
                class asks them in. They used to sit at the bottom here and near
                the top there, so the two halves of one sheet read as two forms.
                Location leads because it is the thing he changes least often and
                the thing the clash preview below needs in order to say anything. */}
            <div className="grid grid-cols-2 gap-3">
              <Select
                label="Location"
                className="col-span-2"
                value={priv.venueId}
                onChange={(e) => updatePriv({ venueId: e.target.value })}
              >
                {venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.active
                      ? venueDisplayName(v)
                      : `${venueDisplayName(v)} (hidden)`}
                  </option>
                ))}
              </Select>
              {/* The same lengths a group or school class gets. This offered
                  60 and 90 only, which made "how long is it" the one question
                  on the sheet whose answer depended on which kind of class was
                  selected — and there is nothing about a private that makes a
                  two-hour one impossible. `durationOptions` also folds in a
                  length already on the class, so duplicating a private booked
                  before this can't open with the field blank. */}
              <Select
                label="Length"
                value={priv.duration}
                onChange={(e) => updatePriv({ duration: Number(e.target.value) })}
              >
                {durationOptions(priv.duration).map((d) => (
                  <option key={d} value={d}>{d} min</option>
                ))}
              </Select>
            </div>

            {/* Just once: the same chips, the same multi-select and the same
                per-row times a one-time group class gets. */}
            {!privRecurring && (
              <div>
                <p className="label mb-2">Dates</p>
                <DateChips
                  today={today}
                  dates={privDates}
                  onAdd={addPrivDate}
                  onRemove={removePrivDate}
                  dateKey={privDateKey}
                />
                <ItemTimesList
                  items={privDates}
                  labelOf={formatWallDay}
                  times={privDateTimes}
                  onSetTime={setPrivDateTime}
                  onRemove={removePrivDate}
                  noteOf={slotNote}
                  railOf={(d) => (preview?.byKey[d]?.coachBusy.length ?? 0) > 0}
                />
              </div>
            )}

            {/* Every week: day chips + a time each, identical to a group class.
                The two extras below are genuinely private-only — a family books
                a block from a date, a group class runs until it is ended. */}
            {privRecurring && (
              <>
                <div>
                  <p className="label mb-2">Days</p>
                  <div className="mb-3">
                    <DayChips
                      multiple
                      label="Days"
                      selected={privWeekdays}
                      onSelect={togglePrivDay}
                    />
                  </div>
                  <ItemTimesList
                    items={WEEKDAYS_IN_ORDER.filter((c) => privWeekdays.includes(c))}
                    labelOf={(c) => WEEKDAY_NAME[c] ?? c}
                    times={privDayTimes}
                    onSetTime={setPrivDayTime}
                    noteOf={slotNote}
                    railOf={(c) => (preview?.byKey[c]?.coachBusy.length ?? 0) > 0}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="label" htmlFor="priv-start">
                      Starting
                    </label>
                    <input
                      id="priv-start"
                      type="date"
                      value={priv.startFrom}
                      onChange={(e) => updatePriv({ startFrom: e.target.value })}
                      className="min-h-11 rounded-[8px] border border-line bg-surface-2 px-3 text-base text-fg"
                    />
                  </div>
                  <Select
                    label="For"
                    value={priv.recurWeeks}
                    onChange={(e) => updatePriv({ recurWeeks: Number(e.target.value) })}
                  >
                    {[2, 3, 4, 5, 6, 7, 8, 10, 12].map((w) => (
                      <option key={w} value={w}>{w} weeks</option>
                    ))}
                  </Select>
                </div>
              </>
            )}
          </>
        )}

        <Button onClick={submit} loading={pending} disabled={!canSubmit} className="w-full">
          {submitLabel}
        </Button>

        {message && <p className="text-sm text-err">{message}</p>}
      </div>
      )}
    </Sheet>
  );
}
