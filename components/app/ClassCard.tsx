"use client";

// One card, every admin screen. Today shows what is on now; the Schedule shows
// this week's sessions; Weekly classes shows the repeating pattern — but to the
// founder they are all "the Monday evening class", so they share one grammar:
//
//   Line 1 (bold): the anchoring fact  — venue (schedule) / day + time (weekly)
//   Line 2:        the coach
//   Line 3:        what kind of class  — "Private · Rohan" / "Group class" / …
//   Badge row:     state               — In progress / Completed / Ended / …
//
// Two rules keep the three screens legible as one thing:
//
//   IDENTITY IS ADDITIVE, STATE IS A LADDER. The ember left-stripe means "this
//   is a private" and nothing else, so it is applied on top of whatever state
//   the card is in. It used to be a rung in the same ladder as completed and
//   in-progress, which meant a private lost its stripe the moment it finished
//   or lost its coach — the card stopped saying what it was exactly when the
//   founder was scanning for it.
//
//   DIMMING MEANS ONE THING: out of play. Finished, ended, paused. It does not
//   mean "you can't pick this" — that is what a missing tick box says, and
//   conflating the two is why an ended class (pickable) and a private (not)
//   were indistinguishable on a phone, where there is no hover to ask.
//
//   IDENTITY IS COLOURED BY KIND, NOT BY EMBER. The left stripe used to be
//   ember for a private and nothing at all for a school, which left school
//   classes leaning on a shouted <Badge>School</Badge> and made ember mean
//   "private" on the same screen it means "live now", "primary button" and
//   "the tab you are on". A colour asked to mean four things means none of
//   them. Kind now owns its own quiet pair — plum for a private, teal for a
//   school, nothing for an ordinary group class — in exactly two places on
//   every card: the stripe, and a 6px dot beside the words. See class-type.tsx.
//
// Border language, documented once:
//   • red border        = needs you to act (no coach yet)
//   • plum left-stripe  = a private class      ┐ identity, additive,
//   • teal left-stripe  = a school's class     ┘ never a status
//   • ember ring        = live right now, or picked (the badge/tick says which)
//   • dimmed            = out of play

import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { time12h } from "./ClassFields";
import { ClassTypeLine, KIND_RAIL, classKind } from "./class-type";
import { useLongPress } from "./use-long-press";
import {
  formatClock,
  formatSessionDate,
  sessionTimeStatus,
  wallDate,
} from "@/lib/academy-time";
import {
  WEEKDAY_NAME,
  type ClassRow,
  type PrivateSeriesRow,
  type SessionRow,
} from "./admin-calendar-types";

/** "18:30" + 60 → "7:30 pm" — a class's finish time from its start + length. */
function endTime12h(time: string, durationMinutes: number): string {
  const [h, m] = time.split(":").map(Number);
  if (!Number.isFinite(h)) return time;
  const total = h * 60 + (m || 0) + durationMinutes;
  const eh = Math.floor(total / 60) % 24;
  const em = total % 60;
  return time12h(`${eh}:${String(em).padStart(2, "0")}`);
}

/** "Mon · 6:30 pm – 7:30 pm" — the weekly grid's line 1, for classes and for
 * privates alike. They sit in the same grid, so they get the same sentence;
 * one used to read "Every Mon · 5:00 pm" with no finish time beside a card
 * reading "Mon · 5:00 pm – 6:00 pm", which is two dialects for one fact. */
function slotLine(weekday: string, time: string, duration: number): string {
  const dayShort = (WEEKDAY_NAME[weekday] ?? weekday).slice(0, 3);
  return `${dayShort} · ${time12h(time)} – ${endTime12h(time, duration)}`;
}


/** Status badges for a session — same order, tones and casing everywhere. */
function SessionBadges({ session }: { session: SessionRow }) {
  const status = sessionTimeStatus(session.starts_at, session.ends_at);
  const show =
    status !== "upcoming" || (session.coachId != null && session.coachArrivedAt != null);
  if (!show) return null;
  return (
    <span className="mt-1.5 inline-flex flex-wrap gap-1.5">
      {status === "in_progress" && <Badge tone="ember">● In progress</Badge>}
      {status === "completed" && <Badge>✓ Completed</Badge>}
      {status !== "completed" && session.coachId && session.coachArrivedAt && (
        <Badge tone="ok">✓ Arrived {formatClock(session.coachArrivedAt)}</Badge>
      )}
    </span>
  );
}

/** Status badges for a weekly class — School / Paused / Ended.
 *
 * The ended badge used to read "tap to restore", from when restoring was the
 * only thing left to do with one. Ended classes now sit on the list by default
 * and the sheet will delete one outright, so the badge names both. */
