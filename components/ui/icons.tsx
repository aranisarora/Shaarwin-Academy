// Inline line icons for the studio shell — no icon dependency. Each is 24px,
// 1.5px stroke, `currentColor`, so they inherit the nav's `fg-2`/`ember`
// colours and match the ivory line aesthetic. Keep them boring and legible: a
// coach in his 40s reads these at a glance.

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

/** Schedule — a calendar. */
export function CalendarIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <rect x="3.5" y="5" width="17" height="16" rx="2" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" />
    </svg>
  );
}

/** WhatsApp — the speech bubble with the handset in it. */
export function WhatsAppIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M12 3.5a8.5 8.5 0 0 0-7.3 12.9L3.5 20.5l4.2-1.1A8.5 8.5 0 1 0 12 3.5Z" />
      <path d="M9.2 8.6c.2-.4.5-.4.8-.4h.5c.2 0 .4.1.5.4l.7 1.6c.1.2 0 .4-.1.6l-.5.6c.6 1.1 1.5 2 2.6 2.6l.6-.5c.2-.2.4-.2.6-.1l1.6.7c.3.1.4.3.4.5v.6c0 .4-.2.7-.5.9-.6.4-1.3.5-2 .3a8 8 0 0 1-5-5c-.2-.7-.1-1.4.3-2Z" />
    </svg>
  );
}
