// The bordered box a list of cards sits in — a day on the schedule. It never
// collapses: a collapsed day is a day you have to remember to open before you
// can say what is on it.

export function GroupCard({
  title,
  meta,
  children,
}: {
  /** Left of the header — a day. Carries its own emphasis. */
  title: React.ReactNode;
  /** Right of the header: "3 classes". */
  meta?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-[12px] border border-line bg-surface-2">
      <div className="flex min-w-0 items-baseline justify-between gap-3 border-b border-line px-4 py-3">
        <span className="flex min-w-0 items-baseline gap-2">{title}</span>
        {meta && <span className="shrink-0 text-sm text-fg-2">{meta}</span>}
      </div>
      {children}
    </div>
  );
}
