"use client";

// Session detail sheet for the merged admin calendar. One edit form covers
// everything; on save a Google Calendar-style scope step asks whether the
// change is for "just this session" or "every week" (the whole class).

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Checkbox, Radio } from "@/components/ui/Checkbox";
import { ActionSection } from "@/components/ui/ActionSection";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import { ConfirmAction } from "@/components/ui/ConfirmAction";
import {
  addSchoolPlayer,
  assignPrivateSessionClient,
  cancelAllFuturePrivateSessions,
  endGroupClass,
  moveSession,
  reassignClassCoach,
  reassignSession,
  getSessionDetail,
  getSessionRoster,
  setSessionCapacity,
  updateGroupClass,
  type RosterEntry,
  type SessionDetail,
} from "@/app/admin/schedule/actions";
import { cancelSession, getRankedCoaches, setClassActive } from "@/app/admin/actions";
import { viewAsCoach } from "@/app/coach/preview-actions";
import { AddressDisplay } from "@/components/app/AddressDisplay";
import { ActionResult } from "@/components/app/ActionResult";
import { ClassDetailFields, generateClassTitle, type ClassFormState } from "./ClassFields";
import { ClassTypeLine, classKind } from "./class-type";
import { TimeSelect12h } from "./TimeSelect12h";
import {
  formatClock,
  formatSessionDate,
  wallDate,
  wallTime,
} from "@/lib/academy-time";
import { useNow } from "@/lib/use-now";
import { attendanceState } from "@/lib/attendance-window";
import { sessionIssues } from "@/lib/session-issues";
import {
  arrivalSourceLabel,
  fmtDistance,
  weekdayOfDate,
  playerChoiceValue,
  playerChoices,
  splitPlayerChoice,
  WEEKDAY_NAME,
  type ClientOption,
  type Coach,
  type SessionRow,
  type Venue,
} from "./admin-calendar-types";

type Scope = "session" | "class";

/** "Aarav, Diya and Kabir" — and past four, a count.
 *
 * The point of naming them at all is that the same two children go unmarked
 * every week and a number can never say so. Past a handful that stops being
 * true: eleven names is a wall he scrolls past, and the roster is directly
 * below with all of them on it anyway. */
function listNames(names: string[], max = 4): string {
  if (names.length === 0) return "they";
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  if (rest > 0) return `${shown.join(", ")} and ${rest} more`;
  if (shown.length === 1) return shown[0];
  return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}

