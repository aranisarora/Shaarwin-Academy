"use client";

import { useTransition } from "react";
import { exitCoachView } from "@/app/coach/preview-actions";
import { Spinner } from "@/components/ui/Spinner";

/**
 * Sticky bar shown on every /coach page while a founder is previewing a coach.
 * "Back to admin" clears the preview cookie and returns to /admin/coaches.
 */
export function CoachPreviewBanner({ coachName }: { coachName: string }) {
  const [pending, start] = useTransition();
  return (
    <div className="sticky top-0 z-40 flex items-center justify-between gap-3 bg-ember px-5 py-2 text-ivory">
      <p className="min-w-0 truncate text-sm font-semibold">
        Viewing as {coachName}
      </p>
      <button
        type="button"
        onClick={() =>
          start(async () => {
            await exitCoachView();
            // Hard navigation so the cleared cookie is re-read by the server and
            // the admin app renders fresh, rather than a cached RSC payload.
            window.location.assign("/admin/coaches");
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
