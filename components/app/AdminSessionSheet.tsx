"use client";

// Session detail sheet for the merged admin calendar. One edit form covers
// everything; on save a Google Calendar-style scope step asks whether the
// change is for "just this session" or "every week" (the whole class).

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { Sheet } from "@/components/ui/Sheet";
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
  reassignSession,
  getSessionRoster,
  setSessionCapacity,
  updateGroupClass,
  type RosterEntry,
} from "@/app/admin/schedule/actions";
import { cancelSession, getRankedCoaches } from "@/app/admin/actions";
import { viewAsCoach } from "@/app/coach/preview-actions";
import { AddressDisplay } from "@/components/app/AddressDisplay";
import { ActionResult } from "@/components/app/ActionResult";
import { ClassDetailFields, generateClassTitle, type ClassFormState } from "./ClassFields";
import { TimeSelect12h } from "./TimeSelect12h";
import {
  formatClock,
  formatSessionDate,
  wallDate,
  wallTime,
} from "@/lib/academy-time";
import {
  arrivalSourceLabel,
  fmtDistance,
  weekdayOfDate,
  WEEKDAY_NAME,
  type ClientOption,
  type Coach,
  type SessionRow,
  type Venue,
} from "./admin-calendar-types";

type Scope = "session" | "class";

