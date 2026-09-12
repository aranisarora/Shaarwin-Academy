"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { effectiveCoachId } from "@/lib/coach-preview";

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

/**
 * File or amend this coach's assessment of a player.
 *
 * Previously an INSERT straight at `skill_assessments`, which meant the second
 * save for a session hit `skill_assessments_once_per_session` and came back as
 * "Already assessed for that session." — a dead end, because neither that table
 * nor `skill_ratings` carries an UPDATE policy, so there was no route to a
 * correction at all. A coach who tapped 1 where they meant 4 left a child's
 * mastery score wrong permanently, in a number their parent can see.
 *
 * `save_session_assessment` (migration 0077) owns the whole edit instead:
 * find-or-create on (player, session, coach), then upsert only the skills the
 * coach touched. Saving twice is now how you fix a mistake, and a skill left
 * alone keeps the rating it already had.
 */
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

  const clean = ratings.filter((r) => r.rating >= 1 && r.rating <= 5);

  // The assessment row itself is the completion marker the backlog reads, so
  // it is written even when nothing changed — "I have looked at this child and
  // they are where they were" is a real answer, and the one a coach in a hurry
  // most often gives.
  // Credited to the previewed coach inside a founder preview, to the signed-in
  // coach otherwise — the same id `getAssessmentForm` used to decide whether
  // this is a new assessment or an amendment, and the id whose backlog the save
  // has to clear. 0078 makes the author an argument for exactly this reason.
  const { error } = await supabase.rpc("save_session_assessment", {
    p_player: playerId,
    p_session: sessionId,
    p_ratings: clean.map((r) => ({ skill_id: r.skillId, rating: r.rating })),
    p_coach: await effectiveCoachId(user.id),
  });

  if (error) {
    if (error.message.includes("not_your_session")) {
      return { ok: false, error: "That class isn't on your schedule." };
    }
    return { ok: false, error: "Couldn’t save the assessment." };
  }

  revalidatePath(`/coach/players/${playerId}`);
  revalidatePath(`/admin/players/${playerId}`);
  revalidatePath("/coach");
  revalidatePath("/app");
  revalidatePath(`/app/players/${playerId}`);
  return { ok: true };
}
