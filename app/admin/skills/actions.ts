"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type Result = { ok: boolean; error?: string };

function revalidate() {
  revalidatePath("/admin/skills");
  revalidatePath("/coach/skills");
}

// ---- Categories (founder only; RLS enforces it) ----

export async function createCategory(name: string): Promise<Result> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Name the category first." };

  const supabase = await createClient();
  const { error } = await supabase.from("skill_categories").insert({ name: trimmed });
  if (error) return { ok: false, error: "Couldn’t create the category." };

  revalidate();
  return { ok: true };
}

export async function renameCategory(id: string, name: string): Promise<Result> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Name can’t be empty." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("skill_categories")
    .update({ name: trimmed })
    .eq("id", id);
  if (error) return { ok: false, error: "Couldn’t rename the category." };

  revalidate();
  return { ok: true };
}

export async function deleteCategory(id: string): Promise<Result> {
  const supabase = await createClient();
  // Cascades its skills (and their ratings) — the UI confirms first.
  const { error } = await supabase.from("skill_categories").delete().eq("id", id);
  if (error) return { ok: false, error: "Couldn’t delete the category." };

  revalidate();
  return { ok: true };
}

// ---- Skills (coaches add + deactivate; founder full control) ----

export async function createSkill(categoryId: string, name: string): Promise<Result> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Name the skill first." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const { error } = await supabase
    .from("skills")
    .insert({ category_id: categoryId, name: trimmed, created_by: user.id });
  if (error) return { ok: false, error: "Couldn’t add the skill." };

  revalidate();
  return { ok: true };
}

export async function renameSkill(id: string, name: string): Promise<Result> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Name can’t be empty." };

  const supabase = await createClient();
  const { error } = await supabase.from("skills").update({ name: trimmed }).eq("id", id);
  if (error) return { ok: false, error: "Couldn’t rename the skill." };

  revalidate();
  return { ok: true };
}

export async function setSkillActive(id: string, active: boolean): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.from("skills").update({ active }).eq("id", id);
  if (error) return { ok: false, error: "Couldn’t update the skill." };

  revalidate();
  return { ok: true };
}

export async function deleteSkill(id: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.from("skills").delete().eq("id", id);
  if (error) return { ok: false, error: "Couldn’t delete the skill." };

  revalidate();
  return { ok: true };
}
