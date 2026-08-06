"use client";

// Confirm step for clearing a selection of weekly classes.
//
// "Delete" means four different things in this domain and the founder shouldn't
// have to hold that in his head, so the server buckets the selection and this
// sheet names each number:
//
//   • stopped, nothing on it     → deleted outright, nobody is told
//   • running, nobody booked yet → deleted only if he ticks for it; no parent is
//                                  told, but the coaches rostered on it are
//   • running, people on it      → ended, or ended AND deleted (told either way)
//   • already ended, has history → deleting it destroys that history
//
// The first is the default and needs one tap. The rest are opt-in, because each
// costs something he can't undo. Nothing is destroyed until the button at the
// bottom is tapped.
//
// The third bucket used to offer only "end", which meant a founder who selected
// every class and tapped Remove could land on a disabled button reading
// "Nothing selected to remove" — the delete he asked for was two more
// operations away and the screen never said so. He is the admin: the option to
// delete outright belongs here, next to the one that spares the history.
//
// The second bucket is newer and it is here for the opposite reason. It used to
// be folded into the first, so "Select all 47" on prod offered to delete 46
// classes under a heading saying they held nothing — 36 of which were still
// running that term, 28 of those school classes, empty only because a school
// register is marked in the hall rather than booked online. The line below is
// suppressed entirely when there are none of them, so clearing husks stays one
// tap with no new ceremony; when there are, it is unticked and it names them.

import { useEffect, useState, useTransition } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { Checkbox, Radio } from "@/components/ui/Checkbox";
import { Spinner } from "@/components/ui/Spinner";
import { bulkRemoveClasses, planClassRemoval } from "@/app/admin/schedule/actions";

const plural = (n: number, one: string, many = `${one}es`) => (n === 1 ? one : many);

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
  warning?: string
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
  if (!parts.length && !warning) return "Nothing changed.";
  let line = parts.length ? parts.join(" · ") + "." : "Nothing was removed.";
  if (ended || deletedBooked) line += " Everyone booked on them has been told.";
  if (kept) line += ` ${kept} ${plural(kept, "was", "were")} left alone.`;
  if (warning) line += ` ${warning}`;
  return line;
}

