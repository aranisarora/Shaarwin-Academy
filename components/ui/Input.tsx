import { forwardRef, useId } from "react";

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  hint?: string;
  error?: string;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, className = "", id, ...props },
  ref
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={inputId} className="label">
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        className={`min-h-11 rounded-[8px] border bg-surface-2 px-3.5 text-base text-fg placeholder:text-fg-2 ${
          error ? "border-err" : "border-line"
        } ${className}`}
        {...props}
      />
      {error ? (
        <p className="text-sm text-err">{error}</p>
      ) : hint ? (
        <p className="text-sm text-fg-2">{hint}</p>
      ) : null}
    </div>
  );
});
