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

  return (
    <div className="flex items-center justify-between gap-3 rounded-[12px] border border-line bg-surface-2 px-4 py-3">
      <div>
        <p className="font-medium">{coachName}</p>
        <p className="tnum text-sm text-fg-2">
          {range}
          {reason ? ` · ${reason}` : ""}
        </p>
      </div>
      <div className="flex gap-2">
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
              if (r.ok) setDone("approved — overlapping sessions sent to the engine");
            })
          }
        >
          {pending ? <Spinner /> : "Approve"}
        </Button>
      </div>
    </div>
  );
}
