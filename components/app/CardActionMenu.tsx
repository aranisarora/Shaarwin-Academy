"use client";

// What you can do to the thing you are holding.
//
// Press-and-hold already meant something on the timetable — it started a
// selection — and that is worth keeping, because clearing a term's classes is a
// bulk job. But it was the only thing a hold could do, so the two other things
// the founder wants from a card he is already touching had nowhere to live: a
// second copy of it, and the editor he can also reach by tapping.
//
// Deliberately NOT here: move and cancel. Both already exist in the session
// sheet, and both are asked there with a scope step first — "just this one, or
// every week?" A one-tap version on a card he is holding would either duplicate
// that question or skip it, and skipping it is how a whole term gets cancelled
// by a thumb.

import { Sheet } from "@/components/ui/Sheet";

export type CardAction = {
  label: string;
  /** The consequence, when the label alone doesn't carry it. */
  hint?: string;
  onSelect: () => void;
  destructive?: boolean;
};

export function CardActionMenu({
  open,
  title,
  actions,
  onClose,
}: {
  open: boolean;
  /** What is being acted on — "Mon 6:30 pm · Mantri Espana". */
  title: string;
  actions: CardAction[];
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <ul className="space-y-2">
        {actions.map((a) => (
          <li key={a.label}>
            <button
              type="button"
              onClick={() => {
                onClose();
                a.onSelect();
              }}
              className={`pressable flex min-h-12 w-full flex-col justify-center rounded-[8px] border px-4 py-2 text-left ${
                a.destructive
                  ? "border-err text-err hover:bg-surface"
                  : "border-line hover:border-ember"
              }`}
            >
              <span className="font-medium">{a.label}</span>
              {a.hint && <span className="text-sm text-fg-2">{a.hint}</span>}
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