export function AdminBulkRemoveSheet({
  classIds,
  onClose,
  onDone,
}: {
  classIds: string[];
  onClose: () => void;
  /** Reports the outcome line and how many classes are gone, so the list can
   * drop them from the selection and refresh. */
  onDone: (message: string) => void;
}) {
  type Plan = {
    deletable: string[];
    deletableRunning: string[];
    endable: string[];
    purgeable: string[];
    purgeCost: {
      sessions: number;
      bookings: number;
      unmarked: number;
      runningSessions: number;
      runningUnmarked: number;
    };
  };
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // The extras with a cost are opt-in — none of them is ticked by default, so
  // the safe deletes are always one tap and nothing else moves.
  const [endBooked, setEndBooked] = useState(false);
  const [purgeEnded, setPurgeEnded] = useState(false);
  const [deleteRunningEmpty, setDeleteRunningEmpty] = useState(false);
  // What to do with the classes people are booked on, once they're included.
  // "end" keeps the record; "delete" removes it too. Both message everyone.
  const [bookedMode, setBookedMode] = useState<"end" | "delete">("end");

  // A rejected server action is the one failure that used to look like nothing
  // at all: the spinner never stopped, and there was no `.catch` to say why. A
  // dropped connection on a phone is common enough that it needs its own line.
  useEffect(() => {
    let alive = true;
    planClassRemoval(classIds)
      .then((r) => {
        if (!alive) return;
        if (r.ok)
          setPlan({
            deletable: r.deletable ?? [],
            deletableRunning: r.deletableRunning ?? [],
            endable: r.endable ?? [],
            purgeable: r.purgeable ?? [],
            purgeCost: r.purgeCost ?? {
              sessions: 0,
              bookings: 0,
              unmarked: 0,
              runningSessions: 0,
              runningUnmarked: 0,
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
  }, [classIds]);

  function run() {
    const deleteBooked = endBooked && bookedMode === "delete";
    setError(null);
    startTransition(async () => {
      try {
        const r = await bulkRemoveClasses(classIds, {
          endBooked,
          purgeEnded,
          deleteBooked,
          deleteRunningEmpty,
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
              r.warning
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
  const nPurge = plan?.purgeable.length ?? 0;
  const deletingBooked = endBooked && bookedMode === "delete";
  const willRemove =
    nDel +
    (deleteRunningEmpty ? nRun : 0) +
    (purgeEnded ? nPurge : 0) +
    (deletingBooked ? nEnd : 0);
  const willEnd = endBooked && !deletingBooked ? nEnd : 0;

  /** "Delete 4 · end 2" — the button says everything that's ticked. */
  const actionLabel = (() => {
    const bits: string[] = [];
    if (willRemove) bits.push(`Delete ${willRemove}`);
    if (willEnd) bits.push(`end ${willEnd}`);
    return bits.length ? bits.join(" · ") : "Nothing ticked yet";
  })();

  return (
    <Sheet open onClose={onClose} title={`Remove ${classIds.length} ${plural(classIds.length, "class")}`}>
      <div className="space-y-4">
        {!plan && !error && (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        )}

        {plan && (
          <>
            {/* The one bucket that goes on the plain button, so its heading has
                to be exactly true twice over. It leads with "stopped", because
                that — not the absence of bookings — is what makes these safe.
                And "no bookings" was a lie for the commonest class of all: one
                whose registers were never marked, so its places sit there
                'confirmed' on sessions long past. Nothing about it is live and
                it still goes on one tap — but it is not empty, and the card
                that destroys those rows has to say how many. */}
            {nDel > 0 && (
              <div className="space-y-1 rounded-[12px] border border-line p-4">
                <p className="label">
                  {plan.purgeCost.unmarked > 0
                    ? `${nDel} stopped ${plural(nDel, "class")}, nothing live and no attendance marked — ${plural(nDel, "it", "they")} can go`
                    : `${nDel} stopped ${plural(nDel, "class")} with no bookings — ${plural(nDel, "it", "they")} can go`}
                </p>
                <p className="text-sm text-fg-2">
                  {plan.purgeCost.unmarked > 0 ? (
                    <>
                      {nDel === 1 ? "It has" : "They have"} already been ended or paused and
                      nobody holds a place in {nDel === 1 ? "it" : "them"}, so nobody is
                      messaged. {nDel === 1 ? "It goes" : "They go"} for good — and so do{" "}
                      {plan.purgeCost.unmarked}{" "}
                      {plural(plan.purgeCost.unmarked, "booking", "bookings")} on sessions that
                      came and went with no register marked.
                    </>
                  ) : (
                    <>
                      {nDel === 1 ? "This class has" : `These ${nDel} classes have`} already
                      been ended or paused and nobody is on{" "}
                      {nDel === 1 ? "it" : "them"}.{" "}
                      {nDel === 1 ? "It is" : "They are"} deleted for good, along with the
                      sessions nobody took. Nobody is messaged.
                    </>
                  )}
                </p>
              </div>
            )}

            {/* Suppressed entirely when the bucket is empty, so the ordinary
                clear-out of husks keeps its single tap. When it isn't, it is the
                line that has to stop him: 36 of these sat on prod, 28 of them
                live school classes, empty only because a school register is
                marked in the hall rather than booked online — and 261 hours of
                coaching between them. */}
            {nRun > 0 && (
              <label className="flex gap-3 rounded-[12px] border border-err p-4">
                <Checkbox
                  size="md"
                  className="mt-0.5 shrink-0"
                  checked={deleteRunningEmpty}
                  onChange={(e) => setDeleteRunningEmpty(e.target.checked)}
                />
                <span className="space-y-1">
                  <span className="label block">
                    Also delete {nRun} running {plural(nRun, "class", "classes")} nobody has
                    booked yet
                  </span>
                  <span className="block text-sm text-fg-2">
                    {nRun === 1 ? "It is" : "They are"} still on the timetable — a school
                    class fills its register in the hall, so an empty one can be mid-term.{" "}
                    {plan.purgeCost.runningSessions > 0 && (
                      <>
                        Deleting takes {plan.purgeCost.runningSessions}{" "}
                        {plural(plan.purgeCost.runningSessions, "session", "sessions")} off
                        the schedule for good, and off the calendar of every coach rostered
                        on {nRun === 1 ? "it" : "them"} — they get one message each.{" "}
                      </>
                    )}
                    Nobody has booked a place, so no parent is messaged
                    {plan.purgeCost.runningUnmarked > 0 && (
                      <>
                        {" "}
                        — but {plan.purgeCost.runningUnmarked}{" "}
                        {plural(plan.purgeCost.runningUnmarked, "booking", "bookings")} on
                        sessions that came and went with no register marked go too
                      </>
                    )}
                    . This can&apos;t be undone.
                  </span>
                </span>
              </label>
            )}

            {nEnd > 0 && (
              <div
                className={`space-y-3 rounded-[12px] border p-4 ${
                  deletingBooked ? "border-err" : "border-line"
                }`}
              >
                <label className="flex gap-3">
                  <Checkbox
                    size="md"
                    className="mt-0.5 shrink-0"
                    checked={endBooked}
                    onChange={(e) => setEndBooked(e.target.checked)}
                  />
                  <span className="space-y-1">
                    <span className="label block">
                      Also remove {nEnd} running {plural(nEnd, "class", "classes")} that hold
                      bookings
                    </span>
                    <span className="block text-sm text-fg-2">
                      Upcoming sessions are cancelled and everyone booked gets one message —
                      one, however many classes go.
                    </span>
                  </span>
                </label>

                {/* Ending and deleting both cancel the sessions and message the
                    same people; they differ only in whether the class itself
                    survives. Asking that as a second question keeps the safe
                    answer selected while making the outright delete reachable
                    in the same pass. */}
                {endBooked && (
                  <div className="space-y-2 border-t border-line pt-3 pl-8">
                    <label className="flex gap-3">
                      <Radio
                        className="mt-1 shrink-0"
                        name="bookedMode"
                        checked={bookedMode === "end"}
                        onChange={() => setBookedMode("end")}
                      />
                      <span>
                        <span className="block text-sm font-medium">End them</span>
                        <span className="block text-sm text-fg-2">
                          Past sessions stay in the history and you can restore the class
                          later. It stays on this list under “Ended”.
                        </span>
                      </span>
                    </label>
                    <label className="flex gap-3">
                      <Radio
                        className="mt-1 shrink-0"
                        name="bookedMode"
                        checked={bookedMode === "delete"}
                        onChange={() => setBookedMode("delete")}
                      />
                      <span>
                        <span className="block text-sm font-medium">
                          Delete them completely
                        </span>
                        <span className="block text-sm text-fg-2">
                          Cancels and messages exactly the same, then removes the{" "}
                          {plural(nEnd, "class", "classes")} and{" "}
                          {nEnd === 1 ? "its" : "their"} history for good. Can’t be undone.
                        </span>
                      </span>
                    </label>
                  </div>
                )}
              </div>
            )}

            {nPurge > 0 && (
              <label className="flex gap-3 rounded-[12px] border border-err p-4">
                <Checkbox
                  size="md"
                  className="mt-0.5 shrink-0"
                  checked={purgeEnded}
                  onChange={(e) => setPurgeEnded(e.target.checked)}
                />
                <span className="space-y-1">
                  <span className="label block">
                    Also delete {nPurge} already-ended {plural(nPurge, "class", "classes")} for
                    good
                  </span>
                  <span className="block text-sm text-fg-2">
                    {nPurge === 1 ? "It has" : "They have"} already been ended, so nobody is
                    messaged again — but {nPurge === 1 ? "it" : "they"} still hold{" "}
                    {plan.purgeCost.sessions}{" "}
                    {plural(plan.purgeCost.sessions, "session", "sessions")} and{" "}
                    {plan.purgeCost.bookings}{" "}
                    {plural(plan.purgeCost.bookings, "booking", "bookings")} of history, which
                    this deletes too. This can&apos;t be undone.
                  </span>
                </span>
              </label>
            )}

            {nDel === 0 && nRun === 0 && nEnd === 0 && nPurge === 0 && (
              <p className="text-sm text-fg-2">Nothing selected.</p>
            )}

            <div className="space-y-2">
              {/* The button disables itself when nothing is ticked, and a
                  disabled button explains nothing — this is the line that used
                  to be missing, when a founder who had selected every class
                  tapped Remove and met a greyed-out control with no reason. */}
              {willRemove === 0 && willEnd === 0 && (nRun > 0 || nEnd > 0 || nPurge > 0) && (
                <p className="text-sm text-fg-2">
                  Every class you picked is either still running or holds bookings or history,
                  so nothing will go until you tick one of the boxes above.
                </p>
              )}
              {/* Next to the button that failed, not at the foot of a long
                  scrolling sheet — a message below the fold reads as nothing
                  having happened at all. */}
              {error && <p className="text-sm text-err">{error}</p>}
              <Button
                variant="destructive"
                className="w-full"
                disabled={pending || (willRemove === 0 && willEnd === 0)}
                onClick={run}
              >
                {pending ? <Spinner /> : actionLabel}
              </Button>
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
