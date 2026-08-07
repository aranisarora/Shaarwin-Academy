"use client";

// Clear the whole calendar.
//
// Every other destructive control in this app works on a selection, and a
// selection can only hold what the screen renders. This is the one that does not
// ask which — it takes everything, including the one-off classes the Weekly tab
// deliberately keeps off its list and the generated weeks behind every private
// slot. So it is the one control that has to be hardest to reach by accident.
//
// Three guards, each doing a different job:
//
//   1. NOTHING DESTRUCTIVE IS RENDERED UNTIL THE PREVIEW LANDS. A mis-tap into
//      this sheet meets a paragraph of numbers, never a live button.
//   2. THE FOUNDER TYPES "WIPE". Not a checkbox — a checkbox is one tap, and one
//      tap is what we are trying to make impossible. The server checks the same
//      string, so this is not client-side theatre.
//   3. KEEP-HISTORY IS PRESELECTED. It ends everything instead of deleting it:
//      the same cancellations, the same messages, but every class can still be
//      restored. The founder has to choose the irreversible one on purpose.
//
// The copy names real costs, in the units the founder thinks in — hours off
// coaches' calendars, minutes back on families' accounts — because "343 rows"
// is not a thing anybody can weigh.

import { useEffect, useState, useTransition } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { Radio } from "@/components/ui/Checkbox";
import { Spinner } from "@/components/ui/Spinner";
import { planCalendarWipe, wipeCalendar } from "@/app/admin/schedule/actions";

const CONFIRM_WORD = "WIPE";
const n = (x: number, one: string, many = `${one}s`) => `${x} ${x === 1 ? one : many}`;

type Preview = {
  groupWeekly: number;
  groupOneOff: number;
  privateClasses: number;
  privateSeries: number;
  futureSessions: number;
  liveBookings: number;
  minutesReturned: number;
  families: number;
  coaches: number;
};

