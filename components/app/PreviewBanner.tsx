"use client";

// Sticky bar shown on every page of an app a founder is only visiting. One
// component for both previews — coach and school — because there is nothing
// role-shaped about it: it says whose app this is and offers the way back.
//
// `onExit` is the server action that clears that preview's cookie. Passing it in
// rather than importing one here is what keeps this shared: the two cookies are
// deliberately separate (leaving a coach must not silently drop you out of a
// school), and this component never needs to know which it is holding.

import { useTransition } from "react";
import { Spinner } from "@/components/ui/Spinner";

export function PreviewBanner({
  who,
  onExit,
  backTo,
}: {
  /** Whose app this is — a coach's name, or a campus label. */
  who: string;
  onExit: () => Promise<void>;
  backTo: string;
}) {
  const [pending, start] = useTransition();
  return (
    <div className="sticky top-0 z-40 flex items-center justify-between gap-3 bg-ember px-5 py-2 text-ivory">
      <p className="min-w-0 truncate text-sm font-semibold">Viewing as {who}</p>
      <button
        type="button"
        onClick={() =>
          start(async () => {
            await onExit();
            // Hard navigation so the cleared cookie is re-read by the server and
            // the admin app renders fresh, rather than a cached RSC payload.
            window.location.assign(backTo);
          })
        }
        disabled={pending}
        className="shrink-0 rounded-[8px] border border-ivory/40 px-3 py-1 text-sm font-semibold hover:bg-ivory/10 disabled:opacity-60"
      >
        {pending ? <Spinner /> : "Back to admin"}
      </button>
    </div>
  );
}