function ClassBadges({ cls }: { cls: ClassRow }) {
  // "School" is not a state, so it is no longer a badge here — the teal stripe
  // and the dot on the type line say it, in the same two places every other
  // kind of class says what it is. This row is now only ever about state.
  if (cls.active) return null;
  return (
    <span className="mt-1.5 inline-flex flex-wrap gap-1.5">
      <Badge tone="err">{cls.endsOn ? "Ended — restore or delete" : "Paused"}</Badge>
    </span>
  );
}

// `pressable` is not decoration on these. Every session and every weekly class
// is one of these cards, they are the app's main way of getting anywhere, and
// without a pressed state a tap on a phone looks like nothing happened until
// the sheet finishes opening.
const cardBase = "pressable w-full rounded-[8px] border px-3 py-2 text-left text-sm";
// Only cards that actually do something on tap promise it. This used to be
// baked into cardBase, so a finished session and an unpickable card both lit up
// under the cursor offering to open something they would not open.
const cardInteractive = "hover:border-ember";

/** The state ladder, shared so precedence is decided once rather than drifting
 * per surface. `dim` is out-of-play; `alert` is "no coach yet"; `ring` is live
 * or picked. Identity (the private stripe) is applied by the caller on top. */
function stateTone({
  dim = false,
  alert = false,
  ring = false,
}: {
  dim?: boolean;
  alert?: boolean;
  ring?: boolean;
}): string {
  if (ring) return "border-ember bg-surface-2 shadow-[0_0_0_1px_var(--ember)]";
  // Out of play beats "no coach": a finished session does not need one, and
  // shouting red at the founder about a class that is over is noise he has to
  // learn to ignore — which then costs him the reds that are real.
  if (dim) return "border-line bg-surface-2 opacity-55";
  if (alert) return "border-err bg-surface-2";
  return "border-line bg-surface-2";
}

// Kept as a name so the "identity is additive" rule still reads at each call
// site; the colour itself now depends on what kind of class it is.
const kindStripe = (c: { isPrivate?: boolean; isSchool?: boolean }) =>
  KIND_RAIL[classKind(c)];

/** The tick every selectable card shows while the founder is picking. Drawn
 * rather than a real <input> so it can live inside the button without nesting
 * two controls. `available: false` draws the empty slot a card that is not part
 * of this operation leaves behind — the absence is then something you see at
 * the same spot on every row, rather than something you infer from dimming. */
