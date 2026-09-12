// One session on the founder's week. The same card the admin drew, with the
// same grammar, and nothing to do to it:
//
//   Line 1 (bold): the anchoring fact — where
//   Line 2:        when — start and finish, struck through if called off
//   Line 3:        what kind of class — glyph + "Private class · Rohan · Ravi"
//   Badge row:     only what the clock cannot say — Live, or Cancelled
//
// IDENTITY IS ADDITIVE, STATE IS A LADDER. What kind of class this is holds in
// every state; the plum/teal rail is written to `--kind-rail` and the state to
// the border and the surface, so neither can eat the other (see `.class-card`
// in globals.css).
//
// DIMMING MEANS ONE THING: out of play. A finished or cancelled class goes grey
// in the ink and nowhere else, so a finished private is still visibly private.
//
// The red border is spent on exactly one thing: a class with nobody to teach
// it. That is the one fact on this screen that needs somebody before it starts,
// and it is rare enough to deserve the loudest signal on the page.
//
// Not a button. Nothing opens; the card promises no tap because there is
// nothing behind one — changes are made in the WhatsApp thread, and the card
// says what it is so he knows what to ask for.

import { Badge } from "@/components/ui/Badge";
import { formatIsoWallClock } from "@/lib/academy-time";
import type { SessionView } from "@/lib/schedule-view";
import { ClassTypeLine, KIND_RAIL } from "./class-type";

/** The state ladder — live beats plain, out-of-play beats "no coach". */
function stateTone(s: SessionView): string {
  const off = s.cancelled;
  const dim = off || s.timing === "completed";
  const live = !off && s.timing === "in_progress";
  const surface = live ? "card-live " : "";
  if (dim) return `${surface}card-done`;
  if (!s.coach) return `${surface}border-err`;
  return `${surface}border-line`;
}

export function SessionCard({ session }: { session: SessionView }) {
  const off = session.cancelled;
  const live = !off && session.timing === "in_progress";
  const start = formatIsoWallClock(session.starts_at);
  const end = session.ends_at ? formatIsoWallClock(session.ends_at) : null;

  return (
    <div
      className={`class-card w-full rounded-[8px] border px-3 py-2 text-left text-sm ${stateTone(session)} ${KIND_RAIL[session.kind]}`}
    >
      <p className="font-semibold">{session.place ?? "Location TBC"}</p>
      <p className={`tnum text-fg-2 ${off ? "line-through" : ""}`}>
        {start}
        {end ? ` – ${end}` : ""}
      </p>
      <ClassTypeLine
        kind={session.kind}
        detail={[
          session.kind === "private" ? (session.player ?? "no client yet") : null,
          // A cancelled session needs nobody, so shouting red about its empty
          // coach slot would be an alarm about work that no longer exists.
          session.coach ? (
            session.coach
          ) : off ? null : (
            <span className="text-err">No coach yet</span>
          ),
          session.kind !== "private" && session.capacity
            ? `${session.taken} of ${session.capacity} booked`
            : null,
        ]}
      />
      {(off || live) && (
        <span className="mt-1.5 inline-flex flex-wrap items-center gap-1.5">
          {/* Neutral, not red. A class that was called off is information. */}
          {off && <Badge>Cancelled</Badge>}
          {live && (
            <Badge tone="ember">
              <span aria-hidden className="live-dot mr-1 leading-none">
                ●
              </span>
              Live
            </Badge>
          )}
        </span>
      )}
    </div>
  );
}
