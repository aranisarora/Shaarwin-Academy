"use server";

import { createClient } from "@/lib/supabase/server";
import { effectiveCoachId } from "@/lib/coach-preview";

export type PendingAssessment = {
  playerId: string;
  playerName: string;
  sessionId: string;
  classTitle: string;
  endedAt: string;
};

/**
 * Sessions the (effective) coach has taught in the last 7 days with attended
 * players still lacking that coach's assessment. Founder preview resolves to
 * the previewed coach so the popup mirrors what that coach would see.
 */
export async function getPendingAssessments(): Promise<PendingAssessment[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const coachId = await effectiveCoachId(user.id);
  const { data } = await supabase.rpc("get_pending_assessments", { p_coach: coachId });

  return (
    (data as
      | {
          player_id: string;
          player_name: string;
          session_id: string;
          class_title: string;
          session_ended_at: string;
        }[]
      | null) ?? []
  ).map((r) => ({
    playerId: r.player_id,
    playerName: r.player_name,
    sessionId: r.session_id,
    classTitle: r.class_title,
    endedAt: r.session_ended_at,
  }));
}
