"use client";

// Confirm step for clearing a selection of weekly classes.
//
// "Delete" means two different things in this domain and the founder shouldn't
// have to hold that in his head: a class nobody ever booked can go for good,
// but a class with bookings can only be *ended* — its sessions cancel, everyone
// booked gets a message, and the history stays. So this sheet asks the server
// which is which before offering a button, and names both numbers in the copy.
// Nothing is destroyed until one of the buttons below is tapped.

import { useEffect, useState, useTransition } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { bulkRemoveClasses, planClassRemoval } from "@/app/admin/schedule/actions";

const plural = (n: number, one: string, many = `${one}es`) => (n === 1 ? one : many);

/** "3 classes deleted · 2 ended — everyone booked has been told." */
function resultLine(deleted: number, ended: number, kept: number): string {
  const parts: string[] = [];
  if (deleted) parts.push(`${deleted} ${plural(deleted, "class")} deleted`);
  if (ended) parts.push(`${ended} ended`);
  if (!parts.length) return "Nothing changed.";
  let line = parts.join(" · ") + ".";
  if (ended) line += " Everyone booked on them has been told.";
  if (kept) line += ` ${kept} couldn't be removed and ${plural(kept, "is", "are")} unchanged.`;
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
  const [plan, setPlan] = useState<{ deletable: string[]; booked: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let alive = true;
    planClassRemoval(classIds).then((r) => {
      if (!alive) return;
      if (r.ok) setPlan({ deletable: r.deletable ?? [], booked: r.booked ?? [] });
      else setError(r.error ?? "Couldn't check those classes.");
    });
    return () => {
      alive = false;
    };
  }, [classIds]);

  function run(endBooked: boolean) {
    startTransition(async () => {
      const r = await bulkRemoveClasses(classIds, endBooked);
      if (r.ok) onDone(resultLine(r.deleted ?? 0, r.ended ?? 0, r.kept ?? 0));
      else setError(r.error ?? "Couldn't remove those classes.");
    });
  }

  const nDel = plan?.deletable.length ?? 0;
  const nBooked = plan?.booked.length ?? 0;

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
                  {nDel} never booked — {plural(nDel, "it", "they")} can go
                </p>
                <p className="text-sm text-fg-2">
                  {nDel === 1 ? "This class is" : `These ${nDel} classes are`} deleted for good,
                  along with the upcoming sessions nobody took. Nobody is messaged.
                </p>
              </div>
            )}

            {nBooked > 0 && (
              <div className="space-y-1 rounded-[12px] border border-line p-4">
                <p className="label">{nBooked} {plural(nBooked, "has", "have")} bookings</p>
                <p className="text-sm text-fg-2">
                  Deleting {nBooked === 1 ? "it" : "them"} would take the attendance history
                  along too, so {nBooked === 1 ? "it" : "they"} can only be{" "}
                  <strong>ended</strong>: upcoming sessions are cancelled, everyone booked gets
                  one message, and past sessions stay in the history. You can restore an ended
                  class later.
                </p>
              </div>
            )}

            {nDel === 0 && nBooked === 0 && (
              <p className="text-sm text-fg-2">Nothing selected.</p>
            )}

            <div className="space-y-2">
              {nDel > 0 && nBooked === 0 && (
                <Button variant="destructive" className="w-full" disabled={pending} onClick={() => run(false)}>
                  {pending ? <Spinner /> : `Delete ${nDel} ${plural(nDel, "class")}`}
                </Button>
              )}

              {nDel > 0 && nBooked > 0 && (
                <>
                  <Button variant="destructive" className="w-full" disabled={pending} onClick={() => run(true)}>
                    {pending ? <Spinner /> : `Delete ${nDel} and end ${nBooked}`}
                  </Button>
                  <Button variant="ghost" className="w-full" disabled={pending} onClick={() => run(false)}>
                    Only delete the {nDel} never booked
                  </Button>
                </>
              )}

              {nDel === 0 && nBooked > 0 && (
                <Button variant="destructive" className="w-full" disabled={pending} onClick={() => run(true)}>
                  {pending ? <Spinner /> : `End ${nBooked} ${plural(nBooked, "class")}`}
                </Button>
              )}

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