export function AdminSessionSheet({
  session,
  coaches,
  venues,
  clients,
  onClose,
  openAt = "edit",
}: {
  session: SessionRow;
  coaches: Coach[];
  venues: Venue[];
  clients: ClientOption[];
  onClose: () => void;
  /** Open straight on the cancel question, for the hold-a-card menu.
   *
   *  It lands on the SCOPE STEP, not on a done deal. That is the whole point:
   *  cancelling a session out of a recurring class can mean this Tuesday or
   *  every Tuesday from now on, and those are wildly different messages to send
   *  a dozen families. A hold that cancelled outright would be the one gesture
   *  in the app with no answer to "which?", so the shortcut skips the reading
   *  and keeps the question. */
  openAt?: "edit" | "cancel";
}) {
  // generateClassTitle's signature is (weekday, time, venueName). Every call in
  // this file used to pass (skillLevel, weekday, time), so each argument landed
  // one slot to the left and every guard failed quietly: WEEKDAY_NAME["any"]
  // fell back to "any", time12h("TU") returned "TU" because Number("TU") is
  // NaN, and the time became the venue. Saving an edit renamed the class to
  // "any TU · 17:00" — in the client's booking list, in the WhatsApp that went
  // out, and in the next confirm prompt he read. Resolve the venue from the
  // form's own venueId, exactly as AdminClassSheet does.
  const venueNameOf = (venueId: string) => venues.find((v) => v.id === venueId)?.name;

  // Mounted fresh per session (parent keys on session.id), so initializers
  // read the session directly — no prop-sync effects.
  const [form, setForm] = useState<ClassFormState>({
    title: generateClassTitle(
      session.classWeekday,
      wallTime(session.starts_at),
      venueNameOf(session.classVenueId ?? "")
    ),
    description: session.classDescription,
    skillLevel: session.classLevel,
    capacity: session.capacity,
    durationMinutes: session.classDuration,
    venueId: session.classVenueId ?? "",
    weekday: session.classWeekday,
    time: wallTime(session.starts_at),
    coachId: "",
  });

  function updateForm(next: ClassFormState) {
    setForm({
      ...next,
      title: generateClassTitle(next.weekday, next.time, venueNameOf(next.venueId)),
    });
  }
  const [date, setDate] = useState(wallDate(session.starts_at));
  const [step, setStep] = useState<"edit" | "scope">(
    openAt === "cancel" ? "scope" : "edit"
  );
  const [scope, setScope] = useState<Scope>("session");
  // The scope step asks the same question for two different verbs. Cancel is
  // the destructive one, so it defaults to the reversible half and its confirm
  // button changes wording with the choice — the label IS the guard.
  const [scopeMode, setScopeMode] = useState<"save" | "cancel">(
    openAt === "cancel" ? "cancel" : "save"
  );

  // Two tabs: what this session IS, and what you can do to it. Tapping a card
  // courtside is almost always the first question, and it used to arrive as a
  // stack of six forms with the facts wedged above them. Landing on Edit when
  // there's no coach preserves exactly what shipped before — that was the one
  // case the sheet already opened ready to act on.
  const [tab, setTab] = useState<"session" | "edit">(
    session.coachId ? "session" : "edit"
  );
  // Which action the Edit tab should open at, when arriving from a callout.
  const [focus, setFocus] = useState<string | null>(session.coachId ? null : "coach");
  const goEdit = (section: string) => {
    setTab("edit");
    setFocus(section);
  };
  const [target, setTarget] = useState(session.coachId ?? "");
  const [lock, setLock] = useState(false);
  // When the ranking rules reject a coach, we surface an in-sheet override
  // prompt (not window.confirm) holding the reason; confirming forces it.
  const [coachOverride, setCoachOverride] = useState<string | null>(null);
  const [ranked, setRanked] = useState<
    { coachId: string; name: string; score: number }[] | null
  >(null);
  // `ok` marks a success outcome — rendered as a green ✓ ActionResult whose copy
  // already says whether WhatsApp went out (see the notify manifest in
  // app/admin/schedule/actions.ts). Errors/validations stay neutral.
  const [message, setMessage] = useState<{ text: string; ok?: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  const okMsg = (text: string) => setMessage({ text, ok: true });
  const errMsg = (text: string) => setMessage({ text });

  // Open private slot (created without a client): pick one to fill it.
  const isOpenPrivate = session.isPrivate && !session.privateClientId;
  const [assignClientId, setAssignClientId] = useState("");
  const [assignPlayerId, setAssignPlayerId] = useState("");

  // School class: register a walk-in pupil (name + grade).
  const [schoolAdding, setSchoolAdding] = useState(false);
  const [schoolName, setSchoolName] = useState("");
  const [schoolGrade, setSchoolGrade] = useState("");

  function addPupil() {
    const name = schoolName.trim();
    if (name === "") {
      errMsg("Enter the player's name.");
      return;
    }
    const grade = schoolGrade.trim() === "" ? null : Number(schoolGrade);
    setMessage(null);
    startTransition(async () => {
      const r = await addSchoolPlayer(session.id, name, grade);
      if (r.ok) {
        setSchoolName("");
        setSchoolGrade("");
        setSchoolAdding(false);
        okMsg(`${name} added to the class.`);
        getSessionRoster(session.id).then(setRoster);
      } else errMsg(r.error ?? "Couldn't add the player.");
    });
  }

  function assign() {
    if (!assignClientId) return;
    setMessage(null);
    startTransition(async () => {
      const r = await assignPrivateSessionClient(
        session.id,
        assignClientId,
        assignPlayerId || undefined
      );
      if (r.ok) {
        okMsg("Client assigned — the session is on their schedule and their minutes were debited.");
        onClose();
      } else errMsg(r.error ?? "Couldn't assign the client.");
    });
  }

  // Who's booked and whether they showed up — loaded alongside the coach ranks.
  const [roster, setRoster] = useState<RosterEntry[] | null>(null);
  // The facts that aren't on the calendar row: the coach's name, what he said
  // and did about turning up, and anything he wrote afterwards.
  const [detail, setDetail] = useState<SessionDetail | null>(null);

  useEffect(() => {
    let alive = true;
    // Three independent reads, none blocking the others — the roster paints as
    // soon as it lands rather than waiting on a coach lookup it doesn't need.
    getRankedCoaches(session.id).then((r) => {
      if (alive) setRanked(r);
    });
    getSessionRoster(session.id, { includeWaitlisted: true }).then((r) => {
      if (alive) setRoster(r);
    });
    getSessionDetail(session.id).then((d) => {
      if (alive) setDetail(d);
    });
    return () => {
      alive = false;
    };
  }, [session.id]);

  // What changed vs the session as it stands — drives the scope step.
  const dateChanged = date !== wallDate(session.starts_at);
  const timeChanged = form.time !== wallTime(session.starts_at);
  const slotChanged = dateChanged || timeChanged;
  const spotsChanged = form.capacity !== session.capacity;
  const classChanged =
    form.description !== session.classDescription ||
    form.skillLevel !== session.classLevel ||
    form.durationMinutes !== session.classDuration ||
    form.venueId !== (session.classVenueId ?? "");
  const anyChanged = slotChanged || spotsChanged || classChanged;

  const thisDayName =
    WEEKDAY_NAME[weekdayOfDate(wallDate(session.starts_at))] ?? "day";
  const classDayName = WEEKDAY_NAME[session.classWeekday] ?? "week";

  /** Changing the coach is the most frequent job in this sheet, and it has two
   * honest answers: cover for one date, or move the class onto someone else.
   * Both were reachable before — but only by leaving for the Weekly tab for the
   * second one. Two labelled buttons say which is which without a question
   * screen; a destructive scope choice still gets the step (see cancel). */
  const [coachScope, setCoachScope] = useState<Scope>("session");

  /** A class-wide reassign reports per-week: some weeks the new coach simply
   *  cannot take, and they keep the coach they had. Saying only "done" over
   *  that is how a founder finds out in three weeks' time. */
  const classCoachDone = (r: { changed?: number; skipped?: number }) =>
    okMsg(
      r.skipped
        ? `Coach set on ${r.changed} upcoming ${classDayName}s — ${r.skipped} couldn't take them (clashes) and kept their coach.`
        : `Coach set on every upcoming ${classDayName} — everyone affected has been told.`
    );

  /** Both scopes reject a coach the same way (`filter_failed`), so the override
   *  box below serves either. `force` replays whichever was asked for. */
  async function runCoach(scope: Scope, force: boolean) {
    if (scope === "session") {
      const r = await reassignSession(session.id, target, lock, force);
      if (!force && !r.ok && r.code === "filter_failed") return r;
      if (r.ok)
        okMsg(`Coach changed for this ${thisDayName} — everyone affected has been told.`);
      else errMsg(r.error ?? "Failed.");
      return null;
    }
    const r = await reassignClassCoach(session.classId, target, lock, force);
    if (!force && !r.ok && r.code === "filter_failed") return r;
    if (r.ok) classCoachDone(r);
    else errMsg(r.error ?? "Failed.");
    return null;
  }

  function applyCoach(scope: Scope) {
    if (!target) return;
    setCoachScope(scope);
    setCoachOverride(null);
    startTransition(async () => {
      // The rules say no — but the founder can override. A hard time clash is
      // still blocked by the database either way. Ask in-sheet, not native.
      const rejected = await runCoach(scope, false);
      if (rejected) setCoachOverride(rejected.error ?? "That coach doesn't fit the rules.");
    });
  }

  function applyCoachOverride() {
    if (!target) return;
    startTransition(async () => {
      await runCoach(coachScope, true);
      setCoachOverride(null);
    });
  }

  /** Cancel, once the scope step has been answered. */
  function applyCancel(chosen: Scope) {
    startTransition(async () => {
      if (chosen === "session") {
        const r = await cancelSession(session.id, "cancelled by academy");
        if (r.ok) okMsg("Cancelled — everyone booked has been told.");
        else errMsg(r.error ?? "Cancel failed.");
      } else {
        const r = await endGroupClass(session.classId);
        if (r.ok) {
          okMsg(
            `Class ended — every upcoming ${classDayName} is cancelled and everyone booked has been told. It stays on the Timetable marked Ended, so you can restore it there.`
          );
          onClose();
        } else errMsg(r.error ?? "Failed.");
      }
      setStep("edit");
      setScopeMode("save");
    });
  }

  function apply(chosen: Scope) {
    if (!session) return;
    startTransition(async () => {
      if (chosen === "session") {
        let coachCleared = false;
        if (slotChanged) {
          const r = await moveSession(session.id, date, form.time);
          if (!r.ok) {
            errMsg(r.error ?? "Move failed.");
            setStep("edit");
            return;
          }
          coachCleared = !!r.coachCleared;
        }
        if (spotsChanged) {
          const r = await setSessionCapacity(session.id, form.capacity);
          if (!r.ok) {
            errMsg(r.error ?? "Couldn't update the spots.");
            setStep("edit");
            return;
          }
        }
        // A capacity-only change notifies nobody; a slot move tells everyone
        // booked. Word the ✓ for whichever actually happened — including the
        // case where the new time clashed for the coach and the move went
        // through without them.
        okMsg(
          coachCleared
            ? "Session moved and everyone booked has been told. The coach couldn't take the new time, so it's off their calendar — the Schedule shows it needs someone."
            : slotChanged
              ? "Saved — just this session changed. Everyone booked has been told."
              : "Saved — just this session changed."
        );
      } else {
        // Only fields the founder deliberately edited feed the class update —
        // this session may be a one-off on a different day, or carry a spots
        // override, and those must not silently re-slot the whole class.
        const r = await updateGroupClass({
          classId: session.classId,
          title: form.title,
          description: form.description,
          skillLevel: form.skillLevel,
          capacity: spotsChanged ? form.capacity : session.classCapacity,
          durationMinutes: form.durationMinutes,
          venueId: form.venueId,
          weekday: dateChanged ? weekdayOfDate(date) : session.classWeekday,
          time: timeChanged ? form.time : session.classTime,
        });
        if (r.ok)
          okMsg(
            r.stuck
              ? `Saved for every week — upcoming sessions moved and everyone booked was told. ${r.stuck} ${r.stuck === 1 ? "week" : "weeks"} couldn't move and ${r.stuck === 1 ? "is" : "are"} still on the old slot; open ${r.stuck === 1 ? "it" : "them"} on the Schedule to move ${r.stuck === 1 ? "it" : "them"} by hand.`
              : "Saved for every week — upcoming sessions moved and everyone booked was told."
          );
        else errMsg(r.error ?? "Couldn't save the class.");
      }
      setStep("edit");
    });
  }

  // Booked players with attendance — attended/no-show set by the coach on the
  // session sheet; "confirmed" means nobody has marked them yet. Waitlisted
  // players are counted apart: they are not in the class, and folding them into
  // "6 of 8 booked" would overstate a class that has room.
  const booked = (roster ?? []).filter((p) => p.status !== "waitlisted");
  const waitlisted = (roster ?? []).filter((p) => p.status === "waitlisted");
  const markedCount = booked.filter(
    (p) => p.status === "attended" || p.status === "no_show"
  ).length;

  // ── What the card's red chips were about ──────────────────────────────────
  //
  // A card is a summary; this sheet is the thing behind it. So the two read the
  // same lib/session-issues.ts, and the sheet's job is to answer the question
  // the chip could only raise: "✗ Attendance 8" becomes eight names, and a
  // button that goes and marks them.
  //
  // Ticking, not frozen at open: a session that ends while the sheet is up
  // starts owing a register, and a sheet left open on a phone would otherwise
  // keep insisting the class is still running.
  const now = useNow();
  const issues = sessionIssues(session, now);
  // The live roster beats the count the week query came back with — the founder
  // may have just marked these very players in the coach preview and come
  // straight back here.
  const unmarked = booked.filter((p) => p.status === "confirmed");
  const unmarkedCount = roster ? unmarked.length : issues.attendance;
  // Re-derived from what is on screen rather than from `issues.any`, which was
  // computed from the week query. The founder marking a register in the coach
  // preview and coming back is the ordinary path through here, and the whole
  // callout has to be able to empty itself out — a red box saying nothing is
  // the app insisting on a problem he has just fixed.
  //
  // A late arrival counts, and has to: it is one of the things that turns the
  // card red, and a red card that opens onto a clean-looking sheet is the exact
  // contradiction lib/session-issues.ts exists to prevent. It is the one entry
  // here that is a fact rather than a job, which is why the heading asks for
  // attention rather than for work, and why it alone does not raise the button.
  const lateArrival = !!issues.arrival?.late;
  const owedWork = issues.noArrival || unmarkedCount > 0 || issues.assess > 0;
  const anyOutstanding = owedWork || lateArrival;
  // Attendance is only editable for a week after the class (lib/attendance-
  // window.ts), and the founder's route in is the coach preview — which is
  // bound by exactly the same window. Offering a button past it would send him
  // to a screen with dead controls on it, so past the edge this says so instead.
  const canMark = attendanceState(session.starts_at, session.ends_at, now) === "open";

  /** Into the coach's own app, on this session, as this coach.
   *
   * /admin has no attendance marker and no assessment editor — by design, see
   * app/coach/session/[id]/actions.ts — so "view as coach" is not a curiosity
   * here, it is the only route to fixing a register. It used to land on the
   * coach's home screen and leave him to find the session himself; from a
   * callout naming one session it goes straight to that session. */
  const fixAsCoach = () =>
    startTransition(async () => {
      const ok = await viewAsCoach(session.coachId as string);
      // Hard navigation: the preview cookie is set httpOnly by the server
      // action, so a soft router.push would re-render /coach from the client
      // cache without it.
      if (ok) window.location.assign(`/coach/session/${session.id}`);
      else errMsg("Preview unavailable — only founders can view as coach.");
    });

  /** How we know the coach was there, in the brackets after the time: whether
   *  they tapped it or the geofence caught them, and how far off the venue they
   *  were when it fired. Built as a list so neither half has to know whether the
   *  other is present — the two used to be spliced together by a stack of
   *  ternaries that each had to re-derive whose turn it was to write the "(". */
  const arrivalNotes: React.ReactNode[] = [];
  if (issues.arrival && session.coachArrivalSource) {
    arrivalNotes.push(arrivalSourceLabel(session.coachArrivalSource));
  }
  if (issues.arrival && session.coachArrivalDistanceM != null) {
    arrivalNotes.push(
      <span className={session.coachArrivalDistanceM > 500 ? "text-err" : undefined}>
        {fmtDistance(session.coachArrivalDistanceM)}
      </span>
    );
  }

  const rosterList =
    roster === null ? (
      <div className="flex justify-center py-2">
        <Spinner />
      </div>
    ) : roster.length === 0 ? (
      <p className="text-sm text-fg-2">No players booked yet.</p>
    ) : (
      <ul className="space-y-1.5">
        {roster.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-3 text-sm">
            <span className={p.status === "waitlisted" ? "text-fg-2" : undefined}>
              {p.name}
            </span>
            {p.status === "attended" ? (
              <Badge tone="ok">Present</Badge>
            ) : p.status === "no_show" ? (
              <Badge tone="err">Absent</Badge>
            ) : p.status === "waitlisted" ? (
              <Badge>Waiting{p.waitlistPosition ? ` · ${p.waitlistPosition}` : ""}</Badge>
            ) : (
              <Badge>Unmarked</Badge>
            )}
          </li>
        ))}
      </ul>
    );

  return (
    <Sheet
      open
      onClose={onClose}
      // Only while he is actually mid-edit — the scope step is a decision, not
      // a form, and the Session tab has nothing to lose.
      dirty={step === "edit" && tab === "edit" && anyChanged}
      title={session.title}
    >
      {step === "scope" ? (
        /* ── Google Calendar-style scope chooser ──
           One screen, two verbs. Saving asks it because the change is
           ambiguous; cancelling asks it because the two answers are wildly
           different sizes and the difference must be a deliberate tap, not a
           button you were already reaching for. */
        <div className="space-y-4">
          <p className="font-medium">
            {scopeMode === "cancel" ? "Cancel which?" : "Apply these changes to…"}
          </p>
          <div className="space-y-2">
            <label
              className={`flex items-start gap-3 rounded-[8px] border p-3 ${
                classChanged && scopeMode === "save"
                  ? "cursor-not-allowed border-line opacity-50"
                  : scope === "session"
                    ? "cursor-pointer border-ember"
                    : "cursor-pointer border-line hover:border-ember"
              }`}
            >
              <Radio
                name="scope"
                className="mt-1"
                checked={scope === "session"}
                disabled={classChanged && scopeMode === "save"}
                onChange={() => setScope("session")}
              />
              <span>
                <span className="block font-medium">
                  Just this {thisDayName}
                  {scopeMode === "cancel" ? ` — ${formatSessionDate(session.starts_at)}` : ""}
                </span>
                <span className="block text-sm text-fg-2">
                  {scopeMode === "cancel"
                    ? "Everyone booked gets a message, and private lessons get their minutes back. Other weeks stay as they are."
                    : `Only ${formatSessionDate(session.starts_at)} changes. Other weeks stay as they are.`}
                </span>
              </span>
            </label>
            <label
              className={`flex items-start gap-3 rounded-[8px] border p-3 ${
                scope === "class"
                  ? "cursor-pointer border-ember"
                  : "cursor-pointer border-line hover:border-ember"
              }`}
            >
              <Radio
                name="scope"
                className="mt-1"
                checked={scope === "class"}
                onChange={() => setScope("class")}
              />
              <span>
                <span className="block font-medium">
                  {scopeMode === "cancel"
                    ? `Every ${classDayName} — end the class`
                    : `Every ${classDayName} — the whole class`}
                </span>
                <span className="block text-sm text-fg-2">
                  {scopeMode === "cancel"
                    ? "All upcoming weeks are cancelled and everyone booked gets a message. Past sessions stay in the history — you can restore the class from the Timetable."
                    : `All upcoming weeks of ${session.title} change. Everyone booked gets a message automatically.`}
                </span>
              </span>
            </label>
          </div>
          {classChanged && scopeMode === "save" && (
            <p className="text-sm text-fg-2">
              You changed the name, description, level, venue or length — those always apply
              to the whole class.
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setStep("edit");
                setScopeMode("save");
              }}
              disabled={pending}
            >
              Back
            </Button>
            {/* The label follows the choice rather than saying "Confirm" — the
                same rule ConfirmAction follows everywhere else: a destructive
                button names what it destroys. */}
            <Button
              variant={scopeMode === "cancel" ? "destructive" : "primary"}
              onClick={() => (scopeMode === "cancel" ? applyCancel(scope) : apply(scope))}
              loading={pending}
            >
              {scopeMode === "cancel"
                ? scope === "session"
                  ? `Cancel this ${thisDayName}`
                  : "End the class"
                : "Apply"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* ── Two tabs: what this is, and what you can do to it ──
              Not sticky. Sheet.tsx already pins the title bar AND marks it
              touch-none because it is the drag-to-dismiss grab area; a second
              sticky strip would eat ~44px of an 88dvh panel and sit in the
              gesture path. */}
          <div role="radiogroup" aria-label="Session or edit" className="grid grid-cols-2 gap-2">
            {(["session", "edit"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                onClick={() => setTab(t)}
                aria-checked={tab === t}
                className={`pressable min-h-11 rounded-[8px] border px-2 text-sm font-semibold ${
                  tab === t
                    ? "border-ember bg-ember text-ivory"
                    : "border-line hover:border-ember"
                }`}
              >
                {t === "session" ? "Session" : "Edit"}
              </button>
            ))}
          </div>

          {tab === "session" && (
            <>
              {/* ── When and where ── */}
              <div>
                <p className="tnum font-display text-3xl">
                  {formatSessionDate(session.starts_at)}
                </p>
                <p className="mt-1 text-fg-2">
                  {session.venueName ?? "Private address"} ·{" "}
                  {formatClock(session.starts_at)}–{formatClock(session.ends_at)} ·{" "}
                  {session.capacity} spots
                  {/* A capacity override is invisible otherwise, and "12 spots"
                      on a class of 8 is exactly the kind of thing he'd only
                      discover by wondering why the numbers disagree. */}
                  {session.capacity !== session.classCapacity
                    ? ` (normally ${session.classCapacity})`
                    : ""}
                </p>
                {session.address && (
                  <AddressDisplay address={session.address} audience="staff" className="mt-2" />
                )}
                {/* What kind of class, in the same glyph + words as the card he
                    just tapped. It was two ember badges — the exact pair the
                    cards dropped — so the app answered "what is this?" quietly
                    on the list and then shouted a different answer, in the
                    colour that means "live right now", the moment he opened it.
                    A sheet is where he confirms what he tapped; it has to look
                    like it. Everything in the row below is state, not kind. */}
                <ClassTypeLine
                  kind={classKind(session)}
                  className="mt-2"
                  detail={[
                    session.isPrivate
                      ? (session.privatePlayerName ?? session.playerName ?? "no client yet")
                      : null,
                  ]}
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  {detail?.status === "cancelled" && <Badge tone="err">Cancelled</Badge>}
                  {!session.classActive && !session.isPrivate && (
                    <Badge tone="neutral">Booking paused</Badge>
                  )}
                </div>
                {detail?.status === "cancelled" && detail.cancelReason && (
                  <p className="mt-1.5 text-sm text-fg-2">{detail.cancelReason}</p>
                )}
              </div>

              {/* ── The one thing that needs him, if anything does ── */}
              {!session.coachId && (
                <div className="space-y-2 rounded-[12px] border border-err p-4">
                  <p className="label !text-err">No coach yet</p>
                  <p className="text-sm text-fg-2">
                    Nobody is rostered on this session.
                  </p>
                  <Button className="w-full" onClick={() => goEdit("coach")}>
                    Pick a coach
                  </Button>
                </div>
              )}
              {/* ── The card's red chips, spelled out ──
                  This is what the schedule's chips are FOR. The card can only
                  afford "✗ Attendance 8"; opening it is how he finds out which
                  eight, whether the coach ever turned up, and — the part that
                  was missing entirely — how to actually clear it. Everything
                  here is a reason the card is not green. */}
              {anyOutstanding && (
                <div className="space-y-3 rounded-[12px] border border-err p-4">
                  {/* Not "Not closed out" — that is the phrase the codebase
                      thinks in and it describes a condition. And not "Still to
                      do" either, which was the first try and was wrong the
                      moment a late arrival could put a card in here: that is
                      something to know, not something to do. Same instinct that
                      turned "Register" into "Attendance" — say the plain thing
                      that stays true of every row underneath it. */}
                  <p className="label !text-err">Needs attention</p>
                  <ul className="space-y-2 text-sm">
                    {lateArrival && (
                      <li>
                        <span aria-hidden className="mr-1.5 text-err">
                          !
                        </span>
                        <span className="font-medium">
                          {detail?.coachName ?? "The coach"} arrived{" "}
                          {issues.arrival?.label}.
                        </span>{" "}
                        {/* No claim about what colour the card is: this same
                            line shows on a live session, which is ember for a
                            reason that has nothing to do with lateness. */}
                        <span className="text-fg-2">
                          The class started without them and the parents were
                          left waiting. Nothing to mark here — it is a thing to
                          know, and to raise with them.
                        </span>
                      </li>
                    )}
                    {issues.noArrival && (
                      <li>
                        <span aria-hidden className="mr-1.5 text-err">
                          ✗
                        </span>
                        <span className="font-medium">Nobody marked the coach in.</span>{" "}
                        <span className="text-fg-2">
                          {detail?.coachConfirmedAt
                            ? `${detail?.coachName ?? "They"} said they were coming, but never marked arriving — so nobody was told the class had started.`
                            : `${detail?.coachName ?? "They"} never confirmed and never marked arriving, so we have no evidence this class was taught.`}
                        </span>
                      </li>
                    )}
                    {unmarkedCount > 0 && (
                      <li>
                        <span aria-hidden className="mr-1.5 text-err">
                          ✗
                        </span>
                        {/* No denominator until the roster is actually in.
                            `session.capacity` is the size of the room, not the
                            number of children booked into it, and "8 of 8 not
                            marked" on a class of three is a worse answer than
                            no answer. */}
                        <span className="font-medium">
                          {roster
                            ? `${unmarkedCount} of ${booked.length} players not marked.`
                            : `${unmarkedCount} player${unmarkedCount === 1 ? "" : "s"} not marked.`}
                        </span>{" "}
                        <span className="text-fg-2">
                          {/* The names, not just the number. "8 unmarked" is the
                              card's job; the sheet is where he finds out it is
                              the same three every week. */}
                          {roster
                            ? `Nobody has said whether ${listNames(unmarked.map((p) => p.name))} turned up.`
                            : "Nobody has said whether they turned up."}
                        </span>
                      </li>
                    )}
                    {issues.assess > 0 && (
                      <li>
                        <span aria-hidden className="mr-1.5 text-err">
                          ✗
                        </span>
                        <span className="font-medium">
                          {issues.assess} player{issues.assess === 1 ? "" : "s"} not rated.
                        </span>{" "}
                        <span className="text-fg-2">
                          They were marked present and have no assessment from this
                          session, so their parents have nothing to read.
                        </span>
                      </li>
                    )}
                  </ul>
                  {/* Only when there is something a tap can actually change. A
                      lateness that cannot be un-happened must not grow a button
                      promising to fix it. */}
                  {owedWork &&
                    (session.coachId && canMark ? (
                      <Button className="w-full" onClick={fixAsCoach} loading={pending}>
                        Fix it in {detail?.coachName?.split(" ")[0] ?? "the coach"}&apos;s app
                      </Button>
                    ) : (
                      <p className="text-sm text-fg-2">
                        {session.coachId
                          ? "This session closed for changes a week after it ran — its paperwork can't be corrected now."
                          : "Nobody was rostered on this session, so there is nobody to mark it."}
                      </p>
                    ))}
                </div>
              )}
              {isOpenPrivate && (
                <div className="space-y-2 rounded-[12px] border border-ember p-4">
                  <p className="label">No client on this slot</p>
                  <p className="text-sm text-fg-2">
                    It is held with nobody in it. No minutes are charged until someone
                    is booked in.
                  </p>
                  <Button className="w-full" onClick={() => goEdit("assign")}>
                    Assign a player
                  </Button>
                </div>
              )}

              {/* ── The coach: who, and what we know about them turning up ── */}
              {session.coachId && (
                <div className="space-y-2 rounded-[12px] border border-line p-4">
                  <p className="label">Coach</p>
                  <p className="font-medium">{detail?.coachName ?? "—"}</p>
                  {/* Saying he's coming and actually arriving are two different
                      events, and the sheet used to collapse both into one
                      badge — so "not arrived yet" read the same whether he had
                      confirmed or had said nothing at all. */}
                  <p className="text-sm text-fg-2">
                    {detail?.coachConfirmedAt
                      ? `Said they're coming ${formatClock(detail.coachConfirmedAt)}`
                      : "Hasn't confirmed yet"}
                    {issues.arrival ? (
                      <>
                        {` · arrived ${formatClock(session.coachArrivedAt as string)} — `}
                        {/* BOTH HALVES, and only here. The card prints the gap
                            alone because that is what he is scanning for; this
                            keeps the wall clock beside it, because a timestamp
                            is what an argument with a coach needs and "12 min
                            late" is what a decision needs. Red only past the
                            grace — see lib/session-issues.ts. */}
                        <span className={issues.arrival.late ? "text-err" : undefined}>
                          {issues.arrival.label}
                        </span>
                        {arrivalNotes.length > 0 && (
                          <>
                            {" ("}
                            {arrivalNotes.map((n, i) => (
                              <span key={i}>
                                {i > 0 ? ", " : ""}
                                {n}
                              </span>
                            ))}
                            {")"}
                          </>
                        )}
                      </>
                    ) : (
                      " — not arrived yet"
                    )}
                  </p>
                  <button
                    type="button"
                    onClick={fixAsCoach}
                    disabled={pending}
                    className="text-sm text-ember hover:underline disabled:opacity-50"
                  >
                    Open this session in their app →
                  </button>
                </div>
              )}

              {/* ── Who's booked, and who was marked ── */}
              <div className="space-y-3 rounded-[12px] border border-line p-4">
                <p className="label">
                  Players{" "}
                  {roster !== null && (
                    <span className="tnum font-normal normal-case text-fg-2">
                      {booked.length} of {session.capacity} booked ·{" "}
                      {markedCount > 0 ? `${markedCount} marked` : "nobody marked"}
                      {waitlisted.length > 0
                        ? ` · ${waitlisted.length} waiting`
                        : ""}
                    </span>
                  )}
                </p>
                {rosterList}
                {detail && detail.cancelledCount > 0 && (
                  <p className="text-sm text-fg-2">
                    {detail.cancelledCount} cancelled.
                  </p>
                )}
              </div>

              {/* ── What the coach wrote afterwards ──
                  Written from the coach's own session screen. Surfacing it here
                  is a deliberate change to who that note is for. */}
              {detail?.coachNotes && (
                <div className="space-y-2 rounded-[12px] border border-line p-4">
                  <p className="label">Coach&apos;s note</p>
                  <p className="text-sm whitespace-pre-wrap">{detail.coachNotes}</p>
                </div>
              )}

              {/* ── Where this session sits: one date, or a pattern ── */}
              {session.isPrivate ? (
                <p className="text-sm text-fg-2">
                  A private session stands on its own — there&apos;s no weekly pattern
                  behind it.
                </p>
              ) : session.classRecurring ? (
                <p className="text-sm text-fg-2">
                  Repeats every {classDayName}. Pausing, restoring and deleting the class
                  live on the{" "}
                  <Link
                    href={`/admin/schedule?view=timetable&class=${session.classId}`}
                    className="text-ember hover:underline"
                  >
                    Timetable
                  </Link>
                  .
                </p>
              ) : (
                <p className="text-sm text-fg-2">
                  This is a one-time class — it runs on this date and never repeats.
                </p>
              )}
            </>
          )}

          {tab === "edit" && (
            <>
              {/* No preamble about what a change will reach. The Info tab already
                  says whether this repeats, and the scope step asks "this
                  {thisDayName}, or every {classDayName}?" at the moment he
                  presses Save — which is when the answer matters and the only
                  time it can be acted on. Saying it a third time here, in a
                  third wording, was the panel talking to itself. */}

          {/* ── Assign a client — the reason an open private slot needs you ── */}
          {isOpenPrivate && (
            <ActionSection
              key={`assign-${focus}`}
              label="Assign a player"
              tone="ember"
              defaultOpen={focus === "assign" || focus === null}
            >
              <p className="text-sm text-fg-2">
                This slot is held with nobody in it. Pick the player to book in — their
                family&apos;s minutes are debited when you do.
              </p>
              {/* Player-first, family in brackets — the same picker as the
                  create sheet, so filling a held slot and booking a new one ask
                  the same question. */}
              <Select
                label="Player"
                value={playerChoiceValue(assignClientId, assignPlayerId)}
                onChange={(e) => {
                  const { clientId, playerId } = splitPlayerChoice(e.target.value);
                  setAssignClientId(clientId);
                  setAssignPlayerId(playerId);
                }}
              >
                <option value="">— pick a player —</option>
                {playerChoices(clients).map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </Select>
              <Button onClick={assign} loading={pending} disabled={!assignClientId} className="w-full">
                Assign client
              </Button>
            </ActionSection>
          )}

          {/* ── School class: add a walk-in pupil ── */}
          {session.isSchool && (
            <ActionSection label="Add a player" defaultOpen={roster !== null && roster.length === 0}>
              <p className="text-sm text-fg-2">
                School pupils aren&apos;t booked online — add whoever attends. The coach can
                also add them from the session.
              </p>
              {schoolAdding ? (
                <>
                  <Input
                    label="Player name"
                    value={schoolName}
                    onChange={(e) => setSchoolName(e.target.value)}
                    autoFocus
                  />
                  <Input
                    label="Grade"
                    type="number"
                    min={1}
                    max={13}
                    hint="Their school grade — used to work out their age."
                    value={schoolGrade}
                    onChange={(e) => setSchoolGrade(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <Button onClick={addPupil} loading={pending}>
                      Add player
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={pending}
                      onClick={() => {
                        setSchoolAdding(false);
                        setSchoolName("");
                        setSchoolGrade("");
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </>
              ) : (
                <Button variant="ghost" onClick={() => setSchoolAdding(true)} className="w-full">
                  + Add player
                </Button>
              )}
            </ActionSection>
          )}

          {/* ── Coach ── */}
          <ActionSection
            key={`coach-${focus}`}
            label="Coach"
            summary={detail?.coachName ?? (session.coachId ? undefined : "No coach yet")}
            tone={session.coachId ? "neutral" : "ember"}
            defaultOpen={focus === "coach"}
          >
            {ranked === null ? (
              <div className="flex justify-center py-3">
                <Spinner />
              </div>
            ) : ranked.length === 0 ? (
              <p className="text-sm text-fg-2">No coach fits this slot automatically.</p>
            ) : (
              <div className="space-y-1.5">
                <p className="text-sm text-fg-2">Best fits first — tap one:</p>
                {ranked.slice(0, 5).map((r) => (
                  <button
                    key={r.coachId}
                    onClick={() => setTarget(r.coachId)}
                    className={`pressable flex min-h-11 w-full items-center justify-between rounded-[8px] border px-3 py-2 text-sm ${
                      target === r.coachId
                        ? "border-ember bg-surface"
                        : "border-line hover:border-ember"
                    }`}
                  >
                    <span>{r.name}</span>
                    <span className="tnum text-fg-2">{r.score.toFixed(0)}</span>
                  </button>
                ))}
              </div>
            )}
            <Select
              label="Or pick any coach"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            >
              <option value="">— pick a coach —</option>
              {/* The coach who is actually on this session, even if they have
                  since been deactivated. `coaches` is filtered to active, so a
                  session still rostered to a retired coach bound the select to
                  an id with no option and rendered it BLANK — the same failure
                  the Length field had. */}
              {target && !coaches.some((c) => c.id === target) && (
                <option value={target}>{detail?.coachName ?? "Current coach"}</option>
              )}
              {coaches.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <label className="flex items-center gap-3 text-sm">
              <Checkbox size="md" checked={lock} onChange={(e) => setLock(e.target.checked)} />
              Keep this coach — don&apos;t swap them automatically
            </label>
            {coachOverride ? (
              <div className="space-y-2 rounded-[8px] border border-err p-3">
                <p className="text-sm text-fg-2">{coachOverride} Assign them anyway?</p>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="ghost"
                    disabled={pending}
                    onClick={() => setCoachOverride(null)}
                  >
                    Keep
                  </Button>
                  <Button loading={pending} onClick={applyCoachOverride}>
                    Assign anyway
                  </Button>
                </div>
              </div>
            ) : !session.isPrivate && session.classRecurring ? (
              /* Two labelled buttons rather than a question screen. Changing a
                 coach is the most frequent job in this sheet and it must not
                 grow a step — and unlike cancelling, neither answer destroys
                 anything, so naming both is enough of a guard. "Every Tuesday"
                 is also the reason this no longer means a trip to the Weekly
                 tab to do the same job. */
              <div className="grid grid-cols-2 gap-2">
                <Button
                  loading={pending}
                  disabled={!target}
                  onClick={() => applyCoach("session")}
                >
                  Just this {thisDayName}
                </Button>
                <Button
                  loading={pending}
                  disabled={!target}
                  onClick={() => applyCoach("class")}
                >
                  Every {classDayName}
                </Button>
              </div>
            ) : (
              <Button
                onClick={() => applyCoach("session")}
                loading={pending}
                disabled={!target}
                className="w-full"
              >
                Change coach
              </Button>
            )}
          </ActionSection>

          {/* ── Move / edit — one form, scoped on save ── */}
          <ActionSection label={session.isPrivate ? "Move this class" : "Move / edit"}>
            {/* Stacked, not two half-columns. The time picker in a half-column
                had about 51px per control on a phone and clipped all three.
                And it is "Date" here — this is a calendar date; "Day" is the
                word the weekday chips use, and one label meant both. */}
            <Input
              label="Date"
              type="date"
              value={date}
              onChange={(e) => {
                const newDate = e.target.value;
                setDate(newDate);
                const newWeekday = weekdayOfDate(newDate);
                setForm(f => ({ ...f, weekday: newWeekday, title: generateClassTitle(newWeekday, f.time, venueNameOf(f.venueId)) }));
              }}
            />
            <TimeSelect12h
              label="Time"
              value={form.time}
              onChange={(time) => updateForm({ ...form, time })}
            />
            {!session.isPrivate && (
              <ClassDetailFields form={form} onChange={updateForm} venues={venues} />
            )}
            <Button
              className="w-full"
              loading={pending}
              disabled={session.isPrivate ? !slotChanged : !anyChanged}
              onClick={() => {
                setMessage(null);
                if (session.isPrivate) {
                  // Private sessions are one-offs — nothing to scope.
                  startTransition(async () => {
                    const r = await moveSession(session.id, date, form.time);
                    if (r.ok)
                      okMsg(
                        r.coachCleared
                          ? "Session moved and the client has been told. The coach couldn't take the new time, so it's off their calendar — the Schedule shows it needs someone."
                          : "Session moved — everyone booked has been told."
                      );
                    else errMsg(r.error ?? "Move failed.");
                  });
                } else {
                  setScope(classChanged ? "class" : "session");
                  setStep("scope");
                }
              }}
            >
              Save changes
            </Button>
          </ActionSection>

          {/* ── More: the rare, destructive actions — confirmed in-sheet ── */}
          <ActionSection label="More">
            {/* Cancelling one date and ending the whole class were two
                separate controls sitting next to each other, one of them
                reading "remove every week" in the same size type as the other.
                They are the same verb at two wildly different sizes, so they
                ask the same question everything else here asks. */}
            {!session.isPrivate && session.classRecurring ? (
              <Button
                variant="destructive"
                className="w-full"
                disabled={pending}
                onClick={() => {
                  setMessage(null);
                  setScope("session");
                  setScopeMode("cancel");
                  setStep("scope");
                }}
              >
                Cancel…
              </Button>
            ) : (
              <ConfirmAction
                label="Cancel this session"
                confirmLabel="Cancel it"
                prompt="Cancel this session? Everyone booked gets a message, and private lessons get their minutes back."
                pending={pending}
                onConfirm={() =>
                  startTransition(async () => {
                    const r = await cancelSession(session.id, "cancelled by academy");
                    if (r.ok) okMsg("Cancelled — everyone booked has been told.");
                    else errMsg(r.error ?? "Cancel failed.");
                  })
                }
              />
            )}

            {/* Pausing booking is a whole-class switch that existed only on the
                Weekly tab, while THIS sheet rendered the "Booking paused" badge
                — so the founder could read the state here and had to go
                somewhere else to change it. */}
            {!session.isPrivate && session.classRecurring && (
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const r = await setClassActive(session.classId, !session.classActive);
                    if (r.ok)
                      okMsg(
                        session.classActive
                          ? "Booking paused for every week. The class stays on the schedule, marked Paused, until you reopen it."
                          : "Booking reopened for every week."
                      );
                    else errMsg(r.error ?? "Failed.");
                  })
                }
                className={`w-full text-center text-sm underline-offset-4 hover:underline disabled:opacity-50 ${
                  session.classActive ? "text-ok" : "text-err"
                }`}
              >
                {session.classActive
                  ? "Open for booking — pause every week"
                  : "Paused — reopen every week"}
              </button>
            )}

            {session.isPrivate && session.privateClientId && (
              <ConfirmAction
                label="Cancel all upcoming sessions for this client"
                confirmLabel="Cancel them all"
                prompt={`Cancel all upcoming private sessions for ${session.playerName ?? "this client"}? Their minutes will be returned and they'll be notified.`}
                pending={pending}
                onConfirm={() =>
                  startTransition(async () => {
                    const r = await cancelAllFuturePrivateSessions(session.id);
                    if (r.ok) {
                      if (r.cancelled)
                        okMsg(
                          `Cancelled ${r.cancelled} upcoming session${r.cancelled === 1 ? "" : "s"} — minutes returned and the client was told.`
                        );
                      else setMessage({ text: "No upcoming sessions found." });
                      onClose();
                    } else errMsg(r.error ?? "Failed.");
                  })
                }
              />
            )}

            {/* Say where the rest lives rather than leaving him to find out
                that it isn't here. */}
            {!session.isPrivate && session.classRecurring && (
              <p className="text-sm text-fg-2">
                Deleting a class for good, and restoring an ended one, happen on the{" "}
                <Link
                  href={`/admin/schedule?view=timetable&class=${session.classId}`}
                  className="text-ember hover:underline"
                >
                  Timetable
                </Link>
                .
              </p>
            )}
          </ActionSection>
            </>
          )}

          {message &&
            (message.ok ? (
              <ActionResult>{message.text}</ActionResult>
            ) : (
              <p className="text-sm text-fg-2">{message.text}</p>
            ))}
        </div>
      )}
    </Sheet>
  );
}
