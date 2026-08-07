"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { decideTimeOff } from "@/app/admin/coaches/actions";

export function TimeOffDecision({
  id,
  coachName,
  range,
  reason,
}: {
  id: string;
  coachName: string;
  range: string;
  reason: string | null;
}) {
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (done) {
    return (
      <div className="rounded-[12px] border border-line bg-surface-2 px-4 py-3 text-sm text-fg-2">
        {coachName} · {range} — {done}
      </div>
    );
  }

  // Stacked, not side-by-side: at 390px the name and dates were squeezed into
  // ~150px beside two buttons, so the dates he is deciding on wrapped to shreds.
  return (
    <div className="rounded-[12px] border border-line bg-surface-2 px-4 py-3">
      <div>
        <p className="font-medium">{coachName} wants time off</p>
        <p className="tnum text-sm text-fg-2">
          {range}
          {reason ? ` · ${reason}` : ""}
        </p>
      </div>
      <div className="mt-3 flex gap-2">
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const r = await decideTimeOff(id, false);
              if (r.ok) setDone("rejected");
            })
          }
        >
          Reject
        </Button>
        <Button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const r = await decideTimeOff(id, true);
              // Plain English: "sent to the engine" meant nothing to him, and
              // the sentence has to say what happens to the classes he just
              // took a coach off.
              if (r.ok)
                setDone("approved — we're finding cover. Anything left over shows on Today.");
            })
          }
        >
          {pending ? <Spinner /> : "Approve"}
        </Button>
      </div>
    </div>
  );
}
