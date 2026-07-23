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

  function save() {
    startTransition(async () => {
      const ratings = [...touched].map((skillId) => ({
        skillId,
        rating: values[skillId],
      }));
      const r = await submitAssessment(playerId, sessionId, ratings);
      if (r.ok) {
        setMessage("Assessment saved.");
        setTouched(new Set());
        router.refresh();
      } else {
        setMessage(r.error ?? "Couldn’t save.");
      }
    });
  }

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
        <Button onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save assessment"}
        </Button>
        {message && <span className="text-sm text-fg-2">{message}</span>}
      </div>
    </div>
  );
}
