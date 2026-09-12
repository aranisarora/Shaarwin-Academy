import { Badge } from "@/components/ui/Badge";
import { masteryLabel } from "@/lib/mastery";

export type RatedCategory = { id: string; name: string };
export type RatedSkill = { id: string; category_id: string; name: string };

/**
 * Read-only mastery + per-skill rating display, shared by the admin and coach
 * player pages. Ratings render as 5 pips (filled = rating); unrated shows "—".
 * Never rendered for clients — the coach/admin RLS gates the rating data.
 */
export function SkillRatingsView({
  mastery,
  categories,
  skills,
  ratings,
}: {
  mastery: number;
  categories: RatedCategory[];
  skills: RatedSkill[];
  ratings: Map<string, number>;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-baseline gap-3">
        <span className="tnum font-display text-3xl">{mastery}</span>
        <span className="text-fg-2">/ 100</span>
        <Badge tone="ember">{masteryLabel(mastery)}</Badge>
      </div>

      {categories.length === 0 ? (
        <p className="text-sm text-fg-2">No skills defined yet.</p>
      ) : (
        categories.map((cat) => {
          const catSkills = skills.filter((s) => s.category_id === cat.id);
          if (catSkills.length === 0) return null;
          return (
            <div key={cat.id}>
              <p className="label mb-2">{cat.name}</p>
              <ul className="divide-y divide-line rounded-[12px] border border-line bg-surface-2">
                {catSkills.map((skill) => {
                  const rating = ratings.get(skill.id);
                  return (
                    <li
                      key={skill.id}
                      className="flex items-center justify-between px-4 py-2.5"
                    >
                      <span className="text-base">{skill.name}</span>
                      {rating ? <Pips value={rating} /> : <span className="text-fg-2">—</span>}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })
      )}
    </div>
  );
}

function Pips({ value }: { value: number }) {
  return (
    <span className="flex items-center gap-1" aria-label={`${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          className={`h-2.5 w-2.5 rounded-full ${n <= value ? "bg-ember" : "bg-line"}`}
        />
      ))}
    </span>
  );
}
