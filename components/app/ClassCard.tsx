"use client";

// One card, every admin screen. Today shows what is on now; the Schedule shows
// this week's sessions; Weekly classes shows the repeating pattern — but to the
// founder they are all "the Monday evening class", so they share one grammar:
//
//   Line 1 (bold): the anchoring fact  — venue (schedule) / day + time (weekly)
//   Line 2:        the coach
//   Line 3:        what kind of class  — glyph + "Private class · Rohan" / …
//   Badge row:     state               — In progress / Completed / Ended / …
//
// Three rules keep the screens legible as one thing:
//
//   IDENTITY IS ADDITIVE, STATE IS A LADDER. What kind of class this is holds
//   whatever state the card is in. It used to be a rung in the same ladder as
//   completed and in-progress, which meant a private lost its mark the moment
//   it finished or lost its coach — the card stopped saying what it was exactly
//   when the founder was scanning for it.
//
//   DIMMING MEANS ONE THING: out of play. Finished, ended, paused. It does not
//   mean "you can't pick this" — that is what a missing tick box says, and
//   conflating the two is why an ended class (pickable) and a private (not)
//   were indistinguishable on a phone, where there is no hover to ask.
//
//   IDENTITY AND STATE NEVER SHARE A CSS PROPERTY. They are separate ideas, so
//   they get separate properties and compose in any order: kind writes an inset
//   rail, state writes the border, the surface and the ring. When both wanted
//   `border-color` the last utility Tailwind emitted won, and a live private
//   came out as three ember sides and one plum edge. See `.class-card` in
//   globals.css for the mechanics, class-type.tsx for the kind signals.
//
//   THE BADGE ROW IS ONLY FOR WHAT THE CLOCK CANNOT SAY. Whether a session is
//   over is written three times already — dimmed, ordered by time, finish time
//   on line 2 — so it is not written a fourth in a pill. What the founder
//   cannot work out from the screen is whether the coach actually turned up,
//   and that is what the badge row is now for.
//
// Card language, documented once. Each line owns a different piece of the card,
// so any combination of them is drawable and none can eat another:
//   • plum/teal left rail = a private / a school's class ┐ identity, additive,
//   • the glyph on line 3 = the same fact, in a shape    ┘ never a status
//   • warm ember surface  = live right now
//   • red border          = needs you to act (no coach yet, or a class that
//                           ran and was never closed out)
//   • ember ring + wash   = you have picked this one
//   • recessed + grey title = settled — over AND closed out, nothing owed
//   • the badge row       = arrival, the register, the assessments

import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { time12h } from "./ClassFields";
import { ClassTypeLine, KIND_RAIL, classKind } from "./class-type";
import { useLongPress } from "./use-long-press";
import { sessionDeviation } from "@/lib/session-deviation";
import { formatClock, formatSessionDate, sessionTimeStatus } from "@/lib/academy-time";
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


/** Status badges for a session — same order, tones and casing everywhere.
 *
 * THE BADGE ROW IS FOR WHAT THE CLOCK CANNOT TELL HIM. It used to lead with
 * "✓ Completed", which is a restatement of three things the card already says:
 * it is dimmed, it sits in a list ordered by time, and its finish time is
 * printed on line 2. What the founder cannot work out from any of that is
 * whether the class was actually closed out — and a class is not closed out
 * until three things happened: the coach marked that they arrived, marked who
 * turned up, and rated the players who did.
 *
 * ALL THREE ARE RED WHEN THEY ARE MISSING, and that is the point rather than an
 * oversight. The first version of this row wrote a missing arrival as a grey
 * "Not marked", reasoning that two thirds of sessions are in that state and red
 * on two thirds of the week would be noise. That gets it exactly backwards: the
 * two thirds IS the finding. A gap this widespread is precisely what the
 * founder needs shoved in front of him, because the number only comes down if
 * somebody is chasing it, and nobody chases a grey footnote. If the week goes
 * quiet later, that is the system working, not the warning being wrong.
 *
 * Order is the order the work actually happens in, which is also the order it
 * unblocks: arrival, then the register, then assessments. Assessments cannot
 * even be owed until the register is kept — an unmarked roster has no attended
 * bookings — so "Assess 5" appearing after "Register 8" is cleared is the true
 * sequence and not a second alarm. See lib/session-followthrough.ts.
 *
 * The counts are on the badges because "Register 8" and "Register 1" are
 * different sizes of problem and the founder is triaging a week, not a card. */
type TimeStatus = ReturnType<typeof sessionTimeStatus>;

