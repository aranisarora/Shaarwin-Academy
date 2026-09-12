import type { Metadata } from "next";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { AdminShell } from "@/components/app/AdminShell";
import { SkillsManager } from "@/components/app/SkillsManager";
import { PageSkeleton } from "@/components/ui/Skeleton";

export const metadata: Metadata = { title: "Skills" };

/** Streamed under the shell — the manager needs auth, the chrome does not. */
async function Manager() {
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
    <SkillsManager
      role="founder"
      categories={categories ?? []}
      skills={skills ?? []}
    />
  );
}

export default function AdminSkillsPage() {
  return (
    <AdminShell title="Skills">
      <div className="mx-auto max-w-3xl">
        <Suspense fallback={<PageSkeleton />}>
          <Manager />
        </Suspense>
      </div>
    </AdminShell>
  );
}
