import { forwardRef, useId } from "react";

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string;
  hint?: string;
};

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  function Select({ label, hint, className = "", id, children, ...props }, ref) {
    const autoId = useId();
    const selectId = id ?? autoId;
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
          className={`min-h-11 rounded-[8px] border border-line bg-surface-2 px-3 text-base text-fg ${className}`}
          {...props}
        >
          {children}
        </select>
        {hint && <p className="text-sm text-fg-2">{hint}</p>}
      </div>
    );
  }
);
