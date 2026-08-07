"use client";

// The editor for one repeating group class. Everything here applies to every
// week of it; one-week-only changes happen on that session in This week.
//
// This sheet used to be the most crowded surface in the app: seventeen controls
// and EIGHT separate outcomes on one scroll, including two identical full-width
// ember buttons a hundred pixels apart that did different things. The one beside
// it — PrivateSeriesSheet, editing the same kind of object for one family — had
// one Save, a dirty check, and a sentence naming the consequence before you
// committed to it. The better design was already in the repo; this is that
// design applied to the object with the bigger blast radius.
//
// Three rules it now follows, all borrowed from next door:
//
//   ONE SAVE. Day, time, location, length, spots and coach are one form and one
//   button. There were two, and the second one destroyed the first one's work:
//   "Set coach for every week" called onDone(), the parent unmounted the sheet,
//   and every unsaved field change went with it — silently, with no dirty check
//   anywhere and a Save button that stayed armed on a pristine form.
//
//   SAY IT BEFORE, NOT AFTER. A ✓ that arrives after the WhatsApps have gone out
//   is a receipt, not a decision. The line above Save names the day, the time
//   and who gets told, and it only appears once something has actually changed.
//
//   DANGER LIVES IN ONE PLACE. Pausing, ending and deleting were three controls
//   at three visual weights scattered between unrelated panels — one of them a
//   GREEN full-width link, in the colour this codebase reserves for "confirmed /
//   done", that paused booking on a live class in a single unconfirmed tap.
//   They are collected under More, closed, in the order they escalate.

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { ActionSection } from "@/components/ui/ActionSection";
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
import { ActionResult } from "./ActionResult";
import { fromDetails } from "@/lib/address";
import { venueDisplayName } from "@/lib/venue-display";
import { ClassDetailFields, generateClassTitle, time12h, type ClassFormState } from "./ClassFields";
import { DayChips } from "./DayChips";
import { TimeSelect12h } from "./TimeSelect12h";
import { formatSessionDate, wallDate } from "@/lib/academy-time";
import { WEEKDAY_NAME, type ClassRow, type Coach, type Venue } from "./admin-calendar-types";

/** Any of these calls can simply not arrive — a phone on a sports-hall wifi
 * drops one often enough that "I tapped it and nothing happened" was a real
 * outcome rather than a misreading. Every action says so instead of leaving its
 * button armed and the sheet silent. */
