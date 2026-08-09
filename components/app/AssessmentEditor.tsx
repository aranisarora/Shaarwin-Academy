"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { submitAssessment } from "@/app/coach/players/[playerId]/actions";

type Category = { id: string; name: string };
type Skill = { id: string; category_id: string; name: string };

/**
 * Coach-facing 1-5 rating editor. Rows prefill with the latest rating (from any
 * coach) so a coach adjusts rather than starts blank. Only skills the coach
 * touches are submitted; the assessment row itself always is (the pending
 * marker). `sessionId` deep-links a pending session; null = ad-hoc assessment.
 *
 * Saving twice for the same session used to fail — the insert hit
 * skill_assessments_once_per_session and came back "Already assessed for that
 * session.", with no UPDATE policy anywhere to offer a way round it. Since
 * migration 0075 a second save amends the first, so this is now a form a coach
 * can correct rather than one shot they had to get right.
 *
 * The considered version of this screen: the whole skill list, in a page that
 * also shows the player's history. `AssessmentSheet` is the same ratings in a
 * sheet, for the thirty seconds after a class when the only question is how
 * today went.
 */
export function AssessmentEditor({
  playerId,
  sessionId,
  classTitle,
  categories,
  skills,
  initialRatings,
}: {
  playerId: string;
  sessionId: string | null;
  classTitle: string | null;
  categories: Category[];
  skills: Skill[];
  initialRatings: Record<string, number>;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, number>>(initialRatings);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function setRating(skillId: string, rating: number) {
    setValues((v) => ({ ...v, [skillId]: rating }));
    setTouched((t) => new Set(t).add(skillId));
    setMessage(null);
  }

  function save(explicit?: string[]) {
    startTransition(async () => {
      const ratings = (explicit ?? [...touched]).map((skillId) => ({
        skillId,
        rating: values[skillId],
      }));
      const r = await submitAssessment(playerId, sessionId, ratings);
      if (r.ok) {
        setMessage("Saved — you can change this any time.");
        setTouched(new Set());
        router.refresh();
      } else {
        setMessage(r.error ?? "Couldn’t save.");
      }
    });
  }

  const hasPrefill = Object.keys(initialRatings).length > 0;

  if (skills.length === 0) {
    return (
      <p className="text-sm text-fg-2">
        No active skills to assess yet. Add skills under Skills first.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {classTitle && (
        <p className="rounded-[8px] border border-ember/40 bg-surface-2 px-3.5 py-2 text-sm">
          Assessing for <strong>{classTitle}</strong>
        </p>
      )}

      {/* The honest majority verdict most weeks, and one tap rather than a
          scroll past every skill to reach Save. It files a real assessment: a
          coach who has watched a child and judged they are where they were has
          assessed them. The alternative on offer was not a more considered
          rating, it was no assessment at all. */}
      {hasPrefill && (
        <Button variant="ghost" className="w-full" disabled={pending} onClick={() => save([])}>
          No change today
        </Button>
      )}

      {categories.map((cat) => {
        const catSkills = skills.filter((s) => s.category_id === cat.id);
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
                          className={`min-h-9 w-9 rounded-[8px] border text-sm font-semibold transition-colors ${
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
        <Button onClick={() => save()} loading={pending}>
          Save assessment
        </Button>
        {message && <span className="text-sm text-fg-2">{message}</span>}
      </div>
    </div>
  );
}
