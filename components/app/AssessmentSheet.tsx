"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { Skeleton } from "@/components/ui/Skeleton";
import { CheckIcon } from "@/components/ui/icons";
import { getAssessmentForm, type AssessmentForm } from "@/app/coach/assess-actions";
import { submitAssessment } from "@/app/coach/players/[playerId]/actions";

/**
 * Rate one player, without leaving where you are.
 *
 * The only route to this used to be /coach/players/[id] — a screen that also
 * carries attendance insights, a mastery breakdown, the full skills grid and a
 * notes thread, with the rating editor beneath all of it. A coach clearing six
 * children after a class paid six navigations and six scrolls to reach the one
 * control they came for, on a phone, in a hall, usually while packing up.
 *
 * So the editor comes to them: the same skills, the same 1-5, fetched on demand
 * and rendered in a sheet over whatever screen they were already on. That page
 * still exists and is still the right place to READ a player's history — this is
 * for the thirty seconds after a class when the only question is "how did they
 * do today".
 *
 * Two things make it survivable at speed:
 *
 *   • "No change today" is one tap and files a real assessment. It is not a
 *     shortcut that fakes an answer — a coach who has watched a child and judged
 *     that they are where they were last week has genuinely assessed them, and
 *     that is the honest majority verdict week to week. The alternative on offer
 *     was not a more thoughtful rating, it was no assessment at all.
 *   • Saving twice amends rather than fails. `save_session_assessment`
 *     (migration 0077) find-or-creates, so a coach who taps 2 and meant 4 taps 4
 *     and saves again. Before this, that mistake was permanent and visible to
 *     the child's parent as a wrong mastery score.
 */
export function AssessmentSheet({
  open,
  onClose,
  playerId,
  playerName,
  sessionId,
  classTitle,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  playerId: string;
  playerName: string;
  sessionId: string | null;
  classTitle?: string | null;
  /** Fired after a successful save, so a queue can advance to the next player. */
  onSaved?: () => void;
}) {
  const [form, setForm] = useState<AssessmentForm | null>(null);
  const [values, setValues] = useState<Record<string, number>>({});
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Callers mount this with `key={playerId}`, so walking a queue gives each
  // player a fresh component rather than one instance whose state has to be
  // reset by hand on the way in — the reset was four synchronous setStates in
  // an effect, which is the cascading-render shape the lint rule is there to
  // catch.
  useEffect(() => {
    let active = true;
    getAssessmentForm(playerId, sessionId).then((f) => {
      if (!active) return;
      setForm(f);
      setValues(f.ratings);
    });
    return () => {
      active = false;
    };
  }, [playerId, sessionId]);

  function setRating(skillId: string, rating: number) {
    setValues((v) => ({ ...v, [skillId]: rating }));
    setTouched((t) => new Set(t).add(skillId));
    setMessage(null);
  }

  /**
   * `explicit` is the set of skills to send. A normal save sends only what the
   * coach touched — the RPC upserts, so an untouched skill keeps its value
   * rather than being overwritten by a prefill the coach never looked at.
   */
  function save(explicit?: string[]) {
    const ids = explicit ?? [...touched];
    startTransition(async () => {
      const r = await submitAssessment(
        playerId,
        sessionId,
        ids.map((skillId) => ({ skillId, rating: values[skillId] })).filter((x) => !!x.rating)
      );
      if (!r.ok) {
        setMessage(r.error ?? "Couldn't save.");
        return;
      }
      onSaved?.();
      onClose();
    });
  }

  const hasPrefill = !!form && Object.keys(form.ratings).length > 0;
  const dirty = touched.size > 0 && !pending;

  return (
    <Sheet open={open} onClose={onClose} title={playerName} dirty={dirty}>
      <div className="space-y-5">
        {classTitle && (
          <p className="text-sm text-fg-2">
            {form?.alreadyFiled ? "Updating your assessment for" : "Assessing for"}{" "}
            <strong className="text-fg">{classTitle}</strong>
          </p>
        )}

        {!form ? (
          <div className="space-y-2">
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
        ) : form.skills.length === 0 ? (
          <p className="text-sm text-fg-2">
            No active skills to assess yet. Add skills under Skills first.
          </p>
        ) : (
          <>
            {/* The fast path, above the list rather than under it: a coach who
                agrees with last week never has to scroll at all. */}
            {hasPrefill && (
              <div className="rounded-[12px] border border-line bg-surface-2 p-4">
                <p className="text-sm text-fg-2">
                  Ratings below are where {playerName.split(" ")[0]} was last time. Change
                  what moved — or file it as it stands.
                </p>
                <Button
                  variant="ghost"
                  className="mt-3 w-full"
                  loading={pending}
                  onClick={() => save([])}
                >
                  No change today
                </Button>
              </div>
            )}

            {form.categories.map((cat) => {
              const catSkills = form.skills.filter((s) => s.category_id === cat.id);
              if (catSkills.length === 0) return null;
              return (
                <div key={cat.id}>
                  <p className="label mb-2">{cat.name}</p>
                  <ul className="space-y-2">
                    {catSkills.map((skill) => (
                      <li
                        key={skill.id}
                        className="flex items-center justify-between gap-3 rounded-[8px] border border-line bg-surface-2 px-3.5 py-2"
                      >
                        <span className="text-base">{skill.name}</span>
                        <span className="flex gap-1" role="group" aria-label={skill.name}>
                          {[1, 2, 3, 4, 5].map((n) => {
                            const selected = values[skill.id] === n;
                            return (
                              <button
                                key={n}
                                type="button"
                                onClick={() => setRating(skill.id, n)}
                                aria-pressed={selected}
                                aria-label={`${skill.name}: ${n} of 5`}
                                className={`min-h-11 w-11 rounded-[8px] border text-sm font-semibold transition-colors ${
                                  selected
                                    ? "border-ember bg-ember text-ivory"
                                    : "border-line text-fg-2 hover:border-ember hover:text-ember"
                                }`}
                              >
                                {n}
                              </button>
                            );
                          })}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}

            <div className="flex items-center gap-3">
              <Button onClick={() => save()} loading={pending} className="flex-1">
                <CheckIcon className="h-5 w-5" />
                {form.alreadyFiled ? "Update assessment" : "Save assessment"}
              </Button>
            </div>
          </>
        )}

        {message && <p className="text-sm text-err">{message}</p>}
      </div>
    </Sheet>
  );
}
