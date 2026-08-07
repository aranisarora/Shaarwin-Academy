"use client";

// A family's standing weekly slot — the private half of what the Timetable
// shows, and until now the half you could look at and not touch.
//
// Tapping one used to navigate somewhere else or drop you into a selection,
// because there was nothing to open: no update path for private_booking_series
// existed anywhere in the app. Ending the slot and booking a new one was the
// only way to move a family's Tuesday, which meant refunding their minutes and
// re-spending them to change a time by half an hour.
//
// What it does NOT offer is as deliberate as what it does. Length and location
// are missing because both change what the family is charged or where a coach
// is sent, and both are set through the booking wizard that geocodes an
// address. A Save here that quietly skipped them would be worse than a Save
// that never claimed them, so the sheet says which door those go through.

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Sheet } from "@/components/ui/Sheet";
import { Spinner } from "@/components/ui/Spinner";
import { updatePrivateSeries } from "@/app/admin/schedule/actions";
import { ActionResult } from "./ActionResult";
import { TimeSelect12h } from "./TimeSelect12h";
import { time12h } from "./ClassFields";
import {
  WEEKDAYS,
  WEEKDAY_NAME,
  type Coach,
  type PrivateSeriesRow,
} from "./admin-calendar-types";

/** MO..SU → the ISO number the series column stores (1 = Monday). */
const ISO_OF: Record<string, number> = {
  MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7,
};

export function PrivateSeriesSheet({
  series,
  coaches,
  onClose,
  onDone,
}: {
  series: PrivateSeriesRow;
  coaches: Coach[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [weekday, setWeekday] = useState(series.weekday);
  const [time, setTime] = useState(series.time);
  // Matched by name because that is all the row carries — the timetable query
  // resolves the preferred coach to a name and never brings the id along.
  const [coachName, setCoachName] = useState(series.coachName ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const movedSlot = weekday !== series.weekday || time !== series.time;
  const changedCoach = coachName !== (series.coachName ?? "");
  const dirty = movedSlot || changedCoach;

  function save() {
    setMessage(null);
    startTransition(async () => {
      const coach = coaches.find((c) => c.name === coachName) ?? null;
      const r = await updatePrivateSeries(series.id, {
        weekday: ISO_OF[weekday] ?? 1,
        startTime: time,
        // Only sent when it actually changed: undefined means "leave it", and
        // an unchanged dropdown must not read as "hand it back to automatic".
        ...(changedCoach ? { preferredCoach: coach?.id ?? null } : {}),
      });
      if (!r.ok) {
        setMessage(r.error ?? "Couldn't change that slot.");
        return;
      }
      // The ✓ says whether a message went out, because the founder came from a
      // world where he watched each one send.
      const weeks = r.movedSessions ?? 0;
      const cleared = r.coachCleared ?? 0;
      onDone(
        movedSlot
          ? `Moved to ${WEEKDAY_NAME[weekday]} ${time12h(time)}${
              weeks ? ` — ${weeks} booked week${weeks === 1 ? "" : "s"} moved with it` : ""
            }. ${series.clientName || "The family"} has been told.${
              cleared
                ? ` ${cleared} week${cleared === 1 ? "" : "s"} clashed for the coach and went back to automatic.`
                : ""
            }`
          : `Coach changed. ${weeks ? `${weeks} booked week${weeks === 1 ? "" : "s"} updated. ` : ""}The coaches have been told.`
      );
    });
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={`${series.playerName}${series.clientName ? ` · ${series.clientName}` : ""}`}
    >
      <div className="space-y-5">
        <p className="tnum text-sm text-fg-2">
          Currently {WEEKDAY_NAME[series.weekday] ?? series.weekday}{" "}
          {time12h(series.time)} · {series.duration} min · {series.venueName}
        </p>

        <div>
          <p className="label mb-2">Day</p>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map(([code, name]) => (
              <button
                key={code}
                type="button"
                onClick={() => setWeekday(code)}
                aria-pressed={weekday === code}
                className={`pressable min-h-11 rounded-full border px-4 text-sm font-medium transition-colors ${
                  weekday === code
                    ? "border-ember bg-ember text-ivory"
                    : "border-line hover:border-ember"
                }`}
              >
                {name.slice(0, 3)}
              </button>
            ))}
          </div>
        </div>

        <TimeSelect12h label="Time" value={time} onChange={setTime} />

        <Select
          label="Coach"
          hint="Leave on automatic and each week gets whoever's free."
          value={coachName}
          onChange={(e) => setCoachName(e.target.value)}
        >
          <option value="">Automatic — pick the best fit</option>
          {coaches.map((c) => (
            <option key={c.id} value={c.name}>
              {c.name}
            </option>
          ))}
        </Select>

        {/* Said before he presses it, not after. Moving a standing slot moves
            every week already booked, and the family finds out either way — so
            he should know that is what Save means. */}
        {movedSlot && (
          <ActionResult>
            Every booked week ahead moves to {WEEKDAY_NAME[weekday]} {time12h(time)}, and{" "}
            {series.clientName || "the family"} is told once.
          </ActionResult>
        )}

        <Button onClick={save} disabled={pending || !dirty} className="w-full">
          {pending ? <Spinner /> : "Save"}
        </Button>

        {message && <p className="text-sm text-err">{message}</p>}

        <p className="text-sm text-fg-2">
          To change the length or where it happens, end this slot and book a new one —
          both change what the family is charged or where the coach is sent.
        </p>
      </div>
    </Sheet>
  );
}