function Tick({ selected, available = true }: { selected?: boolean; available?: boolean }) {
  if (!available) {
    return (
      <span
        aria-hidden
        className="mt-0.5 h-5 w-5 shrink-0 rounded-[4px] border border-dashed border-line"
      />
    );
  }
  return (
    <span
      aria-hidden
      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] border text-xs leading-none ${
        selected ? "border-ember bg-ember text-bg" : "border-line"
      }`}
    >
      {selected ? "✓" : ""}
    </span>
  );
}

/** A single session on the Schedule. `showDay` swaps the start clock for the
 * full weekday + date (used in the ungrouped "no coach yet" box, which isn't
 * under a day header). Pass `href` instead of `onClick` to render the same card
 * as a deep-link (Today reuses it this way to open the exact session). */
export function SessionCard({
  session,
  showDay = false,
  coachName,
  onClick,
  href,
}: {
  session: SessionRow;
  showDay?: boolean;
  /** Day-first mobile layout groups by day, not coach — so the coach moves onto
   * the card. Omitted in the desktop coach-lane view, where it's redundant. */
  coachName?: string | null;
  onClick?: () => void;
  href?: string;
}) {
  const status = sessionTimeStatus(session.starts_at, session.ends_at);
  const tone = `${stateTone({
    dim: status === "completed",
    alert: !session.coachId,
    ring: status === "in_progress",
  })} ${kindStripe(session)}`;
  const inner = (
    <>
      <p className="font-semibold">{session.venueName ?? "Location TBC"}</p>
      <p className="tnum text-fg-2">
        {showDay ? formatSessionDate(session.starts_at) : formatClock(session.starts_at)} –{" "}
        {formatClock(session.ends_at)}
      </p>
      {/* A red card always says why it is red, on every screen. Naming the
          coach is the surface's choice — the desktop lane already is the coach,
          so it would only repeat itself — but "no coach yet" is not, because
          the red border is the loudest thing on the page and Today used to
          show it with nothing beside it to explain what was wrong. */}
      <ClassTypeLine
        kind={classKind(session)}
        detail={[
          session.isPrivate
            ? (session.privatePlayerName ?? session.playerName ?? "no client yet")
            : null,
          !session.coachId ? (
            <span className="text-err">No coach yet</span>
          ) : coachName !== undefined && coachName ? (
            coachName
          ) : null,
        ]}
      />
      <SessionBadges session={session} />
    </>
  );
  if (href) {
    return (
      <Link href={href} className={`block ${cardBase} ${cardInteractive} ${tone}`}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={`${cardBase} ${cardInteractive} ${tone}`}>
      {inner}
    </button>
  );
}

/** A single repeating class on the Weekly classes tab. Venue lives in the group
 * header above, so line 1 is the day + time; line 2 is the coach.
 *
 * Two ways in, and they are the same two everywhere a list can be picked from:
 * tap opens the editor, press-and-hold starts picking. The hold is what makes
 * the "Select" button optional rather than the only door — a founder who has
 * never found that button still gets into selection mode the way he does in
 * every photo app on the phone he is holding.
 *
 * Once picking, the whole card is the checkbox: a founder clearing a timetable
 * is aiming at cards, not at 16px boxes. */
export function WeeklyClassCard({
  cls,
  onClick,
  onLongPress,
  selecting = false,
  selected = false,
}: {
  cls: ClassRow;
  onClick: () => void;
  /** Press and hold to start picking. Omitted once already picking — the whole
   * card is a checkbox by then, so there is nothing left for a hold to start. */
  onLongPress?: () => void;
  selecting?: boolean;
  selected?: boolean;
}) {
  const { handlers, consumeClick } = useLongPress(selecting ? null : onLongPress);
  const tone = `${stateTone({
    dim: !cls.active,
    alert: !!cls.active && !cls.coachName,
    ring: selecting && selected,
  })} ${kindStripe(cls)}`;
  return (
    <button
      type="button"
      onClick={() => {
        if (consumeClick()) return;
        onClick();
      }}
      {...handlers}
      role={selecting ? "checkbox" : undefined}
      aria-checked={selecting ? selected : undefined}
      className={`${cardBase} ${cardInteractive} ${tone} ${selecting ? "flex items-start gap-3" : ""}`}
    >
      {selecting && <Tick selected={selected} />}
      <span className="block min-w-0">
        <span className="tnum block font-semibold">
          {slotLine(cls.weekday, cls.time, cls.duration)}
        </span>
        <span className="block text-fg-2">
          {cls.coachName ?? <span className="text-err">No coach yet</span>}
        </span>
        <ClassTypeLine
          kind={classKind(cls)}
          detail={[`${cls.bookedCount} of ${cls.capacity} booked`]}
        />
        <ClassBadges cls={cls} />
      </span>
    </button>
  );
}

/** A client's weekly private slot on the Weekly tab, in the same grammar as the
 * class card beside it: day + time on line 1, coach on line 2, what it is on
 * line 3, state in the badge row. It used to invent its own — "Every Mon ·
 * 5:00 pm" with no finish time, the coach demoted to line 3, no badges at all —
 * which meant two cards in one grid disagreed about how to say the same fact.
 *
 * It is view-only here: ending a private is a per-client job with a paying
 * family behind it, and it happens on the Schedule where the client's whole
 * picture is. So the card deep-links to its next session and carries a Private
 * badge, rather than a sentence telling the founder where to go.
 *
 * While the founder is picking, it is inert — not a link. The ticks are React
 * state on this page, so following a link mid-selection threw the whole
 * selection away, and the tap that did it was him aiming at a card he wanted.
 * Eleven of the eighteen on prod carried a next session and so were live links. */
export function PrivateSeriesCard({
  series,
  selecting = false,
}: {
  series: PrivateSeriesRow;
  selecting?: boolean;
}) {
  const inner = (
    <>
      <p className="tnum font-semibold">
        {slotLine(series.weekday, series.time, series.duration)}
      </p>
      <p className="text-fg-2">{series.coachName ?? "No coach yet"}</p>
      {/* The plum stripe and the dot already say "private" — an ember Private
          badge on top said it a third time, in the one colour that also means
          "live right now" two cards further down the same grid. */}
      <ClassTypeLine
        kind="private"
        detail={[series.playerName, series.clientName || null]}
      />
    </>
  );
  const tone = `${stateTone({})} ${KIND_RAIL.private}`;

  if (selecting) {
    return (
      <div className={`${cardBase} ${tone} flex items-start gap-3 opacity-55`}>
        <Tick available={false} />
        <div className="min-w-0">{inner}</div>
      </div>
    );
  }
  if (series.nextSessionId && series.nextSessionStart) {
    return (
      <Link
        href={`/admin/schedule?date=${wallDate(series.nextSessionStart)}&session=${series.nextSessionId}`}
        className={`block ${cardBase} ${cardInteractive} ${tone}`}
      >
        {inner}
      </Link>
    );
  }
  return <div className={`${cardBase} ${tone}`}>{inner}</div>;
}