const UNREACHABLE = "Couldn't reach the server. Nothing changed — try again.";

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
  const initialVenueId = cls.venueId ?? venues[0]?.id ?? "";
  const [form, setForm] = useState<ClassFormState>({
    title: generateClassTitle(cls.weekday, cls.time, cls.venueName ?? undefined),
    description: cls.description,
    skillLevel: cls.level,
    capacity: cls.capacity,
    durationMinutes: cls.duration,
    venueId: initialVenueId,
    weekday: cls.weekday,
    time: cls.time,
    coachId: "",
  });

  function updateForm(next: ClassFormState) {
    const venueName = venues.find((v) => v.id === next.venueId)?.name;
    setForm({ ...next, title: generateClassTitle(next.weekday, next.time, venueName) });
  }

  // Seeded with the coach who is actually on it, so the control shows the
  // current answer rather than asking him to remember it. Blank means "nobody
  // yet" — and leaving it blank changes nothing, because there is no server
  // path that takes a class back to automatic.
  const initialCoachId = cls.nextCoachId ?? "";
  const [coachTarget, setCoachTarget] = useState(initialCoachId);
  const [lock, setLock] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  // When the ranking rules reject a coach, we surface an in-sheet override
  // prompt (not window.confirm) holding the reason; confirming forces it.
  const [coachOverride, setCoachOverride] = useState<string | null>(null);
  // What the class half of a part-completed save already did, so the override
  // prompt can report the whole outcome rather than only the coach's half.
  const [savedSoFar, setSavedSoFar] = useState<string[]>([]);
  // Set when the server refuses a delete because the class still holds
  // bookings — holds its explanation until the founder confirms or backs out.
  const [deleteForce, setDeleteForce] = useState<string | null>(null);
  // Anything that goes wrong on the delete path shows *here*, beside the delete
  // controls, rather than in a single line at the foot of a scrolling sheet.
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const ended = !cls.active && !!cls.endsOn;

  // ── What has actually changed ──────────────────────────────────────────────
  const slotMoved = form.weekday !== cls.weekday || form.time !== cls.time;
  const classDirty =
    slotMoved ||
    form.venueId !== initialVenueId ||
    form.durationMinutes !== cls.duration ||
    form.capacity !== cls.capacity;
  const coachDirty = !!coachTarget && coachTarget !== initialCoachId;
  const dirty = classDirty || coachDirty;

  const coachName = coaches.find((c) => c.id === coachTarget)?.name;
  const dayName = WEEKDAY_NAME[form.weekday] ?? form.weekday;
  const wasDayName = WEEKDAY_NAME[cls.weekday] ?? cls.weekday;

  // The founder thinks "who's in that class" — so the panel shows the regulars
  // booked on the next upcoming session (read-only; attendance is a per-session
  // job that happens in This week).
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
  // session sheet shows, so the two panels read the same.
  const venue = venues.find((v) => v.id === cls.venueId) ?? null;
  const address = venue
    ? fromDetails(venue.address_details, {
        address: venue.address,
        postcode: venue.postcode,
        lat: venue.lat,
        lng: venue.lng,
      })
    : null;

  /** The coach half of a save, worded for the weeks a clash kept them off. */
  const coachNote = (r: { changed?: number; skipped?: number }) =>
    r.skipped
      ? `${coachName} is on ${r.changed} upcoming ${dayName}s — ${r.skipped} couldn't take them (clashes) and kept their coach.`
      : `${coachName} is on every upcoming ${dayName} — everyone affected has been told.`;

  /** Run the coach change. Returns the note on success, null once it has
   *  reported its own failure, and the rejection when the rules say no. */
  async function runCoach(
    force: boolean
  ): Promise<{ note: string } | { rejected: string } | null> {
    try {
      const r = await reassignClassCoach(cls.id, coachTarget, lock, force);
      if (!force && !r.ok && r.code === "filter_failed")
        return { rejected: r.error ?? "That coach doesn't fit the rules." };
      if (r.ok) return { note: coachNote(r) };
      setMessage(r.error ?? "Couldn't set the coach.");
      return null;
    } catch {
      setMessage(UNREACHABLE);
      return null;
    }
  }

  /** One Save for the whole sheet. Class fields first, then the coach — so a
   *  coach the rules reject leaves the field changes already applied and says
   *  so, rather than rolling back work the founder can see on screen. */
  function save() {
    setMessage(null);
    setCoachOverride(null);
    startTransition(async () => {
      const notes: string[] = [];

      if (classDirty) {
        try {
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
          if (!r.ok) {
            setMessage(r.error ?? "Couldn't save the class.");
            return;
          }
          notes.push(
            r.stuck
              ? `Saved — upcoming sessions moved with it and everyone booked was told. ${r.stuck} ${r.stuck === 1 ? "week" : "weeks"} couldn't move and ${r.stuck === 1 ? "is" : "are"} still on the old slot; open ${r.stuck === 1 ? "it" : "them"} in This week to move ${r.stuck === 1 ? "it" : "them"} by hand.`
              : "Saved — upcoming sessions moved with it and everyone booked was told."
          );
        } catch {
          setMessage(UNREACHABLE);
          return;
        }
      }

      if (coachDirty) {
        const outcome = await runCoach(false);
        if (!outcome) {
          // The coach failed and said why. Anything already saved must still be
          // reported, or the founder reads a bare error over work that landed.
          if (notes.length) setSavedSoFar(notes);
          return;
        }
        if ("rejected" in outcome) {
          setSavedSoFar(notes);
          setCoachOverride(outcome.rejected);
          return;
        }
        notes.push(outcome.note);
      }

      onDone(notes.join(" "));
    });
  }

  function applyCoachOverride() {
    startTransition(async () => {
      const outcome = await runCoach(true);
      setCoachOverride(null);
      if (!outcome || "rejected" in outcome) return;
      onDone([...savedSoFar, outcome.note].join(" "));
    });
  }

  /* The delete control — trigger, the "ask once more" box the server can demand,
   * and whatever went wrong — kept as one thing, because it has to live in two
   * different places and both of them need all three parts within a thumb's
   * reach of each other.
   *
   * On a running class it sits last inside More, as a subtle underlined link:
   * deleting one outright is a mistakes-only action and should be hard to hit
   * while you were reaching for "End class".
   *
   * On an ENDED class it moves up beside "Restore class" and becomes a real
   * destructive button. The card badge promises "Ended — restore or delete", and
   * a promise answered by a grey link at the bottom of a scrolling sheet is not
   * one the founder can see. */
  const deleteControls = (
    <div className="space-y-2">
      {deleteForce ? (
        <div className="space-y-2 rounded-[8px] border border-err p-3">
          <p className="text-sm text-fg-2">{deleteForce}</p>
          {deleteError && <p className="text-sm text-err">{deleteError}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setDeleteForce(null);
                setDeleteError(null);
              }}
            >
              Keep
            </Button>
            <Button
              variant="destructive"
              loading={pending}
              onClick={() =>
                startTransition(async () => {
                  setDeleteError(null);
                  try {
                    const r = await deleteGroupClass(cls.id, true);
                    if (r.ok) {
                      setDeleteForce(null);
                      onDone(
                        r.cancelledBookings
                          ? "Class deleted. The sessions people were booked on were cancelled first, and everyone affected has been told."
                          : "Class deleted, along with the history it held. Nobody was still holding a place, so nobody needed telling."
                      );
                    } else setDeleteError(r.error ?? "Couldn't delete the class.");
                  } catch {
                    setDeleteError(UNREACHABLE);
                  }
                })
              }
            >
              Delete anyway
            </Button>
          </div>
        </div>
      ) : (
        <ConfirmAction
          variant={ended ? "destructive" : "subtle"}
          label={ended ? "Delete for good" : "Delete completely (mistakes only)"}
          prompt={
            ended
              ? "Delete this class completely? If it still holds bookings you'll be asked once more before anything goes."
              : "Delete this class completely? If anyone is booked on it you'll be asked once more — and their sessions are cancelled and everyone told before it goes."
          }
          confirmLabel="Delete class"
          pending={pending}
          onConfirm={() =>
            startTransition(async () => {
              setDeleteError(null);
              try {
                const r = await deleteGroupClass(cls.id);
                if (!r.ok && r.code === "needs_force") {
                  setDeleteForce(r.error ?? "This class still holds history.");
                  return;
                }
                // A class can pass the guard and still not be empty: its places
                // may sit on sessions that came and went without a register.
                // That is the ordinary end-state of a class here, not a rarity —
                // so the ✓ line must not tell him nobody was ever booked on the
                // thing he just destroyed.
                if (r.ok)
                  onDone(
                    r.unmarkedBookings
                      ? `Class deleted, along with ${r.unmarkedBookings} booking${r.unmarkedBookings === 1 ? "" : "s"} on sessions that came and went with no register marked. Nobody was still holding a place, so nobody was told.`
                      : "Class deleted. Nobody was booked on it, so nobody was told."
                  );
                else setDeleteError(r.error ?? "Couldn't delete the class.");
              } catch {
                setDeleteError(UNREACHABLE);
              }
            })
          }
        />
      )}
      {!deleteForce && deleteError && <p className="text-sm text-err">{deleteError}</p>}
    </div>
  );

  const viewAsCoachButton = cls.nextCoachId && (
    <button
      type="button"
      onClick={() =>
        startTransition(async () => {
          try {
            const ok = await viewAsCoach(cls.nextCoachId as string);
            if (ok) window.location.assign("/coach");
            else setMessage("Preview unavailable — only founders can view as coach.");
          } catch {
            setMessage(UNREACHABLE);
          }
        })
      }
      disabled={pending}
      className="pressable flex min-h-11 w-full items-center text-sm text-ember hover:underline disabled:opacity-50"
    >
      View this coach&apos;s app →
    </button>
  );

  return (
    <Sheet
      open
      onClose={onClose}
      dirty={dirty}
      title={venue ? venueDisplayName(venue) : (cls.venueName ?? "No location")}
    >
      <div className="space-y-4">
        {/* ── What this is: the same header shape the session sheet uses ── */}
        <div>
          <p className="tnum text-fg-2">
            Every {wasDayName}, {time12h(cls.time)} · {cls.duration} min ·{" "}
            {cls.bookedCount} of {cls.capacity} booked
          </p>
          {address && <AddressDisplay address={address} audience="staff" className="mt-2" />}
          <div className="mt-2 flex flex-wrap gap-2">
            {cls.isSchool && <Badge tone="ember">School class</Badge>}
            {!cls.active && (
              <Badge tone="neutral">{cls.endsOn ? "Ended" : "Booking paused"}</Badge>
            )}
          </div>
          {/* Said once. It used to be said twice, in two wordings, forty lines
              apart — and the useful half is the link, not the sentence. */}
          {cls.nextSessionId && cls.nextSessionStart && (
            <p className="mt-3 text-sm text-fg-2">
              Everything here changes every week. For one week only,{" "}
              <Link
                href={`/admin/schedule?date=${wallDate(cls.nextSessionStart)}&session=${cls.nextSessionId}`}
                className="text-ember hover:underline"
              >
                open the {formatSessionDate(cls.nextSessionStart)} session
              </Link>
              .
            </p>
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
              Nobody booked on the next session yet. Mark attendance in This week.
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
              they go back on the schedule (clients who were booked need to book again), or
              delete it and it leaves the list for good.
            </p>
            <Button
              className="w-full"
              loading={pending}
              onClick={() =>
                startTransition(async () => {
                  try {
                    const r = await restoreGroupClass(cls.id);
                    if (r.ok)
                      onDone("Class restored — its upcoming sessions are back on the schedule.");
                    else setMessage(r.error ?? "Couldn't restore the class.");
                  } catch {
                    setMessage(UNREACHABLE);
                  }
                })
              }
            >
              Restore class
            </Button>
            {/* Stacked rather than side by side: armed, the confirm box holds a
                whole sentence, and half a phone's width turns that into a column
                of two-word lines. */}
            {deleteControls}
          </div>
        )}

        {/* ── The one form ────────────────────────────────────────────────── */}
        <div>
          <p className="label mb-2">Day</p>
          <DayChips
            selected={[form.weekday]}
            onSelect={(code) => updateForm({ ...form, weekday: code })}
          />
        </div>

        <TimeSelect12h
          label="Time"
          value={form.time}
          onChange={(time) => updateForm({ ...form, time })}
        />

        <ClassDetailFields form={form} onChange={updateForm} venues={venues} />

        <Select
          label="Coach"
          value={coachTarget}
          onChange={(e) => setCoachTarget(e.target.value)}
        >
          <option value="">No coach yet</option>
          {coaches.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        {/* Only meaningful while a coach is actually being changed, so it only
            exists then — one fewer control on the sheet he opened to read. */}
        {coachDirty && (
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <Checkbox size="md" checked={lock} onChange={(e) => setLock(e.target.checked)} />
            Keep {coachName} on it — don&apos;t swap them automatically
          </label>
        )}

        {/* Before the button, not after it. */}
        {dirty && (
          <ActionResult>
            {[
              slotMoved
                ? `Every ${wasDayName} moves to ${dayName} ${time12h(form.time)}.`
                : classDirty
                  ? "Every upcoming week updates."
                  : null,
              classDirty ? "Everyone booked is told." : null,
              coachDirty ? `${coachName} goes on every upcoming ${dayName}.` : null,
            ]
              .filter(Boolean)
              .join(" ")}
          </ActionResult>
        )}

        {coachOverride ? (
          <div className="space-y-2 rounded-[8px] border border-err p-3">
            <p className="text-sm text-fg-2">{coachOverride} Assign them anyway?</p>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  setCoachOverride(null);
                  // Whatever the class half already did still happened; let him
                  // out with the sheet reporting it rather than silently.
                  if (savedSoFar.length) onDone(savedSoFar.join(" "));
                }}
              >
                Keep
              </Button>
              <Button loading={pending} onClick={applyCoachOverride}>
                Assign anyway
              </Button>
            </div>
          </div>
        ) : (
          <Button className="w-full" loading={pending} disabled={!dirty} onClick={save}>
            Save changes
          </Button>
        )}

        {message && <p className="text-sm text-err">{message}</p>}

        {/* ── More: everything rare, and everything with a cost ──
            Closed by default and ordered by how far it reaches. */}
        {!ended && (
          <ActionSection label="More">
            {viewAsCoachButton}
            <ConfirmAction
              variant="ghost"
              label={cls.active ? "Pause booking" : "Reopen for booking"}
              confirmLabel={cls.active ? "Pause booking" : "Reopen it"}
              prompt={
                cls.active
                  ? "Pause booking on this class? It stays on the timetable, greyed out and marked Paused, and nobody new can book until you reopen it. Sessions still run."
                  : "Reopen this class for booking?"
              }
              pending={pending}
              onConfirm={() =>
                startTransition(async () => {
                  try {
                    const r = await setClassActive(cls.id, !cls.active);
                    if (r.ok)
                      onDone(
                        cls.active
                          ? "Booking paused. The class stays on the timetable, greyed out and marked Paused, until you reopen it."
                          : "Class reopened for booking."
                      );
                    else setMessage(r.error ?? "Failed.");
                  } catch {
                    setMessage(UNREACHABLE);
                  }
                })
              }
            />
            {cls.active && (
              <ConfirmAction
                label="End class"
                confirmLabel="End the class"
                prompt="End this class? All upcoming sessions are cancelled and everyone booked gets a message. Past sessions stay in the history — and you can restore the class later from this list."
                pending={pending}
                onConfirm={() =>
                  startTransition(async () => {
                    try {
                      const r = await endGroupClass(cls.id);
                      if (r.ok)
                        onDone(
                          "Class ended — everyone affected has been told. It stays on the timetable marked Ended, so you can restore it or delete it from there."
                        );
                      else setMessage(r.error ?? "Failed.");
                    } catch {
                      setMessage(UNREACHABLE);
                    }
                  })
                }
              />
            )}
            {/* A class that holds bookings isn't deleted on the first ask. The
                server names the cost with `needs_force` and confirming there
                goes through with it. */}
            {deleteControls}
          </ActionSection>
        )}
      </div>
    </Sheet>
  );
}
