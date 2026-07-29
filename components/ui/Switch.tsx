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
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
        checked ? "bg-ember" : "bg-line"
      }`}
    >
      <span
        className={`absolute top-1 h-5 w-5 rounded-full bg-ivory transition-all ${
          checked ? "left-6" : "left-1"
        }`}
      />
    </button>
  );
}