export function AdminWipeCalendarSheet({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState("");
  const [keepHistory, setKeepHistory] = useState(true);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let alive = true;
    planCalendarWipe()
      .then((r) => {
        if (!alive) return;
        if (r.ok && r.preview) setPreview(r.preview as Preview);
        else setError(r.error ?? "Couldn't read the calendar.");
      })
      .catch(() => {
        if (alive) setError("Couldn't reach the server. Nothing has changed.");
      });
    return () => {
      alive = false;
    };
  }, []);

  const totalClasses =
    (preview?.groupWeekly ?? 0) + (preview?.groupOneOff ?? 0) + (preview?.privateClasses ?? 0);
  const armed = confirm.trim().toUpperCase() === CONFIRM_WORD;

  function run() {
    setError(null);
    startTransition(async () => {
      try {
        const r = await wipeCalendar(CONFIRM_WORD, keepHistory);
        if (r.ok && r.wiped) {
          const w = r.wiped;
          const bits: string[] = [];
          bits.push(
            keepHistory
              ? `${n(w.classes, "class", "classes")} ended`
              : `${n(w.classes, "class", "classes")} cleared`
          );
          if (w.privateSeries) bits.push(`${n(w.privateSeries, "weekly private slot")} retired`);
          if (w.sessions) bits.push(`${n(w.sessions, "session")} cancelled`);
          let line = `Calendar cleared — ${bits.join(", ")}.`;
          if (w.minutesReturned)
            line += ` ${n(w.minutesReturned, "minute")} back on families' accounts.`;
          if (w.clientsMessaged || w.coachesMessaged)
            line += ` ${n(w.clientsMessaged, "family", "families")} and ${n(w.coachesMessaged, "coach", "coaches")} were each told once.`;
          else line += " Nobody was booked, so nobody needed telling.";
          onDone(line);
        } else setError(r.error ?? "Couldn't clear the calendar.");
      } catch {
        setError("Couldn't reach the server. Nothing was cleared — the calendar is as it was.");
      }
    });
  }

  return (
    <Sheet open onClose={onClose} title="Clear the whole calendar">
      <div className="space-y-4">
        {!preview && !error && (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        )}

        {preview && (
          <>
            <div className="space-y-1 rounded-[12px] border border-err p-4">
              <p className="label">This takes everything off the calendar</p>
              <p className="text-sm text-fg-2">
                {totalClasses === 0 ? (
                  <>There is nothing on the calendar to clear.</>
                ) : (
                  <>
                    {n(preview.groupWeekly, "weekly class", "weekly classes")}
                    {preview.groupOneOff > 0 && <>, {n(preview.groupOneOff, "one-off class", "one-off classes")}</>}
                    {preview.privateSeries > 0 && (
                      <>
                        {" "}
                        and {n(preview.privateSeries, "weekly private slot")} (
                        {n(preview.privateClasses, "generated week")})
                      </>
                    )}
                    . {preview.futureSessions > 0 ? (
                      <>
                        {n(preview.futureSessions, "session")} still ahead of{" "}
                        {preview.futureSessions === 1 ? "it" : "them"} come off the schedule.
                      </>
                    ) : (
                      <>Nothing is scheduled ahead of them.</>
                    )}
                  </>
                )}
              </p>
            </div>

            {/* Who pays for it, in the units he thinks in. Suppressed entirely
                when nobody is booked, so an empty calendar doesn't get a
                paragraph of zeros. */}
            {preview.liveBookings > 0 && (
              <div className="space-y-1 rounded-[12px] border border-line p-4">
                <p className="label">Who hears about it</p>
                <p className="text-sm text-fg-2">
                  {n(preview.families, "family", "families")} and{" "}
                  {n(preview.coaches, "coach", "coaches")} get one message each — one, however
                  much of the calendar goes.{" "}
                  {preview.minutesReturned > 0 && (
                    <>
                      {n(preview.minutesReturned, "private minute")} go back in full, including any
                      week inside the 24-hour window a family cancelling would forfeit.{" "}
                    </>
                  )}
                  Group allowances and trial credits are handed back too.
                </p>
              </div>
            )}

            {totalClasses > 0 && (
              <div className="space-y-2 rounded-[12px] border border-line p-4">
                <p className="label">What happens to the classes themselves</p>
                <label className="flex gap-3">
                  <Radio
                    className="mt-1 shrink-0"
                    name="wipeMode"
                    checked={keepHistory}
                    onChange={() => setKeepHistory(true)}
                  />
                  <span>
                    <span className="block text-sm font-medium">
                      End them, keep the history
                    </span>
                    <span className="block text-sm text-fg-2">
                      Everything comes off the schedule and everyone is told, but the classes stay
                      on the list under “Ended” with their attendance intact — and you can restore
                      any of them.
                    </span>
                  </span>
                </label>
                <label className="flex gap-3">
                  <Radio
                    className="mt-1 shrink-0"
                    name="wipeMode"
                    checked={!keepHistory}
                    onChange={() => setKeepHistory(false)}
                  />
                  <span>
                    <span className="block text-sm font-medium">Delete them completely</span>
                    <span className="block text-sm text-fg-2">
                      Cancels and messages exactly the same, then removes every class and all the
                      attendance ever recorded against{" "}
                      {totalClasses === 1 ? "it" : "them"}. Can’t be undone. Your venues, coaches,
                      players and families are not touched.
                    </span>
                  </span>
                </label>
              </div>
            )}

            {totalClasses > 0 && (
              <div className="space-y-2">
                <label className="block text-sm" htmlFor="wipe-confirm">
                  Type <span className="font-semibold">{CONFIRM_WORD}</span> to confirm
                </label>
                <input
                  id="wipe-confirm"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  aria-describedby="wipe-confirm-help"
                  className="w-full rounded-[8px] border border-line bg-surface px-3 py-2 text-sm"
                />
                <p id="wipe-confirm-help" className="text-sm text-fg-2">
                  We ask you to type it because there is no undo for this one.
                </p>
              </div>
            )}

            <div className="space-y-2">
              {error && <p className="text-sm text-err">{error}</p>}
              {totalClasses > 0 && (
                <Button
                  variant="destructive"
                  className="w-full"
                  disabled={pending || !armed}
                  onClick={run}
                >
                  {pending ? (
                    <Spinner />
                  ) : keepHistory ? (
                    `End all ${totalClasses}`
                  ) : (
                    `Delete all ${totalClasses}`
                  )}
                </Button>
              )}
              <Button variant="ghost" className="w-full" disabled={pending} onClick={onClose}>
                Keep my calendar
              </Button>
            </div>
          </>
        )}

        {error && !preview && <p className="text-sm text-err">{error}</p>}
      </div>
    </Sheet>
  );
}
