// "Mon 14 Sep · Today" — the day label, and the one place that decides today
// is worth saying out loud.

export function DayHeading({ label, isToday }: { label: string; isToday: boolean }) {
  return (
    <span className={`font-semibold ${isToday ? "text-ember" : "text-fg"}`}>
      {label}
      {isToday ? " · Today" : ""}
    </span>
  );
}
