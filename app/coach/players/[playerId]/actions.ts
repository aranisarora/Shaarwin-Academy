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

  revalidatePath(`/coach/players/${playerId}`);
  revalidatePath(`/admin/players/${playerId}`);
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

  revalidatePath(`/coach/players/${playerId}`);
  revalidatePath(`/admin/players/${playerId}`);
  return { ok: true };
}

export async function submitAssessment(
  playerId: string,
  sessionId: string | null,
  ratings: { skillId: string; rating: number }[]
): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  // The assessment row itself is the "pending" completion marker, so always
  // insert it even when no ratings changed. RLS requires coach_id = caller.
  const { data: assessment, error: aErr } = await supabase
    .from("skill_assessments")
    .insert({ player_id: playerId, coach_id: user.id, session_id: sessionId })
    .select("id")
    .single();
  if (aErr) {
    // Unique (player, session, coach) — this session was already assessed.
    if (aErr.code === "23505") {
      return { ok: false, error: "Already assessed for that session." };
    }
    return { ok: false, error: "Couldn’t save the assessment." };
  }

  const clean = ratings.filter((r) => r.rating >= 1 && r.rating <= 5);
  if (clean.length > 0) {
    const { error: rErr } = await supabase.from("skill_ratings").insert(
      clean.map((r) => ({
        assessment_id: assessment.id,
        skill_id: r.skillId,
        rating: r.rating,
      }))
    );
    if (rErr) return { ok: false, error: "Couldn’t save the ratings." };
  }

  revalidatePath(`/coach/players/${playerId}`);
  revalidatePath(`/admin/players/${playerId}`);
  revalidatePath("/app");
  revalidatePath(`/app/players/${playerId}`);
  return { ok: true };
}