/**
 * What this session is still waiting on, as the card reads it.
 *
 * One function because the badge row and the card's border are two views of the
 * same judgement, and a card whose chips say "Register 8" while its border says
 * everything is fine is worse than either signal alone. Cancelled sessions
 * never reach here: nothing is owed on a class that did not happen.
 */
function outstanding(session: SessionRow, status: TimeStatus) {
  // A session nobody is rostered on has nobody to arrive: the empty coach slot
  // is the story on that card, and the type line already tells it in red.
  const arrivedAt = session.coachId ? session.coachArrivedAt : null;
  // Silent until it has actually started. A "no arrival" pill on every future
  // class in the week would be a report of nothing, on the cards that have the
  // least to say — and the founder would learn to read past the whole row.
  const noArrival = session.coachId != null && !arrivedAt && status !== "upcoming";
  // The register and the assessments are only owed once the class is over. A
  // coach marking a register mid-class is normal and being half-done at 4pm is
  // not a failure, so chasing it while the whistle is still going would train
  // him to ignore the one row that matters at 6pm.
  const done = status === "completed";
  const register = done ? session.rosterUnmarked : 0;
  const assess = done ? session.assessPending : 0;
  return {
    arrivedAt,
    noArrival,
    register,
    assess,
    any: noArrival || register > 0 || assess > 0,
  };
}

function SessionBadges({ session }: { session: SessionRow }) {
  // Neutral, not red. A class that was called off is information; red is
  // reserved for the things still waiting on him to do something about them.
  if (session.status === "cancelled") {
    return (
      <span className="mt-1.5 inline-flex flex-wrap gap-1.5">
        <Badge>Cancelled</Badge>
      </span>
    );
  }
  const status = sessionTimeStatus(session.starts_at, session.ends_at);
  const live = status === "in_progress";
  const { arrivedAt, noArrival, register, assess } = outstanding(session, status);
  if (!live && !arrivedAt && !noArrival && !register && !assess) return null;
  return (
    <span className="mt-1.5 inline-flex flex-wrap items-center gap-1.5">
      {/* Four characters, not eleven. "In progress" and the arrival chip could
          not both fit on one line on a phone, so the two facts that matter most
          during a class wrapped onto two badge rows. The dot carries the state
          in motion; the word only has to name it. */}
      {live && (
        <Badge tone="ember">
          <span aria-hidden className="live-dot mr-1 leading-none">
            ●
          </span>
          Live
        </Badge>
      )}
      {arrivedAt && <Badge tone="ok">✓ Arrived {formatClock(arrivedAt)}</Badge>}
      {noArrival && <Badge tone="err">✗ No arrival</Badge>}
      {register > 0 && <Badge tone="err">✗ Register {register}</Badge>}
      {assess > 0 && <Badge tone="err">✗ Assess {assess}</Badge>}
    </span>
  );
}

/** Status badges for a weekly class — Paused / Ended.
 *
 * The ended badge used to read "tap to restore", from when restoring was the
 * only thing left to do with one. Ended classes now sit on the list by default
 * and the sheet will delete one outright, so the badge names both. */
