// Native checkbox and radio, tinted with the ember token. Thin on purpose: the
// browser controls already behave correctly on every platform, so these exist
// to keep the accent colour and box size in one place rather than restated at
// each call site (where one copy had drifted to a hardcoded hex fallback).
//
// Size is a prop, not a className override: `h-4` and `h-5` are the same
// Tailwind layer, so the winner would depend on stylesheet order rather than on
// what the caller wrote. className stays free for alignment (mt-0.5 to sit a
// control against the first line of a wrapping label).

// `size` is omitted from the native attributes before being redeclared: the DOM
// one is a number (and meaningless for a checkbox), so intersecting rather than
// replacing it would collapse the prop to `never`.
type ControlProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "size"> & {
  /** "sm" (default) is the 16px box used in dense sheets; "md" is 20px. */
  size?: "sm" | "md";
};

const boxes = { sm: "h-4 w-4", md: "h-5 w-5" } as const;

export function Checkbox({ size = "sm", className = "", ...props }: ControlProps) {
  return (
    <input
      type="checkbox"
      className={`${boxes[size]} accent-[var(--ember)] ${className}`}
      {...props}
    />
  );
}

export function Radio({ size = "sm", className = "", ...props }: ControlProps) {
  return (
    <input
      type="radio"
      className={`${boxes[size]} accent-[var(--ember)] ${className}`}
      {...props}
    />
  );
}
