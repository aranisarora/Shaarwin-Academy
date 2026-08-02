"use client";

// Class editor for the weekly-classes list on the admin calendar. Everything
// here applies to every week of the class (the calendar's session sheet is
// where one-week-only changes happen).

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Checkbox } from "@/components/ui/Checkbox";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import { ConfirmAction } from "@/components/ui/ConfirmAction";
import { setClassActive } from "@/app/admin/actions";
import {
  deleteGroupClass,
  endGroupClass,
  getSessionRoster,
  reassignClassCoach,
  restoreGroupClass,
  updateGroupClass,
  type RosterEntry,
} from "@/app/admin/schedule/actions";
import { viewAsCoach } from "@/app/coach/preview-actions";
import { AddressDisplay } from "@/components/app/AddressDisplay";
import { fromDetails } from "@/lib/address";
import { ClassDetailFields, generateClassTitle, time12h, type ClassFormState } from "./ClassFields";
import { TimeSelect12h } from "./TimeSelect12h";
import { formatSessionDate, wallDate } from "@/lib/academy-time";
import {
  WEEKDAY_NAME,
  WEEKDAYS,
  type ClassRow,
  type Coach,
  type Venue,
} from "./admin-calendar-types";

export function AdminClassSheet({
  cls,
  coaches,
  venues,
  onClose,
  onDone,
}: {
  cls: ClassRow;
  coaches: Coach[];
  venues: Venue[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  // Mounted fresh per class (parent keys on cls.id), so initializers read the
  // class directly — no prop-sync effects.
  const [form, setForm] = useState<ClassFormState>({
    title: generateClassTitle(cls.weekday, cls.time, cls.venueName ?? undefined),
    description: cls.description,
    skillLevel: cls.level,
    capacity: cls.capacity,
    durationMinutes: cls.duration,
    venueId: cls.venueId ?? venues[0]?.id ?? "",
    weekday: cls.weekday,
    time: cls.time,
    coachId: "",
  });

  function updateForm(next: ClassFormState) {
    const venueName = venues.find((v) => v.id === next.venueId)?.name;
    setForm({ ...next, title: generateClassTitle(next.weekday, next.time, venueName) });
  }
  const [coachTarget, setCoachTarget] = useState("");
  const [lock, setLock] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  // When the ranking rules reject a coach, we surface an in-sheet override
  // prompt (not window.confirm) holding the reason; confirming forces it.
  const [coachOverride, setCoachOverride] = useState<string | null>(null);
  // Set when the server refuses a delete because the (already ended) class still
  // holds bookings — holds its explanation until the founder confirms or backs out.
  const [deleteForce, setDeleteForce] = useState<string | null>(null);
  // The "Delete completely" text-link arms in place rather than via a native
  // confirm — keeps its subtle affordance while dropping window.confirm.
  const [pending, startTransition] = useTransition();

  const ended = !cls.active && !!cls.endsOn;

  // The founder thinks "who's in that class" — so the weekly panel shows the
  // regulars booked on the next upcoming session (read-only; attendance is a
  // per-session job that happens in the Schedule tab).
  const [roster, setRoster] = useState<RosterEntry[] | null>(() =>
    cls.nextSessionId ? null : []
  );
  useEffect(() => {
    if (!cls.nextSessionId) return;
    let alive = true;
    getSessionRoster(cls.nextSessionId).then((r) => {
      if (alive) setRoster(r);
    });
    return () => {
      alive = false;
    };
  }, [cls.nextSessionId]);

  // Structured address for the venue this class runs at — same header the
  // Schedule session sheet shows, so the two panels read the same.
  const venue = venues.find((v) => v.id === cls.venueId) ?? null;
  const address = venue
    ? fromDetails(venue.address_details, {
        address: venue.address,
        postcode: venue.postcode,
        lat: venue.lat,
        lng: venue.lng,
      })
    : null;

  // Shared success handling for both the first attempt and the override — the
  // r.skipped branch words the ✓ for coaches a clash kept off some weeks.
  function coachDone(r: { changed?: number; skipped?: number }) {
    onDone(
      r.skipped
        ? `Coach set on ${r.changed} upcoming sessions — ${r.skipped} couldn't take them (clashes) and kept their coach.`
        : "Coach set for every upcoming week — everyone affected has been told."
    );
  }

  function applyCoach() {
    if (!coachTarget) return;
    setCoachOverride(null);
    startTransition(async () => {
      const r = await reassignClassCoach(cls.id, coachTarget, lock);
      if (!r.ok && r.code === "filter_failed") {
        // The rules say no — but the founder can override. A hard time clash
        // is still blocked by the database either way. Ask in-sheet, not native.
        setCoachOverride(r.error ?? "That coach doesn't fit the rules.");
        return;
      }
      if (r.ok) coachDone(r);
      else setMessage(r.error ?? "Failed.");
    });
  }

  function applyCoachOverride() {
    if (!coachTarget) return;
    startTransition(async () => {
      const r = await reassignClassCoach(cls.id, coachTarget, lock, true);
      setCoachOverride(null);
      if (r.ok) coachDone(r);
      else setMessage(r.error ?? "Failed.");
    });
  }

  return (
    <Sheet open onClose={onClose} title="Edit class">
      <div className="space-y-4">
        {/* ── Class header: where, when, how full — matches the session sheet ── */}
        <div>
          <p className="font-semibold">{cls.venueName ?? "No venue"}</p>
          <p className="mt-0.5 text-fg-2">
            Every {WEEKDAY_NAME[cls.weekday] ?? cls.weekday}, {time12h(cls.time)} ·{" "}
            {cls.bookedCount} of {cls.capacity} booked
          </p>
          {address && (
            <AddressDisplay address={address} audience="staff" className="mt-2" />
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            {cls.isSchool && <Badge tone="ember">School class</Badge>}
            {!cls.active && (
              <Badge tone="neutral">{cls.endsOn ? "Ended" : "Booking paused"}</Badge>
            )}
          </div>
          {cls.nextSessionId && cls.nextSessionStart && (
            <Link
              href={`/admin/schedule?date=${wallDate(cls.nextSessionStart)}&session=${cls.nextSessionId}`}
              className="mt-3 block text-sm text-ember hover:underline"
            >
              Open this week&apos;s session ({formatSessionDate(cls.nextSessionStart)}) →
            </Link>
          )}
          {cls.nextCoachId && (
            <button
              type="button"
              onClick={() =>
                startTransition(async () => {
                  const ok = await viewAsCoach(cls.nextCoachId as string);
                  if (ok) window.location.assign("/coach");
                  else setMessage("Preview unavailable — only founders can view as coach.");
                })
              }
              disabled={pending}
              className="mt-2 block text-sm text-ember hover:underline disabled:opacity-50"
            >
              View this coach&apos;s app →
            </button>
          )}
        </div>

        {/* ── Regulars: who's booked on the next session (read-only) ── */}
        <div className="space-y-2 rounded-[12px] border border-line p-4">
          <p className="label">Regulars</p>
          {roster === null ? (
            <div className="flex justify-center py-2">
              <Spinner />
            </div>
          ) : roster.length === 0 ? (
            <p className="text-sm text-fg-2">
              Nobody booked on the next session yet. Mark attendance from the Schedule tab.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {roster.map((p) => (
                <li key={p.id} className="text-sm">
                  {p.name}
                </li>
              ))}
            </ul>
          )}
        </div>

        {ended && (
          <div className="space-y-3 rounded-[12px] border border-line bg-surface-2 p-4">
            <p className="text-sm text-fg-2">
              This class has ended — its upcoming sessions were cancelled. Restore it and
              they go back on the schedule (clients who were booked need to book again).
            </p>
            <Button
              className="w-full"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const r = await restoreGroupClass(cls.id);
                  if (r.ok)
                    onDone("Class restored — its upcoming sessions are back on the schedule.");
                  else setMessage(r.error ?? "Couldn't restore the class.");
                })
              }
            >
              {pending ? <Spinner /> : "Restore class"}
            </Button>
          </div>
        )}

        <ClassDetailFields form={form} onChange={updateForm} venues={venues} />
        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Day"
            value={form.weekday}
            onChange={(e) => updateForm({ ...form, weekday: e.target.value })}
          >
            {WEEKDAYS.map(([code, name]) => (
              <option key={code} value={code}>{name}</option>
            ))}
          </Select>
          <TimeSelect12h
            label="Time"
            value={form.time}
            onChange={(time) => updateForm({ ...form, time })}
          />
        </div>

        <p className="text-sm text-fg-2">
          Changes here apply to every week of this class. Moving the day, time, length or
          venue moves every upcoming session — everyone booked gets a message automatically.
        </p>

        <Button
          className="w-full"
          disabled={pending || !form.venueId}
          onClick={() =>
            startTransition(async () => {
              const r = await updateGroupClass({
                classId: cls.id,
                title: form.title,
                description: form.description,
                skillLevel: form.skillLevel,
                capacity: form.capacity,
                durationMinutes: form.durationMinutes,
                venueId: form.venueId,
                weekday: form.weekday,
                time: form.time,
              });
              if (r.ok)
                onDone("Saved — upcoming sessions moved with it and everyone booked was told.");
              else setMessage(r.error ?? "Couldn't save the class.");
            })
          }
        >
          {pending ? <Spinner /> : "Save changes"}
        </Button>

        {!ended && (
          <div className="space-y-3 rounded-[12px] border border-line p-4">
            <p className="label">Coach — every week</p>
            <Select
              label="Coach"
              hint="Puts this coach on every upcoming session of the class."
              value={coachTarget}
              onChange={(e) => setCoachTarget(e.target.value)}
            >
              <option value="">— pick a coach —</option>
              {coaches.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
            <label className="flex items-center gap-3 text-sm">
              <Checkbox size="md" checked={lock} onChange={(e) => setLock(e.target.checked)} />
              Keep this coach — don&apos;t swap them automatically
            </label>
            {coachOverride ? (
              <div className="space-y-2 rounded-[8px] border border-err p-3">
                <p className="text-sm text-fg-2">{coachOverride} Assign them anyway?</p>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="ghost"
                    disabled={pending}
                    onClick={() => setCoachOverride(null)}
                  >
                    Keep
                  </Button>
                  <Button disabled={pending} onClick={applyCoachOverride}>
                    {pending ? <Spinner /> : "Assign anyway"}
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                onClick={applyCoach}
                disabled={pending || !coachTarget}
                className="w-full"
              >
                {pending ? <Spinner /> : "Set coach for every week"}
              </Button>
            )}
          </div>
        )}

        {!ended && (
          <button
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const r = await setClassActive(cls.id, !cls.active);
                if (r.ok)
                  onDone(cls.active ? "Booking paused for this class." : "Class reopened for booking.");
                else setMessage(r.error ?? "Failed.");
              })
            }
            className={`w-full text-center text-sm underline-offset-4 hover:underline ${
              cls.active ? "text-ok" : "text-err"
            }`}
          >
            {cls.active ? "Open for booking — pause it" : "Paused — reopen for booking"}
          </button>
        )}

        {cls.active && (
          <ConfirmAction
            label="End class"
            confirmLabel="End the class"
            prompt="End this class? All upcoming sessions are cancelled and everyone booked gets a message. Past sessions stay in the history — and you can restore the class later from this list."
            pending={pending}
            onConfirm={() =>
              startTransition(async () => {
                const r = await endGroupClass(cls.id);
                if (r.ok) onDone("Class ended — everyone affected has been told. You can restore it from the weekly classes list.");
                else setMessage(r.error ?? "Failed.");
              })
            }
          />
        )}
        {/* An ended class that still holds bookings can't just be deleted — but
            it can't be "ended instead" either, since it already has been. The
            server says so with `needs_force` and names the cost; confirming
            here deletes it and that history for good. */}
        {deleteForce ? (
          <div className="space-y-2 rounded-[8px] border border-err p-3">
            <p className="text-sm text-fg-2">{deleteForce}</p>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="ghost" disabled={pending} onClick={() => setDeleteForce(null)}>
                Keep
              </Button>
              <Button
                variant="destructive"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const r = await deleteGroupClass(cls.id, true);
                    setDeleteForce(null);
                    if (r.ok) onDone("Class deleted, along with its history.");
                    else setMessage(r.error ?? "Failed.");
                  })
                }
              >
                {pending ? <Spinner /> : "Delete anyway"}
              </Button>
            </div>
          </div>
        ) : (
          <ConfirmAction
            variant="subtle"
            label="Delete completely (mistakes only)"
            prompt={
              ended
                ? "Delete this class completely? If it still holds bookings you'll be asked once more before anything goes."
                : "Delete this class completely? Only works if nobody is booked on it."
            }
            confirmLabel="Delete class"
            pending={pending}
            onConfirm={() =>
              startTransition(async () => {
                const r = await deleteGroupClass(cls.id);
                if (!r.ok && r.code === "needs_force") {
                  setDeleteForce(r.error ?? "This class still holds history.");
                  return;
                }
                if (r.ok) onDone("Class deleted.");
                else setMessage(r.error ?? "Failed.");
              })
            }
          />
        )}
        {message && <p className="text-sm text-err">{message}</p>}
      </div>
    </Sheet>
  );
}
