import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { CoachShell } from "@/components/app/CoachShell";
import { SkillsManager } from "@/components/app/SkillsManager";

export const metadata: Metadata = { title: "Skills" };

export default async function CoachSkillsPage() {
  const { supabase } = await requireUser("/coach/skills");

  const [{ data: categories }, { data: skills }] = await Promise.all([
    supabase
      .from("skill_categories")
      .select("id,name,sort_order,created_at")
      .order("sort_order")
      .order("created_at"),
    supabase
      .from("skills")
      .select("id,category_id,name,active,sort_order,created_at")
      .order("sort_order")
      .order("created_at"),
  ]);

  return (
    <CoachShell title="Skills">
      <div className="mx-auto max-w-3xl">
        <p className="mb-4 text-sm text-fg-2">
          Add the skills you assess players on. Categories are set by the founder.
        </p>
        <SkillsManager
          role="coach"
          categories={categories ?? []}
          skills={skills ?? []}
        />
      </div>
    </CoachShell>
  );
}
