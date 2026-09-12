// What kind of class is this — the one definition every card reads from.
//
// The founder's question is "whose class is this?", and it has exactly three
// answers: an ordinary group class, one family's private class, or a school's
// own class. That is a different axis from "is it happening right now"
// (ember) or "is it over" (grey), so it gets signals of its own.
//
// THREE CHANNELS, NOT ONE. Print the screen in grey, or hand it to the ~8% of
// men who cannot split plum from teal at 6px, and a colour alone collapses to
// "there is a mark here". So the kind is a shape as well:
//
//   group   — three people.  No colour: it is the norm, and a normal week
//             should look calm so the exceptions stand out.
//   private — one person.    Plum.
//   school  — a building.    Teal.
//
// The glyph is the fast channel (recognised before it is read), the colour is
// the reinforcing one, and the word beside it is the one that cannot be got
// wrong. Any two can fail and the card still answers the question.
//
// WHERE KIND MAY APPEAR: the rail down the card's left edge, and the icon
// beside the words. Never a fill, never a badge — a badge on this screen means
// state, and a kind wearing a badge is a kind pretending to be a status.

import type { ClassKind } from "@/lib/schedule-view";

/**
 * The card's left rail, as a custom property rather than a border colour, so
 * the state layer (border, surface) can never overwrite it. See `.class-card`
 * in globals.css.
 */
export const KIND_RAIL: Record<ClassKind, string> = {
  group: "",
  private: "[--kind-rail:inset_3px_0_0_0_var(--priv)]",
  school: "[--kind-rail:inset_3px_0_0_0_var(--school)]",
};

/** Icon tint. Group stays in the body-text grey — it is not an exception. */
export const KIND_TINT: Record<ClassKind, string> = {
  group: "text-fg-2",
  private: "text-priv",
  school: "text-school",
};

/** One vocabulary: the only names the screen has for the three kinds. */
export const KIND_WORD: Record<ClassKind, string> = {
  group: "Group class",
  private: "Private class",
  school: "School class",
};

// Drawn on a 16px grid at 1.5 stroke so, at the 14px these render to, the
// stroke lands on whole pixels rather than greying into a smudge.
function kindIconProps(className?: string) {
  return {
    width: 14,
    height: 14,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className,
  };
}

/** The kind, as a glyph: three people, one person, or a school building. */
export function KindIcon({ kind, className = "" }: { kind: ClassKind; className?: string }) {
  const props = kindIconProps(`shrink-0 ${className}`);
  if (kind === "private") {
    // One person — one family, one player.
    return (
      <svg {...props}>
        <circle cx="8" cy="5.1" r="2.6" />
        <path d="M2.9 14.2v-.5a5.1 5.1 0 0 1 10.2 0v.5" />
      </svg>
    );
  }
  if (kind === "school") {
    // A building under a flag. Flat roof and a wide door on purpose: at 14px
    // on a phone, a pitched roof's apex rounds into a smudged arch, and four
    // horizontal-or-vertical strokes land on whole pixels.
    return (
      <svg {...props}>
        <path d="M8 1.6v2.9" />
        <path d="M8 2.1 10.9 3 8 3.9" />
        <path d="M3.2 14.4V6.6h9.6v7.8z" />
        <path d="M6.3 14.4v-3.6h3.4v3.6" />
      </svg>
    );
  }
  // Three people — the ordinary class, and the only kind that is a crowd.
  return (
    <svg {...props}>
      <circle cx="6.2" cy="5.6" r="2.3" />
      <path d="M1.7 14.2a4.5 4.5 0 0 1 9 0" />
      <path d="M11 3.7a2.3 2.3 0 0 1 0 3.8" />
      <path d="M11.9 9.5a4.5 4.5 0 0 1 2.4 4" />
    </svg>
  );
}

/**
 * The type line on a card: the kind's glyph, the kind's word, then whatever
 * else follows it (the family, the coach, how full it is). `detail` parts are
 * joined with the same middot everywhere; nulls are dropped.
 */
export function ClassTypeLine({
  kind,
  detail = [],
  className = "",
}: {
  kind: ClassKind;
  detail?: (string | React.ReactNode | null | undefined)[];
  className?: string;
}) {
  const parts = detail.filter((d) => d !== null && d !== undefined && d !== "");
  return (
    <span className={`flex items-center gap-1.5 text-xs text-fg-2 ${className}`}>
      <KindIcon kind={kind} className={KIND_TINT[kind]} />
      <span className="min-w-0 truncate">
        {KIND_WORD[kind]}
        {parts.map((p, i) => (
          <span key={i}> · {p}</span>
        ))}
      </span>
    </span>
  );
}
