// "Mon 11 Aug · Today" — the day label, and the one place that decides today
// is worth saying out loud.
//
// Two sizes because the schedule shows this twice: as the header of a day card
// on the phone, and as a small sub-heading inside a coach's lane on the
// desktop. They had drifted into two spellings of the same conditional.

export function DayHeading({
  label,
  isToday,
  size = "card",
}: {
  label: string;
  isToday: boolean;
  /** `card` heads a GroupCard; `sub` sits inside one. */
  size?: "card" | "sub";
}) {
  const tone = isToday ? "text-ember" : size === "card" ? "text-fg" : "text-fg-2";
  const type = size === "card" ? "font-semibold" : "text-xs font-medium";
  return (
    <span className={`${type} ${tone}`}>
      {label}
      {isToday ? " · Today" : ""}
    </span>
  );
}