function ClassBadges({ cls }: { cls: ClassRow }) {
  // "School" is not a state, so it is no longer a badge here — the teal rail
  // and the glyph on the type line say it, in the same two places every other
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
//
// `class-card` is what composes the kind rail with the state halo and the
// background — the card's own background comes from there, so nothing here
// sets `bg-*`. See globals.css.
const cardBase = "class-card pressable w-full rounded-[8px] border px-3 py-2 text-left text-sm";
// Only cards that actually do something on tap promise it. This used to be
// baked into cardBase, so a finished session and an unpickable card both lit up
// under the cursor offering to open something they would not open.
//
// It also used to be `hover:border-ember`, which repainted the card's border in
// the one colour reserved for "live right now" — so on a desktop every card the
// pointer crossed briefly claimed to be in progress, a private lost its rail,
// and a class with no coach lost its red. Hover moves the surface instead.
const cardInteractive = "card-hover";

/** The state ladder, shared so precedence is decided once rather than drifting
 * per surface.
 *
 *   picked  — the founder has ticked this one while selecting
 *   live    — happening right now
 *   dim     — out of play (finished, ended, paused)
 *   alert   — no coach yet
 *
 * `picked` and `live` used to be one rung called `ring`, both drawing the same
 * bare ember ring, so a live class the founder had just ticked looked exactly
 * like a live class he had not — and the tick box was the only thing that said
 * which. They are two different kinds of fact (one about the world, one about
 * what he is doing) and now look it: picked is a ring, live is a wash.
 *
 * LIVE IS NO LONGER A RUNG. It is a surface, so it composes with the rest
 * instead of outranking them, and the ladder below it shrank to the two things
 * that genuinely contest the border. That fixes two bugs at once: the ember
 * border used to stack outside the plum/teal kind rail (three colours deep on
 * the left edge, see `.card-live` in globals.css), and `live` used to swallow
 * `alert`, so a class that was happening right now with nobody rostered — the
 * most urgent card the app can draw — lost its red.
 *
 * Identity (the kind rail) is applied by the caller on top and cannot collide:
 * nothing in here writes --kind-rail. */
function stateTone({
  dim = false,
  alert = false,
  live = false,
  picked = false,
}: {
  dim?: boolean;
  alert?: boolean;
  live?: boolean;
  picked?: boolean;
}): string {
  // What he is doing right now beats what the card is. A picked card that also
  // needs a coach loses its red border, but not the red "No coach yet" on the
  // card itself — the sentence survives, and it was always the clearer signal.
  if (picked) return "card-picked border-ember [--state-ring:0_0_0_2px_var(--ember)]";
  // The surface says live; the border is left to whatever else is true of the
  // card. `live` and `dim` cannot both hold — a session is either running or
  // finished — so the wash only ever meets `alert` or nothing.
  const surface = live ? "card-live " : "";
  // Out of play beats "no coach": a finished session does not need one, and
  // shouting red at the founder about a class that is over is noise he has to
  // learn to ignore — which then costs him the reds that are real.
  //
  // This used to be `opacity-75`, chosen as the lowest fade that kept the card's
  // words above AA. It did not: opacity multiplies every colour at once and the
  // grey second line still came out near 3.6:1. And a 25% fade is a weak way to
  // say "this is over" — on the desktop coach lanes it was the ONLY way, since
  // finished sessions sink to the bottom of the day in the phone's grouping
  // (lib/group-by-day.ts) and nowhere else. `.card-done` recesses the card into
  // the page instead: no multiplication, so its text is legible AND it reads as
  // finished at a glance. See globals.css.
  //
  // The surface itself is no longer named here: `.class-card` paints
  // `var(--card-bg, var(--surface-2))`, so hover, picked, live and done can move
  // the surface without a Tailwind `bg-*` utility racing them for the property.
  if (dim) return `${surface}card-done`;
  if (alert) return `${surface}border-err`;
  return `${surface}border-line`;
}

// Kept as a name so the "identity is additive" rule still reads at each call
// site; the colour itself depends on what kind of class it is.
const kindRail = (c: { isPrivate?: boolean; isSchool?: boolean }) =>
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
  onLongPress,
  href,
}: {
  session: SessionRow;
  showDay?: boolean;
  /** Day-first mobile layout groups by day, not coach — so the coach moves onto
   * the card. Omitted in the desktop coach-lane view, where it's redundant. */
  coachName?: string | null;
  onClick?: () => void;
  /** Press and hold for what you can do to it — the same gesture, on the same
   * card, as on the Timetable. It only worked over there, so the two halves of
   * one tab answered a hold differently: a menu on one, nothing on the other. */
  onLongPress?: () => void;
  href?: string;
}) {
  const status = sessionTimeStatus(session.starts_at, session.ends_at);
  const off = session.status === "cancelled";
  // Where this sits relative to the class's standing slot. A moved session
  // stays in the list at its real time — it is happening — and says where it
  // came from, which is the difference between "the timetable changed" and
  // "this one week is different" that the schedule used to swallow.
  const moved = off ? null : sessionDeviation(session);
  // ONLY A CLASS THAT IS ACTUALLY CLOSED OUT GETS TO SINK. Recessing is for
  // things that are done with, and a finished session still owing a register is
  // not done with — it is the founder's afternoon. So the two facts drive
  // opposite treatments from one test: a settled class recedes into the page, an
  // unsettled one keeps a normal surface and takes the red border. On a scanned
  // day the leftovers are then the only things standing up.
  const owed = off ? null : outstanding(session, status);
  const tone = `${stateTone({
    dim: off || (status === "completed" && !owed?.any),
    alert: !off && (!session.coachId || !!owed?.any),
    live: !off && status === "in_progress",
  })} ${kindRail(session)}`;
  const inner = (
    <>
      <p className="font-semibold">{session.venueName ?? "Location TBC"}</p>
      <p className={`tnum text-fg-2 ${off ? "line-through" : ""}`}>
        {showDay ? formatSessionDate(session.starts_at) : formatClock(session.starts_at)} –{" "}
        {formatClock(session.ends_at)}
      </p>
      {moved && (
        <p className="tnum text-xs text-fg-2">
          Moved from {WEEKDAY_NAME[moved.weekday]?.slice(0, 3) ?? moved.weekday}{" "}
          {time12h(moved.time)}
        </p>
      )}
      {off && session.cancelReason && (
        <p className="text-xs text-fg-2">{session.cancelReason}</p>
      )}
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
          // A cancelled session needs nobody, so shouting red about its empty
          // coach slot would be an alarm about work that no longer exists.
          !session.coachId ? (
            off ? null : <span className="text-err">No coach yet</span>
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
    <SessionButton onClick={onClick} onLongPress={onLongPress} tone={tone}>
      {inner}
    </SessionButton>
  );
}

/** The card as a button, with the hold wired up. Split out because useLongPress
 *  is a hook and the card above returns early for the link form. */
function SessionButton({
  onClick,
  onLongPress,
  tone,
  children,
}: {
  onClick?: () => void;
  onLongPress?: () => void;
  tone: string;
  children: React.ReactNode;
}) {
  const { handlers, consumeClick } = useLongPress(onLongPress ?? null);
  return (
    <button
      type="button"
      onClick={() => {
        // A hold that ends on the card would otherwise also fire the tap, so
        // the menu would open and the sheet behind it at the same time.
        if (consumeClick()) return;
        onClick?.();
      }}
      {...handlers}
      className={`${cardBase} ${cardInteractive} ${tone}`}
    >
      {children}
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
    picked: selecting && selected,
  })} ${kindRail(cls)}`;
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
 * It used to be view-only, on the reasoning that ending a private is a
 * per-client job with a paying family behind it and belongs on the Schedule.
 * Three things were wrong with that. The founder reads this screen as "my
 * calendar", so a row he cannot pick reads as a row he cannot remove — which is
 * exactly the report that started this. The Schedule's action is not the same
 * action either: it is client-wide, sweeping every private that family has, so
 * there was no way to end ONE slot anywhere. And a slot whose weeks stopped
 * generating has no next session, so the deep link was not rendered at all and
 * the card became a dead <div> with no route to anything.
 *
 * So it is now a first-class member of the selection, with the same two doors as
 * the class card beside it: tap, and press-and-hold. What it does NOT get is a
 * merged id — the parent keeps weekly private slots in their own set, because
 * these ids belong to a different table. */
export function PrivateSeriesCard({
  series,
  onClick,
  onLongPress,
  selecting = false,
  selected = false,
}: {
  series: PrivateSeriesRow;
  /** Always the same thing: open the panel for this slot. It used to depend on
   *  whether the slot happened to have a session generated ahead of it — with
   *  one, a tap navigated to the other view; without one, it dropped you into a
   *  selection. Two behaviours for one gesture, chosen by data on the card that
   *  nothing on the card showed. */
  onClick: () => void;
  onLongPress?: () => void;
  selecting?: boolean;
  selected?: boolean;
}) {
  const { handlers, consumeClick } = useLongPress(selecting ? null : onLongPress);
  // Spans, not paragraphs: the card is a <button> while picking, and a <p>
  // inside a button is invalid content.
  const inner = (
    <>
      <span className="tnum block font-semibold">
        {slotLine(series.weekday, series.time, series.duration)}
      </span>
      {/* Red, exactly as on the class card beside it. A private with nobody to
          teach it is the same problem as a group class with nobody to teach it,
          and this card used to state it in the same grey it uses for a coach's
          name — so the one row in the grid that was actually broken was the one
          row that looked fine. */}
      <span className="block text-fg-2">
        {series.coachName ?? <span className="text-err">No coach yet</span>}
      </span>
      {/* The plum rail and the glyph already say "private" — an ember Private
          badge on top said it a third time, in the one colour that also means
          "live right now" two cards further down the same grid. */}
      <ClassTypeLine
        kind="private"
        detail={[series.playerName, series.clientName || null]}
      />
    </>
  );
  const tone = `${stateTone({
    alert: !series.coachName,
    picked: selecting && selected,
  })} ${KIND_RAIL.private}`;

  if (selecting) {
    return (
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        onClick={onClick}
        className={`${cardBase} ${cardInteractive} ${tone} flex items-start gap-3`}
      >
        <Tick selected={selected} />
        <span className="block min-w-0">{inner}</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        if (consumeClick()) return;
        onClick();
      }}
      {...handlers}
      className={`${cardBase} ${cardInteractive} ${tone}`}
    >
      <span className="block min-w-0">{inner}</span>
    </button>
  );
}
