"use client";

// Confirm step for clearing a selection of weekly classes.
//
// There is exactly ONE question here: keep the history, or don't.
//
// "Delete" means four different things in this domain — a stopped husk, a
// running class nobody booked, a class people hold places in, an already-ended
// class with a term of registers behind it — and this sheet used to ask about
// each of them separately. Four opt-in checkboxes and a nested radio is 32
// reachable outcomes, and the founder had to do the sorting himself to reach
// any of them.
//
// He never had to. The server already sorts them: `planClassRemoval` returns
// the buckets. So the sorting became REPORTING — the "What happens" list — and
// the only thing left to ask is the one thing the server cannot know, which is
// whether he wants the record afterwards.
//
//   End them ................ off the schedule, everyone told, rows survive
//                             under "Ended" and can be restored
//   Delete them completely .. same cancellations, same messages, rows and every
//                             register ever marked on them gone
//
// Three things are deliberately NOT choices:
//
//   • Stopped classes holding nothing are deleted under both. There is no
//     history on them to keep, so "keep the history" has no meaning — and
//     making the everyday clear-out of husks pay for the rare decision was the
//     whole problem. The list still says out loud that they go.
//   • Running classes nobody has booked follow the choice. They used to be
//     reachable only through a delete, which is why `endRunningEmpty` exists:
//     "End them" over a whole timetable quietly skipped 36 school classes.
//   • Weekly private slots follow the choice too, and can only ever be ended —
//     deleting the generated weeks is what makes a retired slot come back the
//     next night. The list names the families and the minutes.
//
// The radio itself disappears when it changes nothing: a selection of pure
// husks, or of nothing but private slots, has one possible outcome and gets one
// button. Nothing is destroyed until that button is tapped, and the destructive
// half asks twice.

import { useEffect, useMemo, useState, useTransition } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { Radio } from "@/components/ui/Checkbox";
import { Spinner } from "@/components/ui/Spinner";
import { ConfirmAction } from "@/components/ui/ConfirmAction";
import { bulkRemoveClasses, planClassRemoval } from "@/app/admin/schedule/actions";

const plural = (n: number, one: string, many = `${one}es`) => (n === 1 ? one : many);
/** "1 class" / "12 classes" — the count and its noun, which is what almost every
 *  line of the report below actually wants. */
const count = (x: number, one: string, many = `${one}s`) =>
  `${x} ${x === 1 ? one : many}`;

/** "3 classes deleted · 2 ended — everyone booked has been told." */
function resultLine(
  deleted: number,
  deletedRunning: number,
  ended: number,
  purged: number,
  deletedBooked: number,
  kept: number,
  /** Why part of the selection stayed put, when the rest of it went. Without it
   * a failed ending reads as "2 were left alone." and no reason at all. */
  warning?: string,
  privateSeriesEnded = 0,
  minutesReturned = 0,
  unsupported = 0
): string {
  const parts: string[] = [];
  if (deleted) parts.push(`${deleted} ${plural(deleted, "class")} deleted`);
  // Named apart from the rest, because these are the ones that were still on
  // the timetable — if 36 of them just went, the line has to say so out loud,
  // and say who heard about it. Nobody was booked, but somebody was rostered.
  if (deletedRunning)
    parts.push(
      `${deletedRunning} running ${plural(deletedRunning, "class", "classes")} deleted, nobody booked — ${deletedRunning === 1 ? "its coach has" : "their coaches have"} been told`
    );
  if (purged) parts.push(`${purged} ended ${plural(purged, "class")} deleted with ${purged === 1 ? "its" : "their"} history`);
  if (deletedBooked)
    parts.push(
      `${deletedBooked} booked ${plural(deletedBooked, "class")} cancelled and deleted`
    );
  if (ended) parts.push(`${ended} ended`);
  if (privateSeriesEnded)
    parts.push(
      `${privateSeriesEnded} weekly private ${plural(privateSeriesEnded, "slot", "slots")} ended`
    );
  if (!parts.length && !warning && !unsupported) return "Nothing changed.";
  let line = parts.length ? parts.join(" · ") + "." : "Nothing was removed.";
  // Only the buckets that actually message somebody may claim it. `deletedRunning`
  // is deliberately not one of them — nobody was booked on those by definition,
  // and its own clause above already says who was told.
  if (ended || deletedBooked || privateSeriesEnded)
    line += " Everyone booked on them has been told.";
  if (minutesReturned)
    line += ` ${minutesReturned} private ${plural(minutesReturned, "minute", "minutes")} returned.`;
  if (kept) line += ` ${kept} ${plural(kept, "was", "were")} left alone.`;
  // "We couldn't find it" is a different thing to hear from "we left it alone",
  // and it used to be reported as neither.
  if (unsupported)
    line += ` ${unsupported} couldn't be removed here — ${unsupported === 1 ? "it may" : "they may"} already be gone. Refresh the list.`;
  if (warning) line += ` ${warning}`;
  return line;
}

