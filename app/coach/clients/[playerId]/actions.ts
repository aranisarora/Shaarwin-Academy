"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type Result = { ok: boolean; error?: string };

export async function addStudentNote(
  playerId: string,
  body: string
): Promise<Result> {
  const trimmed = body.trim();
  if (!trimmed) return { ok: false, error: "Write something first." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  // RLS: only coaches/founder may insert, and author_id must be the caller.
  const { error } = await supabase.from("student_notes").insert({
    player_id: playerId,
    author_id: user.id,
    body: trimmed,
  });
  if (error) return { ok: false, error: "Couldn’t save the note." };

  revalidatePath(`/coach/clients/${playerId}`);
  return { ok: true };
}

export async function deleteStudentNote(
  playerId: string,
  noteId: string
): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  // RLS restricts deletes to the note's author (or founder).
  const { error } = await supabase.from("student_notes").delete().eq("id", noteId);
  if (error) return { ok: false, error: "Couldn’t delete the note." };

  revalidatePath(`/coach/clients/${playerId}`);
  return { ok: true };
}
