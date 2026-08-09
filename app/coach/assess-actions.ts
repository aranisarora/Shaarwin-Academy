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
 *
 * Kept alongside `getWrapUpQueue` below rather than folded into it: this is the
 * exact shape `lib/whatsapp/interactive.ts` composes its after-class "rate X
 * next" link from, and the two must not be able to disagree about what is
 * outstanding.
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

/** One outstanding job: a roster to mark, or a player to rate. */
export type WrapUpItem =
  | {
      kind: "attendance";
      sessionId: string;
      classTitle: string;
      endedAt: string;
      /** How many children on that roster nobody has answered for. */
      pendingCount: number;
    }
  | {
      kind: "assessment";
      sessionId: string;
      classTitle: string;
      endedAt: string;
      playerId: string;
      playerName: string;
    };

/**
 * Everything the coach still owes, oldest first, attendance ahead of the
 * assessments it gates. Drives the prompt that cycles until the list is empty.
 *
 * The old prompt asked `get_pending_assessments`, which only counts players
 * already marked ATTENDED — so a class whose roster was never touched produced
 * no attended bookings, contributed nothing, and the one screen chasing the
 * coach went quiet about the exact class they had skipped. This queue sees both
 * halves of the job.
 */
export async function getWrapUpQueue(): Promise<WrapUpItem[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const coachId = await effectiveCoachId(user.id);
  const { data } = await supabase.rpc("get_coach_wrapup_queue", { p_coach: coachId });

  const rows =
    (data as
      | {
          kind: string;
          session_id: string;
          class_title: string;
          session_ended_at: string;
          player_id: string | null;
          player_name: string | null;
          pending_count: number;
        }[]
      | null) ?? [];

  return rows.map((r) =>
    r.kind === "attendance"
      ? {
          kind: "attendance" as const,
          sessionId: r.session_id,
          classTitle: r.class_title,
          endedAt: r.session_ended_at,
          pendingCount: r.pending_count,
        }
      : {
          kind: "assessment" as const,
          sessionId: r.session_id,
          classTitle: r.class_title,
          endedAt: r.session_ended_at,
          playerId: r.player_id as string,
          playerName: r.player_name as string,
        }
  );
}

export type AssessmentForm = {
  categories: { id: string; name: string }[];
  skills: { id: string; category_id: string; name: string }[];
  /** Latest rating per skill, from any coach — the editor prefills from this. */
  ratings: Record<string, number>;
  /** True once this coach has already filed for this session: a save amends. */
  alreadyFiled: boolean;
};

/**
 * The rating form for one player, fetched on demand.
 *
 * This exists so the prompt can finish a job where it stands. Every assessment
 * used to cost a full navigation to /coach/players/[id] — a screen carrying
 * insights, a mastery breakdown, a notes thread and the whole skills grid, with
 * the editor below all of it. For a coach clearing six children after a class
 * that is six page loads and six scrolls to reach the only control they wanted.
 */
export async function getAssessmentForm(
  playerId: string,
  sessionId: string | null
): Promise<AssessmentForm> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { categories: [], skills: [], ratings: {}, alreadyFiled: false };

  const coachId = await effectiveCoachId(user.id);

  // None of these need each other — all four key off ids already in hand.
  const [{ data: categories }, { data: skills }, { data: ratingRows }, { data: filed }] =
    await Promise.all([
      supabase.from("skill_categories").select("id,name").order("sort_order").order("created_at"),
      supabase
        .from("skills")
        .select("id,category_id,name")
        .eq("active", true)
        .order("sort_order")
        .order("created_at"),
      supabase.from("latest_skill_ratings").select("skill_id,rating").eq("player_id", playerId),
      sessionId
        ? supabase
            .from("skill_assessments")
            .select("id")
            .eq("player_id", playerId)
            .eq("session_id", sessionId)
            .eq("coach_id", coachId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  const ratings: Record<string, number> = {};
  for (const r of (ratingRows as { skill_id: string; rating: number }[] | null) ?? []) {
    ratings[r.skill_id] = r.rating;
  }

  return {
    categories: categories ?? [],
    skills: skills ?? [],
    ratings,
    alreadyFiled: !!filed,
  };
}
