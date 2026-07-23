// Inline line icons for the app shells — no icon dependency. Each is 24px,
// 1.5px stroke, `currentColor`, so they inherit the nav's `fg-2`/`ember`
// colours and match the ivory line aesthetic better than the old dingbats.
// Keep them boring and legible: a coach in his 40s reads these at a glance.

type IconProps = { className?: string };

function base(className?: string) {
  return {
    width: 24,
    height: 24,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className,
  };
}

/** Today — a house. */
export function HomeIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />
      <path d="M9.5 21v-6h5v6" />
    </svg>
  );
}

/** Schedule — a calendar. */
export function CalendarIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <rect x="3.5" y="5" width="17" height="16" rx="2" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" />
    </svg>
  );
}

/** Weekly classes — a repeat loop. */
export function RepeatIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M17 3.5 20.5 7 17 10.5" />
      <path d="M20.5 7H7a3.5 3.5 0 0 0-3.5 3.5V12" />
      <path d="M7 20.5 3.5 17 7 13.5" />
      <path d="M3.5 17H17a3.5 3.5 0 0 0 3.5-3.5V12" />
    </svg>
  );
}

/** Players — two people. */
export function PeopleIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <circle cx="9" cy="8" r="3.25" />
      <path d="M3.5 20v-1a5.5 5.5 0 0 1 11 0v1" />
      <path d="M16 5.2a3.25 3.25 0 0 1 0 5.6" />
      <path d="M17.5 14.2A5.5 5.5 0 0 1 20.5 19v1" />
    </svg>
  );
}

/** Coaches — a person with a check (approved / on the roster). */
export function CoachIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <circle cx="10" cy="8" r="3.25" />
      <path d="M4 20v-1a6 6 0 0 1 9.5-4.85" />
      <path d="m15 18 2 2 4-4" />
    </svg>
  );
}

/** Skills — a star. */
export function StarIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="m12 3.5 2.6 5.27 5.82.85-4.21 4.1.99 5.79L12 16.77 6.8 19.5l.99-5.79-4.21-4.1 5.82-.85Z" />
    </svg>
  );
}

/** Venues — a map pin. */
export function MapPinIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M12 21s6.5-5.2 6.5-10a6.5 6.5 0 0 0-13 0c0 4.8 6.5 10 6.5 10Z" />
      <circle cx="12" cy="11" r="2.25" />
    </svg>
  );
}

/** Billing — a receipt. */
export function ReceiptIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M5.5 3.5h13v17l-2.2-1.4-2.15 1.4L12 20.6l-2.15 1.3-2.15-1.4L5.5 21z" />
      <path d="M9 8h6M9 12h6" />
    </svg>
  );
}

/** Settings — a gear. */
export function GearIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <circle cx="12" cy="12" r="2.75" />
      <path d="M12 3v2.5M12 18.5V21M4.2 7.5l2.2 1.25M17.6 15.25l2.2 1.25M4.2 16.5l2.2-1.25M17.6 8.75l2.2-1.25" />
    </svg>
  );
}

/** More — three dots. */
export function DotsIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <circle cx="5.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}
