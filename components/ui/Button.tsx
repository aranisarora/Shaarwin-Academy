import { forwardRef } from "react";
import Link from "next/link";

type Variant = "primary" | "ghost" | "destructive";
type Size = "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 rounded-[8px] font-semibold transition-colors duration-200 disabled:opacity-50 disabled:pointer-events-none select-none";

const variants: Record<Variant, string> = {
  primary: "bg-ember text-ivory hover:bg-ember-2 active:bg-ember-2",
  ghost: "border border-line text-fg hover:border-ember hover:text-ember bg-transparent",
  destructive: "bg-err text-ivory hover:opacity-90",
};

const sizes: Record<Size, string> = {
  md: "min-h-11 px-5 text-base", // ≥44px touch target
  lg: "min-h-13 px-7 text-base",
};

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button({ variant = "primary", size = "md", className = "", ...props }, ref) {
    return (
      <button
        ref={ref}
        className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
        {...props}
      />
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
