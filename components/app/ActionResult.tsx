// One success line, everywhere an admin action completes. A ✓ plus the message
// — whose text already says "…has been told on WhatsApp" wherever a
// notification fired — so the founder never wonders if he still has to message
// people himself (the way he used to on WhatsApp).

export function ActionResult({ children }: { children: React.ReactNode }) {
  return (
    // role=status so the ✓ is announced, not just drawn. These lines carry the
    // consequence ("6 booked weeks moved with it", "3 weeks need a coach") and
    // are frequently the only place it is ever stated.
    <p
      role="status"
      aria-live="polite"
      className="flex items-start gap-1.5 rounded-[12px] border border-ok bg-surface-2 px-4 py-3 text-sm text-ok"
    >
      <span aria-hidden>✓</span>
      <span>{children}</span>
    </p>
  );
}
