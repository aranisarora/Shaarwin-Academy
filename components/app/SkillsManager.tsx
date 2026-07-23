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
          <div className="flex-1">
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
            className="min-h-11 flex-1 rounded-[8px] border border-transparent bg-transparent px-2 text-lg font-semibold text-fg hover:border-line focus:border-line"
          />
        ) : (
          <h2 className="flex-1 px-2 text-lg font-semibold">{category.name}</h2>
        )}
        {isFounder && (
          <Button
            variant="destructive"
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
        <div className="flex-1">
          <Input
            placeholder="Add a skill…"
            value={newSkill}
            onChange={(e) => setNewSkill(e.target.value)}
          />
        </div>
        <Button type="submit" variant="ghost" disabled={pending || !newSkill.trim()}>
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
    <li className={`flex items-center gap-2 py-2 ${skill.active ? "" : "opacity-50"}`}>
      {isFounder ? (
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (name.trim() && name.trim() !== skill.name) {
              run(() => renameSkill(skill.id, name), "Skill renamed.");
            }
          }}
          className="min-h-9 flex-1 rounded-[8px] border border-transparent bg-transparent px-2 text-base text-fg hover:border-line focus:border-line"
        />
      ) : (
        <span className="flex-1 px-2 text-base">{skill.name}</span>
      )}

      {!skill.active && <Badge>Hidden</Badge>}

      <Button
        variant="ghost"
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
    </li>
  );
}
