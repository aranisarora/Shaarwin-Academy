// What kind of class is this — the one definition the Today, Schedule and
// Weekly tabs all read from, so the answer can never differ between them.
//
// The founder's question is "whose class is this?", and it has exactly three
// answers: an ordinary group class, one family's private class, or a school's
// own class. That is a different axis from "is it in trouble" (red) or "is it
// happening right now" (ember), so it gets its own quiet palette:
//
//   group   — no colour at all. It is the norm; a normal week should look calm.
//   private — plum rail + plum dot
//   school  — teal rail + teal dot
//
// The colour appears in exactly two places on every card, always the same two:
// a 3px left rail, and a 6px dot immediately before the words. The words are
// always there too, so the colour is a shortcut for someone who already knows
// the app and never the only way to read it.

export type ClassKind = "group" | "private" | "school";

export function classKind(c: { isPrivate?: boolean; isSchool?: boolean }): ClassKind {
  if (c.isPrivate) return "private";
  if (c.isSchool) return "school";
  return "group";
}

/** The card's left rail. Group gets a plain border so the row still lines up. */
export const KIND_RAIL: Record<ClassKind, string> = {
  group: "border-l-line",
  private: "border-l-[3px] border-l-priv",
  school: "border-l-[3px] border-l-school",
};

const KIND_DOT: Record<ClassKind, string> = {
  group: "bg-fg-2/35",
  private: "bg-priv",
  school: "bg-school",
};

const KIND_WORD: Record<ClassKind, string> = {
  group: "Group class",
  private: "Private",
  school: "School class",
};

/**
 * The type line on a card: a coloured dot, the plain-English kind, then
 * whatever else that screen wants after it (the family, the coach, how full it
 * is). `detail` parts are joined with the same middot everywhere.
 */
export function ClassTypeLine({
  kind,
  detail = [],
  className = "",
}: {
  kind: ClassKind;
  /** Extra facts after the kind — nulls are dropped, so callers can pass freely. */
  detail?: (string | React.ReactNode | null | undefined)[];
  className?: string;
}) {
  const parts = detail.filter((d) => d !== null && d !== undefined && d !== "");
  return (
    <span className={`flex items-center gap-1.5 text-xs text-fg-2 ${className}`}>
      <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${KIND_DOT[kind]}`} />
      <span className="min-w-0 truncate">
        {KIND_WORD[kind]}
        {parts.map((p, i) => (
          <span key={i}> · {p}</span>
        ))}
      </span>
    </span>
  );
}
