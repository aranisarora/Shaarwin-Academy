/** Hairline with a centred 6px ember dot. */
export function SectionDivider({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-4 ${className}`} aria-hidden>
      <span className="h-px flex-1 bg-line" />
      <span className="h-1.5 w-1.5 rounded-full bg-ember" />
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}
