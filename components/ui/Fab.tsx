"use client";

// Floating action button: the mobile home for a screen's one primary "add"
// action (Add a one-time class, Create a class). Sits bottom-right above the
// bottom tab bar and clear of the safe-area inset; hidden on ≥1024px where the
// full-width/header button is fine with a mouse.

export function Fab({
  onClick,
  label,
}: {
  onClick: () => void;
  /** Accessible name — also the tooltip. */
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="above-tabbar pressable fixed right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-ember text-3xl leading-none text-ivory shadow-[var(--shadow-sheet)] active:bg-ember-2 lg:hidden"
    >
      <span aria-hidden className="-mt-0.5">
        +
      </span>
    </button>
  );
}
