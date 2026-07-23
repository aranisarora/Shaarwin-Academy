"use client";

// One card, both admin pages. The Schedule shows this week's sessions; Weekly
// classes shows the repeating pattern — but to the founder they're the same
// thing ("the Monday evening class"), so they share one visual grammar:
//
//   Line 1 (bold): the anchoring fact  — venue (schedule) / day + time (weekly)
//   Line 2:        the variable fact    — time range (schedule) / coach (weekly)
//   Line 3:        the class type       — "Private · Rohan" / "Group class" / …
//   Badge row:     status               — In progress / Completed / Arrived …
//
// Border language (shared, documented once here):
//   • red border       = needs you to act (no coach yet)
//   • ember left-stripe = a private class
//   • ember ring        = happening right now (live)
//   • greyed out        = finished / ended / paused

import { Badge } from "@/components/ui/Badge";
import { time12h } from "./ClassFields";
import {
  clockTime,
  fmtWhen,
  sessionTimeStatus,
  WEEKDAY_NAME,
  type ClassRow,
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

/** "Private · Asha Rao" / "Group class" / "School class" — the card's type line. */
function sessionTypeLine(s: SessionRow): string {
  if (s.isPrivate) return `Private · ${s.playerName ?? "no client yet"}`;
  return s.isSchool ? "School class" : "Group class";
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
        <Badge tone="ok">✓ Arrived {clockTime(session.coachArrivedAt)}</Badge>
      )}
    </span>
  );
}

/** Status badges for a weekly class — School / Paused / Ended. */
function ClassBadges({ cls }: { cls: ClassRow }) {
  if (!cls.isSchool && cls.active) return null;
  return (
    <span className="mt-1.5 inline-flex flex-wrap gap-1.5">
      {cls.isSchool && <Badge>School</Badge>}
      {!cls.active && (
        <Badge tone="err">{cls.endsOn ? "Ended — tap to restore" : "Paused"}</Badge>
      )}
    </span>
  );
}

const cardBase =
  "w-full rounded-[8px] border px-3 py-2 text-left text-sm hover:border-ember";

/** A single session on the Schedule. `showDay` prepends the weekday+date (used
 * in the ungrouped "no coach yet" box, which isn't under a day header). */
export function SessionCard({
  session,
  showDay = false,
  onClick,
}: {
  session: SessionRow;
  showDay?: boolean;
  onClick: () => void;
}) {
  const status = sessionTimeStatus(session.starts_at, session.ends_at);
  const tone =
    status === "completed"
      ? "border-line bg-surface-2 opacity-55"
      : !session.coachId
        ? "border-err bg-surface-2"
        : status === "in_progress"
          ? "border-ember bg-surface-2 shadow-[0_0_0_1px_var(--ember)]"
          : session.isPrivate
            ? "border-line border-l-[3px] border-l-ember bg-surface-2"
            : "border-line bg-surface-2";
  return (
    <button onClick={onClick} className={`${cardBase} ${tone}`}>
      <p className="font-semibold">{session.venueName ?? "Location TBC"}</p>
      <p className="tnum text-fg-2">
        {showDay ? fmtWhen(session.starts_at) : clockTime(session.starts_at)} –{" "}
        {clockTime(session.ends_at)}
      </p>
      <p className="text-xs text-fg-2">{sessionTypeLine(session)}</p>
      <SessionBadges session={session} />
    </button>
  );
}

/** A single repeating class on the Weekly classes tab. Venue lives in the group
 * header above, so line 1 is the day + time; line 2 is the coach. */
export function WeeklyClassCard({
  cls,
  onClick,
}: {
  cls: ClassRow;
  onClick: () => void;
}) {
  const dayShort = (WEEKDAY_NAME[cls.weekday] ?? cls.weekday).slice(0, 3);
  const tone = !cls.active
    ? "border-line bg-surface-2 opacity-55"
    : !cls.coachName
      ? "border-err bg-surface-2"
      : "border-line bg-surface-2";
  return (
    <button onClick={onClick} className={`${cardBase} ${tone}`}>
      <p className="font-semibold">
        {dayShort} · {time12h(cls.time)} – {endTime12h(cls.time, cls.duration)}
      </p>
      <p className="text-fg-2">{cls.coachName ?? "No coach yet"}</p>
      <p className="text-xs text-fg-2">
        {cls.isSchool ? "School class" : "Group class"} ·{" "}
        {cls.bookedCount} of {cls.capacity} booked
      </p>
      <ClassBadges cls={cls} />
    </button>
  );
}
