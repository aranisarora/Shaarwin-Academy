"use client";

// The bordered box a list of cards sits in — a day on the schedule, a venue on
// the timetable. Both screens drew their own, and they disagreed: 12px corners
// on one, 14px on the other, for the same box holding the same cards. They are
// one component now, at the 12px every other surface uses (--radius-card).
//
// Collapsing is optional and phone-only by design. The timetable opens one
// screen tall by collapsing every venue but the first; the schedule never
// collapses a day, because a collapsed day is a day you have to remember to
// open before you can say what is on it.

export function GroupCard({
  title,
  meta,
  collapsible = false,
  open = true,
  onToggle,
  headerAction,
  children,
}: {
  /** Left of the header — a day, a venue. Carries its own emphasis. */
  title: React.ReactNode;
  /** Right of the header: "3 classes", "2 classes · 1 private". */
  meta?: React.ReactNode;
  collapsible?: boolean;
  /** Ignored unless `collapsible`. Desktop shows the body regardless (lg:block). */
  open?: boolean;
  onToggle?: () => void;
  /** Sits outside the collapse toggle — a control that must stay reachable
   *  while the header is also a button (the timetable's per-venue All/None). */
  headerAction?: React.ReactNode;
  children: React.ReactNode;
}) {
  const header = (
    <>
      <span className="flex min-w-0 items-baseline gap-2">
        {collapsible && (
          <span
            aria-hidden
            className={`text-fg-2 transition-transform lg:rotate-90 ${open ? "rotate-90" : ""}`}
          >
            ›
          </span>
        )}
        {title}
      </span>
      {meta && <span className="shrink-0 text-sm text-fg-2">{meta}</span>}
    </>
  );

  return (
    <div className="overflow-hidden rounded-[12px] border border-line bg-surface-2">
      <div className="flex items-center border-b border-line">
        {collapsible ? (
          <button
            type="button"
            aria-expanded={open}
            onClick={onToggle}
            className="flex min-w-0 flex-1 items-baseline justify-between gap-3 px-4 py-3 text-left hover:bg-surface"
          >
            {header}
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-baseline justify-between gap-3 px-4 py-3">
            {header}
          </div>
        )}
        {headerAction}
      </div>
      {/* Collapsed is a phone state only — `lg:block` overrides it, so the
          desktop never hides a body the founder didn't ask to hide. */}
      <div className={collapsible ? `lg:block ${open ? "block" : "hidden"}` : undefined}>
        {children}
      </div>
    </div>
  );
}
