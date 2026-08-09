"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  createCategory,
  renameCategory,
  deleteCategory,
  createSkill,
  renameSkill,
  setSkillActive,
  deleteSkill,
} from "@/app/admin/skills/actions";

export type SkillCategory = {
  id: string;
  name: string;
  sort_order: number;
  created_at: string;
};

export type Skill = {
  id: string;
  category_id: string;
  name: string;
  active: boolean;
  sort_order: number;
  created_at: string;
};

export function SkillsManager({
  role,
  categories,
  skills,
}: {
  role: "founder" | "coach";
  categories: SkillCategory[];
  skills: Skill[];
}) {
  const isFounder = role === "founder";
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [newCategory, setNewCategory] = useState("");

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, ok = "Saved.") {
    startTransition(async () => {
      const r = await fn();
      setMessage(r.ok ? ok : (r.error ?? "Something went wrong."));
    });
  }

  return (
    <div className="space-y-6">
      {message && (
        <p className="rounded-[8px] border border-line bg-surface-2 px-3.5 py-2 text-sm text-fg-2">
          {message}
        </p>
      )}

      {isFounder && (
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newCategory.trim()) return;
            run(async () => {
              const r = await createCategory(newCategory);
              if (r.ok) setNewCategory("");
              return r;
            }, "Category added.");
          }}
        >
          {/* min-w-0 on every flex-1 that holds an <input> in this file. A bare
              flex-1 is `flex: 1 1 0%` with min-width:auto, and an input's auto
              minimum is its intrinsic size — the default 20-character box, near
              enough 176px — so the track refuses to shrink under it and pushes
              the button beside it off the right of the phone. */}
          <div className="min-w-0 flex-1">
            <Input
              label="New category"
              placeholder="e.g. Physical, Mental, Technique"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={pending || !newCategory.trim()}>
            Add
          </Button>
        </form>
      )}

      {categories.length === 0 ? (
        <p className="rounded-[12px] border border-line bg-surface-2 px-5 py-8 text-center text-fg-2">
          {isFounder
            ? "No skill categories yet. Create one above to start rating players."
            : "No skill categories yet. The founder sets these up."}
        </p>
      ) : (
        categories.map((cat) => (
          <CategoryCard
            key={cat.id}
            category={cat}
            skills={skills.filter((s) => s.category_id === cat.id)}
            isFounder={isFounder}
            pending={pending}
            run={run}
          />
        ))
      )}
    </div>
  );
}

function CategoryCard({
  category,
  skills,
  isFounder,
  pending,
  run,
}: {
  category: SkillCategory;
  skills: Skill[];
  isFounder: boolean;
  pending: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>, ok?: string) => void;
}) {
  const [name, setName] = useState(category.name);
  const [newSkill, setNewSkill] = useState("");

  return (
    <section className="rounded-[12px] border border-line bg-surface-2 p-4">
      <div className="flex items-center gap-2">
        {isFounder ? (
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              if (name.trim() && name.trim() !== category.name) {
                run(() => renameCategory(category.id, name), "Category renamed.");
              }
            }}
            className="min-h-11 min-w-0 flex-1 rounded-[8px] border border-transparent bg-transparent px-2 text-lg font-semibold text-fg hover:border-line focus:border-line"
          />
        ) : (
          <h2 className="min-w-0 flex-1 truncate px-2 text-lg font-semibold">
            {category.name}
          </h2>
        )}
        {isFounder && (
          <Button
            variant="destructive"
            className="shrink-0 px-3"
            onClick={() => {
              if (
                confirm(
                  `Delete “${category.name}” and all its skills? This removes their rating history too.`
                )
              ) {
                run(() => deleteCategory(category.id), "Category deleted.");
              }
            }}
            disabled={pending}
          >
            Delete
          </Button>
        )}
      </div>

      <ul className="mt-3 divide-y divide-line">
        {skills.length === 0 ? (
          <li className="px-2 py-3 text-sm text-fg-2">No skills yet.</li>
        ) : (
          skills.map((skill) => (
            <SkillRow
              key={skill.id}
              skill={skill}
              isFounder={isFounder}
              pending={pending}
              run={run}
            />
          ))
        )}
      </ul>

      <form
        className="mt-3 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!newSkill.trim()) return;
          run(async () => {
            const r = await createSkill(category.id, newSkill);
            if (r.ok) setNewSkill("");
            return r;
          }, "Skill added.");
        }}
      >
        <div className="min-w-0 flex-1">
          <Input
            placeholder="Add a skill…"
            value={newSkill}
            onChange={(e) => setNewSkill(e.target.value)}
          />
        </div>
        <Button
          type="submit"
          variant="ghost"
          className="shrink-0 px-3"
          disabled={pending || !newSkill.trim()}
        >
          Add skill
        </Button>
      </form>
    </section>
  );
}

function SkillRow({
  skill,
  isFounder,
  pending,
  run,
}: {
  skill: Skill;
  isFounder: boolean;
  pending: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>, ok?: string) => void;
}) {
  const [name, setName] = useState(skill.name);

  return (
    // The name and its buttons are two groups that wrap as units, not four
    // controls in a row. A founder's row is a rename field, a "Hidden" badge,
    // Hide/Restore and Delete — about 364px of content inside a card that is
    // 318px wide on a 390px phone, so it ran off the right edge and took the
    // page's horizontal scroll with it: Delete was unreachable and every other
    // screen in the app could be dragged sideways from here.
    //
    // basis-40 is the hinge. It lets the name shrink to 10rem before the button
    // group drops to its own line, so a desktop row stays exactly as it was and
    // a phone gets two clean lines instead of one broken one. The buttons keep
    // min-h-11 and only lose horizontal padding — this is a row you scan, not
    // one you should have to aim carefully at.
    <li
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 py-2 ${
        skill.active ? "" : "opacity-50"
      }`}
    >
      {isFounder ? (
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (name.trim() && name.trim() !== skill.name) {
              run(() => renameSkill(skill.id, name), "Skill renamed.");
            }
          }}
          className="min-h-9 min-w-0 flex-1 basis-40 rounded-[8px] border border-transparent bg-transparent px-2 text-base text-fg hover:border-line focus:border-line"
        />
      ) : (
        <span className="min-w-0 flex-1 basis-40 px-2 text-base">{skill.name}</span>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-2">
        {!skill.active && <Badge>Hidden</Badge>}

        <Button
          variant="ghost"
          className="px-3"
          onClick={() =>
            run(
              () => setSkillActive(skill.id, !skill.active),
              skill.active ? "Skill hidden." : "Skill restored."
            )
          }
          disabled={pending}
        >
          {skill.active ? "Hide" : "Restore"}
        </Button>

        {isFounder && (
          <Button
            variant="destructive"
            className="px-3"
            onClick={() => {
              if (confirm(`Delete “${skill.name}” and its rating history?`)) {
                run(() => deleteSkill(skill.id), "Skill deleted.");
              }
            }}
            disabled={pending}
          >
            Delete
          </Button>
        )}
      </div>
    </li>
  );
}
