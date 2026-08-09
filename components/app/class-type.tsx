// What kind of class is this — the one definition the Today, Schedule, Weekly
// and coach screens all read from, so the answer can never differ between them.
//
// The founder's question is "whose class is this?", and it has exactly three
// answers: an ordinary group class, one family's private class, or a school's
// own class. That is a different axis from "is it in trouble" (red) or "is it
// happening right now" (ember), so it gets signals of its own.
//
// THREE CHANNELS, NOT ONE. Kind used to be a colour twice over — a coloured
// rail and a coloured dot beside the words — which is one channel said twice.
// Print the screen in grey, or hand it to the ~8% of men who cannot split plum
// from teal at 6px, and the whole system collapses to "there is a mark here".
// So the dot became a shape:
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
// beside the words. Never a fill, never a badge — a badge on this app means
// state, and a kind wearing a badge is a kind pretending to be a status. That
// is the mistake this file exists to stop the app repeating.

export type ClassKind = "group" | "private" | "school";

export function classKind(c: { isPrivate?: boolean; isSchool?: boolean }): ClassKind {
  if (c.isPrivate) return "private";
  if (c.isSchool) return "school";
  return "group";
}

/**
 * The card's left rail, as a custom property rather than a border colour.
 *
 * It used to be `border-l-[3px] border-l-priv`, which put identity and state on
 * the same CSS property and let source order pick the winner: Tailwind emits
 * `border-l-priv` after `border-ember`, so a private that was live or picked
 * drew three ember sides and one plum edge — a ring with a bite out of it —
 * and a plain group class drew three ember sides and one grey one. Worse,
 * `hover:border-ember` is emitted after both, so pointing at a private wiped
 * its rail and pointing at a class with no coach wiped its red border. The
 * rail is now an inset shadow that the state layer cannot reach at all. See
 * `.class-card` in globals.css.
 *
 * It also costs no layout now: a 3px border made a private's text start 2px
 * right of the group class above it, so a mixed list never quite lined up.
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

/** One vocabulary. The cards used to say "Private" where the Add sheet said
 *  "Private class" and the Schedule's filter chip said just "Private", so the
 *  founder learned the app's words on one screen and could not find them on
 *  the next. These three strings are the app's only names for the three kinds,
 *  and every screen that names a kind imports them. */
export const KIND_WORD: Record<ClassKind, string> = {
  group: "Group class",
  private: "Private class",
  school: "School class",
};

// The nav icons in components/ui/icons.tsx are drawn on a 24px grid at 1.5
// stroke, which at the 14px these render to comes out around half a pixel and
// greys into a smudge. These are drawn on a 16px grid instead, so the stroke
// lands on whole pixels. Same idea, same `currentColor`, different size — that
// is why they live here and not there.
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
    // A building under a flag — the school's own premises, its own class.
    // Flat roof and a wide door on purpose. A pitched roof and a mortarboard
    // were both tried and both lost: at the 14px this actually renders at, on
    // a phone with no retina to hide behind, `stroke-linejoin: round` eats a
    // roof apex into a smudged arch and the mortarboard collapses to a blob.
    // Four strokes, all of them horizontal or vertical, land on whole pixels.
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
 * else that screen wants after it (the family, the coach, how full it is).
 * `detail` parts are joined with the same middot everywhere.
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