export function AdminSessionSheet({
  session,
  coaches,
  venues,
  clients,
  onClose,
}: {
  session: SessionRow;
  coaches: Coach[];
  venues: Venue[];
  clients: ClientOption[];
  onClose: () => void;
}) {
  // Mounted fresh per session (parent keys on session.id), so initializers
  // read the session directly — no prop-sync effects.
  const [form, setForm] = useState<ClassFormState>({
    title: generateClassTitle(session.classLevel, session.classWeekday, wallTime(session.starts_at)),
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
    setForm({ ...next, title: generateClassTitle(next.skillLevel, next.weekday, next.time) });
  }
  const [date, setDate] = useState(wallDate(session.starts_at));
  const [step, setStep] = useState<"edit" | "scope">("edit");
  const [scope, setScope] = useState<Scope>("session");
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
  const [assignOverride, setAssignOverride] = useState(false);
  const assignClient = clients.find((c) => c.id === assignClientId) ?? null;

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
        assignPlayerId || undefined,
        assignOverride
      );
      if (r.ok) {
        okMsg("Client assigned — the session is on their schedule and their minutes were debited.");
        onClose();
      } else errMsg(r.error ?? "Couldn't assign the client.");
    });
  }

  // Who's booked and whether they showed up — loaded alongside the coach ranks.
  const [roster, setRoster] = useState<RosterEntry[] | null>(null);

  useEffect(() => {
    let alive = true;
    getRankedCoaches(session.id).then((r) => {
      if (alive) setRanked(r);
    });
    getSessionRoster(session.id).then((r) => {
      if (alive) setRoster(r);
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

  function applyCoach() {
    if (!session || !target) return;
    setCoachOverride(null);
    startTransition(async () => {
      const r = await reassignSession(session.id, target, lock);
      if (!r.ok && r.code === "filter_failed") {
        // The rules say no — but the founder can override. A hard time clash is
        // still blocked by the database either way. Ask in-sheet, not native.
        setCoachOverride(r.error ?? "That coach doesn't fit the rules.");
        return;
      }
      if (r.ok) okMsg("Coach changed — everyone affected has been told.");
      else errMsg(r.error ?? "Failed.");
    });
  }

  function applyCoachOverride() {
    if (!session || !target) return;
    startTransition(async () => {
      const r = await reassignSession(session.id, target, lock, true);
      setCoachOverride(null);
      if (r.ok) okMsg("Coach changed — everyone affected has been told.");
      else errMsg(r.error ?? "Failed.");
    });
  }

  function apply(chosen: Scope) {
    if (!session) return;
    startTransition(async () => {
      if (chosen === "session") {
        if (slotChanged) {
          const r = await moveSession(session.id, date, form.time);
          if (!r.ok) {
            errMsg(r.error ?? "Move failed.");
            setStep("edit");
            return;
          }
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
        // booked. Word the ✓ for whichever actually happened.
        okMsg(
          slotChanged
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
          okMsg("Saved for every week — upcoming sessions moved and everyone booked was told.");
        else errMsg(r.error ?? "Couldn't save the class.");
      }
      setStep("edit");
    });
  }

  // Booked players with attendance — attended/no-show set by the coach on the
  // session sheet; "confirmed" means nobody has marked them yet.
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
            <span>{p.name}</span>
            {p.status === "attended" ? (
              <Badge tone="ok">Present</Badge>
            ) : p.status === "no_show" ? (
              <Badge tone="err">Absent</Badge>
            ) : (
              <Badge>Unmarked</Badge>
            )}
          </li>
        ))}
      </ul>
    );

  return (
    <Sheet open onClose={onClose} title={session.title}>
      {step === "scope" ? (
        /* ── Google Calendar-style scope chooser ── */
        <div className="space-y-4">
          <p className="font-medium">Apply these changes to…</p>
          <div className="space-y-2">
            <label
              className={`flex items-start gap-3 rounded-[8px] border p-3 ${
                classChanged
                  ? "cursor-not-allowed border-line opacity-50"
                  : scope === "session"
                    ? "cursor-pointer border-ember"
                    : "cursor-pointer border-line hover:border-ember"
              }`}
            >
              <input
                type="radio"
                name="scope"
                className="mt-1 h-4 w-4 accent-[var(--ember)]"
                checked={scope === "session"}
                disabled={classChanged}
                onChange={() => setScope("session")}
              />
              <span>
                <span className="block font-medium">
                  Just this {WEEKDAY_NAME[weekdayOfDate(wallDate(session.starts_at))] ?? "day"}
                </span>
                <span className="block text-sm text-fg-2">
                  Only {formatSessionDate(session.starts_at)} changes. Other weeks stay as they are.
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
              <input
                type="radio"
                name="scope"
                className="mt-1 h-4 w-4 accent-[var(--ember)]"
                checked={scope === "class"}
                onChange={() => setScope("class")}
              />
              <span>
                <span className="block font-medium">
                  Every {WEEKDAY_NAME[session.classWeekday] ?? "week"} — the whole class
                </span>
                <span className="block text-sm text-fg-2">
                  All upcoming weeks of {session.title} change. Everyone booked gets a
                  message automatically.
                </span>
              </span>
            </label>
          </div>
          {classChanged && (
            <p className="text-sm text-fg-2">
              You changed the name, description, level, venue or length — those always apply
              to the whole class.
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="ghost" onClick={() => setStep("edit")} disabled={pending}>
              Back
            </Button>
            <Button onClick={() => apply(scope)} disabled={pending}>
              {pending ? <Spinner /> : "Apply"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* ── Header block: the facts a founder checks courtside ── */}
          <div>
            <p className="tnum font-display text-3xl">{formatSessionDate(session.starts_at)}</p>
            <p className="mt-1 text-fg-2">
              {session.venueName ?? "Private address"} · {session.capacity} spots
            </p>
            {session.address && (
              <AddressDisplay address={session.address} audience="staff" className="mt-2" />
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              {session.isPrivate && <Badge tone="ember">Private</Badge>}
              {session.isSchool && <Badge tone="ember">School class</Badge>}
              {!session.classActive && !session.isPrivate && (
                <Badge tone="neutral">Booking paused</Badge>
              )}
              {session.coachId &&
                (session.coachArrivedAt ? (
                  <Badge tone="ok">Coach arrived {formatClock(session.coachArrivedAt)}</Badge>
                ) : (
                  <Badge tone="neutral">Coach not arrived yet</Badge>
                ))}
            </div>
            {session.coachId &&
              session.coachArrivedAt &&
              (session.coachArrivalSource || session.coachArrivalDistanceM != null) && (
                <p className="mt-1.5 text-sm text-fg-2">
                  {session.coachArrivalSource && arrivalSourceLabel(session.coachArrivalSource)}
                  {session.coachArrivalDistanceM != null && (
                    <>
                      {session.coachArrivalSource ? " · " : ""}
                      <span className={session.coachArrivalDistanceM > 500 ? "text-err" : undefined}>
                        {fmtDistance(session.coachArrivalDistanceM)}
                      </span>
                    </>
                  )}
                </p>
              )}
            {session.coachId && (
              <button
                type="button"
                onClick={() =>
                  startTransition(async () => {
                    const ok = await viewAsCoach(session.coachId as string);
                    // Hard navigation: the preview cookie is set httpOnly by the
                    // server action, so a soft router.push would re-render /coach
                    // from the client cache without it. A full load re-reads it.
                    if (ok) window.location.assign("/coach");
                    else errMsg("Preview unavailable — only founders can view as coach.");
                  })
                }
                disabled={pending}
                className="mt-3 text-sm text-ember hover:underline disabled:opacity-50"
              >
                View this coach&apos;s app →
              </button>
            )}
            {!session.isPrivate && session.classRecurring && (
              <Link
                href={`/admin/weekly?class=${session.classId}`}
                className="mt-3 block text-sm text-fg-2 hover:text-ember hover:underline"
              >
                This repeats every {WEEKDAY_NAME[session.classWeekday] ?? "week"} — edit the
                whole class →
              </Link>
            )}
          </div>

          {/* ── Roster (always visible): who's booked and who showed ── */}
          <div className="space-y-3 rounded-[12px] border border-line p-4">
            <p className="label">
              Players{" "}
              {roster !== null && (
                <span className="tnum text-fg-2">
                  {roster.length}/{session.capacity}
                </span>
              )}
            </p>
            {rosterList}
          </div>

          {/* ── Assign a client — the reason an open private slot needs you ── */}
          {isOpenPrivate && (
            <ActionSection label="Assign a client" tone="ember" defaultOpen>
              <p className="text-sm text-fg-2">
                This slot is held with no client yet. Pick one to book them in — their
                minutes are debited when you do.
              </p>
              <Select
                label="Client"
                value={assignClientId}
                onChange={(e) => {
                  setAssignClientId(e.target.value);
                  setAssignPlayerId("");
                }}
              >
                <option value="">— pick a client —</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name || "Unnamed client"}
                  </option>
                ))}
              </Select>
              {assignClient && assignClient.players.length > 1 && (
                <Select
                  label="Player"
                  value={assignPlayerId}
                  onChange={(e) => setAssignPlayerId(e.target.value)}
                >
                  <option value="">{assignClient.players[0].name} (default)</option>
                  {assignClient.players.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              )}
              <label className="flex cursor-pointer items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={assignOverride}
                  onChange={(e) => setAssignOverride(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[var(--ember)]"
                />
                <span>
                  <span className="font-medium">Ignore plan limits</span>
                  <span className="mt-0.5 block text-fg-2">
                    Book beyond this client&apos;s weekly session limit or session length.
                  </span>
                </span>
              </label>
              <Button onClick={assign} disabled={pending || !assignClientId} className="w-full">
                {pending ? <Spinner /> : "Assign client"}
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
                    <Button onClick={addPupil} disabled={pending}>
                      {pending ? <Spinner /> : "Add player"}
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

          {/* ── Change coach ── */}
          <ActionSection
            label="Change coach"
            summary={session.coachId ? undefined : "No coach yet"}
            tone={session.coachId ? "neutral" : "ember"}
            defaultOpen={!session.coachId}
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
                    className={`flex w-full items-center justify-between rounded-[8px] border px-3 py-2 text-sm ${
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
              {coaches.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <label className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={lock}
                onChange={(e) => setLock(e.target.checked)}
                className="h-5 w-5 accent-[var(--ember)]"
              />
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
                  <Button disabled={pending} onClick={applyCoachOverride}>
                    {pending ? <Spinner /> : "Assign anyway"}
                  </Button>
                </div>
              </div>
            ) : (
              <Button onClick={applyCoach} disabled={pending || !target} className="w-full">
                {pending ? <Spinner /> : "Change coach"}
              </Button>
            )}
          </ActionSection>

          {/* ── Move / edit — one form, scoped on save ── */}
          <ActionSection label={session.isPrivate ? "Move this class" : "Move / edit"}>
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Day"
                type="date"
                value={date}
                onChange={(e) => {
                  const newDate = e.target.value;
                  setDate(newDate);
                  const newWeekday = weekdayOfDate(newDate);
                  setForm(f => ({ ...f, weekday: newWeekday, title: generateClassTitle(f.skillLevel, newWeekday, f.time) }));
                }}
              />
              <TimeSelect12h
                label="Time"
                value={form.time}
                onChange={(time) => updateForm({ ...form, time })}
              />
            </div>
            {!session.isPrivate && (
              <ClassDetailFields form={form} onChange={updateForm} venues={venues} />
            )}
            <Button
              className="w-full"
              disabled={pending || (session.isPrivate ? !slotChanged : !anyChanged)}
              onClick={() => {
                setMessage(null);
                if (session.isPrivate) {
                  // Private sessions are one-offs — nothing to scope.
                  startTransition(async () => {
                    const r = await moveSession(session.id, date, form.time);
                    if (r.ok) okMsg("Session moved — everyone booked has been told.");
                    else errMsg(r.error ?? "Move failed.");
                  });
                } else {
                  setScope(classChanged ? "class" : "session");
                  setStep("scope");
                }
              }}
            >
              {pending ? <Spinner /> : "Save changes"}
            </Button>
          </ActionSection>

          {/* ── More: the rare, destructive actions — confirmed in-sheet ── */}
          <ActionSection label="More">
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
            {!session.isPrivate && (
              <ConfirmAction
                label="End this class — remove every week"
                confirmLabel="End the class"
                prompt={`End ${session.title} completely? All upcoming weeks are cancelled and everyone booked gets a message. Past sessions stay in the history — and you can restore the class later from the weekly classes list.`}
                pending={pending}
                onConfirm={() =>
                  startTransition(async () => {
                    const r = await endGroupClass(session.classId);
                    if (r.ok) {
                      okMsg("Class ended — everyone affected has been told.");
                      onClose();
                    } else errMsg(r.error ?? "Failed.");
                  })
                }
              />
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
          </ActionSection>

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