export function AdminBulkRemoveSheet({
  classIds,
  seriesIds = [],
  onClose,
  onDone,
}: {
  classIds: string[];
  /** `private_booking_series` ids — a different table from `classes`, with no
   * foreign key between them, so they travel as their own list the whole way
   * down rather than being merged into `classIds` and silently dropped. */
  seriesIds?: string[];
  onClose: () => void;
  /** Reports the outcome line and how many classes are gone, so the list can
   * drop them from the selection and refresh. */
  onDone: (message: string) => void;
}) {
  type SeriesPlan = {
    endable: string[];
    alreadyEnded: string[];
    missing: string[];
    cost: {
      futureSessions: number;
      minutesReturned: number;
      families: number;
      coaches: number;
    };
  };
  type Plan = {
    deletable: string[];
    deletableRunning: string[];
    endable: string[];
    purgeable: string[];
    purgeableLive: string[];
    unsupported: string[];
    purgeCost: {
      sessions: number;
      bookings: number;
      unmarked: number;
      runningSessions: number;
      runningUnmarked: number;
      liveBookings: number;
    };
    series: SeriesPlan;
  };
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // The one question. "end" is the default because it is the recoverable half:
  // the same cancellations and the same messages, but nothing is destroyed.
  const [mode, setMode] = useState<"end" | "delete">("end");

  // A rejected server action is the one failure that used to look like nothing
  // at all: the spinner never stopped, and there was no `.catch` to say why. A
  // dropped connection on a phone is common enough that it needs its own line.
  useEffect(() => {
    let alive = true;
    planClassRemoval(classIds, seriesIds)
      .then((r) => {
        if (!alive) return;
        if (r.ok)
          setPlan({
            deletable: r.deletable ?? [],
            deletableRunning: r.deletableRunning ?? [],
            endable: r.endable ?? [],
            purgeable: r.purgeable ?? [],
            purgeableLive: r.purgeableLive ?? [],
            unsupported: r.unsupported ?? [],
            purgeCost: r.purgeCost ?? {
              sessions: 0,
              bookings: 0,
              unmarked: 0,
              runningSessions: 0,
              runningUnmarked: 0,
              liveBookings: 0,
            },
            series: r.series ?? {
              endable: [],
              alreadyEnded: [],
              missing: [],
              cost: { futureSessions: 0, minutesReturned: 0, families: 0, coaches: 0 },
            },
          });
        else setError(r.error ?? "Couldn't check those classes.");
      })
      .catch(() => {
        if (alive) setError("Couldn't reach the server to check those classes. Try again.");
      });
    return () => {
      alive = false;
    };
  }, [classIds, seriesIds]);

  const deleting = mode === "delete";

  function run() {
    setError(null);
    startTransition(async () => {
      try {
        // The two modes, and the whole of the founder's input, expressed against
        // the options the core already had. `endBooked` and `endRunningEmpty`
        // are on in BOTH: ending is what cancels the sessions and sends the
        // messages, and a delete is an ending that also removes the row.
        const r = await bulkRemoveClasses(classIds, {
          endBooked: true,
          endRunningEmpty: true,
          deleteBooked: deleting,
          deleteRunningEmpty: deleting,
          purgeEnded: deleting,
          privateSeriesIds: seriesIds,
          endPrivateSeries: true,
        });
        if (r.ok)
          onDone(
            resultLine(
              r.deleted ?? 0,
              r.deletedRunning ?? 0,
              r.ended ?? 0,
              r.purged ?? 0,
              r.deletedBooked ?? 0,
              r.kept ?? 0,
              r.warning,
              r.privateSeriesEnded ?? 0,
              r.minutesReturned ?? 0,
              r.unsupported ?? 0
            )
          );
        else setError(r.error ?? "Couldn't remove those classes.");
      } catch {
        setError("Couldn't reach the server. Nothing was removed — try again.");
      }
    });
  }

  const nDel = plan?.deletable.length ?? 0;
  const nRun = plan?.deletableRunning.length ?? 0;
  const nEnd = plan?.endable.length ?? 0;
  // The two purge lists are one number to the founder — "the ended ones" — and
  // separate lists only because one of them owes somebody a message.
  const nPurge = (plan?.purgeable.length ?? 0) + (plan?.purgeableLive.length ?? 0);
  const nSeries = plan?.series.endable.length ?? 0;
  const nUnsupported = plan?.unsupported.length ?? 0;
  const nActionable = nDel + nRun + nEnd + nPurge + nSeries;

  // The radio only earns its place when the two answers differ. A selection of
  // pure husks is deleted either way; a selection of nothing but private slots
  // can only be ended. Showing a choice with one outcome is ceremony, and this
  // is the everyday case — clearing husks stays exactly one tap.
  const choiceMatters = nRun + nEnd + nPurge > 0;

  /** How many things move, and under which verb. Ending and deleting are not
   *  the same word and the button refuses to pretend they are. */
  const willDelete = deleting ? nDel + nRun + nEnd + nPurge : nDel;
  const willEnd = deleting ? nSeries : nRun + nEnd + nSeries;

  // A selection of nothing but already-ended classes moves nothing under "End
  // them" — they have already ended. The button has to say so and stay dead
  // rather than offer an empty label over an action with no effect; the line
  // below points at the radio that WOULD do something.
  const nothingMoves = willDelete === 0 && willEnd === 0;

  const actionLabel = (() => {
    if (nothingMoves) return "Nothing to remove";
    if (deleting)
      return willEnd
        ? `Delete ${willDelete} · end ${willEnd}`
        : `Delete ${willDelete} for good`;
    const bits: string[] = [];
    if (willDelete) bits.push(`Delete ${willDelete}`);
    if (willEnd) bits.push(`${willDelete ? "end" : "End"} ${willEnd}`);
    return bits.join(" · ");
  })();

  /** "Remove 12 classes and 3 private slots" — two kinds, counted apart. */
  const title = (() => {
    const bits: string[] = [];
    if (classIds.length) bits.push(`${classIds.length} ${plural(classIds.length, "class")}`);
    if (seriesIds.length)
      bits.push(`${seriesIds.length} private ${plural(seriesIds.length, "slot", "slots")}`);
    return `Remove ${bits.join(" and ")}`;
  })();

  // What actually happens, in the founder's units — hours off a coach's
  // calendar, minutes back on a family's account — rather than a row count. One
  // short line per bucket that has anything in it; most selections produce two
  // or three. This is the five paragraphs of opt-in copy, turned back into what
  // they always were: a report.
  const happenings = useMemo(() => {
    if (!plan) return [];
    const c = plan.purgeCost;
    const s = plan.series.cost;
    const out: string[] = [];

    if (nDel > 0)
      out.push(
        `${count(nDel, "stopped class", "stopped classes")} ${nDel === 1 ? "is" : "are"} deleted outright — ${nDel === 1 ? "it has" : "they have"} already stopped and hold nothing live, so there is no history to keep` +
          (c.unmarked > 0
            ? `, though ${count(c.unmarked, "booking")} on sessions that came and went with no register marked go too`
            : "") +
          `. Nobody is messaged.`
      );

    if (nRun > 0)
      out.push(
        deleting
          ? `${count(nRun, "running class", "running classes")} nobody has booked ${nRun === 1 ? "is" : "are"} deleted` +
            (c.runningSessions > 0
              ? `, taking ${count(c.runningSessions, "upcoming session")} off the schedule and off ${nRun === 1 ? "its coach's" : "their coaches'"} calendars`
              : "") +
            (c.runningUnmarked > 0
              ? `, along with ${count(c.runningUnmarked, "unmarked booking")}`
              : "") +
            `. A school class fills its register in the hall, so an empty one can be mid-term.`
          : `${count(nRun, "running class", "running classes")} nobody has booked ${nRun === 1 ? "ends" : "end"}` +
            (c.runningSessions > 0
              ? ` — ${count(c.runningSessions, "upcoming session")} come off ${nRun === 1 ? "its coach's" : "their coaches'"} calendars`
              : "") +
            `. No parent is messaged; nobody had booked a place.`
      );

    if (nEnd > 0)
      out.push(
        deleting
          ? `${count(nEnd, "running class", "running classes")} people hold places in ${nEnd === 1 ? "is" : "are"} cancelled, then deleted with every register ever marked on ${nEnd === 1 ? "it" : "them"}.`
          : `${count(nEnd, "running class", "running classes")} people hold places in ${nEnd === 1 ? "ends" : "end"} — upcoming sessions are cancelled, past ones stay in the history, and you can restore ${nEnd === 1 ? "it" : "them"}.`
      );

    if (nPurge > 0)
      out.push(
        deleting
          ? (c.liveBookings > 0
              ? `${count(c.liveBookings, "place")} on ${c.liveBookings === 1 ? "an hour" : "hours"} still ahead of us ${c.liveBookings === 1 ? "is" : "are"} cancelled first and those families are told, then `
              : "") +
            `${count(nPurge, "already-ended class", "already-ended classes")} go for good, with ${count(c.sessions, "session")} and ${count(c.bookings, "booking")} of history.`
          : `${count(nPurge, "already-ended class", "already-ended classes")} stay exactly as ${nPurge === 1 ? "it is" : "they are"} — ${nPurge === 1 ? "it has" : "they have"} already ended, so ending ${nPurge === 1 ? "it" : "them"} again does nothing.`
      );

    if (nSeries > 0)
      out.push(
        `${count(nSeries, "weekly private slot")} stop putting new weeks on the calendar` +
          (s.futureSessions > 0
            ? ` — ${count(s.futureSessions, "session")} already booked in ${s.futureSessions === 1 ? "is" : "are"} cancelled` +
              (s.minutesReturned > 0
                ? ` and ${count(s.minutesReturned, "minute")} go back to ${count(s.families, "family", "families")} in full, including any week inside the 24-hour window a family cancelling would forfeit`
                : "")
            : "") +
          `. Setting a slot up again is a new booking, not an undo.`
      );

    if (nEnd > 0 || nSeries > 0 || (deleting && nPurge > 0 && c.liveBookings > 0))
      out.push(
        `Everyone booked gets one message each — one, however many classes and slots go.`
      );

    return out;
  }, [plan, deleting, nDel, nRun, nEnd, nPurge, nSeries]);

  // Two deliberate acts before anything irreversible: the radio is not the
  // default, and then the button asks again. Only when there is genuinely
  // history to lose — a delete that destroys nothing does not need ceremony.
  const destroysHistory =
    deleting &&
    ((plan?.purgeCost.bookings ?? 0) > 0 ||
      (plan?.purgeCost.sessions ?? 0) > 0 ||
      nEnd > 0);

  return (
    <Sheet open onClose={onClose} title={title}>
      <div className="space-y-4">
        {!plan && !error && (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        )}

        {plan && (
          <>
            {/* The one decision. Red only on the branch that earns it — when
                every card was red, none of them read as a warning. */}
            {choiceMatters && (
              <div
                className={`space-y-3 rounded-[12px] border p-4 ${
                  deleting ? "border-err" : "border-line"
                }`}
              >
                <label className="flex gap-3">
                  <Radio
                    className="mt-1 shrink-0"
                    name="removeMode"
                    checked={!deleting}
                    onChange={() => setMode("end")}
                  />
                  <span>
                    <span className="block text-sm font-medium">End them</span>
                    <span className="block text-sm text-fg-2">
                      Everything comes off the schedule and everyone booked is told. The
                      classes stay on the list under “Ended” with their attendance intact —
                      and you can restore any of them.
                    </span>
                  </span>
                </label>
                <label className="flex gap-3">
                  <Radio
                    className="mt-1 shrink-0"
                    name="removeMode"
                    checked={deleting}
                    onChange={() => setMode("delete")}
                  />
                  <span>
                    <span className="block text-sm font-medium">Delete them completely</span>
                    <span className="block text-sm text-fg-2">
                      Cancels and messages exactly the same, then removes the classes and
                      every register ever marked on them. Can’t be undone.
                    </span>
                  </span>
                </label>
              </div>
            )}

            {/* The five opt-in paragraphs, turned back into the report they
                always were. Nothing here is a control. */}
            {happenings.length > 0 && (
              <div className="space-y-2">
                <p className="label">What happens</p>
                <ul className="space-y-1.5">
                  {happenings.map((line, i) => (
                    <li key={i} className="flex gap-2 text-sm text-fg-2">
                      <span aria-hidden className="select-none">
                        ·
                      </span>
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Picked but unactionable — a class that has gone since the page
                rendered, or a slot already retired. Said out loud, because a
                selection that quietly shrinks is how a founder ends up believing
                something was removed that wasn't. */}
            {(nUnsupported > 0 || plan.series.missing.length > 0) && (
              <p className="text-sm text-fg-2">
                {nUnsupported + plan.series.missing.length} of the things you picked
                {nUnsupported + plan.series.missing.length === 1 ? " is" : " are"} no longer
                there. Close this and refresh the list.
              </p>
            )}

            <div className="space-y-2">
              {/* A disabled button explains nothing, so whenever it is dead
                  this says why — and, when there is a way forward, where. */}
              {nothingMoves && (
                <p id="bulk-remove-why" className="text-sm text-fg-2">
                  {nActionable === 0
                    ? "There is nothing here to remove. Close this and refresh the list."
                    : `Everything you picked has already ended, so ending ${nPurge === 1 ? "it" : "them"} again does nothing. Choose “Delete them completely” above to remove ${nPurge === 1 ? "it" : "them"} for good.`}
                </p>
              )}
              {/* Next to the button that failed, not at the foot of a long
                  scrolling sheet — a message below the fold reads as nothing
                  having happened at all. */}
              {error && <p className="text-sm text-err">{error}</p>}
              {destroysHistory ? (
                <ConfirmAction
                  label={actionLabel}
                  confirmLabel="Delete for good"
                  keepLabel="Back"
                  prompt={
                    plan.purgeCost.bookings > 0
                      ? `This also destroys ${count(plan.purgeCost.bookings, "booking")} of attendance history. There is no undo.`
                      : "The classes and everything recorded against them go for good. There is no undo."
                  }
                  pending={pending}
                  onConfirm={run}
                />
              ) : (
                <Button
                  variant="destructive"
                  className="w-full"
                  aria-describedby={nothingMoves ? "bulk-remove-why" : undefined}
                  disabled={pending || nothingMoves}
                  onClick={run}
                >
                  {pending ? <Spinner /> : actionLabel}
                </Button>
              )}
              <Button variant="ghost" className="w-full" disabled={pending} onClick={onClose}>
                Keep everything
              </Button>
            </div>
          </>
        )}

        {/* The plan itself failed, so there are no buttons to sit beside. */}
        {error && !plan && <p className="text-sm text-err">{error}</p>}
      </div>
    </Sheet>
  );
}
