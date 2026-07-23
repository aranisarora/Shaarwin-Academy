import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { AdminShell } from "@/components/app/AdminShell";
import { SkillsManager } from "@/components/app/SkillsManager";

export const metadata: Metadata = { title: "Skills" };

export default async function AdminSkillsPage() {
  const { supabase } = await requireUser("/admin/skills");

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
    <AdminShell title="Skills">
      <div className="mx-auto max-w-3xl">
        <SkillsManager
          role="founder"
          categories={categories ?? []}
          skills={skills ?? []}
        />
      </div>
    </AdminShell>
  );
}
