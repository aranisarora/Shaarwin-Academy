import { forwardRef, useId } from "react";

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string;
  hint?: string;
};

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  function Select({ label, hint, className = "", id, children, ...props }, ref) {
    const autoId = useId();
    const selectId = id ?? autoId;
    const hintId = `${selectId}-hint`;
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={selectId} className="label">
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          // The hint was a loose <p> sitting under the control and wired to
          // nothing, so every explanation in the admin was invisible to a
          // screen reader while taking up two lines for everyone else.
          aria-describedby={hint ? hintId : undefined}
          className={`min-h-11 rounded-[8px] border border-line bg-surface-2 px-3 text-base text-fg ${className}`}
          {...props}
        >
          {children}
        </select>
        {hint && (
          <p id={hintId} className="text-sm text-fg-2">
            {hint}
          </p>
        )}
      </div>
    );
  }
);
