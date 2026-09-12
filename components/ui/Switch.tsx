"use client";

// The on/off toggle: notification preferences, and the "do you have a table?"
// question in the private booking wizard. A button with role="switch" rather
// than a styled checkbox, so the knob can animate and the hit area stays a
// comfortable size on mobile.

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Accessible name. Omit only when the switch sits inside a <label>. */
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`hit-slop relative h-7 w-12 shrink-0 cursor-pointer rounded-full transition-colors disabled:pointer-events-none disabled:opacity-50 ${
        checked ? "bg-ember" : "bg-line"
      }`}
    >
      {/* The knob slides on a transform, not on `left`. Animating `left` relayouts
          the track on every frame; a translate rides the compositor. hit-slop
          buys back the 8px the 28px-tall track is short of a 44px target. */}
      <span
        className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-ivory transition-transform duration-150 ease-out motion-reduce:transition-none ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}
