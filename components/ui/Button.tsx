import { forwardRef } from "react";
import Link from "next/link";
import { Spinner } from "@/components/ui/Spinner";

type Variant = "primary" | "ghost" | "destructive";
type Size = "md" | "lg";

// `pressable` carries the transition (~120ms, transform + colour) as well as the
// squeeze on :active. It replaces the old `transition-colors duration-200` —
// 200ms is fine for a mouse drifting over a button and reads as lag under a
// thumb, and only `primary` ever had a pressed state to begin with.
const base =
  "pressable inline-flex items-center justify-center gap-2 rounded-[8px] font-semibold disabled:opacity-50 disabled:pointer-events-none select-none";

const variants: Record<Variant, string> = {
  primary: "bg-ember text-ivory hover:bg-ember-2 active:bg-ember-2",
  ghost:
    "border border-line text-fg hover:border-ember hover:text-ember active:border-ember active:text-ember bg-transparent",
  destructive: "bg-err text-ivory hover:opacity-90 active:opacity-90",
};

const sizes: Record<Size, string> = {
  md: "min-h-11 px-5 text-base", // ≥44px touch target
  lg: "min-h-13 px-7 text-base",
};

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  /**
   * In flight: shows a spinner BESIDE the label and disables the button.
   *
   * The label stays. Every sheet in the admin used to write
   * `{pending ? <Spinner /> : "Save changes"}`, which throws away the one thing
   * telling the founder what he just set in motion — and collapses the button
   * to spinner-width while his thumb is still on it, so the next tap lands on
   * whatever slid underneath.
   */
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { variant = "primary", size = "md", className = "", loading = false, disabled, children, ...props },
    ref
  ) {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
        {...props}
      >
        {loading && <Spinner />}
        {children}
      </button>
    );
  }
);

type ButtonLinkProps = React.ComponentProps<typeof Link> & {
  variant?: Variant;
  size?: Size;
  className?: string;
};

export function ButtonLink({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ButtonLinkProps) {
  return (
    <Link
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    />
  );
}
