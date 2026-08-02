"use client";

// Confirm step for clearing a selection of weekly classes.
//
// "Delete" means three different things in this domain and the founder
// shouldn't have to hold that in his head, so the server buckets the selection
// and this sheet names each number:
//
//   • no booking history      → deleted outright, nobody is told
//   • running, people on it   → can only be ENDED (they're told, history stays)
//   • already ended, has history → deleting it destroys that history
//
// The first is the default and needs one tap. The other two are opt-in
// checkboxes, unticked, because each costs something the founder can't undo.
// Nothing is destroyed until the button at the bottom is tapped.

import { useEffect, useState, useTransition } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Spinner } from "@/components/ui/Spinner";
import { bulkRemoveClasses, planClassRemoval } from "@/app/admin/schedule/actions";

const plural = (n: number, one: string, many = `${one}es`) => (n === 1 ? one : many);

/** "3 classes deleted · 2 ended — everyone booked has been told." */
function resultLine(deleted: number, ended: number, purged: number, kept: number): string {
  const parts: string[] = [];
  if (deleted) parts.push(`${deleted} ${plural(deleted, "class")} deleted`);
  if (purged) parts.push(`${purged} ended ${plural(purged, "class")} deleted with ${purged === 1 ? "its" : "their"} history`);
  if (ended) parts.push(`${ended} ended`);
  if (!parts.length) return "Nothing changed.";
  let line = parts.join(" · ") + ".";
  if (ended) line += " Everyone booked on them has been told.";
  if (kept) line += ` ${kept} ${plural(kept, "was", "were")} left alone.`;
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
    endable: string[];
    purgeable: string[];
    purgeCost: { sessions: number; bookings: number };
  };
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // The two destructive extras are opt-in and independent — neither is ticked
  // by default, so the safe deletes are always one tap and nothing else moves.
  const [endBooked, setEndBooked] = useState(false);
  const [purgeEnded, setPurgeEnded] = useState(false);

  useEffect(() => {
    let alive = true;
    planClassRemoval(classIds).then((r) => {
      if (!alive) return;
      if (r.ok)
        setPlan({
          deletable: r.deletable ?? [],
          endable: r.endable ?? [],
          purgeable: r.purgeable ?? [],
          purgeCost: r.purgeCost ?? { sessions: 0, bookings: 0 },
        });
      else setError(r.error ?? "Couldn't check those classes.");
    });
    return () => {
      alive = false;
    };
  }, [classIds]);

  function run() {
    startTransition(async () => {
      const r = await bulkRemoveClasses(classIds, { endBooked, purgeEnded });
      if (r.ok) onDone(resultLine(r.deleted ?? 0, r.ended ?? 0, r.purged ?? 0, r.kept ?? 0));
      else setError(r.error ?? "Couldn't remove those classes.");
    });
  }

  const nDel = plan?.deletable.length ?? 0;
  const nEnd = plan?.endable.length ?? 0;
  const nPurge = plan?.purgeable.length ?? 0;
  const willRemove = nDel + (purgeEnded ? nPurge : 0);
  const willEnd = endBooked ? nEnd : 0;

  /** "Delete 4 · end 2" — the button says everything that's ticked. */
  const actionLabel = (() => {
    const bits: string[] = [];
    if (willRemove) bits.push(`Delete ${willRemove}`);
    if (willEnd) bits.push(`end ${willEnd}`);
    return bits.length ? bits.join(" · ") : "Nothing selected to remove";
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
            {nDel > 0 && (
              <div className="space-y-1 rounded-[12px] border border-line p-4">
                <p className="label">
                  {nDel} with no bookings — {plural(nDel, "it", "they")} can go
                </p>
                <p className="text-sm text-fg-2">
                  {nDel === 1 ? "This class is" : `These ${nDel} classes are`} deleted for good,
                  along with the sessions nobody took. Nobody is messaged.
                </p>
              </div>
            )}

            {nEnd > 0 && (
              <label className="flex gap-3 rounded-[12px] border border-line p-4">
                <Checkbox
                  size="md"
                  className="mt-0.5 shrink-0"
                  checked={endBooked}
                  onChange={(e) => setEndBooked(e.target.checked)}
                />
                <span className="space-y-1">
                  <span className="label block">
                    Also end {nEnd} running {plural(nEnd, "class", "classes")} people are on
                  </span>
                  <span className="block text-sm text-fg-2">
                    Upcoming sessions are cancelled and everyone booked gets one message —
                    one, however many classes go. Past sessions stay in the history, and you
                    can restore an ended class later.
                  </span>
                </span>
              </label>
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

            {nDel === 0 && nEnd === 0 && nPurge === 0 && (
              <p className="text-sm text-fg-2">Nothing selected.</p>
            )}

            <div className="space-y-2">
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

        {error && <p className="text-sm text-err">{error}</p>}
      </div>
    </Sheet>
  );
}
